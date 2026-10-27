import { createFileRoute } from "@tanstack/react-router";
import type { Json } from "@/integrations/supabase/types";
import { cronAutorizado } from "@/lib/cron-auth.server";
import { esCuentaDemo } from "@/lib/demo-cuenta";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";

/**
 * Reset periódico de la clínica demo pública. Disparado por Vercel Cron
 * (ver "crons" en vercel.json) o manualmente con el mismo secret.
 *
 * Corre `reset_demo_clinic()` (migración 20260815190000) via RPC con la
 * service_role key — esa función es SECURITY DEFINER así que sus propios
 * INSERT/UPDATE/DELETE pasan el trigger block_demo_writes sin problema.
 */
export const Route = createFileRoute("/api/demo-reset")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const secret = process.env.CRON_SECRET;
        if (!secret) {
          return new Response("CRON_SECRET no configurado", { status: 500 });
        }
        if (!cronAutorizado(auth, secret)) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("reset_demo_clinic");

        if (error) {
          console.error("[demo-reset] failure", error.message);
          return new Response(`reset error: ${error.message}`, { status: 500 });
        }

        // SEG-01: la demo es compartida; un factor MFA inscrito desde la
        // consola le pediría un código ajeno a todos los visitantes. La guarda
        // real es el trigger de la migración 20261019120000; esto limpia en
        // cada reset por si quedó alguno. Un error acá no tumba el reset.
        try {
          await borrarFactoresMfaDeLaDemo(supabaseAdmin);
        } catch (e) {
          console.error("[demo-reset] no se pudieron limpiar los factores MFA", e);
        }

        // La semilla crea los presupuestos "hoy", así que la demo nunca tenía
        // presupuestos sin respuesta que mostrar. Se fechan hacia atrás acá
        // (service role pasa block_demo_writes) en vez de reescribir la
        // función de reset en una migración. Un error no tumba el reset.
        try {
          await fecharPresupuestosDeLaDemo(supabaseAdmin);
        } catch (e) {
          console.error("[demo-reset] no se pudieron fechar los presupuestos", e);
        }

        // PLA-07 crea la cuenta por cobrar cuando un presupuesto PASA a
        // aceptado; la semilla los inserta ya aceptados, así que la demo
        // quedaba sin cuentas. Se crean acá con la misma regla de monto que
        // "Crear cuenta" de la ficha. Un error no tumba el reset.
        try {
          await crearCuentasDeLaDemo(supabaseAdmin);
        } catch (e) {
          console.error("[demo-reset] no se pudieron crear las cuentas por cobrar", e);
        }

        // Caja A+: la semilla deja casi sin cobros el día del reset (corre a
        // las 02:05 de Chile), así que "Cobrado hoy" salía en $0. Se siembran
        // cobros de la mañana de hoy en el huso de la clínica, con medios
        // variados y el efectivo en la caja abierta. Un error no tumba el reset.
        try {
          await crearCobrosDeHoyDeLaDemo(supabaseAdmin);
        } catch (e) {
          console.error("[demo-reset] no se pudieron crear los cobros de hoy", e);
        }

        // Ola 4: un documento emitido de ejemplo (certificado de atención) en
        // la ficha de Valentina, para que la demo muestre la pestaña
        // Documentos, la página del documento, su PDF y la impresión. La
        // semilla SQL no lo puede crear (el motor arma el texto en la app).
        // Un error no tumba el reset.
        try {
          await crearDocumentoDeLaDemo(supabaseAdmin);
        } catch (e) {
          console.error("[demo-reset] no se pudo crear el documento de ejemplo", e);
        }
        await (await import("@/lib/reserva/demo.server")).prepararReservaDeLaDemo(supabaseAdmin);

        await crearEncuestasDeLaDemo(supabaseAdmin);

        // Ola 9: periodontograma con NIC y comparación, laboratorio con
        // catálogo, ortodoncia con alineadores y etapas, y ficha clínica
        // (protocolos, interconsultas, implantes, antecedentes). Cada paso es
        // idempotente y nunca lanza.
        const ola9 = await import("@/lib/demo/ola9.server");
        await ola9.sembrarPeriodontogramaDeLaDemo(supabaseAdmin);
        await ola9.sembrarLaboratorioDeLaDemo(supabaseAdmin);
        await ola9.sembrarOrtodonciaDeLaDemo(supabaseAdmin);
        await ola9.sembrarFichaClinicaDeLaDemo(supabaseAdmin);

        // Ola 8 · frente B: controles, tareas, plantillas y una campaña en borrador.
        await (
          await import("@/lib/demo/seguimiento.server")
        ).sembrarSeguimientoDeLaDemo(supabaseAdmin);
        // Ola 8 · A: etiquetas de pacientes y segmentos guardados (nunca lanza).
        await (
          await import("@/lib/demo/ola8-pacientes.server")
        ).sembrarEtiquetasYSegmentosDeLaDemo(supabaseAdmin);

        // Ola 10 · A: gastos fijos, empresa con convenio, membresías y folios (nunca lanza).
        await (await import("@/lib/demo/finanzas.server")).sembrarFinanzasDeLaDemo(supabaseAdmin);
        // Ola 10 · B: caja por operador (dos cajas abiertas, traspaso y
        // depósito) y comisiones con "rige desde", regla por prestación y el
        // mes pasado liquidado. Va después de los cobros de hoy (nunca lanza).
        await (
          await import("@/lib/demo/caja-comisiones.server")
        ).sembrarCajaYComisionesDeLaDemo(supabaseAdmin);
        // Ola 11 · A: informes guardados de ejemplo en el constructor (nunca lanza).
        await (await import("@/lib/demo/informes.server")).sembrarInformesDeLaDemo(supabaseAdmin);
        // Ola 11 · B: una reserva en línea por aceptar y el aviso de stock bajo
        // (REC-10) pasando por el trigger real (nunca lanza).
        await (await import("@/lib/demo/panel.server")).sembrarPanelDeLaDemo(supabaseAdmin);
        // Ola 13 · A: exámenes, sesiones de fotos y antes/después con imágenes
        // generadas (sin datos reales). Nunca lanza.
        await (await import("@/lib/demo/examenes.server")).sembrarExamenesDeLaDemo(supabaseAdmin);
        // Ola 14 · A: tótem, TV de sala y pantalla de box de ejemplo, sin
        // vincular (ningún token usable público). Nunca lanza.
        await (
          await import("@/lib/dispositivos/demo.server")
        ).sembrarDispositivosDeLaDemo(supabaseAdmin);

        return new Response("ok", { status: 200 });
      },
    },
  },
});

// Usuario dueño de la clínica demo (mismo id fijo que `reset_demo_clinic`).
const DEMO_USER_ID = "139dd209-8495-415c-b6cd-6bbc63367bad";

type SupabaseAdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

async function borrarFactoresMfaDeLaDemo(supabaseAdmin: SupabaseAdminClient) {
  // Se confirma el email antes de borrar: si el id fijo dejara de ser la
  // demo, no se le tocan los factores a nadie más.
  const { data: usuario } = await supabaseAdmin.auth.admin.getUserById(DEMO_USER_ID);
  if (!esCuentaDemo(usuario?.user?.email)) return;
  const { data } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: DEMO_USER_ID });
  for (const factor of data?.factors ?? []) {
    await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: DEMO_USER_ID, id: factor.id });
  }
}

/** Benjamín (enviado hace 9 días) e Isidora (borrador de hace 12): los dos sin respuesta. */
const PRESUPUESTOS_DEMO_SIN_RESPUESTA = [
  { number: "DEMO-0003", dias: 9, enviado: true },
  { number: "DEMO-0004", dias: 12, enviado: false },
] as const;

async function fecharPresupuestosDeLaDemo(supabaseAdmin: SupabaseAdminClient) {
  const { data: clinica } = await supabaseAdmin
    .from("clinics")
    .select("id")
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  if (!clinica) return;
  for (const p of PRESUPUESTOS_DEMO_SIN_RESPUESTA) {
    const fecha = new Date(Date.now() - p.dias * 24 * 60 * 60 * 1000).toISOString();
    // Validez de 30 días desde la creación (PLA-06), como un presupuesto nuevo:
    // sin ella el PDF dice "sin fecha de vencimiento".
    const validoHasta = new Date(Date.now() + (30 - p.dias) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { error } = await supabaseAdmin
      .from("quotes")
      .update(
        p.enviado
          ? { created_at: fecha, sent_at: fecha, valid_until: validoHasta }
          : { created_at: fecha, valid_until: validoHasta },
      )
      .eq("clinic_id", clinica.id)
      .eq("number", p.number);
    if (error) throw new Error(error.message);
  }
}

/** Una cuenta por cobrar por cada plan vigente de la demo; la primera, vencida. */
async function crearCuentasDeLaDemo(supabaseAdmin: SupabaseAdminClient) {
  const { data: clinica } = await supabaseAdmin
    .from("clinics")
    .select("id")
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  if (!clinica) return;

  const [{ data: planes, error: errPlanes }, { data: existentes, error: errCuentas }] =
    await Promise.all([
      supabaseAdmin
        .from("treatment_plans")
        .select("id, patient_id, name, status, created_at")
        .eq("clinic_id", clinica.id)
        .neq("status", "cancelled")
        .order("created_at"),
      supabaseAdmin
        .from("receivables")
        .select("treatment_plan_id")
        .eq("clinic_id", clinica.id)
        .not("treatment_plan_id", "is", null),
    ]);
  if (errPlanes) throw new Error(errPlanes.message);
  if (errCuentas) throw new Error(errCuentas.message);
  const conCuenta = new Set((existentes ?? []).map((c) => c.treatment_plan_id));
  const pendientes = (planes ?? []).filter((p) => !conCuenta.has(p.id));
  if (pendientes.length === 0) return;

  const { data: items, error: errItems } = await supabaseAdmin
    .from("treatment_items")
    .select("plan_id, price_cents, patient_cents")
    .eq("clinic_id", clinica.id)
    .in(
      "plan_id",
      pendientes.map((p) => p.id),
    );
  if (errItems) throw new Error(errItems.message);
  const montoPorPlan = new Map<string, number>();
  for (const it of items ?? []) {
    // `??`: con convenio, `patient_cents` = 0 es real (regla 12).
    const monto = it.patient_cents ?? it.price_cents;
    montoPorPlan.set(it.plan_id, (montoPorPlan.get(it.plan_id) ?? 0) + monto);
  }

  const dia = (offset: number) =>
    new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const filas = pendientes
    .filter((p) => (montoPorPlan.get(p.id) ?? 0) > 0)
    .map((p, i) => ({
      clinic_id: clinica.id,
      patient_id: p.patient_id,
      treatment_plan_id: p.id,
      description: p.name.slice(0, 200),
      amount_cents: montoPorPlan.get(p.id) ?? 0,
      issued_on: i === 0 ? dia(-40) : dia(-10),
      due_on: i === 0 ? dia(-10) : dia(20),
    }));
  if (filas.length === 0) return;
  const { error } = await supabaseAdmin.from("receivables").insert(filas);
  if (error) throw new Error(error.message);
}

/** Registro SIS ficticio: se lee como ejemplo en el documento impreso. */
const REGISTRO_SIS_DEMO = "EJEMPLO-000000";
const PACIENTE_DOCUMENTO_DEMO = "Valentina Muñoz Soto";

/**
 * Un certificado de atención emitido con el motor de documentos, firmado por
 * la profesional de la demo vinculada al usuario dueño (con un registro de la
 * Superintendencia de Salud claramente ficticio). Corre con el rol de
 * servicio: `issued_documents_emitir` lo acepta solo en la clínica demo y a
 * nombre del usuario de esa ficha (migración 20261025200200). Idempotente:
 * si la demo ya tiene un documento, no hace nada.
 */
async function crearDocumentoDeLaDemo(supabaseAdmin: SupabaseAdminClient) {
  const { data: clinica } = await supabaseAdmin
    .from("clinics")
    .select("id, timezone")
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  if (!clinica) return;

  const { count } = await supabaseAdmin
    .from("issued_documents")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinica.id);
  if ((count ?? 0) > 0) return;

  const [{ data: profesional }, { data: pacientes }, { data: plantilla }] = await Promise.all([
    supabaseAdmin
      .from("professionals")
      .select("id")
      .eq("clinic_id", clinica.id)
      .eq("user_id", DEMO_USER_ID)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("patients")
      .select("id, full_name")
      .eq("clinic_id", clinica.id)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("document_templates")
      .select("id, current_version_id")
      .eq("clinic_id", clinica.id)
      .eq("seed_key", "certificado-atencion")
      .maybeSingle(),
  ]);
  const paciente =
    (pacientes ?? []).find((p) => p.full_name === PACIENTE_DOCUMENTO_DEMO) ?? (pacientes ?? [])[0];
  if (!profesional || !paciente || !plantilla?.current_version_id) return;

  const { error: errSis } = await supabaseAdmin
    .from("professionals")
    .update({ sis_registry_number: REGISTRO_SIS_DEMO })
    .eq("id", profesional.id)
    .eq("clinic_id", clinica.id);
  if (errSis) throw new Error(errSis.message);

  const { data: version } = await supabaseAdmin
    .from("document_template_versions")
    .select("id, body")
    .eq("id", plantilla.current_version_id)
    .maybeSingle();
  if (!version) return;

  const [{ cargarDatosParaDocumento }, motor, { construirContexto }] = await Promise.all([
    import("@/lib/documentos/contexto.server"),
    import("@/lib/documentos/motor"),
    import("@/lib/documentos/variables"),
  ]);
  const { datos } = await cargarDatosParaDocumento(supabaseAdmin, {
    clinicId: clinica.id,
    patientId: paciente.id,
    userId: DEMO_USER_ID,
    profesionalId: profesional.id,
  });
  if (!datos.profesional) return;

  // Atención de hace una semana, en el día civil de la clínica.
  const haceUnaSemana = new Intl.DateTimeFormat("en-CA", {
    timeZone: clinica.timezone || "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const campos = {
    fecha_atencion: haceUnaSemana,
    motivo: "Control y limpieza. Documento de ejemplo de la demo de Esmalia.",
  };
  const render = motor.renderPlantilla(version.body, construirContexto({ ...datos, campos }), {
    firma: motor.bloqueDeFirma(datos.profesional),
  });

  const { error } = await supabaseAdmin.from("issued_documents").insert({
    clinic_id: clinica.id,
    patient_id: paciente.id,
    template_version_id: version.id,
    professional_id: profesional.id,
    fields: campos,
    content_blocks: render.bloques as unknown as Json,
    content_html: motor.bloquesAHtml(render.bloques),
    issued_by: DEMO_USER_ID,
  });
  if (error) throw new Error(error.message);
}

/**
 * Cobros de la mañana de hoy (hora de la clínica) para que la caja de la demo
 * tenga movimientos: diez cobros entre las 09:20 y las 13:20, con efectivo,
 * débito, crédito y transferencia, de los pacientes con cita hoy (o de los de
 * la demo si hoy hay pocos). El efectivo queda en la caja abierta.
 */
const COBROS_DEMO_HOY = [
  { hora: "09:20", monto: 35000, medio: "cash", nota: "Control y limpieza" },
  { hora: "09:55", monto: 120000, medio: "debit_card", nota: "Abono endodoncia" },
  { hora: "10:30", monto: 45000, medio: "credit_card", nota: "Resina / obturación" },
  { hora: "10:50", monto: 25000, medio: "cash", nota: "Evaluación" },
  { hora: "11:15", monto: 90000, medio: "transfer", nota: "Cuota brackets" },
  { hora: "11:40", monto: 60000, medio: "debit_card", nota: "Blanqueamiento · abono" },
  { hora: "12:05", monto: 32000, medio: "cash", nota: "Control ortodoncia" },
  { hora: "12:30", monto: 150000, medio: "credit_card", nota: "Corona · fase 2" },
  { hora: "12:55", monto: 18000, medio: "cash", nota: "Radiografía" },
  { hora: "13:20", monto: 48000, medio: "transfer", nota: "Sellantes" },
] as const;

async function crearCobrosDeHoyDeLaDemo(supabaseAdmin: SupabaseAdminClient) {
  const { data: clinica } = await supabaseAdmin
    .from("clinics")
    .select("id, timezone")
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  if (!clinica) return;
  const zona = clinica.timezone || "America/Santiago";
  const hoy = hoyISO(zona);
  const desde = wallTimeInTzToUtc(`${hoy}T00:00:00`, zona).toISOString();
  const hasta = wallTimeInTzToUtc(`${hoy}T23:59:59`, zona).toISOString();

  // Idempotente: si ya hay cobros sembrados hoy, no se duplican.
  const { count } = await supabaseAdmin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinica.id)
    .like("notes", "Demo · %")
    .gte("paid_at", desde)
    .lte("paid_at", hasta);
  if ((count ?? 0) > 0) return;

  const [{ data: citas }, { data: pacientes }, { data: caja }] = await Promise.all([
    supabaseAdmin
      .from("appointments")
      .select("patient_id")
      .eq("clinic_id", clinica.id)
      .neq("status", "cancelada")
      .gte("starts_at", desde)
      .lte("starts_at", hasta)
      .order("starts_at"),
    supabaseAdmin
      .from("patients")
      .select("id")
      .eq("clinic_id", clinica.id)
      .is("archived_at", null)
      .order("created_at")
      .limit(12),
    supabaseAdmin
      .from("cash_registers")
      .select("id")
      .eq("clinic_id", clinica.id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const ids = [
    ...new Set([...(citas ?? []).map((c) => c.patient_id), ...(pacientes ?? []).map((p) => p.id)]),
  ];
  if (ids.length === 0) return;

  const filas = COBROS_DEMO_HOY.map((c, i) => ({
    clinic_id: clinica.id,
    patient_id: ids[i % ids.length],
    // CLP no tiene decimales (ISO 4217): el monto va en pesos, como la semilla.
    amount_cents: c.monto,
    method: c.medio,
    paid_at: wallTimeInTzToUtc(`${hoy}T${c.hora}:00`, zona).toISOString(),
    notes: `Demo · ${c.nota}`,
    created_by: DEMO_USER_ID,
    cash_register_id: c.medio === "cash" ? (caja?.id ?? null) : null,
  }));
  const { error } = await supabaseAdmin.from("payments").insert(filas);
  if (error) throw new Error(error.message);
}

/**
 * Ola 7 · MKT-08: respuestas NPS de ejemplo en citas atendidas de la demo,
 * para que "Notificaciones a pacientes" muestre el resumen y comentarios. La
 * demo nunca recibe correos (el cron la salta); esto solo siembra filas. La
 * reseña no se muestra (sin link). Un error no tumba el reset.
 */
const ENCUESTAS_DEMO: readonly { nota: number | null; comentario: string | null }[] = [
  { nota: 10, comentario: "Muy amables y puntuales. La doctora explicó todo con calma." },
  { nota: 9, comentario: "Excelente atención, volvería sin dudarlo." },
  { nota: 10, comentario: null },
  { nota: 8, comentario: "Bien, aunque esperé unos minutos en la sala." },
  { nota: 9, comentario: null },
  { nota: 6, comentario: "Me costó encontrar estacionamiento cerca." },
  { nota: null, comentario: null },
];

async function crearEncuestasDeLaDemo(supabaseAdmin: SupabaseAdminClient) {
  try {
    const { data: clinica } = await supabaseAdmin
      .from("clinics")
      .select("id")
      .eq("is_demo", true)
      .limit(1)
      .maybeSingle();
    if (!clinica) return;
    const { count } = await supabaseAdmin
      .from("patient_nps_responses")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica.id);
    if ((count ?? 0) > 0) return;
    const { data: citas } = await supabaseAdmin
      .from("appointments")
      .select("id, patient_id, professional_id, ends_at")
      .eq("clinic_id", clinica.id)
      .eq("status", "finalizada")
      .order("ends_at", { ascending: false })
      .limit(ENCUESTAS_DEMO.length);
    if (!citas?.length) return;
    const filas = await Promise.all(
      citas.map(async (c, i) => {
        const e = ENCUESTAS_DEMO[i];
        const enviada = new Date(new Date(c.ends_at).getTime() + 3 * 3_600_000);
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return {
          clinic_id: clinica.id,
          patient_id: c.patient_id,
          appointment_id: c.id,
          professional_id: c.professional_id,
          token_hash: Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join(""),
          sent_at: enviada.toISOString(),
          expires_at: new Date(enviada.getTime() + 14 * 86_400_000).toISOString(),
          score: e.nota,
          comment: e.comentario,
          responded_at:
            e.nota === null ? null : new Date(enviada.getTime() + 3_600_000).toISOString(),
        };
      }),
    );
    const { error } = await supabaseAdmin.from("patient_nps_responses").insert(filas);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("[demo-reset] no se pudieron crear las encuestas de ejemplo", e);
  }
}
