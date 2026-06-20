import { system } from "./prompts/ordering_v1";
import { generateText, Output, stepCountIs, type ModelMessage } from "ai";
import { Reply } from "./reply";
import { Agent, callable } from "agents";
import { getSettings } from "./settings";
import { createDb, withShop } from "./db";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  addItem as addItemToOrder,
  removeItem as removeItemFromOrder,
  setAddress,
  emptyOrder,
  renderOrderSnapshot,
  type OrderState,
  type Address,
} from "./order";
import {
  queryDataTool,
  addItemTool,
  removeItemTool,
  setFulfillmentTool,
  setAddressTool,
  submitOrderTool,
} from "./tools";

export class OrderAgent extends Agent<CloudflareBindings, OrderState> {
  initialState: OrderState = emptyOrder;

  get shopId(): string {
    const [shopId, customer] = this.name.split(":");
    if (!shopId || !customer) {
      throw new Error(
        `OrderAgent name is not "<phone_number_id>:<from>": ${this.name}`,
      );
    }
    return shopId;
  }

  /** The customer's phone number — the second half of the DO name. */
  get customer(): string {
    const [shopId, customer] = this.name.split(":");
    if (!shopId || !customer) {
      throw new Error(
        `OrderAgent name is not "<phone_number_id>:<from>": ${this.name}`,
      );
    }
    return customer;
  }

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`;
  }

  @callable()
  async runTurn(prompt: string): Promise<Reply[]> {
    this
      .sql`INSERT INTO messages (role, content) VALUES ('user', ${JSON.stringify(prompt)})`;
    return this.runModel();
  }

  /**
   * The customer tapped Checkout in the storefront. A deterministic trigger,
   * not a typed message: drop an internal marker recording the one fact the
   * order state can't express — they've finished adding items, so don't ask
   * "anything else?" — and let the prompt's <flow> take it from there (confirm
   * the order, address if delivery, then submit). The marker is context for the
   * model, never sent to the customer.
   */
  @callable()
  async checkout(): Promise<Reply[]> {
    this
      .sql`INSERT INTO messages (role, content) VALUES ('user', ${JSON.stringify("[The customer tapped Checkout in the storefront — they've finished adding items, so don't ask if they'd like anything else. Carry on with the order from here.]")})`;
    return this.runModel();
  }

  /**
   * The shop approved this customer's submitted order. Like checkout(), a
   * deterministic trigger rather than a typed message: drop an internal marker
   * so the model tells the customer their order was approved, then run one turn.
   * The submitted order lives in Neon (the DO draft was cleared at submit), so
   * the model speaks from the conversation history, not the draft state. The
   * marker is context for the model, never sent to the customer.
   */
  @callable()
  async notifyApproved(): Promise<Reply[]> {
    this
      .sql`INSERT INTO messages (role, content) VALUES ('user', ${JSON.stringify("[The shop approved the customer's order. Let them know it's confirmed and being prepared.]")})`;
    return this.runModel();
  }

  /**
   * The current draft order state. Read by the storefront cart endpoints and the
   * debug/state seam; the order snapshot the model sees is rendered from this
   * same state each turn, so it's the single source of truth for the order.
   */
  @callable()
  getOrderState(): OrderState {
    return this.state;
  }

  /**
   * Operator escape hatch: clear this agent's session — order state and message
   * history — so the next turn starts fresh. We clear in place rather than
   * destroy() the Durable Object: destroy() ends with ctx.abort("destroyed"),
   * which tears down the DO mid-RPC and fails the caller's request even though
   * the wipe ran. Clearing state directly returns cleanly.
   */
  @callable()
  reset(): void {
    this.sql`DELETE FROM messages`;
    this.setState(emptyOrder);
  }

  /**
   * Add qty of a catalog product to the draft, scoped to this shop. The shared
   * core for both the model's add_item tool and the storefront's /cart endpoint,
   * so the stock check, quantity merge and total stay identical on both paths.
   * Returns the next order state, or an error with nothing changed.
   */
  @callable()
  async addItem(
    product_id: string,
    qty: number,
  ): Promise<OrderState | { error: string }> {
    const db = createDb(getSettings(this.env));
    const [rows] = await withShop(db, this.shopId, [
      db`SELECT product_id, name, price_minor, currency, in_stock
         FROM products
         WHERE product_id = ${product_id} AND deleted_at IS NULL`,
    ]);
    const product = rows[0];
    if (!product)
      return {
        error: `Unknown product_id "${product_id}". Find the right one with query_data.`,
      };
    if (!product.in_stock) return { error: `"${product.name}" is out of stock.` };

    const next = addItemToOrder(
      this.state,
      {
        product_id: product.product_id,
        name: product.name,
        unit_price_minor: product.price_minor,
        currency: product.currency,
      },
      qty,
    );
    // Seed the idempotency key the moment the draft becomes non-empty, so it's
    // stable for every later submit_order retry of this same draft.
    const seeded = next.draftId
      ? next
      : { ...next, draftId: crypto.randomUUID() };
    this.setState(seeded);
    return seeded;
  }

  /**
   * Remove qty of a line already in the draft. Shared core for the remove_item
   * tool and the /cart endpoint. Returns the next state, or an error.
   */
  @callable()
  removeItem(product_id: string, qty: number): OrderState | { error: string } {
    if (!this.state.items.some((i) => i.product_id === product_id))
      return {
        error: `product_id "${product_id}" is not in the order. Check the current order snapshot.`,
      };
    const next = removeItemFromOrder(this.state, product_id, qty);
    this.setState(next);
    return next;
  }

  /**
   * Validate and save the delivery address the model parsed from the customer's
   * message. line1, city and postcode are required; missing ones come back as a
   * helpful error so the model asks for them rather than saving a partial
   * address. Trims fields and drops empty optionals. Returns the saved address
   * for the model to read back to the customer.
   */
  setAddress(fields: Partial<Address>): Address | { error: string } {
    const trimmed = (v: string | undefined) => v?.trim() || undefined;
    const required = { line1: "street address", city: "city", postcode: "postcode" } as const;
    const missing = Object.entries(required)
      .filter(([k]) => !trimmed(fields[k as keyof Address]))
      .map(([, label]) => label);
    if (missing.length)
      return {
        error: `Address not saved — missing the ${missing.join(", ")}. Ask the customer for the missing part(s), then call set_address again.`,
      };
    const address: Address = {
      line1: trimmed(fields.line1)!,
      city: trimmed(fields.city)!,
      postcode: trimmed(fields.postcode)!,
      ...(trimmed(fields.line2) && { line2: trimmed(fields.line2) }),
      ...(trimmed(fields.notes) && { notes: trimmed(fields.notes) }),
    };
    this.setState(setAddress(this.state, address));
    return address;
  }

  /**
   * Place the confirmed order. Every guard here is deterministic code — the
   * model is never the last line of defence where money is committed:
   *  - preconditions: items present, fulfillment set, address present for delivery;
   *  - revalidate every line against the live catalog (stock + current price)
   *    under RLS, never trusting the DO snapshot's money;
   *  - write the order + items in one transaction, then clear the DO draft.
   *
   * Returns { order_id, total_minor, currency } on success, or { error } the
   * model relays. If a price moved, the corrected price is synced into the draft
   * and the submit aborts, so the customer re-confirms against the right total
   * before it's written. A retried submit of the same draft collapses to one
   * order via the idempotency_key UNIQUE.
   */
  async submitOrder(): Promise<
    { order_id: string; total_minor: number; currency: string } | { error: string }
  > {
    const state = this.state;
    if (state.items.length === 0)
      return { error: "The order is empty — add at least one item before submitting." };
    if (!state.fulfillment.type)
      return {
        error:
          "Fulfillment isn't set — confirm pickup or delivery with set_fulfillment first.",
      };
    if (state.fulfillment.type === "delivery" && !state.fulfillment.address)
      return {
        error:
          "This is a delivery but there's no address yet — collect it with set_address first.",
      };

    const db = createDb(getSettings(this.env));

    // Revalidate: prices and stock may have moved since the items were added.
    // Re-read under RLS; the order is written from these live values, not the
    // DO snapshot's.
    const ids = state.items.map((i) => i.product_id);
    const [rows] = await withShop(db, this.shopId, [
      db`SELECT product_id, name, price_minor, currency, in_stock
         FROM products WHERE product_id = ANY(${ids}) AND deleted_at IS NULL`,
    ]);
    const live = new Map(
      (
        rows as {
          product_id: string;
          name: string;
          price_minor: number;
          currency: string;
          in_stock: boolean;
        }[]
      ).map((r) => [r.product_id, r]),
    );

    const changes: string[] = [];
    let priceSynced = false;
    const items = state.items.map((i) => ({ ...i }));
    for (const item of items) {
      const p = live.get(item.product_id);
      if (!p) {
        changes.push(`${item.name} is no longer available`);
      } else if (!p.in_stock) {
        changes.push(`${item.name} is out of stock`);
      } else if (p.price_minor !== item.unit_price_minor) {
        changes.push(`${item.name}'s price has changed`);
        item.unit_price_minor = p.price_minor;
        item.currency = p.currency;
        priceSynced = true;
      }
    }

    if (changes.length) {
      // Sync corrected prices into the draft so a re-confirm converges; never
      // write a divergent order. Unavailable items the model clears with
      // remove_item or by offering alternatives.
      if (priceSynced) {
        const total = items.reduce((s, i) => s + i.unit_price_minor * i.qty, 0);
        this.setState({ ...state, items, total_minor: total });
      }
      return {
        error: `The order can't be placed as-is — ${changes.join(
          "; ",
        )}. Tell the customer, remove any unavailable items, and re-confirm the updated order before submitting again.`,
      };
    }

    const orderId = crypto.randomUUID();
    const idempotencyKey = `${this.name}:${state.draftId}`;
    const currency = items[0].currency;
    const total = items.reduce((s, i) => s + i.unit_price_minor * i.qty, 0);
    const addr = state.fulfillment.address;

    try {
      await withShop(db, this.shopId, [
        db`INSERT INTO orders (
             order_id, shop_id, customer_phone, fulfillment_type,
             address_line1, address_line2, address_city, address_postcode, address_notes,
             currency, total_minor, idempotency_key
           ) VALUES (
             ${orderId}, ${this.shopId}, ${this.customer}, ${state.fulfillment.type},
             ${addr?.line1 ?? null}, ${addr?.line2 ?? null}, ${addr?.city ?? null},
             ${addr?.postcode ?? null}, ${addr?.notes ?? null},
             ${currency}, ${total}, ${idempotencyKey}
           )`,
        ...items.map(
          (i) =>
            db`INSERT INTO order_items
                 (order_id, product_id, name, unit_price_minor, qty, line_total_minor)
               VALUES (${orderId}, ${i.product_id}, ${i.name},
                 ${i.unit_price_minor}, ${i.qty}, ${i.unit_price_minor * i.qty})`,
        ),
      ]);
    } catch (e) {
      // A retried submit of the same draft hits idempotency_key UNIQUE (23505):
      // the order already exists, so return it instead of erroring or writing
      // twice.
      if ((e as { code?: string }).code === "23505") {
        const [existing] = await withShop(db, this.shopId, [
          db`SELECT order_id, total_minor, currency
             FROM orders WHERE idempotency_key = ${idempotencyKey}`,
        ]);
        const row = existing[0] as
          | { order_id: string; total_minor: number; currency: string }
          | undefined;
        if (row) {
          this.setState(emptyOrder);
          return row;
        }
      }
      throw e;
    }

    this.setState(emptyOrder);
    return { order_id: orderId, total_minor: total, currency };
  }

  private async runModel(): Promise<Reply[]> {
    const output = Output.array({ element: Reply });
    const settings = getSettings(this.env);
    const db = createDb(settings);
    const query_data = queryDataTool({ db, shopId: this.shopId });
    const add_item = addItemTool({
      addItem: (product_id, qty) => this.addItem(product_id, qty),
    });
    const remove_item = removeItemTool({
      removeItem: (product_id, qty) => this.removeItem(product_id, qty),
    });
    const set_fulfillment = setFulfillmentTool({
      getState: () => this.state,
      setState: (state) => this.setState(state),
    });
    const set_address = setAddressTool({
      setAddress: (fields) => this.setAddress(fields),
    });
    const submit_order = submitOrderTool({
      submitOrder: () => this.submitOrder(),
    });

    // One scoped read per turn: shop name + categories with item counts. RLS
    // already limits both to this shop, so neither query needs a shop_id filter.
    const [nameRows, catRows] = await withShop(db, this.shopId, [
      db`SELECT name FROM shops`,
      db`SELECT category, count(*)::int AS count
         FROM products WHERE deleted_at IS NULL GROUP BY category`,
    ]);
    const shopName = (nameRows[0]?.name as string | undefined) ?? null;
    const categories = catRows as { category: string; count: number }[];

    const model = createAnthropic({ apiKey: settings.ANTHROPIC_API_KEY })(
      "claude-haiku-4-5",
    );

    const rows = this.sql<{
      role: string;
      content: string;
    }>`SELECT role, content FROM messages ORDER BY id`;

    const messages = rows.map((r) => ({
      role: r.role,
      content: JSON.parse(r.content),
    })) as ModelMessage[];

    const { output: replies, response } = await generateText({
      model,
      system: system({ shopName, categories }, renderOrderSnapshot(this.state)),
      messages,
      output,
      tools: {
        query_data,
        add_item,
        remove_item,
        set_fulfillment,
        set_address,
        submit_order,
      },
      stopWhen: stepCountIs(5),
    });

    for (const message of response.messages) {
      this
        .sql`INSERT INTO messages (role, content) VALUES (${message.role}, ${JSON.stringify(message.content)})`;
    }

    return replies;
  }
}
