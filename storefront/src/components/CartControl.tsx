import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { $cart, $pending, getToken, mutate, qtyOf } from "../lib/cart";

// The interactive bit of a product card: Add, then a -/+ stepper once it's in
// the cart. One of these hydrates per product (client:visible). Disabled until
// mounted so SSR (no window → no token) and the client agree, then enabled only
// when a cart token is present.
export default function CartControl({
  productId,
  name,
  workerUrl,
  soldOut,
}: {
  productId: string;
  name: string;
  workerUrl: string;
  soldOut: boolean;
}) {
  const cart = useStore($cart);
  const pending = useStore($pending);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(!!getToken()), []);

  if (soldOut) return <span className="text-xs text-neutral-400">Sold out</span>;

  const qty = qtyOf(cart, productId);
  const disabled = !ready || pending.has(productId);

  if (qty > 0) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => mutate(workerUrl, productId, "remove")}
          disabled={disabled}
          aria-label={`Remove one ${name}`}
          className="h-7 w-7 rounded-full border border-neutral-300 text-base leading-none disabled:opacity-40"
        >
          −
        </button>
        <span className="w-4 text-center text-sm font-semibold">{qty}</span>
        <button
          onClick={() => mutate(workerUrl, productId, "add")}
          disabled={disabled}
          aria-label={`Add one ${name}`}
          className="h-7 w-7 rounded-full bg-emerald-600 text-base leading-none text-white disabled:opacity-40"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => mutate(workerUrl, productId, "add")}
      disabled={disabled}
      className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
    >
      Add
    </button>
  );
}
