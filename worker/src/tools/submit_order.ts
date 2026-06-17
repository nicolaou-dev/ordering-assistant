import { tool } from "ai";
import z from "zod";

/** Place the confirmed order. Delegates to the agent's shared submitOrder. */
export function submitOrderTool({
  submitOrder,
}: {
  submitOrder: () => Promise<
    { order_id: string; total_minor: number; currency: string } | { error: string }
  >;
}) {
  return tool({
    description:
      "Place the order after the customer has confirmed the summary. Validates the order and re-checks every item against the live catalog, then writes it for the shop to approve. Returns { order_id, total_minor, currency } on success, or an error to relay — missing details, or items whose price or stock changed (fix those and re-confirm, then try again).",
    inputSchema: z.object({}),
    execute: async () => {
      const result = await submitOrder();
      if ("error" in result) return result;
      return {
        ...result,
        next: "Tell the customer their order has been sent to the shop for approval and they'll get a message once it's confirmed; include the total (total_minor is minor units, e.g. 850 = 8.50). order_id is an internal reference — don't read it out.",
      };
    },
  });
}
