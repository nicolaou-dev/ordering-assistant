import { system } from "./prompts/ordering_v1";
import { generateText, Output } from "ai";
import { Reply } from "./reply";
import { Agent, callable } from "agents";
import { getSettings } from "./settings";
import { createAnthropic } from "@ai-sdk/anthropic";

type OrderState = {};

export class OrderAgent extends Agent<CloudflareBindings, OrderState> {
  initialState: OrderState = {};

  @callable()
  async runTurn(prompt: string): Promise<Reply[]> {
    const output = Output.array({ element: Reply });
    const settings = getSettings(this.env);

    const model = createAnthropic({ apiKey: settings.ANTHROPIC_API_KEY })(
      "claude-haiku-4-5",
    );

    const { output: replies } = await generateText({
      model,
      system,
      prompt,
      output,
    });

    return replies;
  }
}
