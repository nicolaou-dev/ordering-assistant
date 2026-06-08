```txt
pnpm install
pnpm dev
```

```txt
pnpm deploy
```

## Secrets and env vars

Local dev reads secrets from `.dev.vars` in the repo root (gitignored).
Copy the template and fill in the values:

```txt
cp .dev.vars.example .dev.vars
```

For production, set secrets via wrangler:

```txt
pnpm wrangler secret put ANTHROPIC_API_KEY
```

## Cloudflare bindings types

`worker-configuration.d.ts` is generated from `wrangler.jsonc` + `.dev.vars`.
`pnpm dev` runs `wrangler types` first via the `predev` hook, so types stay in
sync when you add a binding or `.dev.vars` key and restart dev.

To regenerate manually:

```txt
pnpm cf-typegen
```

Pass `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
