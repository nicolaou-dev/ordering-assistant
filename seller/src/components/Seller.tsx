import { useCallback, useEffect, useState } from "react";
import { useAgent } from "agents/react";
import {
  SignedIn,
  SignedOut,
  AuthLoading,
  SignInForm,
  SignUpForm,
} from "@neondatabase/auth-ui";
import { AuthProvider } from "./AuthProvider";
import { AppHeader } from "./AppHeader";
import { callWorker, getToken, workerUrl } from "../lib/auth";
import posthog from "../lib/posthog.js";

// The seller-facing app. Signed out → Neon Auth sign-in; signed in → the orders
// queue. Client-only: auth runs in the browser against the managed Neon Auth
// service, and the live order feed is a WebSocket to the shop's ShopAgent.
export default function Seller() {
  return (
    <AuthProvider>
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-3 py-6 sm:px-6">
        <AuthLoading>
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        </AuthLoading>
        <SignedOut>
          <div className="flex flex-1 flex-col justify-center">
            <SignInGate />
          </div>
        </SignedOut>
        <SignedIn>
          <Dashboard />
        </SignedIn>
      </main>
    </AuthProvider>
  );
}

function SignInGate() {
  const [mode, setMode] = useState<"in" | "up">("in");
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <h1 className="text-center text-xl font-semibold">Seller sign in</h1>
      {mode === "in" ? <SignInForm /> : <SignUpForm />}
      <button
        className="text-sm text-muted-foreground underline"
        onClick={() => setMode(mode === "in" ? "up" : "in")}
      >
        {mode === "in" ? "Create an account" : "Have an account? Sign in"}
      </button>
    </div>
  );
}

function Dashboard() {
  // Resolve which shop we operate as (also confirms the session reaches the
  // Worker), then render its order queue.
  const [shopId, setShopId] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    callWorker("/seller/me")
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setShopId(data.shop_id);
          posthog.identify(data.shop_id);
        } else {
          setError(`${res.status} ${await res.text()}`);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "request failed"));
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <AppHeader current="orders" />
      {error && (
        <p className="text-sm text-destructive">Couldn’t reach the shop: {error}</p>
      )}
      {shopId && <Orders shopId={shopId} />}
    </div>
  );
}

type OrderItem = {
  qty: number;
  name: string;
  unit_price_minor: number;
  line_total_minor: number;
};
type Order = {
  order_id: string;
  status: string;
  customer_phone: string;
  customer_name: string | null;
  fulfillment_type: string;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_postcode: string | null;
  address_notes: string | null;
  total_minor: number;
  currency: string;
  created_at: string;
  items: OrderItem[];
};

function Orders({ shopId }: { shopId: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await callWorker("/orders");
    if (res.ok) {
      setOrders(((await res.json()).orders as Order[]) ?? []);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Live updates: subscribe to this shop's ShopAgent. It bumps a revision on
  // every order change (new order, accept, reject, complete); each synced state push
  // triggers a refetch. The JWT rides in as the query token the Worker checks in
  // onBeforeConnect. The socket hibernates while idle.
  useAgent({
    agent: "ShopAgent",
    name: shopId,
    host: workerUrl,
    query: async () => ({ token: (await getToken()) ?? "" }),
    onStateUpdate: () => {
      void refetch();
    },
  });

  async function decide(
    orderId: string,
    action: "approve" | "reject" | "complete",
  ) {
    setBusy(orderId);
    try {
      await callWorker(`/orders/${orderId}/${action}`, { method: "POST" });
      const eventName =
        action === "approve"
          ? "order_approved"
          : action === "reject"
            ? "order_rejected"
            : "order_completed";
      posthog.capture(eventName, { order_id: orderId });
      await refetch();
    } finally {
      setBusy(null);
    }
  }

  // Pending first — the queue to act on — then newest.
  const sorted = [...orders].sort(
    (a, b) =>
      Number(a.status !== "pending_approval") -
        Number(b.status !== "pending_approval") ||
      b.created_at.localeCompare(a.created_at),
  );

  if (!loaded)
    return <p className="text-sm text-muted-foreground">Loading orders…</p>;
  if (sorted.length === 0)
    return <p className="text-sm text-muted-foreground">No orders yet.</p>;

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((o) => (
        <li key={o.order_id} className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{o.customer_name ?? o.customer_phone}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
              {o.status.replace(/_/g, " ")}
            </span>
          </div>
          {o.customer_name && (
            <p className="text-xs text-muted-foreground">{o.customer_phone}</p>
          )}
          <p className="mt-1 text-xs capitalize text-muted-foreground">
            {o.fulfillment_type}
            {o.fulfillment_type === "delivery" && address(o) && (
              <span className="normal-case"> — {address(o)}</span>
            )}
          </p>
          <ul className="mt-2 flex flex-col gap-0.5 text-sm">
            {o.items.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-2">
                <span>
                  {i.qty}× {i.name}
                </span>
                <span className="text-muted-foreground">
                  {money(i.line_total_minor, o.currency)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm font-semibold">
              {money(o.total_minor, o.currency)}
            </span>
            {o.status === "pending_approval" && (
              <div className="flex gap-2">
                <button
                  disabled={busy === o.order_id}
                  onClick={() => decide(o.order_id, "reject")}
                  className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  disabled={busy === o.order_id}
                  onClick={() => decide(o.order_id, "approve")}
                  className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  Accept
                </button>
              </div>
            )}
            {o.status === "approved" && (
              <button
                disabled={busy === o.order_id}
                onClick={() => decide(o.order_id, "complete")}
                className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Complete
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

// The delivery address as a single line, skipping any empty parts.
function address(o: Order): string {
  return [
    o.address_line1,
    o.address_line2,
    o.address_city,
    o.address_postcode,
    o.address_notes,
  ]
    .filter(Boolean)
    .join(", ");
}
