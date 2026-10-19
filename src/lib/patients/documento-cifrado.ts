/**
 * Cifrado del documento de identidad (SEG-03 / GOB-02): reglas puras.
 *
 * Desde la migración 20261019160100 el cifrado lo hace la base (trigger
 * `patients_cifrar_documento`), no la app. La app solo VERIFICA que haya
 * quedado hecho y avisa si no: antes, un fallo del cifrado quedaba en un
 * console.error "no bloqueante" que nadie miraba, y así se pasó de septiembre
 * a octubre con 0 documentos cifrados.
 */
export interface FilaDocumento {
  id: string;
  document_id: string | null;
  document_id_enc: unknown;
}

/** true si la fila tiene un documento escrito y no tiene su versión cifrada.
 * Un documento en blanco no se cifra (el trigger lo deja en NULL a propósito). */
export function documentoQuedoEnClaro(fila: FilaDocumento): boolean {
  const tieneDocumento = typeof fila.document_id === "string" && fila.document_id.trim() !== "";
  const cifrado = fila.document_id_enc !== null && fila.document_id_enc !== undefined;
  return tieneDocumento && !cifrado;
}

/** Ids de las filas con documento en claro y sin cifrar. Nunca devuelve el
 * documento: el aviso a Sentry no puede llevar el RUT. */
export function idsConDocumentoEnClaro(filas: readonly FilaDocumento[]): string[] {
  return filas.filter(documentoQuedoEnClaro).map((f) => f.id);
}

export type OrigenDocumento = "alta" | "edicion" | "importacion";

export function mensajeDocumentoEnClaro(origen: OrigenDocumento, cantidad: number): string {
  return (
    `[SEG-03] ${cantidad} documento(s) de identidad quedaron en claro sin document_id_enc ` +
    `después de ${origen === "importacion" ? "una importación" : origen === "edicion" ? "una edición" : "un alta"}. ` +
    "Revisar el trigger patients_cifrar_documento y la clave esmalia_document_id_key en Vault."
  );
}
