export async function verifySignature(
  rawBody: string,
  secret: string,
  header?: string,
) {
  if (!header?.startsWith("sha256=")) {
    return false;
  }

  const hex = header.slice(7);
  const keyBytes = new TextEncoder().encode(secret);
  const messageBytes = new TextEncoder().encode(rawBody);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, messageBytes);

  const expected = Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

  if (hex.length !== expected.length) return false;

  let acc = 0;
  for (let i = 0; i < expected.length; i++) {
    acc |= expected.charCodeAt(i) ^ hex.charCodeAt(i);
  }

  return acc === 0;
}
