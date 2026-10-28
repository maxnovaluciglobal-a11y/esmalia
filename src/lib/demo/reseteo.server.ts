import type { Json } from "@/integrations/supabase/types";
import { esCuentaDemo } from "@/lib/demo-cuenta";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { AREAS_DE_LA_DEMO } from "@/lib/demo/areas";
import {
  diaEnLaZona,
  estadoDeLaDemo,
  sumarDiasCiviles,
  ZONA_DE_LA_DEMO,
  type EstadoDeLaDemo,
} from "@/lib/demo/dia-de-la-clinica";

/**
 * Reseteo completo de la clínica demo pública.
 *
 * Antes la lógica vivía en la ruta `/api/demo-reset`, y el reseteo "bajo
 * demanda" de `ensureDemoClinicFresh` (el primer visitante del día) llamaba
 * solo a la función SQL `reset_demo_clinic()`. Esa función borra y recrea la
 * clínica pero NO trae los pasos de siembra de la app (cobros de hoy, cuentas
 * por cobrar, documento, encuestas, caja por operador, etc.). Resultado: el
 * primer visitante después de la medianoche de Santiago (antes de que corriera
 * el cron de las 02:05) veía la Caja con "Cobrado hoy: $0" y media app vacía.
 *
 * Ahora las dos puertas (el cron y el primer visitante) pasan por
 * `reiniciarLaDemo`, que hace el reseteo SQL y TODOS los pasos, y por
 * `estadoActualDeLaDemo`, que además de la fecha mira que cada área tenga datos.
 *
 * Corre con el rol de servicio (pasa `block_demo_writes`). Los pasos son
 * idempotentes: un segundo reseteo no duplica ni se traba.
 */
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
    .select("id, timezone")
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  if (!clinica) return;
  const hoy = diaEnLaZona(clinica.timezone || ZONA_DE_LA_DEMO);
  for (const p of PRESUPUESTOS_DEMO_SIN_RESPUESTA) {
    const fecha = new Date(Date.now() - p.dias * 24 * 60 * 60 * 1000).toISOString();
    // Validez de 30 días desde la creación (PLA-06), como un presupuesto nuevo:
    // sin ella el PDF dice "sin fecha de vencimiento". El día es el de la
    // clínica, no el de UTC (regla 7).
    const validoHasta = sumarDiasCiviles(hoy, 30 - p.dias);
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
    .select("id, timezone")
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
        // Los planes de atenciones ya realizadas y cobradas (historial, mes en curso y cobros de
        // hoy) no son cuentas por cobrar: se saldan con sus pagos.
        .not("name", "in", '("Atenciones anteriores","Tratamientos del mes","Atenciones de hoy")')
        // PLA-07: la cuenta nace al aceptar un presupuesto, o sea, solo para planes con presupuesto.
        .not("quote_id", "is", null)
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

  // Fechas relativas al "hoy" de la clínica (regla 7), no al día de UTC.
  const hoyClinica = diaEnLaZona(clinica.timezone || ZONA_DE_LA_DEMO);
  const dia = (offset: number) => sumarDiasCiviles(hoyClinica, offset);
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

  // Los primeros cobros pagan prestaciones pendientes de los planes de la demo: se marcan como
  // realizadas hoy, con su profesional. Así la Caja muestra quién atendió ("Realizado" por
  // profesional) y los cobros no quedan "sin asignar".
  const [{ data: pendientes }, { data: equipo }] = await Promise.all([
    supabaseAdmin
      .from("treatment_items")
      .select("id, plan_id, professional_id, procedure_id")
      .eq("clinic_id", clinica.id)
      .in("status", ["pending", "in_progress"])
      .order("created_at")
      .limit(COBROS_DEMO_HOY.length),
    supabaseAdmin.from("professionals").select("id").eq("clinic_id", clinica.id).order("full_name"),
  ]);
  const planesDeItems = [...new Set((pendientes ?? []).map((it) => it.plan_id))];
  const { data: planes } = planesDeItems.length
    ? await supabaseAdmin
        .from("treatment_plans")
        .select("id, patient_id")
        .eq("clinic_id", clinica.id)
        .neq("status", "cancelled")
        .in("id", planesDeItems)
    : { data: [] };
  const pacienteDelPlan = new Map((planes ?? []).map((pl) => [pl.id, pl.patient_id]));
  const items = (pendientes ?? []).filter((it) => pacienteDelPlan.has(it.plan_id));
  const profesionales = (equipo ?? []).map((pr) => pr.id);

  // Los cobros sin prestación pendiente que pagar crean la suya, realizada hoy en un plan
  // "Atenciones de hoy" del paciente: cada cobro queda atribuido a quien atendió.
  const pacienteDeCobro = (i: number) =>
    items[i] ? pacienteDelPlan.get(items[i].plan_id)! : ids[i % ids.length];
  const horaDe = (hhmm: string) => wallTimeInTzToUtc(`${hoy}T${hhmm}:00`, zona).toISOString();
  const sinItem = COBROS_DEMO_HOY.map((c, i) => ({ c, i })).filter(({ i }) => !items[i]);
  const itemDeCobro = new Map<number, { itemId: string; planId: string }>();
  if (sinItem.length > 0) {
    const pacientesNuevos = [...new Set(sinItem.map(({ i }) => pacienteDeCobro(i)))];
    const { data: planesNuevos, error: errPlanes } = await supabaseAdmin
      .from("treatment_plans")
      .insert(
        pacientesNuevos.map((pid) => ({
          clinic_id: clinica.id,
          patient_id: pid,
          name: "Atenciones de hoy",
          status: "completed" as const,
          total_cents: sinItem
            .filter(({ i }) => pacienteDeCobro(i) === pid)
            .reduce((suma, { c }) => suma + c.monto, 0),
          created_by: DEMO_USER_ID,
          started_at: horaDe("08:00"),
          completed_at: horaDe(COBROS_DEMO_HOY[COBROS_DEMO_HOY.length - 1].hora),
        })),
      )
      .select("id, patient_id");
    if (errPlanes) throw new Error(errPlanes.message);
    const planDe = new Map((planesNuevos ?? []).map((pl) => [pl.patient_id, pl.id]));
    const posicion = new Map<string, number>();
    const claves = new Map<number, string>();
    const filasItems = sinItem.map(({ c, i }) => {
      const planId = planDe.get(pacienteDeCobro(i))!;
      const pos = (posicion.get(planId) ?? 0) + 1;
      posicion.set(planId, pos);
      claves.set(i, `${planId}:${pos}`);
      return {
        clinic_id: clinica.id,
        plan_id: planId,
        name_snapshot: c.nota,
        price_cents: c.monto,
        status: "completed" as const,
        completed_at: horaDe(c.hora),
        completed_by: DEMO_USER_ID,
        professional_id: profesionales[i % profesionales.length] ?? null,
        position: pos,
      };
    });
    const { data: creados, error: errCreados } = await supabaseAdmin
      .from("treatment_items")
      .insert(filasItems)
      .select("id, plan_id, position");
    if (errCreados) throw new Error(errCreados.message);
    const idPorClave = new Map(
      (creados ?? []).map((it) => [`${it.plan_id}:${it.position}`, it.id]),
    );
    for (const [i, clave] of claves) {
      const itemId = idPorClave.get(clave);
      if (itemId) itemDeCobro.set(i, { itemId, planId: clave.split(":")[0] });
    }
  }

  const filas = COBROS_DEMO_HOY.map((c, i) => {
    const pendiente = items[i];
    const nuevo = itemDeCobro.get(i);
    return {
      clinic_id: clinica.id,
      patient_id: pacienteDeCobro(i),
      // CLP no tiene decimales (ISO 4217): el monto va en pesos, como la semilla.
      amount_cents: c.monto,
      method: c.medio,
      paid_at: horaDe(c.hora),
      notes: `Demo · ${c.nota}`,
      created_by: DEMO_USER_ID,
      cash_register_id: c.medio === "cash" ? (caja?.id ?? null) : null,
      treatment_item_id: pendiente?.id ?? nuevo?.itemId ?? null,
      treatment_plan_id: pendiente?.plan_id ?? nuevo?.planId ?? null,
    };
  });
  for (const [i, item] of items.entries()) {
    const { error: errItem } = await supabaseAdmin
      .from("treatment_items")
      .update({
        status: "completed",
        completed_at: filas[i].paid_at,
        completed_by: DEMO_USER_ID,
        professional_id: item.professional_id ?? profesionales[i % profesionales.length] ?? null,
      })
      .eq("id", item.id)
      .eq("clinic_id", clinica.id);
    if (errItem) throw new Error(errItem.message);
  }
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

// ─── Orquestación ────────────────────────────────────────────────────────

type Paso = { nombre: string; correr: () => Promise<void> };

/**
 * Todos los pasos de siembra de la app, en el orden en que dependen unos de
 * otros (los cobros de hoy antes de la caja por operador, etc.). Cada uno es
 * idempotente.
 */
async function pasosDeSiembra(admin: SupabaseAdminClient): Promise<Paso[]> {
  const [
    reserva,
    ola9,
    seguimiento,
    ola8,
    finanzas,
    cajaComisiones,
    informes,
    panel,
    examenes,
    dispositivos,
    grupales,
    cierre,
    cobertura,
  ] = await Promise.all([
    import("@/lib/reserva/demo.server"),
    import("@/lib/demo/ola9.server"),
    import("@/lib/demo/seguimiento.server"),
    import("@/lib/demo/ola8-pacientes.server"),
    import("@/lib/demo/finanzas.server"),
    import("@/lib/demo/caja-comisiones.server"),
    import("@/lib/demo/informes.server"),
    import("@/lib/demo/panel.server"),
    import("@/lib/demo/examenes.server"),
    import("@/lib/dispositivos/demo.server"),
    import("@/lib/demo/grupales-esterilizacion.server"),
    import("@/lib/demo/cierre-pacientes-grupales.server"),
    import("@/lib/demo/cobertura.server"),
  ]);
  return [
    // La semilla crea los presupuestos "hoy": se fechan hacia atrás para que
    // la demo tenga presupuestos sin respuesta y uno vencido.
    { nombre: "presupuestos", correr: () => fecharPresupuestosDeLaDemo(admin) },
    // PLA-07 crea la cuenta por cobrar cuando un presupuesto PASA a aceptado;
    // la semilla los inserta ya aceptados, así que se crean acá.
    { nombre: "cuentas por cobrar", correr: () => crearCuentasDeLaDemo(admin) },
    // Caja A+: cobros de la mañana de hoy, en el huso de la clínica, con
    // medios variados y el efectivo en la caja abierta.
    { nombre: "cobros de hoy", correr: () => crearCobrosDeHoyDeLaDemo(admin) },
    // Ola 4: documento emitido de ejemplo en la ficha de Valentina.
    { nombre: "documento", correr: () => crearDocumentoDeLaDemo(admin) },
    { nombre: "reserva en línea", correr: () => reserva.prepararReservaDeLaDemo(admin) },
    { nombre: "encuestas", correr: () => crearEncuestasDeLaDemo(admin) },
    // Ola 9: periodontograma, laboratorio, ortodoncia y ficha clínica.
    { nombre: "periodontograma", correr: () => ola9.sembrarPeriodontogramaDeLaDemo(admin) },
    { nombre: "laboratorio", correr: () => ola9.sembrarLaboratorioDeLaDemo(admin) },
    { nombre: "ortodoncia", correr: () => ola9.sembrarOrtodonciaDeLaDemo(admin) },
    { nombre: "ficha clínica", correr: () => ola9.sembrarFichaClinicaDeLaDemo(admin) },
    // Ola 8: seguimiento y etiquetas/segmentos.
    { nombre: "seguimiento", correr: () => seguimiento.sembrarSeguimientoDeLaDemo(admin) },
    {
      nombre: "etiquetas y segmentos",
      correr: () => ola8.sembrarEtiquetasYSegmentosDeLaDemo(admin),
    },
    // Ola 10: finanzas, y caja por operador (después de los cobros de hoy).
    { nombre: "finanzas", correr: () => finanzas.sembrarFinanzasDeLaDemo(admin) },
    // Historial de meses anteriores, equipo y configuración: antes de las liquidaciones.
    ...cobertura.pasosDeHistorialDeLaDemo(admin),
    {
      nombre: "caja y comisiones",
      correr: () => cajaComisiones.sembrarCajaYComisionesDeLaDemo(admin),
    },
    // Ola 11: informes y panel por rol.
    { nombre: "informes", correr: () => informes.sembrarInformesDeLaDemo(admin) },
    { nombre: "panel", correr: () => panel.sembrarPanelDeLaDemo(admin) },
    // Ola 13 y 14: exámenes, dispositivos, citas grupales y esterilización.
    { nombre: "exámenes", correr: () => examenes.sembrarExamenesDeLaDemo(admin) },
    { nombre: "dispositivos", correr: () => dispositivos.sembrarDispositivosDeLaDemo(admin) },
    {
      nombre: "grupales y esterilización",
      correr: () => grupales.sembrarGrupalesYEsterilizacionDeLaDemo(admin),
    },
    {
      nombre: "cierre pacientes y grupales",
      correr: () => cierre.sembrarCierrePacientesGrupalesDeLaDemo(admin),
    },
    // Cierre de la demo completa: cada sección con al menos un valor de ejemplo.
    ...cobertura.pasosDeCoberturaDeLaDemo(admin),
  ];
}

export type FalloDeSiembra = { paso: string; mensaje: string };

/** Corre todos los pasos de siembra; un error en uno no frena a los demás. */
export async function sembrarTodoLoDeLaDemo(admin: SupabaseAdminClient): Promise<FalloDeSiembra[]> {
  const fallos: FalloDeSiembra[] = [];
  for (const paso of await pasosDeSiembra(admin)) {
    try {
      await paso.correr();
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      console.error(`[demo-reset] falló el paso «${paso.nombre}»`, mensaje);
      fallos.push({ paso: paso.nombre, mensaje });
    }
  }
  return fallos;
}

/** Cuántas filas de una clínica cumplen la condición de un área de la demo. */
async function contarArea(
  admin: SupabaseAdminClient,
  clinicId: string,
  zona: string,
  area: (typeof AREAS_DE_LA_DEMO)[number],
): Promise<number> {
  const hoy = hoyISO(zona);
  let consulta = admin
    .from(area.tabla as "patients")
    .select("*", { count: "exact", head: true })
    .eq("clinic_id", clinicId);
  for (const f of area.filtros ?? []) {
    const col = f.columna as "id";
    if (f.op === "eq") consulta = consulta.eq(col, f.valor as string);
    else if (f.op === "like") consulta = consulta.like(col, f.valor as string);
    else if (f.op === "noNulo") consulta = consulta.not(col, "is", null);
    else if (f.op === "hoy") {
      consulta = consulta
        .gte(col, wallTimeInTzToUtc(`${hoy}T00:00:00`, zona).toISOString())
        .lt(col, wallTimeInTzToUtc(`${sumarDiasCiviles(hoy, 1)}T00:00:00`, zona).toISOString());
    }
  }
  const { count, error } = await consulta;
  if (error) throw new Error(`${area.tabla}: ${error.message}`);
  return count ?? 0;
}

/** Claves de las áreas de la demo que hoy no llegan a su mínimo de filas. */
export async function areasVaciasDeLaDemo(
  admin: SupabaseAdminClient,
  clinicId: string,
  zona: string = ZONA_DE_LA_DEMO,
): Promise<string[]> {
  const cuentas = await Promise.all(
    AREAS_DE_LA_DEMO.map(async (a) => ({
      clave: a.clave,
      n: await contarArea(admin, clinicId, zona, a),
      minimo: a.minimo,
    })),
  );
  return cuentas.filter((c) => c.n < c.minimo).map((c) => c.clave);
}

export type EstadoActual = {
  estado: EstadoDeLaDemo;
  areasVacias: string[];
  reseteadaEn: string | null;
  hoy: string;
};

/** La demo respecto de HOY en el huso de la clínica: ¿al día, a medias o de otro día? */
export async function estadoActualDeLaDemo(admin: SupabaseAdminClient): Promise<EstadoActual> {
  const { data: clinica } = await admin
    .from("clinics")
    .select("id, created_at, timezone")
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  const zona = clinica?.timezone || ZONA_DE_LA_DEMO;
  const hoy = diaEnLaZona(zona);
  if (!clinica) return { estado: "reiniciar", areasVacias: [], reseteadaEn: null, hoy };
  const areasVacias = await areasVaciasDeLaDemo(admin, clinica.id, zona);
  return {
    estado: estadoDeLaDemo({ reseteadaEn: clinica.created_at, areasVacias, zona }),
    areasVacias,
    reseteadaEn: clinica.created_at,
    hoy,
  };
}

export type ResultadoDelReseteo = {
  accion: "nada" | "completar" | "reiniciar";
  fallos: FalloDeSiembra[];
  areasVaciasAntes: string[];
};

let enCurso: Promise<ResultadoDelReseteo> | null = null;

/**
 * Deja la demo al día. Sin `soloSiHaceFalta` hace siempre el reseteo entero
 * (SQL + todos los pasos), como el cron diario. Con `soloSiHaceFalta` mira
 * primero el estado: al día no toca nada, de otro día la rehace entera, y de
 * hoy pero con áreas vacías solo vuelve a correr los pasos de siembra.
 *
 * Dentro de una misma instancia, varias llamadas simultáneas (varios
 * visitantes a la medianoche) comparten el mismo trabajo.
 */
export function reiniciarLaDemo(
  admin: SupabaseAdminClient,
  opciones: { soloSiHaceFalta?: boolean } = {},
): Promise<ResultadoDelReseteo> {
  if (enCurso) return enCurso;
  enCurso = ejecutarReseteo(admin, opciones).finally(() => {
    enCurso = null;
  });
  return enCurso;
}

async function ejecutarReseteo(
  admin: SupabaseAdminClient,
  opciones: { soloSiHaceFalta?: boolean },
): Promise<ResultadoDelReseteo> {
  const antes = opciones.soloSiHaceFalta ? await estadoActualDeLaDemo(admin) : null;
  const accion: ResultadoDelReseteo["accion"] = !antes
    ? "reiniciar"
    : antes.estado === "al-dia"
      ? "nada"
      : antes.estado;
  if (accion === "nada") return { accion, fallos: [], areasVaciasAntes: [] };

  if (accion === "reiniciar") {
    const { error } = await admin.rpc("reset_demo_clinic");
    if (error) throw new Error(`reset error: ${error.message}`);
    // SEG-01: la demo es compartida; un factor MFA inscrito desde la consola le
    // pediría un código ajeno a todos los visitantes. La guarda real es el
    // trigger de la migración 20261019120000; esto limpia por si quedó alguno.
    try {
      await borrarFactoresMfaDeLaDemo(admin);
    } catch (e) {
      console.error("[demo-reset] no se pudieron limpiar los factores MFA", e);
    }
  }
  const fallos = await sembrarTodoLoDeLaDemo(admin);
  return { accion, fallos, areasVaciasAntes: antes?.areasVacias ?? [] };
}
