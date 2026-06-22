import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { Plus, Minus, Trash2 } from "lucide-react";
import { $cart, $pending, getToken, mutate, qtyOf } from "../lib/cart";

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

  if (soldOut)
    return (
      <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-neutral-400">
        Sold out
      </span>
    );

  const qty = qtyOf(cart, productId);
  const disabled = !ready || pending.has(productId);

  if (qty > 0) {
    return (
      <div className="inline-flex items-center rounded-full bg-brand text-white">
        <button
          onClick={() => mutate(workerUrl, productId, "remove")}
          disabled={disabled}
          aria-label={qty === 1 ? `Remove ${name}` : `Decrease ${name}`}
          className="flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-40"
        >
          {qty === 1 ? <Trash2 size={15} /> : <Minus size={15} />}
        </button>
        <span className="min-w-5 text-center text-sm font-bold tabular-nums">
          {qty}
        </span>
        <button
          onClick={() => mutate(workerUrl, productId, "add")}
          disabled={disabled}
          aria-label={`Add one ${name}`}
          className="flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-40"
        >
          <Plus size={15} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => mutate(workerUrl, productId, "add")}
      disabled={disabled}
      aria-label={`Add ${name}`}
      className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
    >
      Add
    </button>
  );
}
