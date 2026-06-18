import z from "zod";

const Text = z.object({ type: z.literal("text"), message: z.string() });
// Signal to show the order summary before confirmation. The items, prices and
// total are pulled from the DO and hydrated from the live catalog at send time
// (so the figure the customer confirms can't drift from the source of truth);
// message carries the model's words — the short confirm-ask shown with it, so
// the reply asks for itself instead of leaning on a sibling text.
const OrderSummary = z.object({
  type: z.literal("order_summary"),
  message: z.string().describe("Short confirm-ask shown with the summary."),
});
// A set of products to show the customer. The ids are looked up in Postgres and
// rendered as image + caption (name, price, description) at send time, so the
// prices the customer sees never come from the model's tokens. Capped at 10 by
// the prompt. One list (not a reply per product) groups them as a single set.
// message is an optional lead-in line shown before the cards.
const ProductList = z.object({
  type: z.literal("product_list"),
  product_ids: z.array(z.string()).min(1),
  message: z.string().optional().describe("Optional lead-in shown before the cards."),
});
// Signal to show the shop's storefront. The channel mints a cart token for this
// session and renders a tappable link button to the storefront, where the
// customer browses the full catalog and adds to this same order; message is the
// button's accompanying text, in the model's own words.
const Menu = z.object({
  type: z.literal("menu"),
  message: z.string().describe("Text shown with the menu link button."),
});
// Signal to ask whether the order is pickup or delivery. The channel renders it
// as two tappable reply buttons (Pickup, Delivery) and plumbs a tap back in code
// (so the model never re-parses the choice); message is the question/greeting
// shown above the buttons, in the model's own words.
const FulfillmentPrompt = z.object({
  type: z.literal("fulfillment_prompt"),
  message: z.string().describe("Question/greeting shown above the buttons."),
});
export const Reply = z.discriminatedUnion("type", [
  Text,
  OrderSummary,
  ProductList,
  Menu,
  FulfillmentPrompt,
]);
export type Reply = z.infer<typeof Reply>;
