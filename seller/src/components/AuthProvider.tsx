import type { ReactNode } from "react";
import { NeonAuthUIProvider } from "@neondatabase/auth-ui";
import { authClient } from "../lib/auth";

// Shared Neon Auth UI provider for every page (the dashboard and the account
// settings page). Astro is multi-page, so the auth-ui's navigation is plain
// full-page nav and Link is an anchor; after auth or sign-out we land on the
// dashboard. forgotPassword is off until that flow is built (its link would
// otherwise dead-end on a route that doesn't exist yet).
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      credentials={{
        passwordValidation: { minLength: 8, maxLength: 128 },
        forgotPassword: false,
      }}
      redirectTo="/"
      navigate={(href) => {
        window.location.href = href;
      }}
      replace={(href) => {
        window.location.replace(href);
      }}
      Link={({ href, className, children }) => (
        <a href={href} className={className}>
          {children}
        </a>
      )}
    >
      {children}
    </NeonAuthUIProvider>
  );
}
