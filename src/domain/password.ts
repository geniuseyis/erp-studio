// Parolalar düz metin saklanmaz: PBKDF2-SHA256 ile özetlenir. WebCrypto hem tarayıcıda hem Node'da vardır.
const ITERATIONS = 100_000;
const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

/** Biçim: `pbkdf2$<tur>$<tuz base64>$<özet base64>`. Tuz her çağrıda rastgeledir. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return ["pbkdf2", ITERATIONS, toBase64(salt), toBase64(hash)].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iter, salt, hash] = stored.split("$");
    const iterations = Number(iter);
    if (scheme !== "pbkdf2" || !Number.isInteger(iterations) || iterations <= 0 || !salt || !hash) return false;
    const expected = fromBase64(hash);
    const actual = await derive(password, fromBase64(salt), iterations);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
    return diff === 0;
  } catch {
    return false;
  }
}
