import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react";

// The seller app authenticates against the shop's Neon Auth (Better Auth) and
// calls the Worker with the resulting JWT. The React adapter gives the UI its
// useSession/SignedIn hooks. Both URLs are baked in at build from PUBLIC_ env.
const authUrl = import.meta.env.PUBLIC_NEON_AUTH_URL;
// The Worker API origin, also the host the dashboard opens its ShopAgent
// WebSocket against (a different origin from this app).
export const workerUrl = import.meta.env.PUBLIC_WORKER_URL;

export const authClient = createAuthClient(authUrl, {
  adapter: BetterAuthReactAdapter(),
});

// The signed-in session carries the Neon Auth JWT as its session token (this is
// how Neon's own getJWTToken resolves it). The Worker validates it against the
// project JWKS and resolves the caller's shop. Used both as the /seller/*,
// /orders Bearer token and as the ?token= on the ShopAgent WebSocket.
export async function getToken(): Promise<string | null> {
  const session = await authClient.getSession();
  return session.data?.session?.token ?? null;
}

// Call a protected Worker endpoint with the session JWT as a Bearer token.
export async function callWorker(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getToken();
  return fetch(`${workerUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}
