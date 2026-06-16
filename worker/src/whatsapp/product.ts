/**
 * Format the WhatsApp caption for a product reply. The model only emits a bare
 * product_id; the harness looks the product up in Postgres and renders it here,
 * so the name, price and description the customer sees come from the catalog,
 * never the model's tokens. Price is real money (minor units / 100). Used for
 * both the image caption and the no-image text fallback.
 */
export type ProductRow = {
  product_id: string;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  image_url: string | null;
};

export function formatProductCaption(p: ProductRow): string {
  const money = new Intl.NumberFormat("en", {
    style: "currency",
    currency: p.currency,
  }).format(p.price_minor / 100);
  const head = `*${p.name}* — ${money}`;
  return p.description ? `${head}\n\n${p.description}` : head;
}
