import { Hono } from "hono";
import { getSettings } from "./settings";
import { OrderAgent } from "./agent";
import { verifySignature } from "./verify";
import z from "zod";
import { createClient } from "./whatsapp/client";
import { getAgentByName } from "agents";
import * as XLSX from "xlsx";

export { OrderAgent };

const app = new Hono<{ Bindings: CloudflareBindings }>();

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

    for (const reply of replies) {
      if (reply.type === "text") {
        await client.send(from, reply.body);
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
    .refine((n) => Number.isInteger(n), "price must be an integer (minor units)"),
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
      in_stock: r.in_stock ? 1 : 0,
    })),
  );
  const now = Date.now();
  const ids = products.map((p) => p.product_id);

  await c.env.DB.prepare(
    `INSERT INTO shops (phone_number_id, name, created_at) VALUES (?, ?, ?)
      ON CONFLICT(phone_number_id) DO NOTHING`,
  )
    .bind(shopId, shopId, now)
    .run();

  const upserts = products.map((p) =>
    c.env.DB.prepare(
      `INSERT INTO products (product_id, shop_id, category, name, description, price_minor, image_url, in_stock, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(product_id) DO UPDATE SET
         category=excluded.category, name=excluded.name, description=excluded.description,
         price_minor=excluded.price_minor, image_url=excluded.image_url,
         in_stock=excluded.in_stock, deleted_at=NULL`,
    ).bind(
      p.product_id,
      shopId,
      p.category,
      p.name,
      p.description,
      p.price_minor,
      p.image_url,
      p.in_stock,
    ),
  );

  const softDelete = c.env.DB.prepare(
    `UPDATE products SET deleted_at=? WHERE shop_id=? AND deleted_at IS NULL
       AND product_id NOT IN (SELECT value FROM json_each(?))`,
  ).bind(now, shopId, JSON.stringify(ids));

  await c.env.DB.batch([...upserts, softDelete]);

  return c.json({ count: products.length });
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
