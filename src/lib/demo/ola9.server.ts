import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import type { ClavePregunta, CuestionarioRiesgo } from "@/lib/clinical/anamnesis";

/**
 * Pasos de `/api/demo-reset` con los datos de ejemplo de la Ola 9:
 * periodontograma con NIC y comparación (PER-02/03), laboratorio con
 * catálogo y detalle técnico (LAB-03 a 07), ortodoncia con alineadores y
 * etapas (ORT-02 a 05) y ficha clínica con protocolos, interconsultas,
 * implantes y antecedentes completos (FIC-09/14/15, MKT-09).
 *
 * `reset_demo_clinic()` borra la clínica demo entera y la vuelve a crear
 * (todo cae en cascada), así que cada reset parte de cero. Aun así cada paso
 * es idempotente por su cuenta (mira si ya sembró antes de insertar): una
 * segunda llamada sin reset no duplica nada. Ninguno lanza: un error se
 * registra y el reset sigue. Corren con el rol de servicio, que pasa
 * `block_demo_writes`. No se crean notas de evolución restringidas.
 */

type Admin = SupabaseClient<Database>;

/** Id fijo de la clínica demo (`reset_demo_clinic`). */
export const DEMO_CLINIC_ID = "20cea989-de9b-4a3e-852a-31347dc3fe83";
/** Usuario dueño de la clínica demo (`reset_demo_clinic`). */
const DEMO_USER_ID = "139dd209-8495-415c-b6cd-6bbc63367bad";

/** Paciente de la Ola 9: RUT 15.789.012-3 en la semilla. */
export const PACIENTE_OLA9_DEMO = "Agustín Morales Peña";

type ClinicaDemo = { id: string; timezone: string; currency: string };

async function clinicaDemo(admin: Admin): Promise<ClinicaDemo | null> {
  const { data, error } = await admin
    .from("clinics")
    .select("id, timezone, currency")
    .eq("is_demo", true)
    .limit(20);
  if (error) throw new Error(error.message);
  // La del id fijo primero, por si hubiera otra clínica marcada como demo.
  const clinica = (data ?? []).find((c) => c.id === DEMO_CLINIC_ID) ?? (data ?? [])[0];
  if (!clinica) return null;
  return {
    id: clinica.id,
    timezone: clinica.timezone || "America/Santiago",
    currency: clinica.currency,
  };
}

/** Día civil de la clínica desplazado `offset` días (YYYY-MM-DD). */
function dia(zona: string, offset: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offset * 86_400_000));
}

function haceDias(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** Paciente por nombre; si no está, el que tenga más citas. */
async function pacientePorNombre(
  admin: Admin,
  clinicId: string,
  nombre: string,
): Promise<{ id: string; primary_professional_id: string | null } | null> {
  const { data } = await admin
    .from("patients")
    .select("id, primary_professional_id")
    .eq("clinic_id", clinicId)
    .eq("full_name", nombre)
    .limit(1)
    .maybeSingle();
  if (data) return data;
  const { data: citas } = await admin
    .from("appointments")
    .select("patient_id")
    .eq("clinic_id", clinicId)
    .limit(500);
  const conteo = new Map<string, number>();
  for (const c of citas ?? []) conteo.set(c.patient_id, (conteo.get(c.patient_id) ?? 0) + 1);
  const masCitas = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!masCitas) return null;
  const { data: p } = await admin
    .from("patients")
    .select("id, primary_professional_id")
    .eq("id", masCitas)
    .maybeSingle();
  return p ?? null;
}

async function profesionalPorNombre(
  admin: Admin,
  clinicId: string,
  fragmento: string,
): Promise<string | null> {
  const { data } = await admin
    .from("professionals")
    .select("id, full_name")
    .eq("clinic_id", clinicId)
    .order("created_at");
  const lista = data ?? [];
  return (lista.find((p) => p.full_name.includes(fragmento)) ?? lista[0])?.id ?? null;
}

async function paso(nombre: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`[demo-reset] no se pudo sembrar ${nombre}`, e);
  }
}

// ── Periodontograma (PER-02/03) ─────────────────────────────────────────────

const PIEZAS_PERIO = [16, 11, 26, 36, 31, 46] as const;

/** Por pieza: PD y recesión en mv, v, dv, ml, l, dl; sangrado; movilidad y furca. */
type PiezaPerio = {
  pd: readonly number[];
  rec: readonly number[];
  sangra: readonly boolean[];
  movilidad: number;
  furca: number | null;
};

const PUNTOS = ["mv", "v", "dv", "ml", "l", "dl"] as const;
const S = true;
const N = false;

/** Examen inicial: periodontitis localizada en molares. */
const EXAMEN_INICIAL: Record<(typeof PIEZAS_PERIO)[number], PiezaPerio> = {
  16: {
    pd: [4, 3, 5, 4, 3, 5],
    rec: [1, 0, 1, 0, 0, 1],
    sangra: [S, N, S, S, N, S],
    movilidad: 1,
    furca: 1,
  },
  11: {
    pd: [2, 2, 3, 2, 2, 2],
    rec: [0, 1, 0, 0, 0, 0],
    sangra: [N, N, S, N, N, N],
    movilidad: 0,
    furca: null,
  },
  26: {
    pd: [5, 4, 6, 4, 3, 5],
    rec: [1, 1, 2, 0, 0, 1],
    sangra: [S, S, S, S, N, S],
    movilidad: 1,
    furca: 2,
  },
  36: {
    pd: [4, 3, 4, 5, 3, 4],
    rec: [0, 0, 1, 1, 0, 0],
    sangra: [S, N, S, S, N, N],
    movilidad: 0,
    furca: 1,
  },
  31: {
    pd: [3, 2, 3, 3, 2, 3],
    rec: [1, 2, 1, 1, 1, 1],
    sangra: [N, N, S, N, N, N],
    movilidad: 0,
    furca: null,
  },
  46: {
    pd: [5, 4, 5, 4, 3, 5],
    rec: [1, 0, 1, 1, 0, 1],
    sangra: [S, N, S, N, N, S],
    movilidad: 1,
    furca: 1,
  },
};

/** Reevaluación tras raspado: mejora en 16 y 26, empeora la cara distal del 46. */
const REEVALUACION: Record<(typeof PIEZAS_PERIO)[number], PiezaPerio> = {
  16: {
    pd: [2, 2, 3, 3, 2, 3],
    rec: [1, 1, 1, 0, 0, 1],
    sangra: [N, N, S, N, N, N],
    movilidad: 0,
    furca: 1,
  },
  11: {
    pd: [2, 2, 2, 2, 2, 2],
    rec: [0, 1, 0, 0, 0, 0],
    sangra: [N, N, N, N, N, N],
    movilidad: 0,
    furca: null,
  },
  26: {
    pd: [3, 3, 3, 3, 3, 3],
    rec: [1, 1, 2, 0, 0, 1],
    sangra: [N, N, S, N, N, N],
    movilidad: 1,
    furca: 2,
  },
  36: {
    pd: [3, 3, 3, 3, 3, 3],
    rec: [0, 0, 1, 1, 0, 0],
    sangra: [N, N, N, S, N, N],
    movilidad: 0,
    furca: 1,
  },
  31: {
    pd: [2, 2, 2, 2, 2, 2],
    rec: [1, 2, 1, 1, 1, 1],
    sangra: [N, N, N, N, N, N],
    movilidad: 0,
    furca: null,
  },
  46: {
    pd: [5, 4, 7, 4, 3, 7],
    rec: [1, 0, 1, 1, 0, 1],
    sangra: [S, N, S, N, N, S],
    movilidad: 1,
    furca: 2,
  },
};

const NOTA_PERIO_INICIAL = "Examen periodontal inicial. Inflamación y bolsas en molares.";
const NOTA_PERIO_REEVALUACION =
  "Reevaluación tras raspado y alisado radicular. Mejora en 1.6 y 2.6; controlar la cara distal de 4.6.";

type FilaMedicion = Database["public"]["Tables"]["periodontal_measurements"]["Insert"];

/** Filas de mediciones de un examen (6 puntos por pieza + la fila de pieza completa). */
export function medicionesDeExamen(
  clinicId: string,
  chartId: string,
  examen: Record<number, PiezaPerio>,
): FilaMedicion[] {
  const filas: FilaMedicion[] = [];
  for (const [diente, p] of Object.entries(examen)) {
    const tooth = Number(diente);
    PUNTOS.forEach((point, i) => {
      filas.push({
        clinic_id: clinicId,
        chart_id: chartId,
        tooth_number: tooth,
        point,
        pocket_depth_mm: p.pd[i],
        recession_mm: p.rec[i],
        bleeding: p.sangra[i],
      });
    });
    filas.push({
      clinic_id: clinicId,
      chart_id: chartId,
      tooth_number: tooth,
      point: "whole",
      mobility: p.movilidad,
      furcation: p.furca,
    });
  }
  return filas;
}

export async function sembrarPeriodontogramaDeLaDemo(admin: Admin): Promise<void> {
  await paso("el periodontograma", async () => {
    const clinica = await clinicaDemo(admin);
    if (!clinica) return;
    const paciente = await pacientePorNombre(admin, clinica.id, PACIENTE_OLA9_DEMO);
    if (!paciente) return;

    const { count } = await admin
      .from("periodontal_charts")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica.id)
      .eq("patient_id", paciente.id)
      .in("notes", [NOTA_PERIO_INICIAL, NOTA_PERIO_REEVALUACION]);
    if ((count ?? 0) > 0) return;

    const examenes = [
      { notas: NOTA_PERIO_INICIAL, dias: 240, datos: EXAMEN_INICIAL },
      { notas: NOTA_PERIO_REEVALUACION, dias: 21, datos: REEVALUACION },
    ];
    for (const e of examenes) {
      const { data: chart, error } = await admin
        .from("periodontal_charts")
        .insert({
          clinic_id: clinica.id,
          patient_id: paciente.id,
          notes: e.notas,
          recorded_by: DEMO_USER_ID,
          recorded_at: haceDias(e.dias),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const { error: errM } = await admin
        .from("periodontal_measurements")
        .insert(medicionesDeExamen(clinica.id, chart.id, e.datos));
      if (errM) throw new Error(errM.message);
    }
  });
}

// ── Laboratorio (LAB-03 a 07) ───────────────────────────────────────────────

/** Montos en la unidad menor de la moneda (CLP no tiene decimales: pesos). */
export const CATALOGO_LAB_DEMO = [
  { name: "Corona de zirconia", cost_cents: 120000, typical_days: 7, material: "zirconia" },
  {
    name: "Corona metal-porcelana",
    cost_cents: 85000,
    typical_days: 8,
    material: "metal_porcelana",
  },
  {
    name: "Carilla de disilicato de litio",
    cost_cents: 140000,
    typical_days: 10,
    material: "disilicato_litio",
  },
  { name: "Incrustación de resina", cost_cents: 60000, typical_days: 6, material: "resina" },
  {
    name: "Prótesis removible de cromo-cobalto",
    cost_cents: 180000,
    typical_days: 15,
    material: "cromo_cobalto",
  },
  { name: "Placa de relajación", cost_cents: 45000, typical_days: 5, material: "acrilico" },
] as const;

export async function sembrarLaboratorioDeLaDemo(admin: Admin): Promise<void> {
  await paso("el laboratorio", async () => {
    const clinica = await clinicaDemo(admin);
    if (!clinica) return;
    const { data: lab } = await admin
      .from("labs")
      .select("id, name")
      .eq("clinic_id", clinica.id)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!lab) return;

    // Catálogo: (lab_id, name) es único, así que repetirlo no duplica.
    const { error: errCat } = await admin.from("lab_catalog_items").upsert(
      CATALOGO_LAB_DEMO.map((t) => ({
        clinic_id: clinica.id,
        lab_id: lab.id,
        currency: clinica.currency,
        ...t,
      })),
      { onConflict: "lab_id,name", ignoreDuplicates: true },
    );
    if (errCat) throw new Error(errCat.message);

    const { count } = await admin
      .from("lab_orders")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica.id)
      .not("catalog_item_id", "is", null);
    if ((count ?? 0) > 0) return;

    const { data: catalogo, error: errLee } = await admin
      .from("lab_catalog_items")
      .select("id, name, cost_cents")
      .eq("lab_id", lab.id);
    if (errLee) throw new Error(errLee.message);
    const item = (nombre: string) => (catalogo ?? []).find((c) => c.name === nombre);
    const corona = item("Corona de zirconia");
    const carilla = item("Carilla de disilicato de litio");
    if (!corona || !carilla) return;

    const [valentina, isidora, profesional] = await Promise.all([
      pacientePorNombre(admin, clinica.id, "Valentina Muñoz Soto"),
      pacientePorNombre(admin, clinica.id, "Isidora Fuentes León"),
      profesionalPorNombre(admin, clinica.id, "Camila Herrera"),
    ]);
    const pacienteA = valentina ?? isidora;
    const pacienteB = isidora ?? valentina;
    if (!pacienteA || !pacienteB) return;

    const z = clinica.timezone;
    const base = {
      clinic_id: clinica.id,
      lab_id: lab.id,
      lab_name_snapshot: lab.name,
      professional_id: profesional,
      created_by: DEMO_USER_ID,
    };
    const { error } = await admin.from("lab_orders").insert([
      {
        ...base,
        patient_id: pacienteA.id,
        catalog_item_id: corona.id,
        catalog_name_snapshot: corona.name,
        description: "Corona de zirconia pieza 1.1",
        tooth_numbers: [11],
        shade_guide: "vita_classical",
        shade: "A2",
        material: "zirconia",
        margin_type: "chaflan",
        status: "en_proceso",
        sent_on: dia(z, -3),
        due_on: dia(z, 4),
        cost_cents: corona.cost_cents,
        notes: "Translucidez incisal leve. Foto del color adjunta en la ficha.",
      },
      {
        ...base,
        patient_id: pacienteB.id,
        catalog_item_id: carilla.id,
        catalog_name_snapshot: carilla.name,
        description: "Carillas piezas 1.2 y 2.2",
        tooth_numbers: [12, 22],
        shade_guide: "vita_3d_master",
        shade: "2M2",
        material: "disilicato_litio",
        margin_type: "filo_de_cuchillo",
        // Atrasada: debía llegar hace 3 días y sigue enviada.
        status: "enviado",
        sent_on: dia(z, -14),
        due_on: dia(z, -3),
        cost_cents: carilla.cost_cents,
      },
    ]);
    if (error) throw new Error(error.message);
  });
}

// ── Ortodoncia (ORT-02 a 05) ────────────────────────────────────────────────

export async function sembrarOrtodonciaDeLaDemo(admin: Admin): Promise<void> {
  await paso("la ortodoncia", async () => {
    const clinica = await clinicaDemo(admin);
    if (!clinica) return;
    const { count } = await admin
      .from("ortho_cases")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica.id)
      .not("appliance_system", "is", null);
    if ((count ?? 0) > 0) return;

    const [martina, benjamin, ortodoncista] = await Promise.all([
      pacientePorNombre(admin, clinica.id, "Martina Silva Torres"),
      pacientePorNombre(admin, clinica.id, "Benjamín Castro Vidal"),
      profesionalPorNombre(admin, clinica.id, "Matías Reyes"),
    ]);
    if (!martina || !benjamin) return;
    const z = clinica.timezone;

    const casos = [
      {
        paciente: martina.id,
        kind: "aligners" as const,
        appliance_system: "alineadores",
        started_on: dia(z, -120),
        expected_end_on: dia(z, 300),
        monthly_fee_cents: 60000,
        aligner_total: 30,
        aligner_current: 9,
        aligner_change_days: 14,
        aligner_changed_on: dia(z, -5),
        notes: "Alineadores superiores e inferiores. Uso 22 horas al día.",
        etapas: [
          {
            stage: "alineacion",
            dias: -120,
            notes: "Inicio con attachments en 1.3, 2.3 y premolares.",
          },
          { stage: "nivelacion", dias: -40, notes: null },
        ],
      },
      {
        paciente: benjamin.id,
        kind: "brackets" as const,
        appliance_system: "autoligado",
        started_on: dia(z, -300),
        expected_end_on: dia(z, 150),
        monthly_fee_cents: 45000,
        aligner_total: null,
        aligner_current: null,
        aligner_change_days: null,
        aligner_changed_on: null,
        notes: "Brackets autoligado. Control mensual.",
        etapas: [
          { stage: "alineacion", dias: -300, notes: null },
          { stage: "nivelacion", dias: -190, notes: null },
          {
            stage: "cierre_espacios",
            dias: -60,
            notes: "Cadenas elásticas en el sector posterior.",
          },
        ],
      },
    ];

    for (const c of casos) {
      const { data: caso, error } = await admin
        .from("ortho_cases")
        .insert({
          clinic_id: clinica.id,
          patient_id: c.paciente,
          professional_id: ortodoncista,
          kind: c.kind,
          status: "active",
          appliance_system: c.appliance_system,
          started_on: c.started_on,
          expected_end_on: c.expected_end_on,
          monthly_fee_cents: c.monthly_fee_cents,
          aligner_total: c.aligner_total,
          aligner_current: c.aligner_current,
          aligner_change_days: c.aligner_change_days,
          aligner_changed_on: c.aligner_changed_on,
          notes: c.notes,
          created_by: DEMO_USER_ID,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const { error: errE } = await admin.from("ortho_stage_events").insert(
        c.etapas.map((e) => ({
          clinic_id: clinica.id,
          ortho_case_id: caso.id,
          stage: e.stage,
          started_on: dia(z, e.dias),
          notes: e.notes,
        })),
      );
      if (errE) throw new Error(errE.message);
    }
  });
}

// ── Ficha clínica (FIC-09/14/15, MKT-09) ────────────────────────────────────

export const PROTOCOLOS_DEMO = [
  {
    name: "Raspado y alisado radicular",
    procedure_label: "Periodoncia no quirúrgica",
    steps: [
      "Revisar antecedentes y presión arterial.",
      "Anestesia local por cuadrante.",
      "Raspado supra y subgingival con ultrasonido.",
      "Alisado radicular con curetas Gracey.",
      "Irrigación con clorhexidina 0,12 %.",
      "Instrucción de higiene y cepillo interproximal.",
    ],
    indications:
      "Puede haber sensibilidad al frío unos días. Enjuague con clorhexidina dos veces al día por 10 días. Reevaluación en 6 a 8 semanas.",
  },
  {
    name: "Exodoncia simple",
    procedure_label: "Extracción simple",
    steps: [
      "Confirmar pieza, radiografía y consentimiento firmado.",
      "Anestesia local.",
      "Sindesmotomía y luxación.",
      "Extracción y revisión del alvéolo.",
      "Hemostasia con gasa; sutura si corresponde.",
    ],
    indications:
      "Morder la gasa 30 minutos. No enjuagarse ni escupir las primeras 24 horas. Dieta blanda y fría. Frío local las primeras horas.",
  },
] as const;

/** Antecedentes completos: las 29 preguntas respondidas. */
export const ANTECEDENTES_DEMO: Record<ClavePregunta, CuestionarioRiesgo[ClavePregunta]> = {
  diabetes: { answer: "no" },
  hypertension: { answer: "yes", detail: "Controlada con losartán 50 mg." },
  heart_disease: { answer: "no" },
  bleeding_disorder: { answer: "no" },
  respiratory_disease: { answer: "no" },
  kidney_disease: { answer: "no" },
  liver_disease: { answer: "no" },
  thyroid_disease: { answer: "no" },
  neurological_disease: { answer: "no" },
  cancer: { answer: "no" },
  infectious_disease: { answer: "no" },
  surgeries: { answer: "yes", detail: "Apendicectomía en 2009." },
  anesthesia_reaction: { answer: "no" },
  anticoagulants: { answer: "no" },
  bisphosphonates: { answer: "no" },
  immunosuppressants: { answer: "no" },
  tobacco: { answer: "yes", detail: "5 cigarrillos al día." },
  alcohol: { answer: "yes", detail: "Ocasional, fines de semana." },
  bruxism: { answer: "yes", detail: "Nocturno, sin plano de relajación." },
  oral_habits: { answer: "no" },
  mouth_breathing: { answer: "no" },
  family_history: {
    answer: "yes",
    detail: "Padre con diabetes tipo 2 y enfermedad de las encías.",
  },
  pregnancy: { answer: "no" },
  breastfeeding: { answer: "no" },
  gum_bleeding: { answer: "yes", detail: "Al cepillarse, sobre todo en los molares." },
  tmj_pain: { answer: "no" },
  previous_ortho: { answer: "no" },
  dental_anxiety: { answer: "yes", detail: "Leve; prefiere que le expliquen cada paso." },
  other: { answer: "no" },
};

const ALERGIAS_DETALLE_DEMO = [
  { name: "Látex", severity: "moderate", reaction: "Urticaria de contacto." },
  { name: "AINEs", severity: "mild", reaction: "Malestar gástrico." },
] as const;

export async function sembrarFichaClinicaDeLaDemo(admin: Admin): Promise<void> {
  await paso("la ficha clínica", async () => {
    const clinica = await clinicaDemo(admin);
    if (!clinica) return;
    const paciente = await pacientePorNombre(admin, clinica.id, PACIENTE_OLA9_DEMO);
    const z = clinica.timezone;

    // Protocolos de la clínica (el nombre es único por clínica).
    const { data: protocolos } = await admin
      .from("clinical_protocols")
      .select("name")
      .eq("clinic_id", clinica.id);
    const existentes = new Set((protocolos ?? []).map((p) => p.name.trim().toLowerCase()));
    const nuevos = PROTOCOLOS_DEMO.filter((p) => !existentes.has(p.name.toLowerCase()));
    if (nuevos.length > 0) {
      const { error } = await admin.from("clinical_protocols").insert(
        nuevos.map((p) => ({
          clinic_id: clinica.id,
          name: p.name,
          procedure_label: p.procedure_label,
          steps: [...p.steps] as Json,
          indications: p.indications,
          created_by: DEMO_USER_ID,
          updated_by: DEMO_USER_ID,
        })),
      );
      if (error) throw new Error(error.message);
    }

    if (!paciente) return;

    // Interconsultas: una respondida y una pendiente (enviada).
    const { count: nInter } = await admin
      .from("patient_referrals")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica.id)
      .eq("patient_id", paciente.id);
    if ((nInter ?? 0) === 0) {
      const { data: inter, error } = await admin
        .from("patient_referrals")
        .insert([
          {
            clinic_id: clinica.id,
            patient_id: paciente.id,
            specialty: "Radiología maxilofacial",
            destination: "Centro Radiológico Providencia",
            reason: "Planificación de implante en pieza 3.6.",
            request: "Cone beam de la zona 3.6: ancho y altura del reborde, conducto dentario.",
            urgency: "normal",
            status: "pedida",
            requested_by: DEMO_USER_ID,
          },
          {
            clinic_id: clinica.id,
            patient_id: paciente.id,
            specialty: "Cardiología",
            destination: "Dr. Andrés Fuentes, cardiólogo",
            reason: "Hipertensión en tratamiento; evaluar riesgo antes de cirugía de implante.",
            request: "Pase para cirugía oral menor con anestesia local con vasoconstrictor.",
            urgency: "preferente",
            status: "pedida",
            requested_by: DEMO_USER_ID,
          },
        ])
        .select("id, specialty");
      if (error) throw new Error(error.message);
      const radiologia = inter.find((i) => i.specialty === "Radiología maxilofacial");
      const cardiologia = inter.find((i) => i.specialty === "Cardiología");
      if (radiologia) {
        const { error: e1 } = await admin
          .from("patient_referrals")
          .update({
            status: "respondida",
            response:
              "Reborde de 7 mm de ancho y 11 mm de altura útil sobre el conducto dentario. Sin hallazgos patológicos.",
          })
          .eq("id", radiologia.id);
        if (e1) throw new Error(e1.message);
      }
      if (cardiologia) {
        const { error: e2 } = await admin
          .from("patient_referrals")
          .update({ status: "enviada" })
          .eq("id", cardiologia.id);
        if (e2) throw new Error(e2.message);
      }
    }

    // Implantes: uno controlado (oseointegrado) y uno recién colocado.
    const { count: nImpl } = await admin
      .from("patient_implants")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica.id)
      .eq("patient_id", paciente.id);
    if ((nImpl ?? 0) === 0) {
      const { data: implantes, error } = await admin
        .from("patient_implants")
        .insert([
          {
            clinic_id: clinica.id,
            patient_id: paciente.id,
            tooth: 36,
            brand: "Straumann",
            model: "BLT Roxolid SLActive",
            diameter_mm: 4.1,
            length_mm: 10,
            lot: "TQ8842",
            reference: "021.4310",
            placed_on: dia(z, -180),
            professional_id: paciente.primary_professional_id,
            status: "colocado",
            created_by: DEMO_USER_ID,
          },
          {
            clinic_id: clinica.id,
            patient_id: paciente.id,
            tooth: 45,
            brand: "Neodent",
            model: "Helix GM",
            diameter_mm: 3.75,
            length_mm: 11.5,
            lot: "NH23B117",
            placed_on: dia(z, -40),
            professional_id: paciente.primary_professional_id,
            status: "colocado",
            notes: "Torque de inserción 35 Ncm. Tornillo de cierre.",
            created_by: DEMO_USER_ID,
          },
        ])
        .select("id, tooth");
      if (error) throw new Error(error.message);
      const primero = implantes.find((i) => i.tooth === 36);
      if (primero) {
        const { error: errC } = await admin.from("patient_implant_controls").insert({
          clinic_id: clinica.id,
          patient_id: paciente.id,
          implant_id: primero.id,
          controlled_on: dia(z, -60),
          finding: "Sin movilidad ni dolor. Mucosa periimplantaria sana. Listo para la corona.",
          isq: 74,
          status_after: "oseointegrado",
          recorded_by: DEMO_USER_ID,
        });
        if (errC) throw new Error(errC.message);
      }
    }

    // Antecedentes completos. Solo si falta alguna respuesta, para no sumar
    // una fila de auditoría de la anamnesis en cada llamada.
    const { data: historia } = await admin
      .from("patient_medical_history")
      .select("risk_questionnaire")
      .eq("patient_id", paciente.id)
      .maybeSingle();
    const respondidas = Object.keys((historia?.risk_questionnaire as object | null) ?? {}).length;
    if (respondidas < Object.keys(ANTECEDENTES_DEMO).length) {
      const { error } = await admin.from("patient_medical_history").upsert(
        {
          clinic_id: clinica.id,
          patient_id: paciente.id,
          allergies: ALERGIAS_DETALLE_DEMO.map((a) => a.name),
          allergy_details: ALERGIAS_DETALLE_DEMO.map((a) => ({ ...a })) as Json,
          chronic_medications: ["Losartán 50mg"],
          conditions: ["Hipertensión"],
          risk_questionnaire: ANTECEDENTES_DEMO as Json,
          notes: "Usar guantes de nitrilo. Controlar presión antes de anestesia.",
          updated_by: DEMO_USER_ID,
        },
        { onConflict: "patient_id" },
      );
      if (error) throw new Error(error.message);
    }
  });
}

/** Los cuatro pasos de la Ola 9, en orden. Nunca lanza. */
export async function sembrarOla9DeLaDemo(admin: Admin): Promise<void> {
  await sembrarPeriodontogramaDeLaDemo(admin);
  await sembrarLaboratorioDeLaDemo(admin);
  await sembrarOrtodonciaDeLaDemo(admin);
  await sembrarFichaClinicaDeLaDemo(admin);
}
