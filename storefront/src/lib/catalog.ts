import { neon } from "@neondatabase/serverless";

// Build-time catalog read. Runs in the Astro frontmatter (Node, at build), so
// the product grid is static HTML — no DB call in the browser. Connects as the
// read-only loop_agent role and scopes the read to one shop via the same
// app.shop_id GUC the Worker uses (RLS hides every row when it is unset).

export type Product = {
  product_id: string;
  category: string;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  image_url: string | null;
  in_stock: boolean;
};

export type Category = { name: string; products: Product[] };

export async function loadCatalog(): Promise<Category[]> {
  // import.meta.env (not process.env) — Astro exposes these to server-side code
  // in both `astro dev` and `astro build`; process.env is only populated at build.
  const url = import.meta.env.DATABASE_URL;
  const shopId = import.meta.env.SHOP_ID;
  if (!url || !shopId) {
    throw new Error("DATABASE_URL and SHOP_ID must be set to build the storefront");
  }

  const sql = neon(url);
  const [, products] = (await sql.transaction([
    sql`SELECT set_config('app.shop_id', ${shopId}, true)`,
    sql`SELECT product_id, category, name, description, price_minor, currency, image_url, in_stock
        FROM products
        WHERE deleted_at IS NULL
        ORDER BY category, name`,
  ])) as [unknown, Product[]];

  // Group into categories, preserving the query's category order.
  const byCategory = new Map<string, Product[]>();
  for (const p of products) {
    const group = byCategory.get(p.category) ?? [];
    group.push(p);
    byCategory.set(p.category, group);
  }
  return [...byCategory].map(([name, products]) => ({ name, products }));
}
