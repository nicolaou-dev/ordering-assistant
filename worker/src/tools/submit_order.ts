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
    execute: () => submitOrder(),
  });
}
