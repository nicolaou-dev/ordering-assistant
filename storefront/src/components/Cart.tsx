import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { Plus, Minus, Trash2, X } from "lucide-react";
import {
  $cart,
  $error,
  $pending,
  checkout,
  hydrate,
  mutate,
  type CartItem,
} from "../lib/cart";
import { money } from "../lib/money";

export default function Cart({
  workerUrl,
  waNumber,
  images,
}: {
  workerUrl: string;
  waNumber: string;
  images: Record<string, string>;
}) {
  const cart = useStore($cart);
  const error = useStore($error);
  const [open, setOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    hydrate(workerUrl);
  }, [workerUrl]);

  const count = cart.items.reduce((n, i) => n + i.qty, 0);

  useEffect(() => {
    if (count === 0) setOpen(false);
  }, [count]);

  if (count === 0) return null;

  const currency = cart.items[0]?.currency ?? "EUR";

  async function onCheckout() {
    setCheckingOut(true);
    $error.set(null);
    try {
      await checkout(workerUrl);
      window.location.href = `https://wa.me/${waNumber}`;
    } catch (e) {
      $error.set(e instanceof Error ? e.message : "Checkout failed");
      setCheckingOut(false);
    }
  }

  return (
    <>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-0 z-40 flex flex-col rounded-t-2xl bg-neutral-900 text-neutral-50">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close cart"
              className="absolute right-4 top-4 text-neutral-400"
            >
              <X size={24} />
            </button>
            <div className="mx-auto w-full max-w-2xl flex-1 overflow-auto px-4 pb-28 pt-14">
              <h2 className="mb-6 text-lg font-semibold">Your order</h2>
              <ul className="space-y-5">
                {cart.items.map((item) => (
                  <CartLine
                    key={item.product_id}
                    item={item}
                    image={images[item.product_id]}
                    workerUrl={workerUrl}
                  />
                ))}
              </ul>
              {error && <p className="pt-3 text-xs text-red-600">{error}</p>}
            </div>
          </div>
        </>
      )}

      <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl">
        {open ? (
          <button
            onClick={onCheckout}
            disabled={checkingOut}
            className="flex w-full items-center gap-2 rounded-xl bg-brand px-4 py-3.5 text-white shadow-lg disabled:opacity-60"
          >
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/25 px-1.5 text-sm font-bold">
              {count}
            </span>
            <span className="text-sm font-semibold">
              {checkingOut ? "Sending…" : "Go to checkout"}
            </span>
            <span className="ml-auto text-sm font-semibold">
              {money(cart.total_minor, currency)}
            </span>
          </button>
        ) : (
          <button
            onClick={() => setOpen(true)}
            aria-label={`View order, ${count} item${count === 1 ? "" : "s"}`}
            className="flex w-full items-center gap-2 rounded-xl bg-brand px-4 py-3.5 text-white shadow-lg"
          >
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/25 px-1.5 text-sm font-bold">
              {count}
            </span>
            <span className="text-sm font-semibold">View order</span>
            <span className="ml-auto text-sm font-semibold">
              {money(cart.total_minor, currency)}
            </span>
          </button>
        )}
      </div>
    </>
  );
}

function CartLine({
  item,
  image,
  workerUrl,
}: {
  item: CartItem;
  image?: string;
  workerUrl: string;
}) {
  const pending = useStore($pending);
  const busy = pending.has(item.product_id);

  return (
    <li className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => mutate(workerUrl, item.product_id, "remove")}
          disabled={busy}
          aria-label={
            item.qty === 1 ? `Remove ${item.name}` : `Decrease ${item.name}`
          }
          className={`flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-40 ${
            item.qty === 1
              ? "bg-red-500/15 text-red-400"
              : "bg-white/10 text-neutral-200"
          }`}
        >
          {item.qty === 1 ? <Trash2 size={15} /> : <Minus size={15} />}
        </button>
        <span className="w-5 text-center text-sm font-semibold">
          {item.qty}
        </span>
        <button
          onClick={() => mutate(workerUrl, item.product_id, "add")}
          disabled={busy}
          aria-label={`Add one ${item.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40"
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.name}</div>
        <div className="text-xs text-neutral-400">
          {money(item.unit_price_minor * item.qty, item.currency)}
        </div>
      </div>
      {image && (
        <img
          src={image}
          alt=""
          className="h-12 w-12 shrink-0 rounded-md object-cover"
        />
      )}
    </li>
  );
}
