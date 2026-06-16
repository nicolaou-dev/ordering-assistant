import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import { $cart, $error, hydrate } from "../lib/cart";
import { money } from "../lib/money";

// Fixed bottom bar: item count, total, and the Checkout link that hands off to
// WhatsApp (the order already lives in the Durable Object, so the agent just
// confirms). Mounts on load (client:load), so it also seeds the shared cart from
// the DO. Hidden until there's something in the cart.
export default function CartBar({
  workerUrl,
  waNumber,
}: {
  workerUrl: string;
  waNumber: string;
}) {
  const cart = useStore($cart);
  const error = useStore($error);
  useEffect(() => {
    hydrate(workerUrl);
  }, [workerUrl]);

  const count = cart.items.reduce((n, i) => n + i.qty, 0);
  if (count === 0) return null;

  const currency = cart.items[0]?.currency ?? "EUR";
  const href = `https://wa.me/${waNumber}?text=${encodeURIComponent(
    "I'm ready to check out my order",
  )}`;

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        <div className="text-sm">
          <span className="font-semibold">{count}</span> item
          {count === 1 ? "" : "s"}
          <span className="mx-2 text-neutral-300">·</span>
          <span className="font-semibold">
            {money(cart.total_minor, currency)}
          </span>
        </div>
        <a
          href={href}
          className="ml-auto rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white"
        >
          Checkout
        </a>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
