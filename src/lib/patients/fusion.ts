import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/**
 * Fichas fusionadas (CLI-06, auditoría 360 del 18-oct-2026).
 *
 * `merge_patients` mueve citas, pagos, odontograma, empresa con convenio,
 * membresía y cuotas, inscripciones a citas grupales, etc. a la ficha que
 * queda, pero hay dos cosas que se quedan donde nacieron:
 *  - las notas clínicas (cuelgan de `patient_ref` y una nota firmada no se
 *    reescribe), y
 *  - la anamnesis (combinar dos historias médicas sola inventaría un cuadro
 *    que nadie revisó).
 * La ficha destino las tiene que MOSTRAR igual: una alergia que quedó en la
 * ficha vieja es justo la que alguien no ve antes de recetar.
 */

export type FilaDeFusion = { id: string; merged_into: string | null };

/**
 * Todas las fichas que terminaron dentro de `destinoId`, directa o
 * indirectamente (A → B → destino). La base ya no deja fusionar hacia una
 * ficha fusionada, pero puede haber cadenas de antes; el `visitadas` corta
 * cualquier ciclo.
 */
export function fichasAbsorbidas(destinoId: string, filas: FilaDeFusion[]): string[] {
  const hijosDe = new Map<string, string[]>();
  for (const f of filas) {
    if (!f.merged_into) continue;
    hijosDe.set(f.merged_into, [...(hijosDe.get(f.merged_into) ?? []), f.id]);
  }
  const resultado: string[] = [];
  const visitadas = new Set<string>([destinoId]);
  const pendientes = [destinoId];
  while (pendientes.length) {
    const actual = pendientes.pop()!;
    for (const hijo of hijosDe.get(actual) ?? []) {
      if (visitadas.has(hijo)) continue;
      visitadas.add(hijo);
      resultado.push(hijo);
      pendientes.push(hijo);
    }
  }
  return resultado;
}

/** Para cada ficha absorbida, la ficha que quedó al final de la cadena. */
export function destinoFinal(filas: FilaDeFusion[]): Map<string, string> {
  const destinoDe = new Map(filas.map((f) => [f.id, f.merged_into]));
  const resultado = new Map<string, string>();
  for (const f of filas) {
    if (!f.merged_into) continue;
    let actual = f.merged_into;
    const vistos = new Set<string>([f.id]);
    while (destinoDe.get(actual) && !vistos.has(actual)) {
      vistos.add(actual);
      actual = destinoDe.get(actual)!;
    }
    resultado.set(f.id, actual);
  }
  return resultado;
}

/** Une listas de texto sin repetir (sin distinguir mayúsculas ni espacios de más). */
export function unirSinRepetir(...listas: string[][]): string[] {
  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const lista of listas) {
    for (const item of lista) {
      const limpio = item.trim();
      const clave = limpio.toLocaleLowerCase("es");
      if (!limpio || vistos.has(clave)) continue;
      vistos.add(clave);
      resultado.push(limpio);
    }
  }
  return resultado;
}

/**
 * Alergias por paciente para la agenda, sumando a cada ficha las de las
 * fichas que absorbió. Las fichas absorbidas conservan las suyas (se siguen
 * pudiendo abrir).
 */
export function alergiasConFusionadas(
  propias: Record<string, string[]>,
  filas: FilaDeFusion[],
): Record<string, string[]> {
  const resultado: Record<string, string[]> = { ...propias };
  for (const [origen, destino] of destinoFinal(filas)) {
    const delOrigen = propias[origen];
    if (!delOrigen?.length) continue;
    resultado[destino] = unirSinRepetir(resultado[destino] ?? [], delOrigen);
  }
  return resultado;
}

/** Lee las fichas fusionadas de la clínica (pocas: índice parcial `patients_merged_idx`). */
export async function cargarFusiones(
  supabase: SupabaseClient<Database>,
  clinicId: string,
): Promise<FilaDeFusion[]> {
  const { data, error } = await supabase
    .from("patients")
    .select("id, merged_into")
    .eq("clinic_id", clinicId)
    .not("merged_into", "is", null);
  if (error) throw new Error("No pudimos leer las fichas fusionadas.");
  return (data ?? []) as FilaDeFusion[];
}

/**
 * La ficha más todas las que se fusionaron en ella. Para registros que no
 * se reescriben al fusionar (notas, documentos y consentimientos firmados):
 * se leen por estos ids en vez de mover el `patient_id`.
 */
export async function idsDeLaFicha(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  patientId: string,
): Promise<string[]> {
  return [patientId, ...fichasAbsorbidas(patientId, await cargarFusiones(supabase, clinicId))];
}
