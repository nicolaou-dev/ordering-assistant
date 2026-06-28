import z from "zod";

const Schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_API_VERSION: z.string().default("v25.0"),
  ADMIN_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_ADMIN: z.string().min(1),
  // Storefront origin (no trailing slash), e.g. http://localhost:4321 in dev.
  // The agent builds the menu link as `${STOREFRONT_URL}/?t=<cart token>`.
  STOREFRONT_URL: z.string().min(1),
  // Public base URL for shop images in R2 (no trailing slash). Consumers build
  // <R2_PUBLIC_BASE_URL>/<shopId>/<sha256>.<ext>. The bucket's r2.dev URL today;
  // swap to a custom domain for production with no data change (we store keys).
  R2_PUBLIC_BASE_URL: z.string().min(1),
  // Neon Auth (Better Auth). The seller endpoints validate the caller's Neon
  // Auth JWT against the JWKS, treating BASE_URL as the issuer. Non-secret.
  NEON_AUTH_BASE_URL: z.string().min(1),
  NEON_AUTH_JWKS_URL: z.string().min(1),
});

export type Settings = z.infer<typeof Schema>;

export function getSettings(env: CloudflareBindings) {
  return Schema.parse(env);
}
