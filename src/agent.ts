import { system } from "./prompts/ordering_v1";
import { generateText, Output } from "ai";
import { Reply } from "./reply";
import { Agent, callable } from "agents";
import { getSettings } from "./settings";
import { createAnthropic } from "@ai-sdk/anthropic";

type OrderState = {};

export class OrderAgent extends Agent<CloudflareBindings, OrderState> {
  initialState: OrderState = {};

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

    const model = createAnthropic({ apiKey: settings.ANTHROPIC_API_KEY })(
      "claude-haiku-4-5",
    );

    this.sql`INSERT INTO messages (role, content) VALUES ('user', ${prompt})`;

    const rows = this.sql<{
      role: string;
      content: string;
    }>`SELECT role, content FROM messages ORDER BY id`;

    const messages = rows.map((r) => ({
      role: r.role as "user" | "assistant",
      content:
        r.role === "assistant"
          ? (JSON.parse(r.content) as Reply[]).map((x) => x.body).join("\n")
          : r.content,
    }));

    const { output: replies } = await generateText({
      model,
      system,
      messages,
      output,
    });

    this
      .sql`INSERT INTO messages (role, content) VALUES ('assistant', ${JSON.stringify(replies)})`;

    return replies;
  }
}
