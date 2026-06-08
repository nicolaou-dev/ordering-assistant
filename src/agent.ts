import { system } from "./prompts/ordering_v1";
import { generateText, LanguageModel, Output } from "ai";
import { Reply } from "./reply";

type Prompt = string;

export const createAgent = (model: LanguageModel) => {
  return {
    run: async (prompt: Prompt) => {
      const output = Output.array({ element: Reply });
      const { output: replies } = await generateText({
        model,
        system,
        prompt,
        output,
      });
      return replies;
    },
  };
};
