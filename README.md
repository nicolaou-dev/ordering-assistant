https://github.com/user-attachments/assets/3e7c8a6e-7a3e-4ecb-a008-dd5095c6c9ae

# Loop

An AI agent that takes customer orders conversationally — for any shop (pet
store, restaurant, bakery). The shop's catalog is a spreadsheet it uploads; the
agent reads it, answers questions, and guides the customer through the order end
to end. Delivered over WhatsApp today, but the agent is channel-agnostic.

## How it works

- Each conversation is a **Durable Object** (`OrderAgent`, named
  `<phone_number_id>:<customer>`) that holds the live draft order. State is a
  small machine rendered into the prompt each turn — the model reasons over the
  order's current shape rather than following a scripted flow.
- The agent **writes its own SQL** to read the catalog, kept safe by defense in
  depth (see [Security](#security)).
- A customer-facing **storefront** (Astro) and a **seller dashboard** (accept /
  reject / complete orders) round out the product.

## Layout

pnpm workspace with three packages, each owning its config, deps, and scripts:

| Package       | What it is                                                         |
| ------------- | ----------------------------------------------------------------- |
| `worker/`     | The Cloudflare Worker — API (Hono), the agent, Durable Objects, DB |
| `storefront/` | Astro + React + Tailwind storefront (catalog baked in at build)    |
| `seller/`     | Seller dashboard (Neon Auth, live order management)                |

## Stack

- **Cloudflare Workers** + **Durable Objects** (per-conversation state) + **R2**
  (shop images)
- **Claude** via the Vercel **AI SDK** (`@ai-sdk/anthropic`), with prompt caching
- **Neon Postgres** with row-level security
- **Hono** (routing), **Zod** (schemas), **Evalite** (agent evals)

## Getting started

```sh
pnpm install

# worker (API + agent) — http://localhost:8787
cp worker/.dev.vars.example worker/.dev.vars   # then fill in the values
pnpm worker dev

# storefront — http://localhost:4321
cp storefront/.env.example storefront/.env
pnpm storefront dev

# seller dashboard
cp seller/.env.example seller/.env
pnpm seller dev
```

`pnpm worker dev` regenerates Cloudflare binding types first (via the `predev`
hook), so they stay in sync when you add a binding or `.dev.vars` key.

### Database

Migrations live in `worker/db/migrations` (node-pg-migrate). The read-only
`loop_agent` role is created once from `worker/db/role.sql`.

```sh
pnpm worker db:migrate            # apply migrations
pnpm worker db:migrate:new name   # scaffold a new migration
```

## Security

The agent has full read access to the catalog by authoring SQL, made safe by
three independent layers — the DB role is the real boundary; the rest fail fast
and fail closed:

- **Read-only Postgres role** (`loop_agent`, `NOBYPASSRLS`, `GRANT SELECT`) — the
  agent path cannot write, period.
- **Row-level security** scopes every query to a single shop via a
  per-transaction GUC (`app.shop_id`). Unset reads as `NULL` → zero rows, so a
  bug hides data rather than leaking it.
- **AST validation** (`query_guard.ts`) parses each model-written query and
  permits only a single read statement over `products`/`shops`, blocking writes
  hidden in a CTE.

Also: WhatsApp webhooks are verified by constant-time **HMAC** signature, and the
storefront cart token is **AES-GCM** encrypted (the customer's phone number is
encrypted in the URL, not just signed).

## Testing & evals

Agent behavior is gated by an eval suite, not eyeballed. `regression.eval.ts`
asserts deterministic outcomes (order state, submission, grounding) over
realistic conversations.

> **Note:** the eval suite is currently out of shape and needs fixing before it
> can be trusted as a gate.

```sh
pnpm worker eval        # gated regression suite (threshold 90)
pnpm worker eval:watch  # iterate locally
pnpm typecheck          # across all packages
```

## Deploy

```sh
pnpm worker deploy
```

Set production secrets via wrangler, e.g.:

```sh
pnpm worker exec wrangler secret put ANTHROPIC_API_KEY
```

See `AGENTS.md` for architecture conventions and prompt-engineering principles,
`tix.md` for the ticket workflow, and `CLOUDFLARE.md` for Workers guidance.
