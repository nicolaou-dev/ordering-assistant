import { tool } from "ai";
import z from "zod";
import { setName, type OrderState } from "../order";

/** Record the customer's name. Reads and writes the agent's state. */
export function setNameTool({
  getState,
  setState,
}: {
  getState: () => OrderState;
  setState: (state: OrderState) => void;
}) {
  return tool({
    description:
      "Record who the order is for — the customer's name — once they tell you, so you can address them by it. Save exactly the name they give; don't invent one. Returns the saved name. Pass an empty name to clear it.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("The customer's name, as they gave it. Empty to clear."),
    }),
    execute: async ({ name }) => {
      const next = setName(getState(), name);
      setState(next);
      return { name: next.customerName };
    },
  });
}
