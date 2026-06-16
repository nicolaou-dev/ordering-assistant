// Generic encrypted-token primitive, shared by the cart and seller tokens.
//
// AES-GCM gives authenticated encryption: a token is both tamper-proof (GCM auth
// fails on any edit) and opaque (the payload is encrypted, not just base64 in the
// URL). The key is derived from a server secret (WHATSAPP_APP_SECRET). encodeToken
// stamps an `exp`; decodeToken decrypts and rejects expired tokens, so callers
// only need to validate their own claim shapes.

// 24h: long enough to browse and order, short enough that a leaked link expires.
const TTL_MS = 24 * 60 * 60 * 1000;

async function deriveKey(secret: string): Promise<CryptoKey> {
  // AES-GCM needs a fixed-length key; SHA-256 of the secret gives 256 bits.
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeToken(payload: any, secret: string) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload_with_exp = { ...payload, exp: Date.now() + TTL_MS };
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload_with_exp)),
  );
  return `${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt, authenticate, and check expiry, returning the payload or null.
 * Returns null — never throws — for anything wrong: malformed, tampered (GCM
 * auth fails), or expired. Callers treat null as "no access".
 */
export async function decodeToken(
  token: string,
  secret: string,
): Promise<any | null> {
  try {
    const [ivPart, ctPart] = token.split(".");
    if (!ivPart || !ctPart) return null;

    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlDecode(ivPart) },
      key,
      b64urlDecode(ctPart),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext));
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
