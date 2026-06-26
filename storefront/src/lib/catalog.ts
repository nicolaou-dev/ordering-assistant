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

// The shop's storefront header, read from the shops row at build time. A shop
// created by catalog ingest has cover_url/tagline null; the page omits them.
export type Shop = { name: string; cover_url: string | null; tagline: string | null };

// import.meta.env (not process.env) — Astro exposes these to server-side code in
// both `astro dev` and `astro build`; process.env is only populated at build.
function buildEnv(): { url: string; shopId: string } {
  const url = import.meta.env.DATABASE_URL;
  const shopId = import.meta.env.SHOP_ID;
  if (!url || !shopId) {
    throw new Error("DATABASE_URL and SHOP_ID must be set to build the storefront");
  }
  return { url, shopId };
}

// Read the shop's header (name, cover, tagline) scoped to one shop via the same
// app.shop_id GUC + RLS the catalog read uses.
export async function loadShop(): Promise<Shop> {
  const { url, shopId } = buildEnv();
  const sql = neon(url);
  const [, rows] = (await sql.transaction([
    sql`SELECT set_config('app.shop_id', ${shopId}, true)`,
    sql`SELECT name, cover_url, tagline FROM shops WHERE phone_number_id = ${shopId}`,
  ])) as [unknown, Shop[]];
  const shop = rows[0];
  if (!shop) {
    throw new Error(`No shop found for SHOP_ID ${shopId}`);
  }
  return shop;
}

export async function loadCatalog(): Promise<Category[]> {
  const { url, shopId } = buildEnv();
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
  // Placeholder menu ordering until it's shop-configurable (backend-driven, its
  // own ticket): a curated priority with unknown categories falling to the end
  // alphabetically. Mains/savoury first, drinks and desserts last.
  const ORDER = [
    "Pies",
    "Vegan Pies",
    "Pizza",
    "Vegan Pizza",
    "Falafel",
    "Koupes",
    "Appetizers",
    "Desserts",
    "Drinks",
  ];
  const rank = (name: string) => {
    const i = ORDER.findIndex((c) => c.toLowerCase() === name.toLowerCase());
    return i === -1 ? ORDER.length : i;
  };
  return [...byCategory]
    .map(([name, products]) => ({ name, products }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}
