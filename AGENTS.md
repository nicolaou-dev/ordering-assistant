# Loop — WhatsApp Ordering Agent

One agent that takes orders for any shop (pet shop, restaurant, etc.). Catalog is a spreadsheet the shop uploads. Eventually delivered over WhatsApp; today we build the agent.

See `tix.md` for the ticket workflow. See `CLOUDFLARE.md` for Cloudflare Workers
guidance.

## Test shop (local dev)

One shop is seeded in Neon for local development: **Bake N Take**.

- `phone_number_id` `1098392886696367` — also `WHATSAPP_PHONE_NUMBER_ID` in
  `.dev.vars`, the `shops` PK / RLS `app.shop_id`, and the OrderAgent DO name is
  `<phone_number_id>:<customer>`.
- Dialable WhatsApp number +1 (555) 652-3510 → E.164 `15556523510`. A Meta
  **test number** (limited recipients; shows "test number", no profile
  name/picture by default). Used for the storefront `wa.me` link (`WA_NUMBER`).
- 63 products seeded from `worker/tests/fixtures/bake-n-take.xlsx`. Set the shop
  name via `POST /admin/shops`.

## Monorepo layout & scripts

pnpm workspace with two packages: `worker/` (the Cloudflare Worker — API, agent,
DB) and `storefront/` (the Astro storefront). Each owns its own config, deps and
scripts.

Don't invoke tools ad-hoc (`npx tsc`, raw binaries). Run the package's own
script: `pnpm worker <script>` (e.g. `pnpm worker dev`, `pnpm worker deploy`,
`pnpm worker db:migrate`) or `pnpm storefront <script>` (e.g. `pnpm storefront
build`). `pnpm typecheck` runs across both. Each carries the right flags and config.

## Check current versions

Training data is stale. Before suggesting a library API, check the
installed version: read `package.json`, then `node_modules/<pkg>` types or
current docs.

## No symptom fixes

When the agent/LLM behaves wrong, fix the root cause — not the one failure that
surfaced. The defect is usually the model reasoning or acting without enough
context, so adding a rule per observed failure ("match category
case-insensitively") is whack-a-mole: if it's not that, it'll be something else.
Fix it by giving the model the data/vocabulary it's guessing at, improving the
prompt's general principles, or using a more capable model. Name the
symptom-vs-cause tradeoff and recommend the principled fix.

## Prompting & tools

The agent prompt is engineered, not improvised. Decisions follow documented
practice — Anthropic's "effective context engineering for agents", "writing
effective tools for agents", "building effective agents" and "Claude 4 prompting
best practices", plus the workflow-graph patterns in arXiv 2505.23006 — not
intuition. Check those before reshaping the prompt or tools.

- **Small and high-signal, not just short.** Cut redundant restatement, keep
  concrete signal. Vague guidance is as bad as an over-prescriptive rulebook.
- **Steer just-in-time, not up front.** Put situational guidance where the model
  reads it the moment it matters: a `next` hint on a tool's return (e.g.
  `query_data` keys advice on row count) and the order snapshot's `Next:` line for
  the macro flow. The static prompt holds the role, a few heuristics, and
  examples — not a per-situation rulebook.
- **Say what TO do, not what NOT to do**, and drop emphatic caps ("NEVER/MUST").
  Haiku 4.5 follows precise, calm instructions and overtriggers on shouting.
- **Examples beat prose.** A few canonical `<example>`s steer a small model
  better than paragraphs of rules.
- **Tool descriptions are onboarding docs.** Make implicit context explicit and
  keep it on the tool (the catalog schema lives on `query_data`, not the prompt).
  Return high-signal results and coach through error messages.
- **This is a workflow, not an open-ended agent.** Prefer code-driven control
  (state-gated tools, validation inside the tool bodies) over asking the prompt to
  police the flow.
- **Measure, don't eyeball.** Validate prompt/behaviour changes against the eval
  harness rather than a single `/debug/chat` run.
