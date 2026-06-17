import { tool } from "ai";
import z from "zod";
import { guardQuery } from "../query_guard";
import { withShop, type Sql } from "../db";

/** Max rows returned to the model from one query_data call. */
export const ROW_CAP = 50;

/** Read-only catalog SQL, scoped to one shop under RLS. */
export function queryDataTool({ db, shopId }: { db: Sql; shopId: string }) {
  return tool({
    description: `Run one read-only SQL SELECT over this shop's catalog and read the rows back. Use it before you mention any product, price, or availability.

Catalog (PostgreSQL), already scoped to this shop:

products
- product_id  TEXT     primary key
- category    TEXT     e.g. 'Pizza', 'Drinks'
- name        TEXT     product name
- description TEXT     may be NULL
- price_minor INTEGER  price in minor units (cents): 1050 = €10.50
- currency    TEXT     ISO code, e.g. 'EUR'
- in_stock    BOOLEAN  true when available
- deleted_at  TIMESTAMPTZ  set when a product is removed — keep "deleted_at IS NULL"
- search      tsvector  keyword index over name, description, category (whole words). Match with: search @@ plainto_tsquery('simple', 'words')

shops
- name TEXT  the shop's display name

Write a single SELECT or CTE (the tool is read-only). Keep "deleted_at IS NULL" on products. Rows already come from this shop only, so leave out any shop_id filter. To find an item, match both ways at once: (search @@ plainto_tsquery('simple', 'words') OR name ILIKE '%word%') — search catches whole words, ILIKE partial ones. The result carries a "next" hint for what to do with the rows; returns up to ${ROW_CAP} rows (truncated true if there were more).`,
    inputSchema: z.object({
      sql: z.string().describe("A single SELECT/CTE against products/shops."),
    }),
    execute: async ({ sql }) => {
      const guard = guardQuery(sql);
      if ("error" in guard) return { error: guard.error };

      // Wrap to cap rows: only safe because the guard proved a single SELECT.
      const capped = `SELECT * FROM (${guard.sql}) AS _q LIMIT ${ROW_CAP + 1}`;
      try {
        const [raw] = await withShop(db, shopId, [db.query(capped)]);
        const truncated = raw.length > ROW_CAP;
        const rows = truncated ? raw.slice(0, ROW_CAP) : raw;
        return { rows, truncated, next: nextHint(rows.length) };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });
}

// Just-in-time guidance returned alongside the rows: what to do next depends on
// how many matched, so the steer travels with the result rather than living as a
// static rule in the prompt. The model can always override for a clear request.
function nextHint(count: number): string {
  if (count === 0) {
    return "No match. Try one more search for a close alternative; if you find one, offer it and send the menu too. If nothing fits, send the menu.";
  }
  if (count <= 3) {
    return "If the customer named an item to order, show these with a product_list. If they were just asking, answer in a short text.";
  }
  return "Lots matched — send the menu so they can browse, or ask the customer to narrow it down.";
}
