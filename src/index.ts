import { Hono } from "hono";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/healthz", (c) => {
  return c.json({ ok: true, ts: new Date().toISOString() });
});

export default app;
