import { formatAddress, type OrderState } from "../order";

/**
 * Format the customer-facing order summary sent over WhatsApp when the model
 * emits an order_summary reply. Reads the stored order state: names, unit
 * prices and total were captured from the catalog at add_item time, so nothing
 * here comes from the model. Amounts are shown as real money (minor units / 100)
 * for the customer — the model-facing snapshot keeps raw minor units. Refreshing
 * stale prices if the catalog changes mid-order is a separate concern.
 */
export function formatOrderSummary(state: OrderState): string {
  const { items, total_minor, fulfillment } = state;
  const currency = items[0]?.currency ?? "EUR";
  const money = (minor: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency }).format(
      minor / 100,
    );
  const lines = items.map(
    (i) => `${i.qty} × ${i.name} — ${money(i.unit_price_minor * i.qty)}`,
  );
  const { type, address } = fulfillment;
  const handover =
    type === "delivery"
      ? `Delivery to ${address ? formatAddress(address) : ""}`.trimEnd()
      : "Pickup";
  return `*Your order*\n\n${lines.join("\n")}\n\n*Total: ${money(total_minor)}*\n\n${handover}`;
}
