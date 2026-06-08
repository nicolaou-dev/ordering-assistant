import { Hono } from "hono";
import { getSettings } from "./settings";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAgent } from "./agent";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/healthz", (c) => {
  return c.json({ ok: true, ts: new Date().toISOString() });
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
