import z from "zod";

const Text = z.object({ type: z.literal("text"), body: z.string() });
export const Reply = z.discriminatedUnion("type", [Text]);
export type Reply = z.infer<typeof Reply>;
