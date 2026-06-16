import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { getSettings } from "./settings";
import { OrderAgent } from "./agent";
import { verifySignature } from "./verify";
import { mintCartToken, verifyCartToken } from "./cart_token";
import z from "zod";
import { createClient } from "./whatsapp/client";
import { formatOrderSummary } from "./whatsapp/summary";
import { formatProductCaption, type ProductRow } from "./whatsapp/product";
import { createAdminDb, createDb, withShop, type Sql } from "./db";
import type { Reply } from "./reply";
import { getAgentByName } from "agents";
import * as XLSX from "xlsx";
import { mintSellerToken, verifySellerToken } from "./seller_token";

export { OrderAgent };

// Deliver the agent's replies to one customer over WhatsApp. Shared by the
// inbound webhook and the storefront checkout endpoint so both render replies
// identically (text / hydrated order summary / product images). Send failures
// are logged, not thrown — one failed message must not drop the rest.
type SendCtx = {
  client: ReturnType<typeof createClient>;
  to: string;
  sql: Sql;
  shopId: string;
  orderSummary: () => Promise<string>;
  menuLink: () => Promise<string>;
};

async function sendReplies(replies: Reply[], ctx: SendCtx): Promise<void> {
  const { client, to, sql, shopId, orderSummary, menuLink } = ctx;
  for (const reply of replies) {
    try {
      if (reply.type === "text") {
        await client.send(to, reply.body);
      } else if (reply.type === "order_summary") {
        await client.send(to, await orderSummary());
      } else if (reply.type === "product_list") {
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
        await client.send(
          to,
          `Browse our full menu and add what you'd like:\n${await menuLink()}`,
        );
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
    const result = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO inbound_messages(message_id, received_at) VALUES (?, ?)",
    )
      .bind(id, Date.now())
      .run();

    if (result.meta.changes === 0) {
      console.log("deduped", { id });
      return;
    }

    console.log("inbound", { from, id, text: text?.body });

    if (!text?.body) return;

    const client = createClient(settings);

    client.markReadTyping(id).catch((e) => {
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
      orderSummary: async () => formatOrderSummary(await stub.getOrderState()),
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

// Authenticate a seller request by its Bearer token, returning the shop_id it
// carries (the shop's phone_number_id). Throws 401 on a missing, invalid, or
// expired token. The seller order endpoints derive shop_id from this — never
// from the path or ADMIN_TOKEN.
async function sellerShopId(
  c: Context<{ Bindings: CloudflareBindings }>,
): Promise<string> {
  const settings = getSettings(c.env);
  const token = c.req.header("Authorization")?.slice(7);
  const claims = token
    ? await verifySellerToken(token, settings.WHATSAPP_APP_SECRET)
    : null;
  if (!claims) throw new HTTPException(401, { message: "invalid seller token" });
  return claims.phone_number_id;
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

// Create or rename a shop. Catalog ingest defaults shops.name to the shop_id;
// this sets a real name. ON CONFLICT updates only the name, so re-running ingest
// (which inserts shops ON CONFLICT DO NOTHING) never clobbers it.
const ShopBody = z.object({
  phone_number_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
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

  const sql = createAdminDb(settings);
  const [shop] = await sql`
    INSERT INTO shops (phone_number_id, name)
    VALUES (${parsed.data.phone_number_id}, ${parsed.data.name})
    ON CONFLICT (phone_number_id) DO UPDATE SET name = excluded.name
    RETURNING phone_number_id, name`;
  return c.json(shop);
});

// Bootstrap minting so the seller order endpoints are testable before OTP login
// exists. ADMIN_TOKEN-guarded; the shop_id (the shop's phone_number_id) is the
// path param, and the minted token verifies back to it.
app.post("/admin/shops/:shop_id/seller-token", async (c) => {
  const settings = getSettings(c.env);
  const token = c.req.header("Authorization")?.slice(7);
  if (token !== settings.ADMIN_TOKEN) {
    return c.body(null, 401);
  }

  const shopId = c.req.param("shop_id");
  const sellerToken = await mintSellerToken(
    shopId,
    settings.WHATSAPP_APP_SECRET,
  );
  return c.json({ token: sellerToken });
});

// Exercise the seller Bearer auth: echoes back the shop_id a token resolves to,
// or 401. Lets us manually verify a minted seller token before the real seller
// endpoints (approve / list orders) exist.
app.get("/debug/seller", async (c) => {
  const shopId = await sellerShopId(c);
  return c.json({ shop_id: shopId });
});

// Seller reads their shop's orders, newest first — the read side the approve
// flow acts on, until a dashboard exists. The Bearer token is the identity
// (verifySellerToken -> shop_id), and withShop scopes both reads under RLS, so a
// shop only ever sees its own orders. Optional ?status= narrows to one status
// (e.g. the pending_approval queue); absent, all statuses are returned. Items
// are the stored snapshot (never re-priced from the catalog); order_items'
// policy scopes them through their parent order, so the unfiltered item read
// already returns only this shop's lines, which we group onto their orders.
app.get("/orders", async (c) => {
  const shopId = await sellerShopId(c);
  const status = c.req.query("status");
  const sql = createDb(getSettings(c.env));

  const [orders, items] = await withShop(sql, shopId, [
    status
      ? sql`SELECT order_id, status, customer_phone, fulfillment_type,
                   total_minor, currency, created_at
            FROM orders WHERE status = ${status} ORDER BY created_at DESC`
      : sql`SELECT order_id, status, customer_phone, fulfillment_type,
                   total_minor, currency, created_at
            FROM orders ORDER BY created_at DESC`,
    sql`SELECT order_id, qty, name, unit_price_minor, line_total_minor
        FROM order_items`,
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
// resolves to the shop_id (never the path), and withShop scopes the write under
// RLS so a token for shop A can't touch shop B's order — that order is simply
// invisible, so it reads as 404. The UPDATE is guarded on status so only
// pending_approval -> approved happens; any other status is left untouched and
// reported back (409) so the seller knows it was already handled.
app.post("/orders/:order_id/approve", async (c) => {
  const settings = getSettings(c.env);
  const shopId = await sellerShopId(c);
  const orderId = c.req.param("order_id");
  const sql = createDb(settings);

  const [approved, current] = await withShop(sql, shopId, [
    sql`UPDATE orders SET status = 'approved', updated_at = now()
        WHERE order_id = ${orderId} AND status = 'pending_approval'
        RETURNING order_id, status, customer_phone`,
    sql`SELECT status FROM orders WHERE order_id = ${orderId}`,
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
      sql,
      shopId,
      orderSummary: async () => formatOrderSummary(await stub.getOrderState()),
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

// Debug-only stand-in for the send-time render of an order_summary reply: shows
// the hydrated, customer-facing summary the channel would send, so hydration is
// testable without WhatsApp.
app.post("/debug/summary", async (c) => {
  const { instance } = await c.req.json<{ instance: string }>();
  const stub = await getAgentByName(c.env.OrderAgent, instance);
  const summary = formatOrderSummary(await stub.getOrderState());
  return c.json({ summary });
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
    orderSummary: async () => formatOrderSummary(await stub.getOrderState()),
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
