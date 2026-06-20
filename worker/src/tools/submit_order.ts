import { tool } from "ai";
import z from "zod";

/** Place the confirmed order. Delegates to the agent's shared submitOrder. */
export function submitOrderTool({
  submitOrder,
}: {
  submitOrder: () => Promise<
    | { order_id: string; total_minor: number; currency: string }
    | { error: string }
  >;
}) {
  return tool({
    description:
      "Place the order after the customer has confirmed it. Validates the order and re-checks every item against the live catalog, then writes it for the shop to approve. Returns { order_id, total_minor, currency } on success, or an error — missing details, or items whose price or stock changed.",
    inputSchema: z.object({}),
    execute: async () => {
      const result = await submitOrder();
      if (!("error" in result)) return result;
      // The error names what's missing or stale — e.g. fulfillment not recorded
      // (call set_fulfillment), no delivery address (set_address), or a price/stock
      // change. Fix that cause and retry here, in this same turn, rather than
      // handing the work to a later turn. Mirrors <turn>: the customer hears from
      // you once there's a result, so resolve it before replying.
      return {
        ...result,
        recover:
          "Fix the cause this error names and call submit_order again in this same turn. If fixing it needs something only the customer can give, ask them for it. Reply only with a real outcome or that ask, never a holding message.",
      };
    },
  });
}
