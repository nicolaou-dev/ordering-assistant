import z from "zod";

const Text = z.object({ type: z.literal("text"), message: z.string() });
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
export const Reply = z.discriminatedUnion("type", [Text, ProductList, Menu]);
export type Reply = z.infer<typeof Reply>;
