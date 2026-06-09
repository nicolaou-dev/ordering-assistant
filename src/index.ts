import { Hono } from "hono";
import { getSettings } from "./settings";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAgent } from "./agent";

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

export default app;
