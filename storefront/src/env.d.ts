/// <reference types="astro/client" />

// Server-side env the storefront reads at build/dev (see .env.example). Typed so
// import.meta.env.DATABASE_URL etc. aren't `unknown`.
interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly SHOP_ID: string;
  readonly WORKER_URL: string;
  readonly WA_NUMBER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
