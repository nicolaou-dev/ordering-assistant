import { system } from "./prompts/ordering_v1";
import { generateText, Output, stepCountIs, tool, type ModelMessage } from "ai";
import { Reply } from "./reply";
import { Agent, callable } from "agents";
import { getSettings } from "./settings";
import { createDb, withShop } from "./db";
import { guardQuery } from "./query_guard";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  addItem,
  removeItem,
  emptyOrder,
  renderOrderSnapshot,
  type OrderState,
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
      execute: async ({ product_id, qty }) => {
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
        if (!product.in_stock)
          return { error: `"${product.name}" is out of stock.` };

        const next = addItem(
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
      },
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
      execute: async ({ product_id, qty }) => {
        if (!this.state.items.some((i) => i.product_id === product_id))
          return {
            error: `product_id "${product_id}" is not in the order. Check the current order snapshot.`,
          };

        const next = removeItem(this.state, product_id, qty);
        this.setState(next);
        return next;
      },
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

    this
      .sql`INSERT INTO messages (role, content) VALUES ('user', ${JSON.stringify(prompt)})`;

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
