/// <reference types="astro/client" />

// Client-exposed config (PUBLIC_ prefix → baked into the browser bundle). See
// .env.example. PUBLIC_NEON_AUTH_URL is the shop's Neon Auth base URL (what Neon
// hands you as VITE_NEON_AUTH_URL); PUBLIC_WORKER_URL is the API origin.
interface ImportMetaEnv {
  readonly PUBLIC_NEON_AUTH_URL: string;
  readonly PUBLIC_WORKER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
