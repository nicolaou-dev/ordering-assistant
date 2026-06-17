import z from "zod";

const Text = z.object({ type: z.literal("text"), body: z.string() });
// Channel-neutral signal to show the order summary before confirmation: carries
// no items or prices, just tells the channel to render the current order. The
// harness pulls items + fulfillment from the DO and hydrates names / prices /
// total from the live catalog at send time, so the figure the customer confirms
// can't drift from the source of truth.
const OrderSummary = z.object({ type: z.literal("order_summary") });
// A set of products to show the customer. Carries only catalog ids — no names,
// prices or details: the harness looks each up in Postgres and renders it as an
// image + caption (name, price, description) at send time, so the prices the
// customer sees can never come from the model's tokens. Capped at 10 by the
// prompt. One list (not a reply per product) groups them as a single set.
const ProductList = z.object({
  type: z.literal("product_list"),
  product_ids: z.array(z.string()).min(1),
});
// Channel-neutral signal to show the shop's storefront. Carries no data: the
// harness mints a cart token for this session and sends a link to the storefront,
// where the customer browses the full catalog and adds to this same order.
const Menu = z.object({ type: z.literal("menu") });
// Channel-neutral signal to ask whether the order is pickup or delivery. Carries
// no data: the channel renders it as two tappable reply buttons (Pickup,
// Delivery); a tap is plumbed back in code, so the model never re-parses the
// choice. Falls back to a plain text question on channels without buttons.
const FulfillmentPrompt = z.object({ type: z.literal("fulfillment_prompt") });
export const Reply = z.discriminatedUnion("type", [
  Text,
  OrderSummary,
  ProductList,
  Menu,
  FulfillmentPrompt,
]);
export type Reply = z.infer<typeof Reply>;
