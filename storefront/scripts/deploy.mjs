// Per-shop storefront deploy. Usage: `pnpm storefront deploy <shop_id>`.
//
// The storefront is a static Astro build whose catalog and header (name, cover,
// tagline) are read from Neon by SHOP_ID at build time. To deploy one shop we
// only need its id; the rest (DATABASE_URL, WORKER_URL, WA_NUMBER) come from
// .env — WORKER_URL is one shared worker for every shop, WA_NUMBER is the same
// test number for now.
//
// Astro builds import.meta.env from Vite's loadEnv(mode, dir, ""), which layers
// .env first and then process.env on top — so exporting SHOP_ID for the child
// `astro build` overrides .env without touching the Astro code.
//
// Run via `node --env-file=.env` (see package.json) so DATABASE_URL et al. are
// already in process.env here. Deploy is a wrangler direct upload, so it needs
// nothing but a local `wrangler login` — no git integration, no API token.

import { spawnSync } from "node:child_process";

const shopId = process.argv[2];
if (!shopId) {
  console.error("Usage: pnpm storefront deploy <shop_id>");
  process.exit(1);
}

const project = `loop-storefront-${shopId}`;
console.log(`Deploying ${shopId} to Pages project ${project}\n`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Build for this shop. The build reads the shop's header + catalog from Neon by
// SHOP_ID and fails if no such shop exists.
run("node_modules/.bin/astro", ["build"], {
  env: { ...process.env, SHOP_ID: shopId },
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
