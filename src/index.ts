import { Hono } from "hono";
import { cors } from "hono/cors";
import { getSettings } from "./settings";
import { OrderAgent } from "./agent";
import { verifySignature } from "./verify";
import { verifyCartToken } from "./cart_token";
import z from "zod";
import { createClient } from "./whatsapp/client";
import { formatOrderSummary } from "./whatsapp/summary";
import { formatProductCaption, type ProductRow } from "./whatsapp/product";
import type { Address } from "./order";
import { createAdminDb, createDb, withShop } from "./db";
import { getAgentByName } from "agents";
import * as XLSX from "xlsx";

export { OrderAgent };

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

    const sql = createDb(settings);

    for (const reply of replies) {
      if (reply.type === "text") {
        await client.send(from, reply.body);
      } else if (reply.type === "order_summary") {
        await client.send(from, formatOrderSummary(await stub.getOrderState()));
      } else if (reply.type === "product_list") {
        // Hydrate each id from the catalog (scoped to this shop) and send it as a
        // native image + caption, so prices/details come from Postgres, never the
        // model's tokens. One atomic image+caption per product keeps the name,
        // price and description attached to the image (separate messages can
        // reorder in transit); no image_url falls back to a text message.
        const [rows] = await withShop(sql, phone_number_id, [
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
            await client.sendImage(from, product.image_url, caption);
          } else {
            await client.send(from, caption);
          }
        }
      }
    }
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

// Debug-only stand-in for the real flow-completion webhook: writes a structured
// address into the order and continues the loop, so the whole LLM flow is
// testable without WhatsApp.
app.post("/debug/address", async (c) => {
  const { instance, address } = await c.req.json<{
    instance: string;
    address: Address;
  }>();
  const stub = await getAgentByName(c.env.OrderAgent, instance);
  const replies = await stub.completeAddress(address);
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
