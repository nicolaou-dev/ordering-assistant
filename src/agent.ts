import { system } from "./prompts/ordering_v1";
import { generateText, LanguageModel } from "ai";

type Prompt = string;

export const createAgent = (model: LanguageModel) => {
  return {
    run: async (prompt: Prompt) => {
      const { text } = await generateText({
        model,
        system,
        prompt,
      });
      return text;
    },
  };
};
