import { system } from "./prompts/ordering_v1";
import { generateText, Output, type ModelMessage } from "ai";
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
    });

    for (const message of response.messages) {
      this
        .sql`INSERT INTO messages (role, content) VALUES (${message.role}, ${JSON.stringify(message.content)})`;
    }

    return replies;
  }
}
