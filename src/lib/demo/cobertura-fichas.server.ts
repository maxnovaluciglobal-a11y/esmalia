import {
  diaRelativo,
  paso,
  USUARIO_DEMO_ID,
  type Admin,
  type ContextoDemo,
  type PasoDeSiembra,
} from "@/lib/demo/contexto.server";

/**
 * Demo completa · la ficha de TODOS los pacientes con lo básico (notas clínicas, anamnesis,
 * odontograma, un documento y un examen), no solo la de los cuatro pacientes de la semilla
 * SQL. Quien abre cualquier ficha de la demo ve pestañas con contenido y entiende de qué
 * trata cada una. Todo ficticio.
 *
 * Idempotente: cada paso siembra solo a los pacientes que aún no tienen esa parte.
 */

// ─── Notas clínicas ──────────────────────────────────────────────────────

/**
 * Una nota y su versión 1 son dos filas que el disparador diferido exige juntas: se escriben
 * en una sola transacción con `sembrar_notas_de_la_demo()` (migración 20261118100100).
 */
async function sembrarNotasClinicas(ctx: ContextoDemo) {
  const { error } = await ctx.admin.rpc("sembrar_notas_de_la_demo");
  if (error) throw new Error(`notas clínicas: ${error.message}`);
}

// ─── Anamnesis ───────────────────────────────────────────────────────────

const ANAMNESIS = [
  { alergias: [], medicamentos: [], condiciones: [], nota: "Sin antecedentes de relevancia." },
  {
    alergias: ["Ibuprofeno"],
    medicamentos: [],
    condiciones: [],
    nota: "Evitar antiinflamatorios; usar paracetamol.",
  },
  {
    alergias: [],
    medicamentos: ["Levotiroxina 50 mcg"],
    condiciones: ["Hipotiroidismo"],
    nota: "Controlado con tratamiento.",
  },
  {
    alergias: ["Látex"],
    medicamentos: [],
    condiciones: ["Asma"],
    nota: "Usar guantes de nitrilo; mantener su inhalador a mano.",
  },
] as const;

async function sembrarAnamnesis(ctx: ContextoDemo) {
  const { data: con } = await ctx.admin
    .from("patient_medical_history")
    .select("patient_id")
    .eq("clinic_id", ctx.clinicId);
  const tienen = new Set((con ?? []).map((f) => f.patient_id));
  const filas = ctx.pacientes
    .filter((p) => !tienen.has(p.id))
    .map((p, i) => {
      const a = ANAMNESIS[i % ANAMNESIS.length];
      return {
        clinic_id: ctx.clinicId,
        patient_id: p.id,
        allergies: [...a.alergias],
        chronic_medications: [...a.medicamentos],
        conditions: [...a.condiciones],
        notes: a.nota,
        updated_by: USUARIO_DEMO_ID,
      };
    });
  if (filas.length === 0) return;
  const { error } = await ctx.admin.from("patient_medical_history").insert(filas);
  if (error) throw new Error(`anamnesis: ${error.message}`);
}

// ─── Odontograma ─────────────────────────────────────────────────────────

const MARCAS = [
  [{ pieza: 46, cara: "oclusal", condicion: "caries" }],
  [
    { pieza: 36, cara: "oclusal", condicion: "obturacion" },
    { pieza: 18, cara: "whole", condicion: "ausente" },
  ],
  [
    { pieza: 21, cara: "whole", condicion: "corona" },
    { pieza: 16, cara: "oclusal", condicion: "sellante" },
  ],
  [{ pieza: 26, cara: "mesial", condicion: "caries" }],
] as const;

async function sembrarOdontogramas(ctx: ContextoDemo) {
  const { data: con } = await ctx.admin
    .from("odontogram_marks")
    .select("patient_id")
    .eq("clinic_id", ctx.clinicId);
  const tienen = new Set((con ?? []).map((f) => f.patient_id));
  const filas = ctx.pacientes
    .filter((p) => !tienen.has(p.id))
    .flatMap((p, i) =>
      MARCAS[i % MARCAS.length].map((m) => ({
        clinic_id: ctx.clinicId,
        patient_id: p.id,
        tooth_number: m.pieza,
        surface: m.cara,
        condition: m.condicion,
        recorded_by: USUARIO_DEMO_ID,
      })),
    );
  if (filas.length === 0) return;
  const { error } = await ctx.admin.from("odontogram_marks").insert(filas);
  if (error) throw new Error(`odontograma: ${error.message}`);
}

// ─── Documentos emitidos ─────────────────────────────────────────────────

/** Un certificado de atención de ejemplo para los pacientes que aún no tienen documentos. */
async function sembrarDocumentos(ctx: ContextoDemo) {
  const [{ data: profesional }, { data: plantilla }, { data: previos }] = await Promise.all([
    ctx.admin
      .from("professionals")
      .select("id")
      .eq("clinic_id", ctx.clinicId)
      .eq("user_id", USUARIO_DEMO_ID)
      .limit(1)
      .maybeSingle(),
    ctx.admin
      .from("document_templates")
      .select("id, current_version_id")
      .eq("clinic_id", ctx.clinicId)
      .eq("seed_key", "certificado-atencion")
      .maybeSingle(),
    ctx.admin.from("issued_documents").select("patient_id").eq("clinic_id", ctx.clinicId),
  ]);
  if (!profesional || !plantilla?.current_version_id) return;
  const { data: version } = await ctx.admin
    .from("document_template_versions")
    .select("id, body")
    .eq("id", plantilla.current_version_id)
    .maybeSingle();
  if (!version) return;
  const tienen = new Set((previos ?? []).map((d) => d.patient_id));
  const pendientes = ctx.pacientes.filter((p) => !tienen.has(p.id));
  if (pendientes.length === 0) return;

  const [{ cargarDatosParaDocumento }, motor, { construirContexto }] = await Promise.all([
    import("@/lib/documentos/contexto.server"),
    import("@/lib/documentos/motor"),
    import("@/lib/documentos/variables"),
  ]);
  for (const [i, p] of pendientes.entries()) {
    const { datos } = await cargarDatosParaDocumento(ctx.admin, {
      clinicId: ctx.clinicId,
      patientId: p.id,
      userId: USUARIO_DEMO_ID,
      profesionalId: profesional.id,
    });
    if (!datos.profesional) return;
    const campos = {
      fecha_atencion: diaRelativo(ctx, -(2 + i * 4)),
      motivo: "Control y limpieza. Documento de ejemplo de la demo de Esmalia.",
    };
    const render = motor.renderPlantilla(version.body, construirContexto({ ...datos, campos }), {
      firma: motor.bloqueDeFirma(datos.profesional),
    });
    const { error } = await ctx.admin.from("issued_documents").insert({
      clinic_id: ctx.clinicId,
      patient_id: p.id,
      template_version_id: version.id,
      professional_id: profesional.id,
      fields: campos,
      content_blocks: render.bloques as never,
      content_html: motor.bloquesAHtml(render.bloques),
      issued_by: USUARIO_DEMO_ID,
    });
    if (error) throw new Error(`documento: ${error.message}`);
  }
}

// ─── Exámenes ────────────────────────────────────────────────────────────

/** Una radiografía generada (sin datos reales) para cada paciente que aún no tiene exámenes. */
async function sembrarExamenes(ctx: ContextoDemo) {
  const { data: con } = await ctx.admin
    .from("patient_exams")
    .select("patient_id")
    .eq("clinic_id", ctx.clinicId);
  const tienen = new Set((con ?? []).map((f) => f.patient_id));
  const pendientes = ctx.pacientes.filter((p) => !tienen.has(p.id));
  if (pendientes.length === 0) return;
  const { periapical, panoramica } = await import("@/lib/demo/examenes.server");
  const periapicalPng = periapical();
  const panoramicaPng = panoramica();
  const profesional = ctx.profesionales.find((p) => p.userId === USUARIO_DEMO_ID);
  for (const [i, p] of pendientes.entries()) {
    const esPanoramica = i % 3 === 2;
    const nombre = esPanoramica ? "panoramica-ejemplo.png" : "periapical-ejemplo.png";
    const datos = esPanoramica ? panoramicaPng : periapicalPng;
    const ruta = `${ctx.clinicId}/${p.id}/demo/${nombre}`;
    const { error: errSubida } = await ctx.admin.storage
      .from("clinical-exams")
      .upload(ruta, datos, { contentType: "image/png", upsert: true });
    if (errSubida) throw new Error(`examen: ${errSubida.message}`);
    const { error } = await ctx.admin.from("patient_exams").insert({
      clinic_id: ctx.clinicId,
      patient_id: p.id,
      kind: esPanoramica ? "panoramica" : "periapical",
      taken_on: diaRelativo(ctx, -(10 + i * 9)),
      teeth: esPanoramica ? [] : [[46, 36, 16, 26][i % 4]],
      professional_id: profesional?.id ?? null,
      notes: "Imagen de ejemplo generada para la demo.",
      storage_path: ruta,
      filename: nombre,
      mime_type: "image/png",
      size_bytes: datos.length,
      status: "listo",
      confirmed_at: new Date().toISOString(),
      uploaded_by: USUARIO_DEMO_ID,
    });
    if (error) throw new Error(`examen: ${error.message}`);
  }
}

// ─── Datos administrativos de cada paciente ──────────────────────────────

const PREVISIONES = [
  { plan: "fonasa", institucion: "Fonasa", tramo: "B" },
  { plan: "isapre", institucion: "Consalud", tramo: null },
  { plan: "isapre", institucion: "Banmédica", tramo: null },
  { plan: "particular", institucion: null, tramo: null },
  { plan: "fonasa", institucion: "Fonasa", tramo: "C" },
] as const;
const DIRECCIONES = [
  ["Av. Providencia 1234, depto. 502", "Providencia"],
  ["Los Leones 890", "Providencia"],
  ["Av. Apoquindo 4500, oficina 31", "Las Condes"],
  ["Irarrázaval 2150", "Ñuñoa"],
  ["Av. Larraín 6700", "La Reina"],
  ["Santa Rosa 321", "Santiago"],
] as const;
const CONTACTOS = [
  ["Marcela Soto", "madre"],
  ["Pablo Ibáñez", "pareja"],
  ["Rosa Contreras", "hermana"],
  ["Jorge Fuentes", "padre"],
  ["Lucía Herrera", "amiga"],
] as const;

/**
 * Previsión, dirección y contacto de emergencia de cada paciente (todos nacían "pendientes" y
 * la ficha mostraba «Ficha incompleta» y «Sin contacto de emergencia»). Solo completa lo que
 * falta: no pisa lo que la semilla ya dejó.
 */
async function completarDatosDeLosPacientes(ctx: ContextoDemo) {
  const { data: filas } = await ctx.admin
    .from("patients")
    .select(
      "id, health_plan, health_plan_institution, health_plan_tier, address, commune, emergency_contact_name, agreement_id",
    )
    .eq("clinic_id", ctx.clinicId)
    .is("archived_at", null)
    .order("full_name");
  for (const [i, p] of (filas ?? []).entries()) {
    const prev = p.agreement_id ? PREVISIONES[1] : PREVISIONES[i % PREVISIONES.length];
    const [direccion, comuna] = DIRECCIONES[i % DIRECCIONES.length];
    const [contacto, parentesco] = CONTACTOS[i % CONTACTOS.length];
    const cambios: Record<string, string | null> = {};
    if (!p.health_plan) {
      cambios.health_plan = prev.plan;
      cambios.health_plan_institution = prev.institucion;
      cambios.health_plan_tier = prev.tramo;
    }
    if (!p.address) {
      cambios.address = direccion;
      cambios.commune = comuna;
    }
    if (!p.emergency_contact_name) {
      cambios.emergency_contact_name = contacto;
      cambios.emergency_contact_relationship = parentesco;
      cambios.emergency_contact_phone = `+56 9 6123 46${String(10 + i).padStart(2, "0")}`;
    }
    if (Object.keys(cambios).length === 0) continue;
    const { error } = await ctx.admin
      .from("patients")
      .update(cambios as never)
      .eq("id", p.id)
      .eq("clinic_id", ctx.clinicId);
    if (error) throw new Error(`datos del paciente: ${error.message}`);
  }
}

export function pasosDeFichas(admin: Admin): PasoDeSiembra[] {
  return [
    paso(admin, "datos de todos los pacientes", completarDatosDeLosPacientes),
    paso(admin, "notas clínicas de todas las fichas", sembrarNotasClinicas),
    paso(admin, "anamnesis de todas las fichas", sembrarAnamnesis),
    paso(admin, "odontograma de todas las fichas", sembrarOdontogramas),
    paso(admin, "documentos de varias fichas", sembrarDocumentos),
    paso(admin, "exámenes de todas las fichas", sembrarExamenes),
  ];
}
