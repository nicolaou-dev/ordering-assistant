import { tool } from "ai";
import z from "zod";
import { setPaymentMethod, type OrderState } from "../order";

/** Record cash/card payment on the draft. Reads and writes the agent's state. */
export function setPaymentMethodTool({
  getState,
  setState,
}: {
  getState: () => OrderState;
  setState: (state: OrderState) => void;
}) {
  return tool({
    description:
      "Record how the customer pays: cash or card — the method the customer has actually chosen. Call it once they say which; calling again just switches it. If they haven't chosen, ask them — don't assume a default. Returns the updated payment method. Cash completes with no payment step; card is paid via a link, handled separately.",
    inputSchema: z.object({
      method: z.enum(["cash", "card"]).describe("How the customer pays."),
    }),
    execute: async ({ method }) => {
      const next = setPaymentMethod(getState(), method);
      setState(next);
      return { payment_method: next.payment_method };
    },
  });
}
