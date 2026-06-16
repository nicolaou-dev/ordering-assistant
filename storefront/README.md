# Loop Storefront

A storefront menu page for a shop: browse the catalog, build a cart, and hand off
to WhatsApp to check out. Deploys as a static site (Cloudflare Pages).

## How it works

- **Catalog is static.** `src/lib/catalog.ts` reads the shop's products from Neon
  at **build time** (Astro frontmatter), so the grid ships as plain HTML with no
  DB call in the browser. Images are optimized to self-hosted WebP via
  `astro:assets`.
- **Cart is live.** Two small islands share a nanostores cart (`src/lib/cart.ts`):
  `CartControl` (per-card Add / ± stepper) and `CartBar` (total + Checkout). Every
  add/remove POSTs to the Worker's `/cart` endpoint, which edits the customer's
  draft order in the OrderAgent Durable Object. The server returns the full cart;
  the UI never does price math.
- **Identity comes from the link.** The agent links here with a signed `?t=` cart
  token that tells the Worker which order to edit. No token → the page is
  browse-only.

## Environment

The build needs these (see `.env.example`; real values live in a gitignored
`.env`):

| Var            | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `DATABASE_URL` | Neon connection (read-only `loop_agent` role)        |
| `SHOP_ID`      | Shop's `phone_number_id` — scopes the catalog read   |
| `SHOP_NAME`    | Heading shown on the page                            |
| `WORKER_URL`   | Base URL of the Worker serving `/cart/*`             |
| `WA_NUMBER`    | Shop's dialable E.164 number for the `wa.me` handoff |

## Commands

| Command        | Action                                   |
| -------------- | ---------------------------------------- |
| `pnpm dev`     | Dev server at `localhost:4321`           |
| `pnpm build`   | Build the static site to `./dist/`       |
| `pnpm preview` | Serve `./dist/` locally before deploying |

## Status

The cart goes live once the `/cart` endpoints and the signed cart token exist
(tickets #1/#2). Until then the grid renders and Add is disabled. `WA_NUMBER` is a
placeholder until the shop's real number is wired in.
