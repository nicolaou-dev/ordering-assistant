import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { getSettings } from "./settings";
import { OrderAgent } from "./agent";
import { verifySignature } from "./verify";
import { mintCartToken, verifyCartToken } from "./cart_token";
import z from "zod";
import { createClient } from "./whatsapp/client";
import { formatProductCaption, type ProductRow } from "./whatsapp/product";
import { createAdminDb, createDb, withShop, type Sql } from "./db";
import type { Reply } from "./reply";
import { getAgentByName } from "agents";
import * as XLSX from "xlsx";
import { verifyNeonAuthToken } from "./neon_auth";

export { OrderAgent };

// Deliver the agent's replies to one customer over WhatsApp. Shared by the
// inbound webhook and the storefront checkout endpoint so both render replies
// identically (text / product images / menu link). Send failures are logged,
// not thrown — one failed message must not drop the rest.
type SendCtx = {
  client: ReturnType<typeof createClient>;
  to: string;
  sql: Sql;
  shopId: string;
  menuLink: () => Promise<string>;
};

async function sendReplies(replies: Reply[], ctx: SendCtx): Promise<void> {
  const { client, to, sql, shopId, menuLink } = ctx;
  for (const reply of replies) {
    try {
      if (reply.type === "text") {
        await client.send(to, reply.message);
      } else if (reply.type === "product_list") {
        // Optional lead-in line before the product cards.
        if (reply.message) await client.send(to, reply.message);
        // Hydrate each id from the catalog (scoped to this shop) and send it as a
        // native image + caption, so prices/details come from Postgres, never the
        // model's tokens. One atomic image+caption per product keeps the name,
        // price and description attached to the image; no image_url falls back to text.
        const [rows] = await withShop(sql, shopId, [
          sql`SELECT product_id, name, description, price_minor, currency, image_url
              FROM products
              WHERE product_id = ANY(${reply.product_ids}) AND deleted_at IS NULL`,
        ]);
        const byId = new Map(
          (rows as ProductRow[]).map((r) => [r.product_id, r]),
        );
        for (const id of reply.product_ids) {
          const product = byId.get(id);
          if (!product) {
            console.log("product_list: unknown product_id, skipping", { id });
            continue;
          }
          const caption = formatProductCaption(product);
          if (product.image_url) {
            await client.sendImage(to, product.image_url, caption);
          } else {
            await client.send(to, caption);
          }
        }
      } else if (reply.type === "menu") {
        // Render as an interactive CTA URL button ("Menu") rather than a text
        // with the raw link, so the customer taps a button instead of a URL. The
        // model's words are the button's accompanying text.
        await client.sendCtaUrl(to, reply.message, "Menu", await menuLink());
      }
    } catch (e) {
      console.error("sendReplies: failed to send a reply", {
        to,
        type: reply.type,
        error: (e as Error).message,
      });
    }
  }
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

// The storefront calls /cart from a different origin (Cloudflare Pages). Auth is
// the signed token in the body, not a cookie, so an open origin is safe.
app.use("/cart/*", cors());

// The seller app is its own origin (separate deploy) and authenticates with a
// Neon Auth Bearer token, not a cookie — so an open origin is safe here too.
// Covers the seller context (/seller/me), the orders read, and the approve action.
app.use("/seller/*", cors());
app.use("/orders", cors());
app.use("/orders/*", cors());

app.get("/healthz", (c) => {
  return c.json({ ok: true, ts: new Date().toISOString() });
});

app.get("/webhook/whatsapp", (c) => {
  const settings = getSettings(c.env);
  const mode = c.req.query("hub.mode");
  const verify_token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (
    mode === "subscribe" &&
    settings.WHATSAPP_VERIFY_TOKEN === verify_token &&
    challenge
  ) {
    return c.text(challenge, 200);
  }

  return c.text("Forbidden", 403);
});

const Value = z.object({
  metadata: z.object({ phone_number_id: z.string() }),
  messages: z
    .array(
      z.object({
        from: z.string(),
        id: z.string(),
        type: z.string(),
        text: z.object({ body: z.string() }).optional(),
      }),
    )
    .nonempty(),
});

app.post("/webhook/whatsapp", async (c) => {
  const settings = getSettings(c.env);
  const rawBody = await c.req.text();
  const header = c.req.header("x-hub-signature-256");

  const valid = await verifySignature(
    rawBody,
    settings.WHATSAPP_APP_SECRET,
    header,
  );

  if (!valid) {
    return c.body(null, 401);
  }

  const body = JSON.parse(rawBody);
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const parsed = Value.safeParse(value);

  if (!parsed.success) {
    return c.body(null, 200);
  }

  const { phone_number_id } = parsed.data.metadata;
  const { from, id, text } = parsed.data.messages[0];
  const sessionKey = `${phone_number_id}:${from}`;

  const handleInbound = async () => {
    // Webhook idempotency on Neon (one datastore now D1 is gone): WhatsApp
    // delivers each event at least once, so record every message_id and skip
    // repeats. The table is global — message_id is unique across the whole WABA —
    // so it has no RLS and is written by the admin/owner role; loop_agent (the
    // RLS-scoped shop reader) never touches it. A new row back means first
    // delivery; ON CONFLICT DO NOTHING returning nothing means a duplicate.
    const db = createAdminDb(settings);
    const [seen] = await db`
      INSERT INTO inbound_messages (message_id) VALUES (${id})
      ON CONFLICT (message_id) DO NOTHING
      RETURNING message_id`;

    if (!seen) {
      console.log("deduped", { id });
      return;
    }

    console.log("inbound", { from, id, text: text?.body });

    // Only typed messages drive a turn; ignore anything else.
    if (!text?.body) return;

    const client = createClient(settings);

    // Await so the read receipt + typing indicator are actually sent before the
    // slow agent turn — and not cancelled when a fast turn lets handleInbound
    // (and its waitUntil) settle before a detached fetch finishes. Catch so a
    // markReadTyping failure logs but never blocks the reply.
    await client.markReadTyping(id).catch((e) => {
      console.error("markReadTyping failed", {
        id,
        error: (e as Error).message,
      });
    });

    const stub = await getAgentByName(c.env.OrderAgent, sessionKey);
    const replies = await stub.runTurn(text.body);

    await sendReplies(replies, {
      client,
      to: from,
      sql: createDb(settings),
      shopId: phone_number_id,
      menuLink: async () =>
        `${settings.STOREFRONT_URL}/?t=${await mintCartToken(phone_number_id, from, settings.WHATSAPP_APP_SECRET)}`,
    });
  };

  c.executionCtx.waitUntil(handleInbound());

  return c.body(null, 200);
});

const Row = z.object({
  category: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  image_url: z.string().optional(),
  price: z
    .union([z.string(), z.number()])
    .transform((p) => Number(p))
    .refine(
      (n) => Number.isInteger(n),
      "price must be an integer (minor units)",
    ),
  in_stock: z.boolean(),
});

const Rows = z.array(Row);

async function productId(shopId: string, category: string, name: string) {
  const data = new TextEncoder().encode(`${shopId}\n${category}\n${name}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Authenticate a seller request by its Neon Auth bearer token and resolve the
// shop they own. Throws 401 on a missing/invalid token, 403 when the user owns
// no shop. The seller order endpoints derive shop_id from this — never from the
// path or ADMIN_TOKEN. (First slice assumes a single shop per owner.)
async function sellerShopId(
  c: Context<{ Bindings: CloudflareBindings }>,
): Promise<string> {
  const settings = getSettings(c.env);
  const token = c.req.header("Authorization")?.slice(7);
  // Neon Auth signs tokens with iss = the deployment origin (no /neondb/auth
  // path), so validate against the base URL's origin.
  const issuer = new URL(settings.NEON_AUTH_BASE_URL).origin;
  const userId = token
    ? await verifyNeonAuthToken(token, settings.NEON_AUTH_JWKS_URL, issuer)
    : null;
  if (!userId) throw new HTTPException(401, { message: "invalid auth token" });

  const sql = createAdminDb(settings);
  const [row] =
    await sql`SELECT shop_id FROM shop_owners WHERE user_id = ${userId} LIMIT 1`;
  if (!row) throw new HTTPException(403, { message: "no shop for this user" });
  return row.shop_id as string;
}

app.post("/admin/catalog/:shop_id", async (c) => {
  const settings = getSettings(c.env);
  const bearer = c.req.header("Authorization");
  const token = bearer?.slice(7);

  if (token !== settings.ADMIN_TOKEN) {
    return c.body(null, 401);
  }

  const shopId = c.req.param("shop_id");
  const buf = await c.req.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buf), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet);
  const parsed = Rows.safeParse(rawRows);
  if (!parsed.success) {
    return c.json({ errors: parsed.error.issues }, 400);
  }
  const products = await Promise.all(
    parsed.data.map(async (r) => ({
      product_id: await productId(shopId, r.category, r.name),
      category: r.category,
      name: r.name,
      description: r.description ?? null,
      price_minor: r.price,
      image_url: r.image_url ?? null,
      in_stock: r.in_stock,
    })),
  );
  const ids = products.map((p) => p.product_id);

  // The admin role has BYPASSRLS, so writes target the path's shop_id directly
  // without set_config. One transaction: shop first (products FK it), then a
  // single UNNEST upsert of every row, then soft-delete rows absent from this
  // upload.
  const sql = createAdminDb(settings);
  await sql.transaction([
    sql`INSERT INTO shops (phone_number_id, name) VALUES (${shopId}, ${shopId})
        ON CONFLICT (phone_number_id) DO NOTHING`,
    sql`INSERT INTO products (product_id, shop_id, category, name, description, price_minor, image_url, in_stock)
        SELECT product_id, ${shopId}, category, name, description, price_minor, image_url, in_stock
        FROM UNNEST(
          ${ids}::text[],
          ${products.map((p) => p.category)}::text[],
          ${products.map((p) => p.name)}::text[],
          ${products.map((p) => p.description)}::text[],
          ${products.map((p) => p.price_minor)}::int[],
          ${products.map((p) => p.image_url)}::text[],
          ${products.map((p) => p.in_stock)}::boolean[]
        ) AS t(product_id, category, name, description, price_minor, image_url, in_stock)
        ON CONFLICT (product_id) DO UPDATE SET
          category = excluded.category, name = excluded.name, description = excluded.description,
          price_minor = excluded.price_minor, image_url = excluded.image_url,
          in_stock = excluded.in_stock, deleted_at = NULL`,
    sql`UPDATE products SET deleted_at = now()
        WHERE shop_id = ${shopId} AND deleted_at IS NULL
          AND NOT (product_id = ANY(${ids}))`,
  ]);

  return c.json({ count: products.length });
});

// Create or rename a shop, optionally assigning its owner. Catalog ingest
// defaults shops.name to the shop_id; this sets a real name. ON CONFLICT updates
// only name/cover/tagline, so re-running ingest (which inserts shops ON CONFLICT
// DO NOTHING) never clobbers it. owner_user_id is a Neon Auth user.id; when
// present it's recorded in shop_owners so that seller can work the shop's orders
// — the admin bootstrap until self-serve onboarding sets the owner from the
// signed-in user.
const ShopBody = z.object({
  phone_number_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  cover_url: z.string().trim().min(1).optional(),
  tagline: z.string().trim().min(1).optional(),
  owner_user_id: z.string().trim().min(1).optional(),
});

app.post("/admin/shops", async (c) => {
  const settings = getSettings(c.env);
  const token = c.req.header("Authorization")?.slice(7);
  if (token !== settings.ADMIN_TOKEN) {
    return c.body(null, 401);
  }

  const parsed = ShopBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ errors: parsed.error.issues }, 400);
  }

  const { phone_number_id, name, cover_url, tagline, owner_user_id } = parsed.data;
  const sql = createAdminDb(settings);
  // COALESCE on conflict so a name-only update (e.g. just renaming) doesn't null
  // out an existing cover_url/tagline.
  const [shop] = await sql`
    INSERT INTO shops (phone_number_id, name, cover_url, tagline)
    VALUES (${phone_number_id}, ${name}, ${cover_url ?? null}, ${tagline ?? null})
    ON CONFLICT (phone_number_id) DO UPDATE SET
      name = excluded.name,
      cover_url = COALESCE(excluded.cover_url, shops.cover_url),
      tagline = COALESCE(excluded.tagline, shops.tagline)
    RETURNING phone_number_id, name, cover_url, tagline`;
  if (owner_user_id) {
    await sql`INSERT INTO shop_owners (user_id, shop_id)
              VALUES (${owner_user_id}, ${phone_number_id})
              ON CONFLICT (user_id, shop_id) DO NOTHING`;
  }
  return c.json(shop);
});

// The signed-in seller's context: the shop their Neon Auth token resolves to
// (via shop_owners), or 401/403. The dashboard calls this on load to confirm the
// session and learn which shop it's operating as.
app.get("/seller/me", async (c) => {
  const shopId = await sellerShopId(c);
  return c.json({ shop_id: shopId });
});

// Seller reads their shop's orders, newest first — the read side the approve
// flow acts on, until a dashboard exists. The caller's Neon Auth token resolves
// to their shop (sellerShopId). This is the seller path — deterministic SQL we
// own — so it connects as the admin role and scopes every query with an explicit
// shop_id filter, the same pattern as catalog ingest. (RLS on orders is reserved
// for the customer agent path, which is locked to a single customer.) Optional
// ?status= narrows to one status (e.g. the pending_approval queue); absent, all
// statuses are returned. Items are the stored snapshot (never re-priced); they
// carry no shop_id of their own, so they're scoped through their parent orders.
app.get("/orders", async (c) => {
  const shopId = await sellerShopId(c);
  const status = c.req.query("status");
  const sql = createAdminDb(getSettings(c.env));

  const [orders, items] = await sql.transaction([
    status
      ? sql`SELECT order_id, status, customer_phone, fulfillment_type,
                   total_minor, currency, created_at
            FROM orders WHERE shop_id = ${shopId} AND status = ${status}
            ORDER BY created_at DESC`
      : sql`SELECT order_id, status, customer_phone, fulfillment_type,
                   total_minor, currency, created_at
            FROM orders WHERE shop_id = ${shopId} ORDER BY created_at DESC`,
    sql`SELECT order_id, qty, name, unit_price_minor, line_total_minor
        FROM order_items
        WHERE order_id IN (SELECT order_id FROM orders WHERE shop_id = ${shopId})`,
  ]);

  const itemsByOrder = new Map<string, Record<string, any>[]>();
  for (const item of items) {
    const { order_id, ...line } = item;
    (itemsByOrder.get(order_id) ?? itemsByOrder.set(order_id, []).get(order_id)!).push(line);
  }

  return c.json({
    orders: orders.map((o) => ({ ...o, items: itemsByOrder.get(o.order_id) ?? [] })),
  });
});

// Seller approves one pending order. The Bearer token is the identity: it
// resolves to the shop_id (never the path). The seller path runs as the admin
// role with an explicit shop_id filter on every query, so a token for shop A
// can't touch shop B's order — no row matches, the status read comes back empty,
// and it reads as 404. The UPDATE is guarded on status so only pending_approval
// -> approved happens; any other status is left untouched and reported back
// (409) so the seller knows it was already handled.
app.post("/orders/:order_id/approve", async (c) => {
  const settings = getSettings(c.env);
  const shopId = await sellerShopId(c);
  const orderId = c.req.param("order_id");
  const sql = createAdminDb(settings);

  const [approved, current] = await sql.transaction([
    sql`UPDATE orders SET status = 'approved', updated_at = now()
        WHERE order_id = ${orderId} AND shop_id = ${shopId}
          AND status = 'pending_approval'
        RETURNING order_id, status, customer_phone`,
    sql`SELECT status FROM orders WHERE order_id = ${orderId} AND shop_id = ${shopId}`,
  ]);

  if (approved.length > 0) {
    // Let the customer hear it from the agent, not a canned template: signal
    // their OrderAgent (keyed by shop + customer phone) to author a turn, then
    // push the replies over WhatsApp. The send is best-effort — the order is
    // already approved, so a failed notification must not fail the seller's
    // request — but we await it so the seller's 200 reflects a sent message.
    const customer = approved[0].customer_phone as string;
    const stub = await getAgentByName(c.env.OrderAgent, `${shopId}:${customer}`);
    const replies = await stub.notifyApproved();
    await sendReplies(replies, {
      client: createClient(settings),
      to: customer,
      // loop_agent (RLS): sendReplies hydrates product_list cards from the
      // catalog scoped to this shop. Only the order UPDATE/read above needs admin.
      sql: createDb(settings),
      shopId,
      menuLink: async () =>
        `${settings.STOREFRONT_URL}/?t=${await mintCartToken(shopId, customer, settings.WHATSAPP_APP_SECRET)}`,
    });
    return c.json({ order_id: orderId, status: "approved" });
  }
  // No transition: either the order isn't visible to this shop (RLS → no row →
  // 404) or it's in some other status (409 with that status, unchanged).
  if (current.length === 0) {
    return c.json({ error: "order not found" }, 404);
  }
  return c.json({ order_id: orderId, status: current[0].status }, 409);
});

app.get("/debug/rls/:shop_id", async (c) => {
  const settings = getSettings(c.env);
  const sql = createDb(settings);
  const shopId = c.req.param("shop_id");

  // Same query, two ways: unscoped (no app.shop_id) sees nothing because the
  // RLS policy matches no rows; scoped sees only this shop's rows.
  const unscoped = await sql`SELECT count(*)::int AS count FROM products`;
  const scoped = await withShop(sql, shopId, [
    sql`SELECT count(*)::int AS count FROM products`,
  ]);

  return c.json({
    shop_id: shopId,
    without_set_config: unscoped[0].count,
    with_set_config: scoped[0][0].count,
  });
});

app.post("/debug/chat", async (c) => {
  const { message, instance } = await c.req.json<{
    message: string;
    instance: string;
  }>();
  const stub = await getAgentByName(c.env.OrderAgent, instance);
  const replies = await stub.runTurn(message);
  return c.json({ replies });
});

// Debug seam for the storefront Checkout tap, mirroring /cart/checkout's
// continuation turn without the cart-token plumbing — so the eval harness can
// drive a checkout.
app.post("/debug/checkout", async (c) => {
  const { instance } = await c.req.json<{ instance: string }>();
  const stub = await getAgentByName(c.env.OrderAgent, instance);
  const replies = await stub.checkout();
  return c.json({ replies });
});

// Raw draft order state for an agent instance — the eval harness reads this to
// assert on outcomes (items, qty, total, fulfillment, address) rather than the
// formatted summary string.
app.post("/debug/state", async (c) => {
  const { instance } = await c.req.json<{ instance: string }>();
  const stub = await getAgentByName(c.env.OrderAgent, instance);
  return c.json(await stub.getOrderState());
});

// Operator escape hatch: wipe an agent's Durable Object (order + history) so a
// customer session can be reset. Guarded by ADMIN_TOKEN like /admin/catalog,
// since it destroys state.
app.post("/debug/reset", async (c) => {
  const settings = getSettings(c.env);
  const token = c.req.header("Authorization")?.slice(7);
  if (token !== settings.ADMIN_TOKEN) {
    return c.body(null, 401);
  }

  const { instance } = await c.req.json<{ instance: string }>();
  const stub = await getAgentByName(c.env.OrderAgent, instance);
  await stub.reset();
  return c.body(null, 204);
});

// Storefront cart edits. The signed token (minted into the storefront link)
// identifies which OrderAgent to edit; verify it, derive the agent's name
// `${shopId}:${customer}`, then call the same addItem/removeItem the model's
// tools use. Returns the cart (items + total) for the page to render.
const CartBody = z.object({
  token: z.string(),
  product_id: z.string(),
  qty: z.number().int().positive().default(1),
});

// Read the current cart so the storefront can hydrate on load (reload, or
// arriving from chat with items already in the draft). Reuses getOrderState;
// the token is in the query string since GET has no body.
app.get("/cart/state", async (c) => {
  const settings = getSettings(c.env);
  const token = c.req.query("token");
  if (!token) return c.json({ error: "bad request" }, 400);

  const claims = await verifyCartToken(token, settings.WHATSAPP_APP_SECRET);
  if (!claims) return c.json({ error: "invalid token" }, 401);

  const stub = await getAgentByName(
    c.env.OrderAgent,
    `${claims.shopId}:${claims.customer}`,
  );
  const state = await stub.getOrderState();
  return c.json({ items: state.items, total_minor: state.total_minor });
});

app.post("/cart/add", async (c) => {
  const settings = getSettings(c.env);
  const parsed = CartBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad request" }, 400);

  const claims = await verifyCartToken(
    parsed.data.token,
    settings.WHATSAPP_APP_SECRET,
  );
  if (!claims) return c.json({ error: "invalid token" }, 401);

  const stub = await getAgentByName(
    c.env.OrderAgent,
    `${claims.shopId}:${claims.customer}`,
  );
  const result = await stub.addItem(parsed.data.product_id, parsed.data.qty);
  if ("error" in result) return c.json(result, 409);
  return c.json({ items: result.items, total_minor: result.total_minor });
});

app.post("/cart/remove", async (c) => {
  const settings = getSettings(c.env);
  const parsed = CartBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad request" }, 400);

  const claims = await verifyCartToken(
    parsed.data.token,
    settings.WHATSAPP_APP_SECRET,
  );
  if (!claims) return c.json({ error: "invalid token" }, 401);

  const stub = await getAgentByName(
    c.env.OrderAgent,
    `${claims.shopId}:${claims.customer}`,
  );
  const result = await stub.removeItem(parsed.data.product_id, parsed.data.qty);
  if ("error" in result) return c.json(result, 409);
  return c.json({ items: result.items, total_minor: result.total_minor });
});

// Storefront checkout: run an agent turn (triggered by an internal marker, not a
// visible customer message) so it produces the order summary, push the replies
// to the customer over WhatsApp, then the page redirects to the chat — the
// summary is already waiting when they arrive. A failed turn returns an error so
// the page can show it and not redirect; failed sends are logged best-effort.
app.post("/cart/checkout", async (c) => {
  const settings = getSettings(c.env);
  const { token } = await c.req
    .json<{ token?: string }>()
    .catch(() => ({ token: undefined }));
  if (!token) return c.json({ error: "bad request" }, 400);

  const claims = await verifyCartToken(token, settings.WHATSAPP_APP_SECRET);
  if (!claims) return c.json({ error: "invalid token" }, 401);

  const stub = await getAgentByName(
    c.env.OrderAgent,
    `${claims.shopId}:${claims.customer}`,
  );

  let replies;
  try {
    replies = await stub.checkout();
  } catch (e) {
    console.error("checkout turn failed", { error: (e as Error).message });
    return c.json({ error: "checkout failed" }, 502);
  }

  await sendReplies(replies, {
    client: createClient(settings),
    to: claims.customer,
    sql: createDb(settings),
    shopId: claims.shopId,
    menuLink: async () =>
      `${settings.STOREFRONT_URL}/?t=${await mintCartToken(claims.shopId, claims.customer, settings.WHATSAPP_APP_SECRET)}`,
  });

  return c.body(null, 204);
});

app.post("/debug/send", async (c) => {
  const { to, body } = await c.req.json<{ to: string; body: string }>();
  const settings = getSettings(c.env);
  const client = createClient(settings);

  try {
    await client.send(to, body);
    return c.body(null, 204);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

export default app;
