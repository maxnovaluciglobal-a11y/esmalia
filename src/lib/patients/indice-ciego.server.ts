/**
 * PAC-03: búsqueda por documento con el índice ciego de la base
 * (`buscar_pacientes_por_documento`, migración 20261022100200). La base
 * calcula el HMAC con la clave de Vault; acá solo viajan ids.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { normalizarDocumento } from "@/lib/patients/rut";

export const MENSAJE_DOCUMENTO_DUPLICADO =
  "Ya hay una ficha con ese documento en la clínica. Ábrela o fusiona las fichas; si de verdad es otra persona, confirma que quieres crearla igual.";

/**
 * Ids de los pacientes de la clínica con ese documento, escrito como sea
 * ("12.345.678-5" o "123456785"). Si la búsqueda falla (sin clave en Vault,
 * migración pendiente), devuelve [] en vez de romper: es un aviso, no una
 * regla. `excluir` saca a la propia ficha cuando se edita.
 */
export async function idsConElMismoDocumento(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  documento: string,
  excluir?: string,
): Promise<string[]> {
  if (!normalizarDocumento(documento)) return [];
  const { data, error } = await supabase.rpc("buscar_pacientes_por_documento", {
    p_clinic_id: clinicId,
    p_documento: documento,
  });
  if (error) {
    console.error("[indice-ciego] búsqueda por documento falló:", error.code ?? error.message);
    return [];
  }
  return ((data ?? []) as unknown as string[]).filter((id) => id !== excluir);
}
