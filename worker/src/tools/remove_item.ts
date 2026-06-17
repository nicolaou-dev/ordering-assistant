import { tool } from "ai";
import z from "zod";
import type { OrderState } from "../order";

/** Remove a line from the draft. Delegates to the agent's shared removeItem. */
export function removeItemTool({
  removeItem,
}: {
  removeItem: (product_id: string, qty: number) => OrderState | { error: string };
}) {
  return tool({
    description:
      "Remove qty of a product (by product_id) already in the order, decrementing that line. If qty reaches or exceeds the line's quantity, the line is dropped. The total is handled for you; returns the updated order, or an error with nothing changed.",
    inputSchema: z.object({
      product_id: z
        .string()
        .describe("The product_id of a line already in the order."),
      qty: z.number().int().positive().describe("How many to remove."),
    }),
    execute: ({ product_id, qty }) => removeItem(product_id, qty),
  });
}
