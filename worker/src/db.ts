import {
  neon,
  type NeonQueryFunction,
  type NeonQueryPromise,
} from "@neondatabase/serverless";
import type { Settings } from "./settings";

export type Sql = NeonQueryFunction<false, false>;

/** Connects as loop_agent (read-only, RLS-bound) — the agent path's role. */
export function createDb(settings: Settings): Sql {
  return neon(settings.DATABASE_URL);
}

/** Connects as the admin role (BYPASSRLS) — the catalog ingest path's role. */
export function createAdminDb(settings: Settings): Sql {
  return neon(settings.DATABASE_URL_ADMIN);
}

/**
 * Run queries scoped to one shop under row-level security.
 *
 * set_config('app.shop_id', shopId, true) sets the GUC transaction-locally; the
 * neon HTTP driver runs the whole array as a single transaction, so the setting
 * is visible to `queries` and discarded at COMMIT — no leakage between requests.
 * Without it the policies hide every row (an unset app.shop_id reads as NULL,
 * which matches nothing).
 *
 * Returns the results of `queries` (the set_config result is dropped).
 */
export async function withShop(
  sql: Sql,
  shopId: string,
  queries: NeonQueryPromise<false, false>[],
): Promise<Record<string, any>[][]> {
  const results = await sql.transaction([
    sql`SELECT set_config('app.shop_id', ${shopId}, true)`,
    ...queries,
  ]);
  return results.slice(1) as Record<string, any>[][];
}

/**
 * Run queries scoped to one shop AND one customer under row-level security.
 *
 * Same mechanism as withShop, with a second transaction-local GUC: orders /
 * order_items policies require both app.shop_id and app.customer_id, so the
 * agent reads only this customer's order history and writes orders only for
 * this customer (the INSERT's WITH CHECK matches customer_phone to the GUC).
 * Either GUC unset reads as NULL → matches nothing → fail-closed.
 */
export async function withShopCustomer(
  sql: Sql,
  shopId: string,
  customerId: string,
  queries: NeonQueryPromise<false, false>[],
): Promise<Record<string, any>[][]> {
  const results = await sql.transaction([
    sql`SELECT set_config('app.shop_id', ${shopId}, true)`,
    sql`SELECT set_config('app.customer_id', ${customerId}, true)`,
    ...queries,
  ]);
  return results.slice(2) as Record<string, any>[][];
}
