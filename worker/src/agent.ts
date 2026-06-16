import { system } from "./prompts/ordering_v1";
import { generateText, Output, stepCountIs, tool, type ModelMessage } from "ai";
import { Reply } from "./reply";
import { Agent, callable } from "agents";
import { getSettings } from "./settings";
import { createDb, withShop } from "./db";
import { guardQuery } from "./query_guard";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  addItem as addItemToOrder,
  removeItem as removeItemFromOrder,
  setFulfillment,
  setAddress,
  emptyOrder,
  renderOrderSnapshot,
  type OrderState,
  type Address,
} from "./order";
import z from "zod";

/** Max rows returned to the model from one query_data call. */
const ROW_CAP = 50;

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
   * not a typed message: drop an internal marker so the
   * model shows the order summary and asks them to confirm, then run one turn.
   * The marker is context for the model, never sent to the customer.
   */
  @callable()
  async checkout(): Promise<Reply[]> {
    this
      .sql`INSERT INTO messages (role, content) VALUES ('user', ${JSON.stringify("[The customer tapped Checkout in the storefront. Show the order summary and ask them to confirm.]")})`;
    return this.runModel();
  }

  /**
   * Return the draft order for the harness to render an order_summary reply.
   * The model only signals "show it"; the channel adapter reads the stored
   * state (items + fulfillment + total, all catalog-sourced at add_item time)
   * and formats it, so nothing in the summary comes from model output.
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
    this.setState(next);
    return next;
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

  private async runModel(): Promise<Reply[]> {
    const output = Output.array({ element: Reply });
    const settings = getSettings(this.env);
    const db = createDb(settings);
    const query_data = tool({
      description:
        "Run a read-only SQL SELECT against this shop's catalog (products, shops). Results are automatically scoped to this shop. Returns up to " +
        ROW_CAP +
        " rows; if truncated is true, narrow the query.",
      inputSchema: z.object({
        sql: z.string().describe("A single SELECT/CTE against products/shops."),
      }),
      execute: async ({ sql }) => {
        const guard = guardQuery(sql);
        if ("error" in guard) return { error: guard.error };

        // Wrap to cap rows: only safe because the guard proved a single SELECT.
        const capped = `SELECT * FROM (${guard.sql}) AS _q LIMIT ${ROW_CAP + 1}`;
        try {
          const [rows] = await withShop(db, this.shopId, [db.query(capped)]);
          const truncated = rows.length > ROW_CAP;
          return { rows: truncated ? rows.slice(0, ROW_CAP) : rows, truncated };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    });

    const add_item = tool({
      description:
        "Add qty of a catalog product (by product_id) to the order. Stock, quantity merging and the total are handled for you; returns the updated order, or an error with nothing added.",
      inputSchema: z.object({
        product_id: z.string().describe("The product_id of a catalog product."),
        qty: z.number().int().positive().describe("How many to add."),
      }),
      execute: ({ product_id, qty }) => this.addItem(product_id, qty),
    });

    const remove_item = tool({
      description:
        "Remove qty of a product (by product_id) already in the order, decrementing that line. If qty reaches or exceeds the line's quantity, the line is dropped. The total is handled for you; returns the updated order, or an error with nothing changed.",
      inputSchema: z.object({
        product_id: z
          .string()
          .describe("The product_id of a line already in the order."),
        qty: z.number().int().positive().describe("How many to remove."),
      }),
      execute: ({ product_id, qty }) => this.removeItem(product_id, qty),
    });

    const set_fulfillment = tool({
      description:
        "Record how the customer wants the order fulfilled: pickup or delivery. Call it once they say which; calling again just switches the type. Returns the updated fulfillment. Does not collect an address.",
      inputSchema: z.object({
        type: z
          .enum(["pickup", "delivery"])
          .describe("How the order is handed over."),
      }),
      execute: async ({ type }) => {
        const next = setFulfillment(this.state, type);
        this.setState(next);
        return next.fulfillment;
      },
    });

    const set_address = tool({
      description:
        "Save the customer's delivery address, parsed into parts from what they typed. line1 (street and number), city and postcode are required; line2 and notes (delivery instructions) are optional. Returns the saved address to read back for confirmation, or an error naming what's missing so you can ask the customer for it. Only for delivery orders.",
      inputSchema: z.object({
        line1: z.string().optional().describe("Street address and number."),
        line2: z.string().optional().describe("Flat, unit or second line."),
        city: z.string().optional().describe("City or town."),
        postcode: z.string().optional().describe("Postal / ZIP code."),
        notes: z.string().optional().describe("Delivery instructions."),
      }),
      execute: (fields) => this.setAddress(fields),
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
