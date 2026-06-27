import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react";

// The seller app authenticates against the shop's Neon Auth (Better Auth) and
// calls the Worker with the resulting JWT. The React adapter gives the UI its
// useSession/SignedIn hooks. Both URLs are baked in at build from PUBLIC_ env.
const authUrl = import.meta.env.PUBLIC_NEON_AUTH_URL;
const workerUrl = import.meta.env.PUBLIC_WORKER_URL;

export const authClient = createAuthClient(authUrl, {
  adapter: BetterAuthReactAdapter(),
});

// The signed-in session carries the Neon Auth JWT as its session token (this is
// how Neon's own getJWTToken resolves it). Read it from the session and call a
// protected Worker endpoint with it as a Bearer token; the Worker validates the
// JWT against the project JWKS and resolves the caller's shop.
export async function callWorker(path: string): Promise<Response> {
  const session = await authClient.getSession();
  const token = session.data?.session?.token ?? null;
  return fetch(`${workerUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}
