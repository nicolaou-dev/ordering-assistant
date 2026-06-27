import { useEffect, useState } from "react";
import {
  NeonAuthUIProvider,
  SignedIn,
  SignedOut,
  AuthLoading,
  SignInForm,
  SignUpForm,
  UserButton,
} from "@neondatabase/auth-ui";
import { authClient, callWorker } from "../lib/auth";

// The seller-facing app. Signed out → Neon Auth sign-in; signed in → the
// dashboard shell (orders land in their own ticket). Client-only: auth runs in
// the browser against the managed Neon Auth service.
export default function Seller() {
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      credentials={{ passwordValidation: { minLength: 8, maxLength: 128 } }}
    >
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        <AuthLoading>
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        </AuthLoading>
        <SignedOut>
          <SignInGate />
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
    <div className="flex flex-col gap-4">
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
  // Confirm the session reaches the Worker and learn which shop we operate as.
  const [shopId, setShopId] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    callWorker("/seller/me")
      .then(async (res) =>
        res.ok ? setShopId((await res.json()).shop_id) : setError(`${res.status} ${await res.text()}`),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "request failed"));
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <UserButton />
      </div>
      {shopId && <p className="text-sm text-muted-foreground">Shop {shopId}</p>}
      {error && <p className="text-sm text-destructive">Couldn’t reach the shop: {error}</p>}
      <p className="text-sm text-muted-foreground">Your orders will appear here.</p>
    </div>
  );
}
