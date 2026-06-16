// A cart token identifies which draft order the storefront may edit. The agent
// mints one into the storefront link; the /cart endpoints verify it to derive
// the OrderAgent the customer is talking to (its name is `${shopId}:${customer}`).
//
// We use authenticated encryption (AES-GCM), not a bare signature, so the token
// is both tamper-proof AND opaque — the customer's phone number is encrypted,
// not just base64 in the URL. The key is derived from WHATSAPP_APP_SECRET, the
// same secret the WhatsApp webhook signature uses.

export type CartClaims = { shopId: string; customer: string };

// 24h: long enough to browse and order, short enough that a leaked link expires.
const TTL_MS = 24 * 60 * 60 * 1000;

type Payload = CartClaims & { exp: number };

async function deriveKey(secret: string): Promise<CryptoKey> {
  // AES-GCM needs a fixed-length key; SHA-256 of the secret gives 256 bits.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encrypt the claims into an opaque URL-safe token: `b64url(iv).b64url(ciphertext)`. */
export async function mintCartToken(
  shopId: string,
  customer: string,
  secret: string,
): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload: Payload = { shopId, customer, exp: Date.now() + TTL_MS };
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt and validate a token, returning its claims or null. Returns null —
 * never throws — for anything wrong: malformed, tampered (GCM auth fails), or
 * expired. Callers treat null as "no access".
 */
export async function verifyCartToken(
  token: string,
  secret: string,
): Promise<CartClaims | null> {
  try {
    const [ivPart, ctPart] = token.split(".");
    if (!ivPart || !ctPart) return null;

    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlDecode(ivPart) },
      key,
      b64urlDecode(ctPart),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as Payload;

    if (
      typeof payload.shopId !== "string" ||
      typeof payload.customer !== "string" ||
      typeof payload.exp !== "number" ||
      Date.now() > payload.exp
    ) {
      return null;
    }
    return { shopId: payload.shopId, customer: payload.customer };
  } catch {
    return null;
  }
}
