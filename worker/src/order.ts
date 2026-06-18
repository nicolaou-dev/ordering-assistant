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

// A delivery address. The model parses it from what the customer typed and
// writes it with the set_address tool, then reads it back to confirm. The
// customer is the source of truth for their own address, so model parsing is
// safe — unlike prices, where the catalog is authoritative.
export type Address = {
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  notes?: string;
};

// How the order is handed over. type is null until the customer chooses;
// address stays null until set_address writes it (delivery only).
export type Fulfillment = {
  type: "pickup" | "delivery" | null;
  address: Address | null;
};

export type OrderState = {
  items: OrderItem[];
  // Updated by add_item as items change, so the snapshot and downstream
  // tickets read the total without re-summing.
  total_minor: number;
  fulfillment: Fulfillment;
  // Idempotency seed for submit_order: assigned when the draft gets its first
  // item, cleared when the order is placed. Combined with the DO name it forms
  // a key stable across retries of the same draft, so a double submit collapses
  // to one order via orders.idempotency_key UNIQUE.
  draftId: string | null;
};

export const emptyOrder: OrderState = {
  items: [],
  total_minor: 0,
  fulfillment: { type: null, address: null },
  draftId: null,
};

/** One-line address, for the snapshot and the customer-facing summary. */
export function formatAddress(a: Address): string {
  const parts = [a.line1, a.line2, a.city, a.postcode].filter(Boolean);
  return a.notes ? `${parts.join(", ")} (${a.notes})` : parts.join(", ");
}

/**
 * Set how the order is fulfilled, returning the next state. Switching type just
 * overwrites the previous choice. Pure: the model captures the customer's
 * answer; this never collects an address or any other detail itself.
 */
export function setFulfillment(
  state: OrderState,
  type: "pickup" | "delivery",
): OrderState {
  return { ...state, fulfillment: { ...state.fulfillment, type } };
}

/**
 * Attach a delivery address to the order, returning the next state. Pure: the
 * caller (set_address tool) has already validated the required fields.
 */
export function setAddress(state: OrderState, address: Address): OrderState {
  return { ...state, fulfillment: { ...state.fulfillment, address } };
}

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
  return { ...state, items, total_minor: state.total_minor + qty * product.unit_price_minor };
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
  return { ...state, items, total_minor: state.total_minor - removed * existing.unit_price_minor };
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
  const { type, address } = state.fulfillment;
  const fulfillment = type ?? "not set yet";
  let header = `## Current order\n\nStatus: draft\nFulfillment: ${fulfillment}`;
  // Delivery needs an address; pickup shows no address line at all.
  if (type === "delivery") {
    header += `\nAddress: ${address ? formatAddress(address) : "needed"}`;
  }
  const next = `\n\nNext: ${nextStep(state)}`;
  if (state.items.length === 0) {
    return `${header}\n\n(empty — no items added yet)${next}`;
  }
  const currency = state.items[0].currency;
  const lines = state.items.map((i) => {
    const lineTotal = i.unit_price_minor * i.qty;
    return `- ${i.qty} x ${i.name} @ ${i.unit_price_minor} = ${lineTotal}`;
  });
  return `${header}\nCurrency: ${currency} (all amounts below are price_minor — minor units, e.g. 850 = 8.50)\n\n${lines.join("\n")}\n\nOrder total: ${state.total_minor}${next}`;
}

// A one-line heuristic for the likely next step, derived from the order state.
// It's a guide for the model, not a command — a clear request from the customer
// (e.g. naming an item up front) takes priority over the suggested step.
function nextStep(state: OrderState): string {
  const { type, address } = state.fulfillment;
  const hasItems = state.items.length > 0;
  if (!type) {
    return hasItems
      ? "ask whether it's pickup or delivery with a fulfillment_prompt."
      : "greet the customer and ask whether it's pickup or delivery with a fulfillment_prompt — unless they've named an item to order, in which case look it up.";
  }
  if (!hasItems) {
    return "send the menu so they can browse and add items.";
  }
  // The order has items: don't rush ahead. Check they're done first, then
  // confirm the items with the summary. Show it, ask, and wait — the order is
  // placed only once the customer confirms and submit_order succeeds, so avoid
  // "placed/done" language before that. A delivery address (if still needed) is
  // collected after the items are confirmed, not before — the summary's job is
  // to confirm what they picked, and the address has its own read-back, which
  // doubles as the go-ahead to place the order.
  const summaryStep =
    "send the order_summary with a short text asking them to confirm it, and wait for their reply";
  const finish =
    type === "delivery" && !address
      ? `${summaryStep}. Once they confirm the items, collect the delivery address with set_address; with the address read back and confirmed, tell them you're set to deliver there and ask for the go-ahead to place the order, then place it with submit_order once they give it`
      : `${summaryStep} — place it with submit_order only once they've confirmed`;
  return `ask if they'd like anything else; once they're done, ${finish}.`;
}
