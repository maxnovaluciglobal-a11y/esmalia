import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { DEMO_CLINIC_ID } from "@/lib/demo/ola9.server";
import type { ConfigInforme } from "@/lib/reportes/informes";

/**
 * Paso de `/api/demo-reset` con informes guardados de ejemplo (Ola 11 ·
 * frente A, INF-04): tres configuraciones compartidas para que el
 * constructor de Informes no arranque vacío. Las cifras salen de la agenda,
 * los pacientes y los pagos que ya siembra la demo (no se inventan datos).
 *
 * Idempotente: si la demo ya tiene informes guardados, no hace nada. Nunca
 * lanza. Corre con el rol de servicio, que pasa `block_demo_writes`.
 */

type Admin = SupabaseClient<Database>;

/** Usuario dueño de la clínica demo (`reset_demo_clinic`). */
const DEMO_USER_ID = "139dd209-8495-415c-b6cd-6bbc63367bad";

const EJEMPLOS: { name: string; config: ConfigInforme }[] = [
  {
    name: "Atenciones por profesional, contra el mes anterior",
    config: {
      metrica: "atenciones",
      corte: "profesional",
      corte2: "total",
      periodo: "mes",
      comparar: "anterior",
    },
  },
  {
    name: "Citas por día de la semana y hora",
    config: { metrica: "citas", corte: "dia_semana", corte2: "hora", periodo: "90-dias" },
  },
  {
    name: "Pacientes nuevos por origen",
    config: { metrica: "pacientes_nuevos", corte: "origen", corte2: "total", periodo: "90-dias" },
  },
];

const COMUNAS = ["Providencia", "Las Condes", "Ñuñoa", "Santiago", "La Florida", "Maipú"];
const PREVISIONES = ["fonasa", "isapre", "fonasa", "particular", "isapre", "fonasa"];
const ORIGENES = ["Instagram", "Google", "Recomendación", "Recomendación", "Convenio", "Google"];
// Sexo (opcional): el reparto incluye a quien prefiere no decirlo y deja algunas fichas sin registrar.
const SEXOS_DEMO = [
  "femenino",
  "masculino",
  "femenino",
  "prefiere_no_decir",
  "masculino",
  "femenino",
  "otro",
  null,
] as const;

/**
 * La semilla SQL crea pacientes sin comuna, previsión ni origen, así que los
 * cortes demográficos (INF-08, con el sexo incluido) salían 100% "Sin dato". Se completan solo los
 * que siguen vacíos, con un reparto fijo (mismo resultado en cada reset).
 */
async function completarDatosDemograficos(admin: Admin): Promise<void> {
  const { data: pacientes } = await admin
    .from("patients")
    .select("id, commune, health_plan, acquisition_source, sex")
    .eq("clinic_id", DEMO_CLINIC_ID)
    .order("created_at")
    .order("id");
  for (const [i, p] of (pacientes ?? []).entries()) {
    const cambios: {
      commune?: string;
      health_plan?: string;
      acquisition_source?: string;
      sex?: string;
    } = {};
    if (!p.commune) cambios.commune = COMUNAS[i % COMUNAS.length];
    if (!p.health_plan) cambios.health_plan = PREVISIONES[i % PREVISIONES.length];
    if (!p.acquisition_source) cambios.acquisition_source = ORIGENES[i % ORIGENES.length];
    const sexo = SEXOS_DEMO[i % SEXOS_DEMO.length];
    if (!p.sex && sexo) cambios.sex = sexo;
    if (Object.keys(cambios).length === 0) continue;
    const { error } = await admin
      .from("patients")
      .update(cambios)
      .eq("id", p.id)
      .eq("clinic_id", DEMO_CLINIC_ID);
    if (error) {
      console.error("[demo-reset] datos demográficos:", error.message);
      return;
    }
  }
}

export async function sembrarInformesDeLaDemo(admin: Admin): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id")
      .eq("id", DEMO_CLINIC_ID)
      .eq("is_demo", true)
      .maybeSingle();
    if (!clinica) return;
    await completarDatosDemograficos(admin);
    const { count } = await admin
      .from("saved_reports")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", DEMO_CLINIC_ID);
    if ((count ?? 0) > 0) return;
    const { error } = await admin.from("saved_reports").insert(
      EJEMPLOS.map((e) => ({
        clinic_id: DEMO_CLINIC_ID,
        name: e.name,
        config: e.config as unknown as Json,
        shared: true,
        created_by: DEMO_USER_ID,
      })),
    );
    if (error) console.error("[demo-reset] informes guardados:", error.message);
  } catch (e) {
    console.error("[demo-reset] no se pudieron sembrar los informes guardados", e);
  }
}
