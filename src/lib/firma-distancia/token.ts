/**
 * Firma a distancia (Ola 5 · DOC-05): token del link, código de 6 dígitos y
 * secreto de sesión. Lógica pura con Web Crypto (corre igual en el navegador,
 * en Node 24 y en los tests).
 *
 * - Token del link: 32 bytes aleatorios en base64url (43 caracteres, 256
 *   bits). La base guarda SOLO su sha256 (`token_hash`): quien lea la tabla
 *   no puede armar el link. Es de un solo uso porque la solicitud, una vez
 *   firmada, cancelada o reemplazada, ya no acepta nada.
 * - Código: 6 dígitos uniformes (muestreo por rechazo, sin sesgo de módulo).
 *   La base guarda `sha256(token_hash + ":" + código)`.
 * - Sesión: después del RUT correcto, otro secreto aleatorio que el
 *   navegador guarda en memoria; la base guarda su sha256 y lo exige para
 *   pedir el código y para firmar (30 min).
 */

const LARGO_TOKEN = 43;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CODIGO = /^\d{6}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function base64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Secreto aleatorio de 256 bits en base64url (token del link o de sesión). */
export function generarSecreto(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const s = base64Url(bytes);
  if (s.length !== LARGO_TOKEN) throw new Error("Secreto con largo inesperado.");
  return s;
}

export function esTokenValido(token: unknown): token is string {
  return typeof token === "string" && TOKEN.test(token);
}

export function esHuellaHex(valor: unknown): valor is string {
  return typeof valor === "string" && HEX64.test(valor);
}

export async function sha256Hex(texto: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lo que guarda la base del token (o del secreto de sesión). */
export function huellaDeSecreto(secreto: string): Promise<string> {
  return sha256Hex(secreto);
}

/** Código de 6 dígitos, uniforme en 000000-999999. */
export function generarCodigo(): string {
  const tope = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < tope) return String(buf[0] % 1_000_000).padStart(6, "0");
  }
}

/** "123 456", "123-456" o " 123456 " → "123456"; null si no son 6 dígitos. */
export function normalizarCodigo(entrada: string | null | undefined): string | null {
  const limpio = (entrada ?? "").replace(/[\s-]/g, "");
  return CODIGO.test(limpio) ? limpio : null;
}

/** Huella del código atada a la solicitud: el mismo código en otro link no sirve. */
export function huellaDeCodigo(tokenHash: string, codigo: string): Promise<string> {
  return sha256Hex(`${tokenHash}:${codigo}`);
}
