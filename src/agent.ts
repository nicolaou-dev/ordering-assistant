import { system } from "./prompts/ordering_v1";
import { generateText, Output, stepCountIs, tool, type ModelMessage } from "ai";
import { Reply } from "./reply";
import { Agent, callable } from "agents";
import { getSettings } from "./settings";
import { createAnthropic } from "@ai-sdk/anthropic";
import z from "zod";

type OrderState = {};

export class OrderAgent extends Agent<CloudflareBindings, OrderState> {
  initialState: OrderState = {};

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
    const find_products = tool({
      description:
        "Find products in this shop's catalog by name or keyword. Returns matching products with price and stock. Call once per product the customer asks about.",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }) => {
        const { results } = await this.env.DB.prepare(
          `
          SELECT p.product_id, p.name, p.description, p.category, p.price_minor, p.currency, p.in_stock
          FROM products_fts f JOIN products p ON p.rowid = f.rowid    
          WHERE products_fts MATCH ?1 AND p.shop_id = ?2 AND p.deleted_at IS NULL
          LIMIT 10
        `,
        )
          .bind(query, this.shopId)
          .all();

        return results;
      },
    });

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
      system,
      messages,
      output,
      tools: {
        find_products,
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
