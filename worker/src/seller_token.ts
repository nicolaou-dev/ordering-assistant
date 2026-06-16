// A seller token is a stateless per-shop credential for the self-serve order
// endpoints. It carries the shop's phone_number_id (the shops PK / app.shop_id),
// so an endpoint derives shop_id from the token instead of the shared ADMIN_TOKEN
// (which would let any seller act on every shop). Sellers will eventually obtain
// one via OTP login; for now it's minted by an admin-guarded endpoint.
//
// Same crypto as the cart token (see token.ts): AES-GCM, so the token is both
// tamper-proof and opaque, keyed off WHATSAPP_APP_SECRET.

import { decodeToken, encodeToken } from "./token";

export type SellerClaims = { phone_number_id: string };

type Payload = SellerClaims & { exp: number };

/** Encrypt the claims into an opaque URL-safe token: `b64url(iv).b64url(ciphertext)`. */
export async function mintSellerToken(
  phone_number_id: string,
  secret: string,
): Promise<string> {
  return encodeToken({ phone_number_id }, secret);
}

/**
 * Decrypt and validate a token, returning its claims or null. decodeToken
 * already rejects malformed, tampered, and expired tokens; here we only check
 * the claim shape. Callers treat null as "no access".
 */
export async function verifySellerToken(
  token: string,
  secret: string,
): Promise<SellerClaims | null> {
  const payload = (await decodeToken(token, secret)) as Payload | null;

  if (typeof payload?.phone_number_id !== "string") {
    return null;
  }
  return { phone_number_id: payload.phone_number_id };
}
