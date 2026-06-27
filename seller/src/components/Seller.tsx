import { useCallback, useEffect, useState } from "react";
import { useAgent } from "agents/react";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import {
  NeonAuthUIProvider,
  SignedIn,
  SignedOut,
  AuthLoading,
  SignInForm,
  SignUpForm,
} from "@neondatabase/auth-ui";
import { authClient, callWorker, getToken, workerUrl } from "../lib/auth";

// The seller-facing app. Signed out → Neon Auth sign-in; signed in → the orders
// queue. Client-only: auth runs in the browser against the managed Neon Auth
// service, and the live order feed is a WebSocket to the shop's ShopAgent.
export default function Seller() {
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      credentials={{ passwordValidation: { minLength: 8, maxLength: 128 } }}
    >
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
    </NeonAuthUIProvider>
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
      .then(async (res) =>
        res.ok
          ? setShopId((await res.json()).shop_id)
          : setError(`${res.status} ${await res.text()}`),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "request failed"));
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="shrink-0 text-xl font-semibold">Orders</h1>
        <AccountMenu />
      </div>
      {error && (
        <p className="text-sm text-destructive">Couldn’t reach the shop: {error}</p>
      )}
      {shopId && <Orders shopId={shopId} />}
    </div>
  );
}

// The signed-in user's menu. Neon Auth's UserButton renders a Radix dropdown
// that doesn't open on iOS (an upstream Radix/WebKit bug, no modal/prop fix), so
// we use a plain button toggle — native onClick fires reliably on iOS, the same
// way the sign-in form's button does. Still Neon Auth underneath: useSession for
// the user, signOut to end the session (which flips back to <SignedOut>).
function AccountMenu() {
  const [open, setOpen] = useState(false);
  const { data } = authClient.useSession();
  const user = data?.user;
  if (!user) return null;
  const initials = (user.name || user.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  const avatar = (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
      {initials}
    </span>
  );
  return (
    <div className="relative min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-w-0 items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
      >
        {avatar}
        <span className="min-w-0 text-left leading-tight">
          <span className="block truncate font-medium">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {user.email}
          </span>
        </span>
        <ChevronsUpDown className="ml-1 size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          {/* tap-away backdrop */}
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1 w-60 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <div className="flex items-center gap-2 px-2 py-1.5">
              {avatar}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>
            <div className="my-1 h-px bg-border" />
            <a
              role="menuitem"
              href="/settings"
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Settings className="size-4 text-muted-foreground" />
              Settings
            </a>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void authClient.signOut();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <LogOut className="size-4 text-muted-foreground" />
              Sign Out
            </button>
          </div>
        </>
      )}
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
  // every order change (new order, accept, reject); each synced state push
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

  async function decide(orderId: string, action: "approve" | "reject") {
    setBusy(orderId);
    try {
      await callWorker(`/orders/${orderId}/${action}`, { method: "POST" });
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
