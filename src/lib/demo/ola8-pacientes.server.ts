import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import type { ColorEtiqueta } from "@/lib/patients/etiquetas";
import type { FiltrosDePacientes } from "@/lib/patients/filtros-pacientes";

/**
 * Paso de `/api/demo-reset` con los datos de ejemplo de la Ola 8 · frente A:
 * etiquetas de pacientes (PAC-07) asignadas a algunas fichas y segmentos
 * guardados (PAC-06), para que la lista de /pacientes los muestre.
 *
 * Idempotente (no duplica si se llama dos veces sin reset) y nunca lanza:
 * un error se registra y el reset sigue. Corre con el rol de servicio, que
 * pasa `block_demo_writes`.
 */

type Admin = SupabaseClient<Database>;

/** Id fijo de la clínica demo (`reset_demo_clinic`). */
const DEMO_CLINIC_ID = "20cea989-de9b-4a3e-852a-31347dc3fe83";

export const ETIQUETAS_DEMO: readonly { nombre: string; color: ColorEtiqueta }[] = [
  { nombre: "VIP", color: "ocre" },
  { nombre: "Ortodoncia 2026", color: "azul" },
  { nombre: "Prefiere la tarde", color: "verde" },
  { nombre: "Riesgo de abandono", color: "rojo" },
];

export const SEGMENTOS_DEMO: readonly {
  nombre: string;
  descripcion: string;
  filtros: FiltrosDePacientes;
}[] = [
  {
    nombre: "Con saldo pendiente",
    descripcion: "Pacientes que deben algo, para la cobranza de la semana.",
    filtros: { conSaldo: true },
  },
  {
    nombre: "Sin visita en 6 meses",
    descripcion: "Vinieron antes y no volvieron: candidatos a control.",
    filtros: { sinVisitaMeses: 6 },
  },
  {
    nombre: "Cumpleaños del mes",
    descripcion: "Para el saludo de cumpleaños.",
    filtros: { cumpleMes: true },
  },
];

export async function sembrarEtiquetasYSegmentosDeLaDemo(admin: Admin): Promise<void> {
  try {
    const { data: clinicas, error: errClinica } = await admin
      .from("clinics")
      .select("id")
      .eq("is_demo", true)
      .limit(20);
    if (errClinica) throw new Error(errClinica.message);
    const clinica =
      (clinicas ?? []).find((c) => c.id === DEMO_CLINIC_ID) ?? (clinicas ?? [])[0] ?? null;
    if (!clinica) return;
    const clinicId = clinica.id;

    // Etiquetas: las que falten (por nombre).
    const { data: existentes, error: errEtq } = await admin
      .from("patient_labels")
      .select("id, name")
      .eq("clinic_id", clinicId);
    if (errEtq) throw new Error(errEtq.message);
    const porNombre = new Map((existentes ?? []).map((e) => [e.name, e.id]));
    const faltan = ETIQUETAS_DEMO.filter((e) => !porNombre.has(e.nombre));
    if (faltan.length > 0) {
      const { data: nuevas, error } = await admin
        .from("patient_labels")
        .insert(faltan.map((e) => ({ clinic_id: clinicId, name: e.nombre, color: e.color })))
        .select("id, name");
      if (error) throw new Error(error.message);
      for (const n of nuevas ?? []) porNombre.set(n.name, n.id);
    }

    // Asignación: reparte las etiquetas entre los primeros pacientes activos
    // (por nombre, estable entre resets). Sin duplicar.
    const { data: pacientes, error: errPac } = await admin
      .from("patients")
      .select("id")
      .eq("clinic_id", clinicId)
      .is("archived_at", null)
      .order("full_name", { ascending: true })
      .limit(12);
    if (errPac) throw new Error(errPac.message);
    const ids = (pacientes ?? []).map((p) => p.id);
    const reparto: [string, number[]][] = [
      ["VIP", [0, 3, 7]],
      ["Ortodoncia 2026", [1, 4, 8, 10]],
      ["Prefiere la tarde", [0, 2, 5, 9]],
      ["Riesgo de abandono", [6, 11]],
    ];
    const filas = reparto.flatMap(([nombre, posiciones]) => {
      const labelId = porNombre.get(nombre);
      return labelId
        ? posiciones
            .filter((i) => ids[i])
            .map((i) => ({ clinic_id: clinicId, patient_id: ids[i], label_id: labelId }))
        : [];
    });
    if (filas.length > 0) {
      const { error } = await admin
        .from("patient_label_assignments")
        .upsert(filas, { onConflict: "patient_id,label_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }

    // Segmentos: los que falten (por nombre).
    const { data: segs, error: errSeg } = await admin
      .from("patient_segments")
      .select("name")
      .eq("clinic_id", clinicId);
    if (errSeg) throw new Error(errSeg.message);
    const yaEstan = new Set((segs ?? []).map((s) => s.name));
    const nuevos = SEGMENTOS_DEMO.filter((s) => !yaEstan.has(s.nombre));
    if (nuevos.length > 0) {
      const { error } = await admin.from("patient_segments").insert(
        nuevos.map((s) => ({
          clinic_id: clinicId,
          name: s.nombre,
          description: s.descripcion,
          filters: s.filtros as unknown as Json,
        })),
      );
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    console.error("[demo-reset] no se pudieron sembrar las etiquetas y segmentos", e);
  }
}
