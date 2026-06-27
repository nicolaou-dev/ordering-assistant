import { useEffect, useState } from "react";
import { fetchRecentItems, type RecentItem } from "../lib/cart";
import { money } from "../lib/money";
import CartControl from "./CartControl.tsx";

// "Bought before": the customer's recently-bought products, re-addable with the
// normal Add control. Runtime data behind the cart token, so it loads
// client-side (the catalog page itself is static). A horizontally-scrollable
// strip. Renders nothing for read-only visitors or first-timers.
export default function RecentItems({
  workerUrl,
  images,
}: {
  workerUrl: string;
  images: Record<string, string>;
}) {
  const [items, setItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    fetchRecentItems(workerUrl).then(setItems);
  }, [workerUrl]);

  if (items.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-lg font-bold">Recently bought</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((p) => (
          <article
            key={p.product_id}
            className="flex w-36 shrink-0 flex-col overflow-hidden rounded-2xl bg-neutral-900"
          >
            {images[p.product_id] && (
              <img
                src={images[p.product_id]}
                alt={p.name}
                loading="lazy"
                className="h-24 w-full object-cover"
              />
            )}
            <div className="flex flex-1 flex-col p-2">
              <h3 className="line-clamp-2 text-xs font-semibold leading-snug">
                {p.name}
              </h3>
              <span className="mt-1 text-sm font-bold">
                {money(p.price_minor, p.currency)}
              </span>
              <div className="mt-2">
                <CartControl
                  productId={p.product_id}
                  name={p.name}
                  workerUrl={workerUrl}
                  soldOut={!p.in_stock}
                />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
