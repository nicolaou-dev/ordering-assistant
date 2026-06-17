import { tool } from "ai";
import z from "zod";
import { setFulfillment, type OrderState } from "../order";

/** Record pickup/delivery on the draft. Reads and writes the agent's state. */
export function setFulfillmentTool({
  getState,
  setState,
}: {
  getState: () => OrderState;
  setState: (state: OrderState) => void;
}) {
  return tool({
    description:
      "Record how the customer wants the order fulfilled: pickup or delivery. Call it once they say which; calling again just switches the type. Returns the updated fulfillment. Does not collect an address.",
    inputSchema: z.object({
      type: z
        .enum(["pickup", "delivery"])
        .describe("How the order is handed over."),
    }),
    execute: async ({ type }) => {
      const next = setFulfillment(getState(), type);
      setState(next);
      return next.fulfillment;
    },
  });
}
