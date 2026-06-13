// The draft order the model builds up over a conversation. Held in the agent's
// durable state (this.state). All order logic — stock checks, qty
// merging, totals — lives here in code; the model only calls add_item and reads
// the rendered snapshot, never doing price math or validation itself.

export type OrderItem = {
  product_id: string;
  qty: number;
  name: string;
  unit_price_minor: number;
  currency: string;
};

export type OrderState = {
  items: OrderItem[];
  // Updated by add_item as items change, so the snapshot and downstream
  // tickets read the total without re-summing.
  total_minor: number;
};

export const emptyOrder: OrderState = { items: [], total_minor: 0 };

/**
 * Add qty of a product to the order, returning the next state. Merges into the
 * existing line if the product is already present, and keeps total_minor in
 * step. Pure: the caller fetches the product and checks stock first.
 */
export function addItem(
  state: OrderState,
  product: Omit<OrderItem, "qty">,
  qty: number,
): OrderState {
  const items = state.items.map((i) => ({ ...i }));
  const existing = items.find((i) => i.product_id === product.product_id);
  if (existing) existing.qty += qty;
  else items.push({ ...product, qty });
  return { items, total_minor: state.total_minor + qty * product.unit_price_minor };
}

/**
 * Remove qty of a product from the order, returning the next state. Decrements
 * the existing line, dropping it entirely when qty meets or exceeds the current
 * quantity (clamped at 0), and keeps total_minor in step. Pure: the caller
 * confirms the product is in the order first.
 */
export function removeItem(
  state: OrderState,
  product_id: string,
  qty: number,
): OrderState {
  const existing = state.items.find((i) => i.product_id === product_id)!;
  const removed = Math.min(qty, existing.qty);
  const items = state.items
    .map((i) => ({ ...i }))
    .filter((i) => {
      if (i.product_id !== product_id) return true;
      i.qty -= removed;
      return i.qty > 0;
    });
  return { items, total_minor: state.total_minor - removed * existing.unit_price_minor };
}

/**
 * Render the live order state as a compact, clearly-labelled block for the
 * model. Prepended after the static prompt each turn so the model always reads
 * THE current order it is completing. Amounts are raw minor units (cents) —
 * the same representation query_data returns for price_minor — so the model
 * never reconciles two money formats. Status is "draft" until later tickets
 * add submission.
 */
export function renderOrderSnapshot(state: OrderState): string {
  const header = "## Current order\n\nStatus: draft";
  if (state.items.length === 0) {
    return `${header}\n\n(empty — no items added yet)`;
  }
  const currency = state.items[0].currency;
  const lines = state.items.map((i) => {
    const lineTotal = i.unit_price_minor * i.qty;
    return `- ${i.qty} x ${i.name} @ ${i.unit_price_minor} = ${lineTotal}`;
  });
  return `${header}\nCurrency: ${currency} (all amounts below are price_minor — minor units, e.g. 850 = 8.50)\n\n${lines.join("\n")}\n\nOrder total: ${state.total_minor}`;
}
