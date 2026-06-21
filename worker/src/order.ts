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
  return {
    ...state,
    items,
    total_minor: state.total_minor + qty * product.unit_price_minor,
  };
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
  return {
    ...state,
    items,
    total_minor: state.total_minor - removed * existing.unit_price_minor,
  };
}

/**
 * Render the live order state as a compact, clearly-labelled block for the
 * model. Prepended after the static prompt each turn so the model always reads
 * THE current order it is completing, and which step of the prompt's <flow> it
 * is on (fulfillment chosen? address saved? items added?). Amounts are raw minor
 * units (cents) — the same representation query_data returns for price_minor —
 * so the model never reconciles two money formats. Status is "draft" until
 * submitted.
 */
export function renderOrderSnapshot(state: OrderState): string {
  const { type, address } = state.fulfillment;
  const fulfillment = type ?? "not set yet. Set using set_fulfillment";
  let header = `## Current order\n\nStatus: draft\nFulfillment: ${fulfillment}`;
  // Delivery needs an address; pickup shows no address line at all.
  if (type === "delivery") {
    header += `\nAddress: ${address ? formatAddress(address) : "needed"}`;
  }
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

/** The customer's most recent submitted order, read back from the DB for the
 * prompt. Distinct from OrderState — it's history, not the draft being built. */
export type RecentOrder = {
  // timestamptz — the neon driver hands this back as a Date, not a string.
  created_at: string | Date;
  status: string;
  fulfillment_type: "pickup" | "delivery";
  items: { name: string; qty: number }[];
};

// How long ago, in words a customer would use. Whole-day granularity (UTC) is
// enough for "welcome back" framing; exact times aren't useful in the prompt.
function relativeDay(then: Date): string {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.floor((day(new Date()) - day(then)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * A compact, read-only block on the customer's most recent order, injected so a
 * returning customer is greeted with awareness and the agent can speak to an
 * in-flight order (its status) without a tool call. Deliberately lean: no prices
 * (they go stale and the model must never quote an old one as current) and no
 * address (its own ticket) — just what they got, when, where it stands, and
 * pickup/delivery. Reordering or quoting prices goes through the tools, which
 * re-read the live catalog. Returns "" for a first-timer (no block).
 */
export function renderLastOrder(order: RecentOrder | null): string {
  if (!order) return "";
  const lines = order.items.map((i) => `- ${i.qty} x ${i.name}`).join("\n");
  const when = new Date(order.created_at);
  const placed = `${when.toISOString().slice(0, 10)} (${relativeDay(when)})`;
  return `## Customer's last order\n\nPlaced: ${placed}\nStatus: ${order.status.replace(/_/g, " ")}\nFulfillment: ${order.fulfillment_type}\n\n${lines}`;
}
