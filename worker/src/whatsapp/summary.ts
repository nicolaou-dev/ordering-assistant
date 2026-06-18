import type { OrderState } from "../order";

/**
 * Format the customer-facing order summary sent over WhatsApp when the model
 * emits an order_summary reply. Reads the stored order state: names, unit
 * prices and total were captured from the catalog at add_item time, so nothing
 * here comes from the model. Amounts are shown as real money (minor units / 100)
 * for the customer — the model-facing snapshot keeps raw minor units. Refreshing
 * stale prices if the catalog changes mid-order is a separate concern.
 *
 * Items and total only: the summary's job is to confirm what they picked. The
 * customer chose pickup/delivery explicitly (a button tap) and confirms the
 * delivery address on its own read-back when set_address saves it, so neither
 * is repeated here.
 */
export function formatOrderSummary(state: OrderState): string {
  const { items, total_minor } = state;
  const currency = items[0]?.currency ?? "EUR";
  const money = (minor: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency }).format(
      minor / 100,
    );
  const lines = items.map(
    (i) => `${i.qty} × ${i.name} — ${money(i.unit_price_minor * i.qty)}`,
  );
  return `*Your order*\n\n${lines.join("\n")}\n\n*Total: ${money(total_minor)}*`;
}
