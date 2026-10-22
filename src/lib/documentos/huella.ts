/**
 * Huella de integridad de un documento emitido (DOC-01).
 *
 * La calcula la BASE al emitir (trigger `issued_documents_emitir`) sobre lo
 * que efectivamente quedó guardado:
 *
 *   sha256( content_html || U+001F || coalesce(signature_sha256, '') )
 *
 * Esta función es el par exacto en TypeScript (Web Crypto: corre en el
 * navegador y en Node 24): la pantalla del documento la recalcula para
 * mostrar "Integridad verificada", y `tests/documentos-db.test.ts` compara
 * las dos con el mismo documento. Si se cambia una, se cambia la otra.
 */
const SEPARADOR = "\u001f";

export function entradaDeHuella(contenidoHtml: string, firmaSha256: string | null): string {
  return `${contenidoHtml}${SEPARADOR}${firmaSha256 ?? ""}`;
}

export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function huellaDocumento(
  contenidoHtml: string,
  firmaSha256: string | null,
): Promise<string> {
  return sha256Hex(entradaDeHuella(contenidoHtml, firmaSha256));
}

/** Los primeros caracteres de la huella, para imprimir en el pie ("a1b2c3d4…"). */
export function huellaCorta(huella: string, largo = 16): string {
  return huella.length > largo ? `${huella.slice(0, largo)}…` : huella;
}
