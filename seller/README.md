# Seller app

The shop owner's web app: sign in and (soon) work the order queue. A static
Astro build with a client-only React island.

- **Auth is Neon Auth** (managed Better Auth). The island authenticates against
  the shop's Neon Auth service using the drop-in `@neondatabase/auth-ui`
  components; signed-in, it calls the Worker with a Bearer JWT the Worker
  validates against the shop's ownership.
- Config is build-time `PUBLIC_` env (see `.env.example`): `PUBLIC_NEON_AUTH_URL`
  (the shop's Neon Auth base URL) and `PUBLIC_WORKER_URL` (the API origin).

## Commands

Run from the repo root: `pnpm seller <script>`.

| Command  | Action                                |
| -------- | ------------------------------------- |
| `dev`    | Dev server (next free port from 4321) |
| `build`  | Build the static site to `./dist/`    |
| `preview`| Serve the build locally               |

## Status

Login + a dashboard shell with a Worker connection check. The orders view and
its deploy land in their own tickets.
