// Validates a Neon Auth (Better Auth) session JWT. The seller endpoints trust
// the caller's identity from this token instead of a bespoke seller token.
//
// Neon Auth signs with EdDSA (Ed25519); we verify the signature against the
// project's JWKS and the issuer (the deployment origin), then read the user id
// from `sub`. createRemoteJWKSet caches the key set across requests.

import { createRemoteJWKSet, jwtVerify } from "jose";

// One JWKS fetcher per URL, reused across requests (the worker isolate keeps it
// warm). Keyed so a config change in dev doesn't pin the old URL.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUrl: string) {
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}

/**
 * Verify a Neon Auth JWT and return its user id (`sub`), or null when the token
 * is missing, malformed, expired, or fails signature/issuer checks.
 */
export async function verifyNeonAuthToken(
  token: string,
  jwksUrl: string,
  issuer: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getJwks(jwksUrl), { issuer });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
