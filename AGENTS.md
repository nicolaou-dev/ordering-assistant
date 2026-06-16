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
- 63 products seeded from `tests/fixtures/bake-n-take.xlsx`. Set the shop name via
  `POST /admin/shops`.

## Use the project's scripts

Don't invoke tools ad-hoc (`npx tsc`, raw binaries). Check `package.json`
`scripts` and run the project's own command (`pnpm <script>`) — it carries the
right flags and config.

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
