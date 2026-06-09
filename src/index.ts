import { Hono } from "hono";
import { getSettings } from "./settings";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAgent } from "./agent";
import { verifySignature } from "./verify";
import z from "zod";
import { createClient } from "./whatsapp/client";

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

const Inbound = z.object({
  from: z.string(),
  id: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
});

app.post("/webhook/whatsapp", async (c) => {
  const settings = getSettings(c.env);
  const text = await c.req.text();
  const header = c.req.header("x-hub-signature-256");

  const valid = await verifySignature(
    text,
    settings.WHATSAPP_APP_SECRET,
    header,
  );

  if (!valid) {
    return c.body(null, 401);
  }

  const body = JSON.parse(text);
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const inbound = Inbound.safeParse(msg);

  if (inbound.success) {
    const { from, id, text } = inbound.data;
    c.executionCtx.waitUntil(
      Promise.resolve().then(async () => {
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
      }),
    );
  }

  return c.body(null, 200);
});

app.post("/debug/chat", async (c) => {
  const { message } = await c.req.json<{ message: string }>();
  const settings = getSettings(c.env);
  const model = createAnthropic({ apiKey: settings.ANTHROPIC_API_KEY })(
    "claude-haiku-4-5",
  );
  const agent = createAgent(model);
  const replies = await agent.run(message);
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
