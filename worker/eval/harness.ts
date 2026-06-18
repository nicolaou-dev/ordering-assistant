// Shared eval harness for the ordering agent, on top of Evalite (Vitest-based).
// Evalite owns scoring, aggregation, run history and the watch UI; this file
// owns the parts no library can: driving the stateful OrderAgent (Durable
// Object + Haiku + Neon) through a multi-turn conversation over /debug/*, and
// the outcome graders. Cases live in regression.eval.ts / capability.eval.ts and
// call orderingEval().
//
// Run with `pnpm worker eval` (gated) or `pnpm worker eval:all` — both need
// `pnpm worker dev` running. Per Anthropic's "demystifying evals": grade the
// outcome (reply types, order state, grounding), not the path the model took.

import { evalite, createScorer } from "evalite";
import { neon } from "@neondatabase/serverless";
import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const BASE = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const SHOP = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "1098392886696367";
const ADMIN = process.env.ADMIN_TOKEN ?? "";

export type ReplyType =
  | "text"
  | "order_summary"
  | "product_list"
  | "menu"
  | "fulfillment_prompt";
export type Reply =
  | { type: "text"; message: string }
  | { type: "order_summary"; message: string }
  | { type: "product_list"; product_ids: string[]; message?: string }
  | { type: "menu"; message: string }
  | { type: "fulfillment_prompt"; message: string };

type OrderState = {
  items: { product_id: string; qty: number; name: string; unit_price_minor: number }[];
  total_minor: number;
  fulfillment: { type: "pickup" | "delivery" | null; address: unknown | null };
};

// A turn the customer takes: a typed message (string), a tapped pickup/delivery
// button ({ tap }, drives /debug/tap mirroring the webhook's button-reply path),
// or the storefront Checkout tap ({ checkout }, drives /debug/checkout).
export type Turn = string | { tap: "pickup" | "delivery" } | { checkout: true };

// What a case asserts about the conversation it just drove. All fields are
// serializable so Evalite can show them in the run UI/history.
export type Spec = {
  replies?: { turn: number; present?: ReplyType[]; absent?: ReplyType[] }[];
  state?: { fulfillment?: "pickup" | "delivery"; itemsInclude?: string[]; itemCount?: number; empty?: boolean };
  submitted?: boolean;
  rubric?: string;
};

type Convo = {
  replies: Reply[][]; // per turn
  finalState: OrderState;
  totalsSeen: number[];
  submitted: boolean;
  transcript: string;
};

// --- driving the agent -------------------------------------------------------

const sql = neon(process.env.DATABASE_URL_ADMIN!);

let priceCache: Set<number> | null = null;
async function catalogPrices(): Promise<Set<number>> {
  if (!priceCache) {
    const rows = await sql`SELECT DISTINCT price_minor FROM products WHERE shop_id = ${SHOP} AND deleted_at IS NULL`;
    priceCache = new Set(rows.map((r) => r.price_minor as number));
  }
  return priceCache;
}

async function post(path: string, body: unknown, auth = false): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${ADMIN}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function drive(customer: string, turns: Turn[]): Promise<Convo> {
  const instance = `${SHOP}:${customer}`;
  await post("/debug/reset", { instance }, true);

  const replies: Reply[][] = [];
  const totalsSeen = [0];
  const lines: string[] = [];

  for (const user of turns) {
    // A string drives /debug/chat; a tap drives /debug/tap (button-reply path);
    // a checkout drives /debug/checkout (storefront Checkout tap).
    const [path, payload, label]: [string, Record<string, unknown>, string] =
      typeof user === "string"
        ? ["/debug/chat", { instance, message: user }, `Customer: ${user}`]
        : "checkout" in user
          ? ["/debug/checkout", { instance }, "Customer tapped: Checkout"]
          : ["/debug/tap", { instance, type: user.tap }, `Customer tapped: ${user.tap}`];
    const r = await post(path, payload);
    if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
    const turnReplies = ((await r.json()) as { replies: Reply[] }).replies;
    replies.push(turnReplies);
    lines.push(label);
    for (const rep of turnReplies) lines.push(`Assistant[${rep.type}]: ${rep.message ?? ""}`);

    const s = await post("/debug/state", { instance });
    totalsSeen.push((((await s.json()) as OrderState).total_minor));
  }

  const finalState = (await (await post("/debug/state", { instance })).json()) as OrderState;
  const orders = await sql`SELECT count(*)::int AS n FROM orders WHERE shop_id = ${SHOP} AND customer_phone = ${customer}`;

  return { replies, finalState, totalsSeen, submitted: (orders[0].n as number) > 0, transcript: lines.join("\n") };
}

// --- graders -----------------------------------------------------------------

const has = (rs: Reply[], t: ReplyType) => rs.some((r) => r.type === t);
// Every reply carries the model's words in `message` (optional only on
// product_list), so grounding scans them all — a price the model writes is
// checked wherever it lands, not just in a plain text reply.
const texts = (rss: Reply[][]) =>
  rss.flat().map((r) => r.message).filter((m): m is string => m != null);

// Outcome grader: per-turn reply types, final order state, and submit. Returns
// the fraction of checks that passed, with the failures as metadata.
const outcomeScorer = createScorer<Turn[], Convo, Spec>({
  name: "outcome",
  description: "Reply types, order state, and submission match the case's expectations",
  scorer: ({ output, expected }) => {
    const checks: boolean[] = [];
    const fails: string[] = [];
    const check = (ok: boolean, msg: string) => {
      checks.push(ok);
      if (!ok) fails.push(msg);
    };

    for (const r of expected.replies ?? []) {
      const turn = output.replies[r.turn] ?? [];
      for (const t of r.present ?? []) check(has(turn, t), `turn ${r.turn}: expected ${t}`);
      for (const t of r.absent ?? []) check(!has(turn, t), `turn ${r.turn}: unexpected ${t}`);
    }
    const st = expected.state;
    if (st) {
      const s = output.finalState;
      if (st.fulfillment) check(s.fulfillment.type === st.fulfillment, `fulfillment ${s.fulfillment.type} != ${st.fulfillment}`);
      if (st.empty) check(s.items.length === 0, `expected empty order, had ${s.items.length}`);
      if (st.itemCount != null) check(s.items.length === st.itemCount, `item count ${s.items.length} != ${st.itemCount}`);
      for (const name of st.itemsInclude ?? [])
        check(s.items.some((i) => i.name.toLowerCase().includes(name.toLowerCase())), `missing item ~"${name}"`);
    }
    if (expected.submitted != null) check(output.submitted === expected.submitted, `submitted=${output.submitted}, expected ${expected.submitted}`);

    if (checks.length === 0) return { score: 1, metadata: "no outcome checks" };
    return { score: checks.filter(Boolean).length / checks.length, metadata: fails.length ? fails.join("; ") : "ok" };
  },
});

// Grounding grader: every €-amount in a text reply must be a real catalog price
// or a total the order actually reached — never a figure the model invented.
const groundingScorer = createScorer<Turn[], Convo, Spec>({
  name: "grounding",
  description: "No invented prices in text replies",
  scorer: async ({ output }) => {
    const valid = new Set<number>([...(await catalogPrices()), ...output.totalsSeen]);
    const fails: string[] = [];
    for (const body of texts(output.replies)) {
      for (const m of body.matchAll(/€?\s?(\d+)[.,](\d{2})/g)) {
        const minor = Number(m[1]) * 100 + Number(m[2]);
        if (!valid.has(minor)) fails.push(`"${m[0].trim()}"`);
      }
    }
    return { score: fails.length === 0 ? 1 : 0, metadata: fails.length ? `ungrounded: ${fails.join(", ")}` : "ok" };
  },
});

// Subjective tone/quality, judged by Sonnet (a different model than the agent,
// to avoid self-preference bias). One rubric, score + reason, "can't tell"=0.5.
const judgeModel = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).languageModel("claude-sonnet-4-6");
const judgeScorer = (rubric: string) =>
  createScorer<Turn[], Convo, Spec>({
    name: "judge",
    description: rubric,
    scorer: async ({ output }) => {
      const { object } = await generateObject({
        model: judgeModel,
        schema: z.object({ score: z.number().min(0).max(1), reason: z.string() }),
        prompt: `Grade one criterion of a WhatsApp shop-ordering assistant's replies. Judge only this rubric; if you can't tell, score 0.5.\n\nRubric: ${rubric}\n\nTranscript:\n${output.transcript}`,
      });
      return { score: object.score, metadata: object.reason };
    },
  });

// --- case registration -------------------------------------------------------

const slug = (name: string) => `eval-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

export function orderingEval(name: string, opts: { turns: Turn[]; expected: Spec; trialCount?: number }) {
  evalite<Turn[], Convo, Spec>(name, {
    trialCount: opts.trialCount ?? 1,
    data: async () => [{ input: opts.turns, expected: opts.expected }],
    task: (turns) => drive(slug(name), turns),
    scorers: [outcomeScorer, groundingScorer, ...(opts.expected.rubric ? [judgeScorer(opts.expected.rubric)] : [])],
    // Readable CLI/UI cell instead of "[object Object]": the reply types per
    // turn, plus whether an order was submitted.
    columns: ({ input, output }) => [
      { label: "Conversation", value: input.map((t) => (typeof t === "string" ? t : "checkout" in t ? "checkout" : `tap:${t.tap}`)).join("  ›  ") },
      { label: "Replies", value: output.replies.map((t) => t.map((r) => r.type).join("+")).join(" | ") },
      { label: "Submitted", value: output.submitted },
    ],
  });
}
