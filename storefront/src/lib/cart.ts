import { atom } from "nanostores";

// Shared cart state across islands. The static Astro grid hydrates one small
// CartControl per product and one CartBar; both read and mutate this store, so
// pressing Add on a card updates the bar without either island knowing about
// the other. The server is the source of truth: every mutation POSTs to the
// Worker's /cart endpoint and replaces the cart with the response — no price
// math happens here.

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
