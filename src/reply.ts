import z from "zod";

const Text = z.object({ type: z.literal("text"), body: z.string() });
// Channel-neutral signal to collect the delivery address: carries no address
// data, just tells the channel to present a form (a WhatsApp Flow later).
const AddressRequest = z.object({ type: z.literal("address_request") });
// Channel-neutral signal to show the order summary before confirmation: carries
// no items or prices, just tells the channel to render the current order. The
// harness pulls items + fulfillment from the DO and hydrates names / prices /
// total from the live catalog at send time, so the figure the customer confirms
// can't drift from the source of truth.
const OrderSummary = z.object({ type: z.literal("order_summary") });
export const Reply = z.discriminatedUnion("type", [
  Text,
  AddressRequest,
  OrderSummary,
]);
export type Reply = z.infer<typeof Reply>;
