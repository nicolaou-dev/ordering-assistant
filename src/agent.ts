import { system } from "./prompts/ordering_v1";
import { generateText, Output, stepCountIs, tool, type ModelMessage } from "ai";
import { Reply } from "./reply";
import { Agent, callable } from "agents";
import { getSettings } from "./settings";
import { createDb, withShop } from "./db";
import { guardQuery } from "./query_guard";
import { createAnthropic } from "@ai-sdk/anthropic";
import z from "zod";

type OrderState = {};

/** Max rows returned to the model from one query_data call. */
const ROW_CAP = 50;

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
        query_data,
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
