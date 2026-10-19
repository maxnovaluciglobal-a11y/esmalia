import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  idsConDocumentoEnClaro,
  mensajeDocumentoEnClaro,
  type FilaDocumento,
  type OrigenDocumento,
} from "@/lib/patients/documento-cifrado";

type ClienteDb = Pick<SupabaseClient<Database>, "from">;
export type Reportar = (error: Error) => Promise<void> | void;

async function reportarASentry(error: Error) {
  const { capturarErrorDelServidor } = await import("@/lib/sentry.server");
  await capturarErrorDelServidor(error, { ruta: "cifrado_documento_id" });
}

/**
 * Después de un alta, una edición o una importación con documento: relee
 * las filas y, si alguna quedó con `document_id` en claro y sin
 * `document_id_enc`, lo reporta como ERROR a Sentry (sin el documento ni el
 * nombre: solo cuántas y en qué operación). No bloquea la operación: el
 * paciente ya quedó guardado, y el backfill de la migración es idempotente,
 * así que corregir la causa y volver a correrlo cifra lo que haya quedado.
 *
 * Devuelve los ids que quedaron sin cifrar (para tests y logs).
 */
export async function vigilarCifradoDeDocumento(
  supabase: ClienteDb,
  patientIds: readonly string[],
  origen: OrigenDocumento,
  reportar: Reportar = reportarASentry,
): Promise<string[]> {
  if (patientIds.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from("patients")
      .select("id, document_id, document_id_enc")
      .in("id", [...patientIds]);
    if (error) throw new Error(error.message);

    const enClaro = idsConDocumentoEnClaro((data ?? []) as FilaDocumento[]);
    if (enClaro.length > 0) {
      const fallo = new Error(mensajeDocumentoEnClaro(origen, enClaro.length));
      console.error(fallo.message);
      await reportar(fallo);
    }
    return enClaro;
  } catch (e) {
    // Ni la verificación ni el aviso pueden romper el alta del paciente.
    console.error(
      "[SEG-03] no se pudo verificar el cifrado del documento:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}
