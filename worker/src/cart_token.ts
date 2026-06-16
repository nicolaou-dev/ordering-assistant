// A cart token identifies which draft order the storefront may edit. The agent
// mints one into the storefront link; the /cart endpoints verify it to derive
// the OrderAgent the customer is talking to (its name is `${shopId}:${customer}`).
//
// We use authenticated encryption (AES-GCM), not a bare signature, so the token
// is both tamper-proof AND opaque — the customer's phone number is encrypted,
// not just base64 in the URL. The key is derived from WHATSAPP_APP_SECRET, the
// same secret the WhatsApp webhook signature uses.

import { decodeToken, encodeToken } from "./token";

export type CartClaims = { shopId: string; customer: string };

type Payload = CartClaims & { exp: number };

/** Encrypt the claims into an opaque URL-safe token: `b64url(iv).b64url(ciphertext)`. */
export async function mintCartToken(
  shopId: string,
  customer: string,
  secret: string,
): Promise<string> {
  return encodeToken({ shopId, customer }, secret);
}

/**
 * Decrypt and validate a token, returning its claims or null. decodeToken
 * already rejects malformed, tampered, and expired tokens; here we only check
 * the claim shape. Callers treat null as "no access".
 */
export async function verifyCartToken(
  token: string,
  secret: string,
): Promise<CartClaims | null> {
  const payload = (await decodeToken(token, secret)) as Payload | null;

  if (
    typeof payload?.shopId !== "string" ||
    typeof payload.customer !== "string"
  ) {
    return null;
  }
  return { shopId: payload.shopId, customer: payload.customer };
}
