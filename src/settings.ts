import z from "zod";

const Schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
});

export type Settings = z.infer<typeof Schema>;

export function getSettings(env: CloudflareBindings) {
  return Schema.parse(env);
}
