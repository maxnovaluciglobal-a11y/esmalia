import { createFileRoute } from "@tanstack/react-router";
import type { Json } from "@/integrations/supabase/types";
import { cronAutorizado } from "@/lib/cron-auth.server";
import { esCuentaDemo } from "@/lib/demo-cuenta";

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
