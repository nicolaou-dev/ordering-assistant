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

  if (soldOut) return <span className="text-xs text-neutral-400">Sold out</span>;

  const qty = qtyOf(cart, productId);
  const disabled = !ready || pending.has(productId);

  if (qty > 0) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => mutate(workerUrl, productId, "remove")}
          disabled={disabled}
          aria-label={qty === 1 ? `Remove ${name}` : `Decrease ${name}`}
          className={`flex h-7 w-7 items-center justify-center rounded-full border disabled:opacity-40 ${
            qty === 1 ? "border-red-200 text-red-600" : "border-neutral-300"
          }`}
        >
          {qty === 1 ? <Trash2 size={14} /> : <Minus size={14} />}
        </button>
        <span className="w-4 text-center text-sm font-semibold">{qty}</span>
        <button
          onClick={() => mutate(workerUrl, productId, "add")}
          disabled={disabled}
          aria-label={`Add one ${name}`}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white disabled:opacity-40"
        >
          <Plus size={14} />
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
