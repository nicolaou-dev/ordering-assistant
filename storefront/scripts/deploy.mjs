// Per-shop storefront deploy. Usage: `pnpm storefront deploy <shop_id>`.
//
// The storefront is a static Astro build whose catalog, name, worker URL and
// wa.me number are baked in at build time from env. To deploy one shop we only
// need its id: the shop name (and catalog) are read from Neon by that id, and
// the rest (DATABASE_URL, WORKER_URL, WA_NUMBER) come from .env — WORKER_URL is
// one shared worker for every shop, WA_NUMBER is the same test number for now.
//
// Astro builds import.meta.env from Vite's loadEnv(mode, dir, ""), which layers
// .env first and then process.env on top — so exporting SHOP_ID/SHOP_NAME for
// the child `astro build` overrides .env without touching the Astro code.
//
// Run via `node --env-file=.env` (see package.json) so DATABASE_URL et al. are
// already in process.env here. Deploy is a wrangler direct upload, so it needs
// nothing but a local `wrangler login` — no git integration, no API token.

import { spawnSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";

const shopId = process.argv[2];
if (!shopId) {
  console.error("Usage: pnpm storefront deploy <shop_id>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL must be set (loaded from .env) to look up the shop.");
  process.exit(1);
}

// Read the shop name scoped to this shop via the same app.shop_id GUC + RLS the
// catalog read uses. An unknown id returns no rows (and would build a nameless
// storefront), so stop here instead.
const sql = neon(databaseUrl);
const [, rows] = await sql.transaction([
  sql`SELECT set_config('app.shop_id', ${shopId}, true)`,
  sql`SELECT name FROM shops WHERE phone_number_id = ${shopId}`,
]);
const shopName = rows[0]?.name;
if (!shopName) {
  console.error(`No shop found for id ${shopId}.`);
  process.exit(1);
}

const project = `loop-storefront-${shopId}`;
console.log(`Deploying "${shopName}" (${shopId}) to Pages project ${project}\n`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Build with this shop's identity layered over .env.
run("node_modules/.bin/astro", ["build"], {
  env: { ...process.env, SHOP_ID: shopId, SHOP_NAME: shopName },
});

// Ensure the per-shop project exists (no-op once created); tolerate the
// "already exists" error so re-deploys just go straight through.
spawnSync(
  "node_modules/.bin/wrangler",
  ["pages", "project", "create", project, "--production-branch", "main"],
  { stdio: "inherit" },
);

// Deploy as a production deployment regardless of the current git branch.
run("node_modules/.bin/wrangler", [
  "pages",
  "deploy",
  "dist",
  "--project-name",
  project,
  "--branch",
  "main",
]);
