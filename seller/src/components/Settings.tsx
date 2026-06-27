import { useEffect } from "react";
import {
  SignedIn,
  SignedOut,
  AuthLoading,
  UpdateNameCard,
  ChangeEmailCard,
  ChangePasswordCard,
} from "@neondatabase/auth-ui";
import { AuthProvider } from "./AuthProvider";

// The seller's account settings page (/settings), reached from the account
// menu — update name, email, and password via Neon Auth's cards. Behind
// sign-in; a signed-out visitor is bounced to the dashboard (which shows the
// sign-in form).
export default function Settings() {
  return (
    <AuthProvider>
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-3 py-6 sm:px-6">
        <AuthLoading>
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        </AuthLoading>
        <SignedOut>
          <RedirectHome />
        </SignedOut>
        <SignedIn>
          <div className="flex flex-col gap-4">
            <a
              href="/"
              className="text-sm text-muted-foreground hover:underline"
            >
              ← Orders
            </a>
            <h1 className="text-xl font-semibold">Account</h1>
            <UpdateNameCard />
            <ChangeEmailCard />
            <ChangePasswordCard />
          </div>
        </SignedIn>
      </main>
    </AuthProvider>
  );
}

function RedirectHome() {
  useEffect(() => {
    window.location.replace("/");
  }, []);
  return (
    <p className="text-center text-sm text-muted-foreground">Redirecting…</p>
  );
}
