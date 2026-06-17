import { tool } from "ai";
import z from "zod";
import { guardQuery } from "../query_guard";
import { withShop, type Sql } from "../db";

/** Max rows returned to the model from one query_data call. */
export const ROW_CAP = 50;

/** Read-only catalog SQL, scoped to one shop under RLS. */
export function queryDataTool({ db, shopId }: { db: Sql; shopId: string }) {
  return tool({
    description:
      "Run a read-only SQL SELECT against this shop's catalog (products, shops). Results are automatically scoped to this shop. Returns up to " +
      ROW_CAP +
      " rows; if truncated is true, narrow the query.",
    inputSchema: z.object({
      sql: z.string().describe("A single SELECT/CTE against products/shops."),
    }),
    execute: async ({ sql }) => {
      const guard = guardQuery(sql);
      if ("error" in guard) return { error: guard.error };

      // Wrap to cap rows: only safe because the guard proved a single SELECT.
      const capped = `SELECT * FROM (${guard.sql}) AS _q LIMIT ${ROW_CAP + 1}`;
      try {
        const [rows] = await withShop(db, shopId, [db.query(capped)]);
        const truncated = rows.length > ROW_CAP;
        return { rows: truncated ? rows.slice(0, ROW_CAP) : rows, truncated };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });
}
