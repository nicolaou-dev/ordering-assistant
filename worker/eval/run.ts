// Eval harness for the ordering agent. Drives the real OrderAgent (Durable
// Object + Haiku + Neon catalog) through scripted multi-turn conversations over
// the /debug/* endpoints of a running `wrangler dev`, and grades the OUTCOMES —
// reply types and order state — not the path the model took (per Anthropic's
// "demystifying evals for AI agents": grade what was produced, not the
// trajectory). Deterministic graders do the objective checks; an LLM judge
// (Sonnet, a different model than the agent, to avoid self-preference bias)
// scores subjective tone only where a case asks for it.
//
// Run with: pnpm worker eval   (requires `pnpm worker dev` running)

import { neon } from "@neondatabase/serverless";
import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const BASE = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const SHOP = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "1098392886696367";
const ADMIN = process.env.ADMIN_TOKEN ?? "";

type Reply =
  | { type: "text"; body: string }
  | { type: "order_summary" }
  | { type: "product_list"; product_ids: string[] }
  | { type: "menu" };

type OrderState = {
  items: { product_id: string; qty: number; name: string; unit_price_minor: number }[];
  total_minor: number;
  fulfillment: { type: "pickup" | "delivery" | null; address: unknown | null };
};

// --- HTTP against the running worker ----------------------------------------

async function post(path: string, body: unknown, auth = false): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${ADMIN}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const reset = (instance: string) => post("/debug/reset", { instance }, true);

async function chat(instance: string, message: string): Promise<Reply[]> {
  const r = await post("/debug/chat", { instance, message });
  if (!r.ok) throw new Error(`/debug/chat ${r.status}: ${await r.text()}`);
  return ((await r.json()) as { replies: Reply[] }).replies;
}

async function state(instance: string): Promise<OrderState> {
  const r = await post("/debug/state", { instance });
  if (!r.ok) throw new Error(`/debug/state ${r.status}: ${await r.text()}`);
  return (await r.json()) as OrderState;
}

// --- Grading helpers (return failure messages; empty = pass) -----------------

const types = (rs: Reply[]) => rs.map((r) => r.type);
const has = (rs: Reply[], t: Reply["type"]) => rs.some((r) => r.type === t);

function expectReply(rs: Reply[], present: Reply["type"][], absent: Reply["type"][]): string[] {
  const fails: string[] = [];
  for (const t of present) if (!has(rs, t)) fails.push(`expected a ${t} reply, got [${types(rs)}]`);
  for (const t of absent) if (has(rs, t)) fails.push(`did not expect a ${t} reply, got [${types(rs)}]`);
  return fails;
}

const textBodies = (rs: Reply[]) =>
  rs.filter((r): r is Extract<Reply, { type: "text" }> => r.type === "text").map((r) => r.body);

// Grounding: any €-amount in a text reply must be a real catalog price or a
// total the order actually reached — never a figure the model made up.
function checkGrounding(texts: string[], validMinor: Set<number>): string[] {
  const fails: string[] = [];
  for (const body of texts) {
    for (const m of body.matchAll(/€?\s?(\d+)[.,](\d{2})/g)) {
      const minor = Number(m[1]) * 100 + Number(m[2]);
      if (!validMinor.has(minor)) {
        fails.push(`ungrounded price "${m[0].trim()}" (=${minor} minor) in: "${body.slice(0, 70)}…"`);
      }
    }
  }
  return fails;
}

// --- LLM judge (subjective tone/clarity only) --------------------------------

const judgeModel = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).languageModel(
  "claude-sonnet-4-6",
);

async function judge(transcript: string, rubric: string): Promise<{ pass: boolean; score: number; reason: string }> {
  const { object } = await generateObject({
    model: judgeModel,
    schema: z.object({
      score: z.number().min(0).max(1).describe("0.0–1.0"),
      pass: z.boolean(),
      reason: z.string(),
    }),
    prompt: `You are grading one criterion of a WhatsApp shop-ordering assistant's replies. Judge only this rubric; if you can't tell, score 0.5 and pass=false.\n\nRubric: ${rubric}\n\nTranscript:\n${transcript}`,
  });
  return object;
}

// --- Cases -------------------------------------------------------------------

type Turn = { user: string; expect?: (rs: Reply[]) => string[] };
type Case = {
  name: string;
  regression: boolean; // regression cases must stay green; a failure exits non-zero
  turns: Turn[];
  expectState?: (s: OrderState) => string[];
  submitted?: boolean; // assert an order row was written for this customer
  rubric?: string; // optional LLM-judge criterion over the transcript
};

// Regression cases assert near-deterministic OUTCOMES (state, reply type
// present/absent, grounding) that should always hold. Capability cases probe
// probabilistic behaviour (a single run is a noisy sample) and are measured but
// don't gate — multi-run pass-rate thresholds are the way to gate those (a
// documented next step), so they stay non-regression for now.
const cases: Case[] = [
  {
    name: "greeting: no products on hello",
    regression: true,
    turns: [{ user: "hi", expect: (rs) => expectReply(rs, [], ["product_list", "menu", "order_summary"]) }],
    expectState: (s) => (s.items.length === 0 ? [] : ["expected empty order"]),
    rubric: "Does the reply greet the customer and ask whether it's pickup or delivery (rather than show products)?",
  },
  {
    name: "fulfillment recorded, no dump or premature summary",
    regression: true,
    turns: [
      { user: "hi" },
      { user: "delivery please", expect: (rs) => expectReply(rs, [], ["order_summary"]) },
    ],
    expectState: (s) =>
      s.fulfillment.type === "delivery" ? [] : [`fulfillment=${s.fulfillment.type}, expected delivery`],
  },
  {
    name: "menu offered after fulfillment",
    regression: false,
    turns: [{ user: "hi" }, { user: "pickup", expect: (rs) => expectReply(rs, ["menu"], []) }],
  },
  {
    name: "named item -> product_list",
    regression: true,
    turns: [{ user: "for pickup, I'd like a falafel wrap", expect: (rs) => expectReply(rs, ["product_list"], []) }],
  },
  {
    name: "broad term -> helpful, doesn't over-list",
    regression: false,
    turns: [{ user: "what pizzas do you have?" }],
    rubric: "Did the assistant avoid dumping every product as text, and either show a few cards, offer the menu, or ask the customer to narrow down?",
  },
  {
    name: "no match -> alternative, not a flat no",
    regression: false,
    turns: [{ user: "do you have any sushi for pickup?", expect: (rs) => expectReply(rs, [], ["product_list"]) }],
    rubric: "The shop has no sushi. Did the assistant avoid a bare 'no' and point the customer somewhere useful (an alternative and/or the menu)?",
  },
  {
    name: "anything-else before summary",
    regression: false,
    turns: [
      { user: "pickup, one coca cola please", expect: (rs) => expectReply(rs, [], ["order_summary"]) },
      { user: "that's all thanks", expect: (rs) => expectReply(rs, ["order_summary"], []) },
    ],
    expectState: (s) => (s.items.length === 1 ? [] : [`expected 1 item, got ${s.items.length}`]),
  },
  {
    name: "add from summary -> no menu",
    regression: true,
    turns: [
      { user: "pickup, one coca cola" },
      { user: "that's all" },
      { user: "actually add a sprite too", expect: (rs) => expectReply(rs, [], ["menu"]) },
    ],
    expectState: (s) =>
      s.items.some((i) => /sprite/i.test(i.name)) ? [] : [`Sprite not added; items: ${s.items.map((i) => i.name).join(", ") || "none"}`],
  },
  {
    name: "happy path -> order submitted",
    regression: true,
    turns: [{ user: "pickup, one coca cola" }, { user: "that's all" }, { user: "yes, confirm and place it" }],
    expectState: (s) => (s.items.length === 0 ? [] : ["draft should be cleared after a successful submit"]),
    submitted: true,
  },
  {
    name: "[persona] terse one-word customer",
    regression: false,
    turns: [{ user: "pickup" }, { user: "coca cola" }, { user: "done" }],
    expectState: (s) =>
      s.items.some((i) => /cola/i.test(i.name)) ? [] : [`no cola in order; items: ${s.items.map((i) => i.name).join(", ") || "none"}`],
    rubric: "The customer is extremely terse. Did the assistant keep up, infer intent, and move the order forward without getting confused?",
  },
  {
    name: "[persona] indecisive browser",
    regression: false,
    turns: [
      { user: "hey what do you have? pickup" },
      { user: "hmm not sure, maybe something with falafel?" },
      { user: "ok what's in the falafel wrap" },
    ],
    rubric: "The customer is indecisive and browsing. Did the assistant stay patient and helpful, ground its answers in the catalog, and guide them toward a choice without being pushy?",
  },
  {
    name: "[capability] finds 'tahini pie' (known gap)",
    regression: false,
    turns: [{ user: "for pickup, can I get a tahini pie?", expect: (rs) => expectReply(rs, ["product_list"], ["menu"]) }],
  },
];

// --- Runner ------------------------------------------------------------------

async function run() {
  const ping = await fetch(`${BASE}/healthz`).catch(() => null);
  if (!ping?.ok) {
    console.error(`No worker at ${BASE}. Start it first:  pnpm worker dev`);
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL_ADMIN!);
  const priceRows = await sql`SELECT DISTINCT price_minor FROM products WHERE shop_id = ${SHOP} AND deleted_at IS NULL`;
  const catalogPrices = new Set<number>(priceRows.map((r) => r.price_minor as number));

  let passed = 0;
  let regressionFailed = 0;

  for (const c of cases) {
    const instance = `${SHOP}:eval-${c.name.replace(/[^a-z0-9]+/gi, "-")}`;
    const customer = instance.split(":")[1];
    const failures: string[] = [];
    const transcript: string[] = [];
    const totalsSeen = new Set<number>([0]);

    try {
      await reset(instance);
      for (const turn of c.turns) {
        const replies = await chat(instance, turn.user);
        transcript.push(`Customer: ${turn.user}`);
        for (const r of replies) transcript.push(`Assistant[${r.type}]: ${"body" in r ? r.body : ""}`);
        if (turn.expect) failures.push(...turn.expect(replies));
        failures.push(...checkGrounding(textBodies(replies), new Set([...catalogPrices, ...totalsSeen])));
        const s = await state(instance);
        totalsSeen.add(s.total_minor);
      }

      const finalState = await state(instance);
      if (c.expectState) failures.push(...c.expectState(finalState));

      if (c.submitted) {
        const rows = await sql`SELECT count(*)::int AS n FROM orders WHERE shop_id = ${SHOP} AND customer_phone = ${customer}`;
        if ((rows[0].n as number) < 1) failures.push("no order row was written");
      }

      let judgeNote = "";
      if (c.rubric) {
        const j = await judge(transcript.join("\n"), c.rubric);
        judgeNote = `  judge ${j.score.toFixed(2)} ${j.pass ? "✓" : "✗"} — ${j.reason}`;
        if (!j.pass) failures.push(`judge: ${j.reason}`);
      }

      const ok = failures.length === 0;
      if (ok) passed++;
      else if (c.regression) regressionFailed++;
      console.log(`${ok ? "✓" : "✗"} ${c.name}${c.regression ? "" : "  (capability)"}`);
      for (const f of failures) console.log(`    - ${f}`);
      if (judgeNote) console.log(judgeNote);
    } catch (e) {
      regressionFailed += c.regression ? 1 : 0;
      console.log(`✗ ${c.name}  — harness error: ${(e as Error).message}`);
    } finally {
      await reset(instance).catch(() => {});
    }
  }

  console.log(`\n${passed}/${cases.length} cases passed.`);
  if (regressionFailed > 0) {
    console.error(`${regressionFailed} regression case(s) failed.`);
    process.exit(1);
  }
}

run();
