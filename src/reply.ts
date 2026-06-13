import z from "zod";

const Text = z.object({ type: z.literal("text"), body: z.string() });
// Channel-neutral signal to collect the delivery address: carries no address
// data, just tells the channel to present a form (a WhatsApp Flow later).
const AddressRequest = z.object({ type: z.literal("address_request") });
export const Reply = z.discriminatedUnion("type", [Text, AddressRequest]);
export type Reply = z.infer<typeof Reply>;
