import z from "zod";

const Schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_API_VERSION: z.string().default("v25.0"),
  ADMIN_TOKEN: z.string().min(1),
});

export type Settings = z.infer<typeof Schema>;

export function getSettings(env: CloudflareBindings) {
  return Schema.parse(env);
}
