import { tool } from "ai";
import z from "zod";
import type { OrderState } from "../order";

/** Add a catalog product to the draft. Delegates to the agent's shared addItem. */
export function addItemTool({
  addItem,
}: {
  addItem: (
    product_id: string,
    qty: number,
  ) => Promise<OrderState | { error: string }>;
}) {
  return tool({
    description:
      "Add qty of a catalog product (by product_id) to the order. Stock, quantity merging and the total are handled for you; returns the updated order, or an error with nothing added.",
    inputSchema: z.object({
      product_id: z.string().describe("The product_id of a catalog product."),
      qty: z.number().int().positive().describe("How many to add."),
    }),
    execute: ({ product_id, qty }) => addItem(product_id, qty),
  });
}
