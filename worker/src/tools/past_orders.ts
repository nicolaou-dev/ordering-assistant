import { tool } from "ai";
import z from "zod";
import { withShopCustomer, type Sql } from "../db";

/** How many recent orders to read back. Enough for "my usual" without a wall of history. */
export const PAST_ORDERS_LIMIT = 5;

/**
 * Read this customer's own recent orders, newest first. Row-level security locks
 * the read to this shop AND this customer, so it can never surface another
 * customer's history. Returns a curated shape (no internal order id, no totals) —
 * just the lines, so the model can answer "what did I get last time?" or re-add
 * an item without leaking anything.
 */
export function pastOrdersTool({
  db,
  shopId,
  customerId,
}: {
  db: Sql;
  shopId: string;
  customerId: string;
}) {
  return tool({
    description: `Look up this customer's own recent orders (newest first, up to ${PAST_ORDERS_LIMIT}). Each order returns its date, status, fulfillment, and items as { product_id, name, qty }. Returns { orders: [...] }; an empty list means this is their first order.`,
    inputSchema: z.object({}),
    execute: async () => {
      const [rows] = await withShopCustomer(db, shopId, customerId, [
        db`SELECT o.created_at, o.status, o.fulfillment_type,
                 jsonb_agg(
                   jsonb_build_object('product_id', i.product_id, 'name', i.name, 'qty', i.qty)
                   ORDER BY i.name
                 ) AS items
           FROM orders o
           JOIN order_items i ON i.order_id = o.order_id
           GROUP BY o.order_id, o.created_at, o.status, o.fulfillment_type
           ORDER BY o.created_at DESC
           LIMIT ${PAST_ORDERS_LIMIT}`,
      ]);
      return { orders: rows };
    },
  });
}
