import { atom } from "nanostores";

export type CartItem = {
  product_id: string;
  name: string;
  qty: number;
  unit_price_minor: number;
  currency: string;
};

export type Cart = { items: CartItem[]; total_minor: number };

export const $cart = atom<Cart>({ items: [], total_minor: 0 });
export const $pending = atom<Set<string>>(new Set());
export const $error = atom<string | null>(null);

// The signed cart token the agent put in the link identifies which order to
// edit. No token (the customer didn't arrive from their chat) → ordering is
// read-only.
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("t");
}

export function qtyOf(cart: Cart, product_id: string): number {
  return cart.items.find((i) => i.product_id === product_id)?.qty ?? 0;
}

// Read the current cart from the DO on page load, so a reload (or arriving from
// chat with items already in the draft) shows the real order, not an empty one.
// Best-effort: on failure the cart stays empty and the customer can still add.
export async function hydrate(workerUrl: string): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${workerUrl}/cart/state?token=${encodeURIComponent(token)}`);
    if (res.ok) $cart.set((await res.json()) as Cart);
  } catch {
    // leave the cart empty; adding still works
  }
}

// Trigger the agent to push the order summary to the customer's WhatsApp. The
// caller redirects to the chat on success; throws so it can show an error and not.
export async function checkout(workerUrl: string): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("missing token");
  const res = await fetch(`${workerUrl}/cart/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`checkout failed (${res.status})`);
}

export type RecentItem = {
  product_id: string;
  name: string;
  price_minor: number;
  currency: string;
  in_stock: boolean;
};

// The customer's recently-bought products, for the "Bought before" strip. Needs
// the cart token (it's their own history); without one there's nothing to show.
export async function fetchRecentItems(
  workerUrl: string,
): Promise<RecentItem[]> {
  const token = getToken();
  if (!token) return [];
  try {
    const res = await fetch(
      `${workerUrl}/cart/recent-items?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return [];
    return ((await res.json()) as { items: RecentItem[] }).items ?? [];
  } catch {
    return [];
  }
}

export async function mutate(
  workerUrl: string,
  product_id: string,
  op: "add" | "remove",
): Promise<void> {
  const token = getToken();
  if (!token) return;

  $pending.set(new Set($pending.get()).add(product_id));
  $error.set(null);
  try {
    const res = await fetch(`${workerUrl}/cart/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, product_id, qty: 1 }),
    });
    if (!res.ok) throw new Error(`cart ${op} failed (${res.status})`);
    $cart.set((await res.json()) as Cart);
  } catch (e) {
    $error.set(e instanceof Error ? e.message : "Something went wrong");
  } finally {
    const next = new Set($pending.get());
    next.delete(product_id);
    $pending.set(next);
  }
}
