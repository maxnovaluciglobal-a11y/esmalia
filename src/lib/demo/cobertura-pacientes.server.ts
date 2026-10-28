import { PACIENTES_SIN_VISITA } from "@/lib/demo/cobertura-historial.server";
import {
  contarFilas,
  diaRelativo,
  instanteDeLaClinica,
  paso,
  sha256Hex,
  USUARIO_DEMO_ID,
  type Admin,
  type ContextoDemo,
  type PasoDeSiembra,
} from "@/lib/demo/contexto.server";

/**
 * Demo completa · lo que cuelga de la ficha del paciente y de la relación con él: tutor de
 * un paciente menor de edad, signos vitales, controles de ortodoncia, consentimientos
 * firmados, formularios previos, solicitudes de firma a distancia, recetas, avisos por correo
 * y sus ajustes, campaña ya enviada, y los turnos de la sala de espera. Todo ficticio (RUT y
 * correos inventados, de ejemplo).
 *
 * Idempotente: cada paso mira si su tabla ya tiene filas de la clínica.
 */

function hexAleatorio(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// PNG de 1 × 1 píxeles: la firma electrónica por nombre tipeado sube este marcador, igual que
// la app (el nombre firmado es la evidencia, no un trazo).
const FIRMA_MARCADOR = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

// ─── Tutor de un paciente menor de edad ──────────────────────────────────

/** Antonia (la paciente 9 de la semilla) pasa a ser menor de edad, con su madre como tutora. */
async function sembrarTutor(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "patient_guardians", ctx.clinicId)) > 0) return;
  const menor = ctx.pacientes.find((p) => p.nombre.startsWith("Antonia")) ?? ctx.pacientes[8];
  if (!menor) return;
  const { error: errNacimiento } = await ctx.admin
    .from("patients")
    .update({ birth_date: "2014-03-12" })
    .eq("id", menor.id)
    .eq("clinic_id", ctx.clinicId);
  if (errNacimiento) throw new Error(`fecha de nacimiento: ${errNacimiento.message}`);
  const { error } = await ctx.admin.from("patient_guardians").insert({
    clinic_id: ctx.clinicId,
    patient_id: menor.id,
    full_name: "Carolina Núñez Rojas",
    document_id: "14.222.333-4",
    relationship: "madre",
    phone: "+56 9 6123 4599",
    email: "carolina.nunez@demo.esmalia.com",
    is_primary: true,
    created_by: USUARIO_DEMO_ID,
  });
  if (error) throw new Error(`tutor: ${error.message}`);
}

// ─── Signos vitales ──────────────────────────────────────────────────────

async function sembrarSignosVitales(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "patient_vital_signs", ctx.clinicId)) > 0) return;
  const medidas = [
    [118, 76, 72, 36.5],
    [124, 80, 78, 36.6],
    [132, 84, 84, 36.7],
    [112, 70, 68, 36.4],
  ] as const;
  const filas = ctx.pacientes.slice(0, 4).flatMap((p, i) =>
    [-30, -2].map((d, k) => {
      const [sis, dia, fc, t] = medidas[(i + k) % medidas.length];
      return {
        clinic_id: ctx.clinicId,
        patient_id: p.id,
        systolic_mmhg: sis,
        diastolic_mmhg: dia,
        heart_rate_bpm: fc,
        temperature_c: t,
        measured_at: instanteDeLaClinica(ctx, diaRelativo(ctx, d - i), "10:05"),
        recorded_by: USUARIO_DEMO_ID,
        notes: k === 0 ? "Control previo al tratamiento." : null,
      };
    }),
  );
  const { error } = await ctx.admin.from("patient_vital_signs").insert(filas);
  if (error) throw new Error(`signos vitales: ${error.message}`);
}

// ─── Controles de ortodoncia ─────────────────────────────────────────────

async function sembrarControlesDeOrtodoncia(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "ortho_controls", ctx.clinicId)) > 0) return;
  const { data: casos } = await ctx.admin
    .from("ortho_cases")
    .select("id")
    .eq("clinic_id", ctx.clinicId);
  const filas = (casos ?? []).flatMap((c, i) =>
    [-84, -56, -28].map((d, k) => ({
      clinic_id: ctx.clinicId,
      ortho_case_id: c.id,
      control_date: diaRelativo(ctx, d - i * 3),
      attended: !(i === 1 && k === 1),
      notes: ["Cambio de arco y ajuste.", "Control de higiene y elásticos.", "Ajuste mensual."][k],
      created_by: USUARIO_DEMO_ID,
    })),
  );
  if (filas.length === 0) return;
  const { error } = await ctx.admin.from("ortho_controls").insert(filas);
  if (error) throw new Error(`controles de ortodoncia: ${error.message}`);
}

// ─── Consentimientos firmados ────────────────────────────────────────────

async function sembrarConsentimientos(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "patient_consents", ctx.clinicId)) > 0) return;
  const [{ data: plantillas }, { data: tutores }] = await Promise.all([
    ctx.admin
      .from("consent_templates")
      .select("id, title, body, procedure, risks, alternatives")
      .eq("clinic_id", ctx.clinicId)
      .order("title"),
    ctx.admin.from("patient_guardians").select("id, patient_id").eq("clinic_id", ctx.clinicId),
  ]);
  const prof = ctx.profesionales[0];
  const casos: { paciente: (typeof ctx.pacientes)[number]; titulo: string; tutorId?: string }[] =
    [];
  const exodoncia = plantillas?.find((t) => t.title.includes("exodoncia"));
  const anestesia = plantillas?.find((t) => t.title.includes("anestesia"));
  if (exodoncia) casos.push({ paciente: ctx.pacientes[3], titulo: exodoncia.title });
  if (anestesia) {
    const menor = tutores?.[0];
    const paciente = menor ? ctx.pacientes.find((p) => p.id === menor.patient_id) : undefined;
    if (paciente && menor) casos.push({ paciente, titulo: anestesia.title, tutorId: menor.id });
  }
  for (const [i, c] of casos.entries()) {
    const plantilla = plantillas?.find((t) => t.title === c.titulo);
    if (!plantilla) continue;
    const ruta = `${ctx.clinicId}/${c.paciente.id}/consent-signatures/demo-ejemplo-${i + 1}.png`;
    const { error: errSubida } = await ctx.admin.storage
      .from("clinical-documents")
      .upload(ruta, FIRMA_MARCADOR, { contentType: "image/png", upsert: true });
    if (errSubida) throw new Error(`firma de ejemplo: ${errSubida.message}`);
    const nombreFirma = c.tutorId ? "Carolina Núñez Rojas" : c.paciente.nombre;
    const { error } = await ctx.admin.from("patient_consents").insert({
      clinic_id: ctx.clinicId,
      patient_id: c.paciente.id,
      template_id: plantilla.id,
      title_snapshot: plantilla.title,
      procedure_snapshot: plantilla.procedure ?? plantilla.title,
      body_snapshot: plantilla.body,
      risks_snapshot: plantilla.risks,
      alternatives_snapshot: plantilla.alternatives,
      informed_by_professional_id: prof?.id ?? null,
      signature_storage_path: ruta,
      signature_sha256: await sha256Hex(`demo-firma-${i + 1}`),
      signed_by_name: nombreFirma,
      signed_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -(9 + i * 5)), "11:30"),
      recorded_by: USUARIO_DEMO_ID,
      ...(c.tutorId ? { guardian_id: c.tutorId } : {}),
    });
    if (error) throw new Error(`consentimiento: ${error.message}`);
  }
}

// ─── Formularios previos del paciente ────────────────────────────────────

async function sembrarFormulariosPrevios(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "patient_intake_forms", ctx.clinicId)) > 0) return;
  const { data: citas } = await ctx.admin
    .from("appointments")
    .select("id, patient_id")
    .eq("clinic_id", ctx.clinicId)
    .gte("starts_at", instanteDeLaClinica(ctx, ctx.hoy, "00:00"))
    .neq("status", "cancelada")
    .order("starts_at")
    .limit(3);
  const lista = citas ?? [];
  if (lista.length === 0) return;
  const base = (i: number) => ({
    clinic_id: ctx.clinicId,
    patient_id: lista[i % lista.length].patient_id,
    appointment_id: lista[i % lista.length].id,
    token_hash: hexAleatorio(),
    sent_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -2), "09:00"),
    expires_at: instanteDeLaClinica(ctx, diaRelativo(ctx, 5), "23:59"),
  });
  const { error } = await ctx.admin.from("patient_intake_forms").insert([
    { ...base(0), status: "enviado" },
    {
      ...base(1),
      status: "respondido",
      opened_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -1), "20:10"),
      submitted_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -1), "20:14"),
      submitted_allergies: ["Penicilina"],
      submitted_medications: ["Losartán 50 mg"],
      submitted_comment: "Me duele al masticar del lado izquierdo desde hace una semana.",
      submitted_contact: { phone: "+56 9 6123 4510", email: "paciente@demo.esmalia.com" },
    },
    {
      ...base(2),
      status: "aceptado",
      opened_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -2), "18:30"),
      submitted_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -2), "18:33"),
      submitted_allergies: [],
      submitted_medications: [],
      reviewed_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -1), "09:15"),
      reviewed_by: USUARIO_DEMO_ID,
    },
  ]);
  if (error) throw new Error(`formularios previos: ${error.message}`);
}

// ─── Recetas ─────────────────────────────────────────────────────────────

/**
 * Dos recetas emitidas de ejemplo con el motor de documentos, por la profesional de la demo
 * vinculada al usuario dueño. Arma lo mismo que `emitirReceta` (plantilla, ficha, vademécum,
 * avisos de alergia, render), pero escribe las dos filas a mano y no con el RPC
 * `emitir_receta`, que atribuye la receta a `auth.uid()`: el reseteo corre con el rol de
 * servicio y `prescriptions_emitir` lo acepta solo en la clínica demo (migración
 * 20261118100000), igual que `issued_documents_emitir`.
 */
async function sembrarRecetas(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "prescriptions", ctx.clinicId)) > 0) return;
  const [receta, motor, { construirContexto }, { cargarDatosParaDocumento }, { cargarVersion }] =
    await Promise.all([
      import("@/lib/clinical/emitir-receta.server"),
      import("@/lib/documentos/motor"),
      import("@/lib/documentos/variables"),
      import("@/lib/documentos/contexto.server"),
      import("@/lib/documentos/emitir.server"),
    ]);
  const { data: meds } = await ctx.admin
    .from("clinic_medications")
    .select("id, active_ingredient, concentration, form, dose, frequency, duration, instructions")
    .eq("clinic_id", ctx.clinicId)
    .order("active_ingredient");
  if (!meds || meds.length === 0) return;
  const [plantilla] = await receta.plantillasDeReceta(ctx.admin, ctx.clinicId);
  if (!plantilla) return;
  const version = await cargarVersion(ctx.admin, {
    clinicId: ctx.clinicId,
    templateId: plantilla.id,
  });
  const medicamento = (nombre: string) =>
    meds.find((m) => m.active_ingredient === nombre) ?? meds[0];
  const entrada = (m: (typeof meds)[number]) => ({
    medication: m.active_ingredient,
    presentation: [m.concentration, m.form].filter(Boolean).join(" "),
    dose: m.dose ?? "1 unidad",
    frequency: m.frequency ?? "Cada 8 horas",
    duration: m.duration ?? "3 días",
    instructions: m.instructions ?? "",
    route: "oral" as const,
    catalog: `clinica:${m.id}`,
  });
  const casos = [
    {
      paciente: ctx.pacientes[0],
      meds: [medicamento("Ibuprofeno")],
      nota: "Control en una semana.",
    },
    {
      paciente: ctx.pacientes[1],
      meds: [medicamento("Amoxicilina"), medicamento("Paracetamol")],
      nota: "Completar el tratamiento antibiótico.",
    },
  ];
  for (const c of casos) {
    const { datos, profesional } = await cargarDatosParaDocumento(ctx.admin, {
      clinicId: ctx.clinicId,
      patientId: c.paciente.id,
      userId: USUARIO_DEMO_ID,
    });
    if (!profesional || !datos.profesional) return;
    const items = await receta.armarMedicamentos(ctx.admin, ctx.clinicId, c.meds.map(entrada));
    const alergias = await receta.alergiasDeLaFicha(ctx.admin, ctx.clinicId, c.paciente.id);
    const avisos = receta.avisosDeLaReceta(items, alergias);
    const render = motor.renderPlantilla(
      version.body,
      construirContexto({
        ...datos,
        campos: {},
        receta: { items, indicacionesGenerales: c.nota, alergias },
      }),
      { firma: motor.bloqueDeFirma(datos.profesional) },
    );
    const { data: doc, error } = await ctx.admin
      .from("issued_documents")
      .insert({
        clinic_id: ctx.clinicId,
        patient_id: c.paciente.id,
        template_version_id: version.id,
        professional_id: profesional.id,
        fields: {},
        content_blocks: render.bloques as never,
        content_html: motor.bloquesAHtml(render.bloques),
        issued_by: USUARIO_DEMO_ID,
      })
      .select("id")
      .single();
    if (error) throw new Error(`documento de la receta: ${error.message}`);
    const { error: errReceta } = await ctx.admin.from("prescriptions").insert({
      clinic_id: ctx.clinicId,
      patient_id: c.paciente.id,
      professional_id: profesional.id,
      items: items as never,
      instructions: c.nota,
      issued_document_id: doc.id,
      allergy_alerts: (avisos.length ? avisos : null) as never,
      issued_by: USUARIO_DEMO_ID,
    });
    if (errReceta) throw new Error(`receta: ${errReceta.message}`);
  }
}

// ─── Avisos por correo al paciente ───────────────────────────────────────

async function sembrarAjustesDeAvisos(ctx: ContextoDemo) {
  const { error } = await ctx.admin.from("patient_notification_settings").upsert(
    {
      clinic_id: ctx.clinicId,
      confirmation_enabled: true,
      confirmation_enabled_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -20), "10:00"),
      reminder_enabled: true,
      reminder_hours: [24, 2],
      nps_enabled: true,
      nps_enabled_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -20), "10:00"),
      nps_hours_after: 3,
      intake_form_mode: "confirmation",
      updated_by: USUARIO_DEMO_ID,
    },
    { onConflict: "clinic_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`ajustes de avisos: ${error.message}`);
}

async function sembrarAvisosEnviados(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "patient_email_dispatches", ctx.clinicId)) > 0) return;
  const { data: citas } = await ctx.admin
    .from("appointments")
    .select("id, patient_id, status")
    .eq("clinic_id", ctx.clinicId)
    .gte("starts_at", instanteDeLaClinica(ctx, diaRelativo(ctx, -3), "00:00"))
    .lte("starts_at", instanteDeLaClinica(ctx, diaRelativo(ctx, 3), "23:59"))
    .order("starts_at")
    .limit(10);
  const lista = citas ?? [];
  if (lista.length === 0) return;
  const filas = lista.map((c, i) => ({
    clinic_id: ctx.clinicId,
    appointment_id: c.id,
    patient_id: c.patient_id,
    kind: (["confirmation", "reminder", "nps"] as const)[i % 3],
    slot: i % 3 === 1 ? "24h" : "once",
    status: (["sent", "sent", "sent", "skipped", "pending"] as const)[i % 5],
    recipient: "paciente@demo.esmalia.com",
    recipient_role: "paciente",
    attempts: 1,
    reason: i % 5 === 3 ? "El paciente no tiene correo registrado." : null,
  }));
  const { error } = await ctx.admin.from("patient_email_dispatches").insert(filas);
  if (error) throw new Error(`avisos enviados: ${error.message}`);
}

// ─── Campaña cancelada ───────────────────────────────────────────────────

/**
 * Una campaña nace como borrador y solo una persona con sesión la confirma, así que la demo
 * no puede mostrar una enviada. Sí muestra una cancelada, además del borrador de la semilla.
 */
async function sembrarCampanaCancelada(ctx: ContextoDemo) {
  const { count } = await ctx.admin
    .from("outreach_campaigns")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .eq("status", "cancelada");
  if ((count ?? 0) > 0) return;
  const { data: campana, error } = await ctx.admin
    .from("outreach_campaigns")
    .insert({
      clinic_id: ctx.clinicId,
      name: "Promoción de blanqueamiento de primavera",
      channel: "correo",
      subject: "Blanqueamiento con 15 % de descuento",
      body: "Hola, este mes tenemos un descuento en blanqueamiento dental. Responde este correo para agendar.",
      status: "borrador",
      segment: { tipo: "todos" },
      segment_label: "Todos los pacientes con correo",
      created_by: USUARIO_DEMO_ID,
    })
    .select("id")
    .single();
  if (error) throw new Error(`campaña: ${error.message}`);
  const { error: errCancela } = await ctx.admin
    .from("outreach_campaigns")
    .update({ status: "cancelada" })
    .eq("id", campana.id)
    .eq("clinic_id", ctx.clinicId);
  if (errCancela) throw new Error(`campaña (cancelar): ${errCancela.message}`);
}

// ─── Sala de espera ──────────────────────────────────────────────────────

async function sembrarSalaDeEspera(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "waiting_room_turns", ctx.clinicId)) > 0) return;
  const { data: citas } = await ctx.admin
    .from("appointments")
    .select("id, branch_id, patient_id")
    .eq("clinic_id", ctx.clinicId)
    .gte("starts_at", instanteDeLaClinica(ctx, ctx.hoy, "00:00"))
    .lt("starts_at", instanteDeLaClinica(ctx, diaRelativo(ctx, 1), "00:00"))
    .in("status", ["confirmada", "en-sala"])
    .order("starts_at")
    .limit(3);
  const lista = citas ?? [];
  if (lista.length === 0) return;
  const { data: totem } = await ctx.admin
    .from("clinic_devices")
    .select("id")
    .eq("clinic_id", ctx.clinicId)
    .eq("kind", "totem")
    .limit(1)
    .maybeSingle();
  for (const [i, c] of lista.entries()) {
    const llegada = instanteDeLaClinica(
      ctx,
      ctx.hoy,
      `${String(8 + i).padStart(2, "0")}:${i === 0 ? "50" : "30"}`,
    );
    const { error } = await ctx.admin.from("waiting_room_turns").insert({
      clinic_id: ctx.clinicId,
      branch_id: c.branch_id,
      appointment_id: c.id,
      turn_date: ctx.hoy,
      turn_number: i + 1,
      checked_in_at: llegada,
      checked_in_via: i === 1 ? "recepcion" : "totem",
      call_count: i === 0 ? 1 : 0,
      called_at: i === 0 ? instanteDeLaClinica(ctx, ctx.hoy, "09:02") : null,
    });
    if (error) throw new Error(`sala de espera: ${error.message}`);
    await ctx.admin
      .from("appointments")
      .update({ status: "en-sala", arrived_at: llegada })
      .eq("id", c.id)
      .eq("clinic_id", ctx.clinicId);
    if (totem) {
      await ctx.admin.from("totem_identifications").insert({
        clinic_id: ctx.clinicId,
        device_id: totem.id,
        patient_id: c.patient_id,
        ok: true,
        rut_hash: hexAleatorio(),
        session_hash: hexAleatorio(),
        ended_at: llegada,
      });
    }
  }
}

// ─── Notificaciones de la persona de la demo ─────────────────────────────

async function sembrarNotificaciones(ctx: ContextoDemo) {
  const { count } = await ctx.admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .eq("recipient_id", USUARIO_DEMO_ID)
    .neq("kind", "stock_low");
  if ((count ?? 0) > 0) return;
  const nombre = (i: number) => ctx.pacientes[i % ctx.pacientes.length]?.nombre ?? "Un paciente";
  const filas = [
    {
      kind: "inbound_message",
      title: `${nombre(0)} escribió por WhatsApp`,
      body: "Consulta si puede cambiar su hora de la próxima semana.",
      link: "/conversaciones",
      hace: 25,
      leida: false,
    },
    {
      kind: "appointment_request",
      title: "Nueva solicitud de hora desde el portal",
      body: `${nombre(3)} pidió una hora para un control.`,
      link: "/agenda",
      hace: 90,
      leida: false,
    },
    {
      kind: "patient_confirmed_appointment",
      title: `${nombre(1)} confirmó su cita de mañana`,
      body: null,
      link: "/agenda",
      hace: 240,
      leida: true,
    },
    {
      kind: "review_approved",
      title: "Tu nota clínica fue revisada y aprobada",
      body: "La revisión de la nota de control quedó aprobada sin cambios.",
      link: "/dashboard",
      hace: 1_500,
      leida: true,
    },
    {
      kind: "daily_digest",
      title: "Resumen del día",
      body: "Tienes citas por confirmar y un control vencido.",
      link: "/dashboard",
      hace: 1_900,
      leida: true,
    },
  ];
  const { error } = await ctx.admin.from("notifications").insert(
    filas.map((f) => ({
      clinic_id: ctx.clinicId,
      recipient_id: USUARIO_DEMO_ID,
      actor_id: null,
      kind: f.kind,
      title: f.title,
      body: f.body,
      link: f.link,
      created_at: new Date(Date.now() - f.hace * 60_000).toISOString(),
      read_at: f.leida ? new Date(Date.now() - (f.hace - 10) * 60_000).toISOString() : null,
    })),
  );
  if (error) throw new Error(`notificaciones: ${error.message}`);
}

// ─── Dispositivo vinculado ───────────────────────────────────────────────

/**
 * La pantalla de sala figura como vinculada y en uso (el tótem y la del box quedan sin vincular,
 * con su código para emparejar). El token es una huella al azar que nadie conoce: ningún
 * dispositivo real puede usarla.
 */
async function sembrarDispositivoVinculado(ctx: ContextoDemo) {
  const { data: sala } = await ctx.admin
    .from("clinic_devices")
    .select("id, paired_at")
    .eq("clinic_id", ctx.clinicId)
    .eq("kind", "sala")
    .limit(1)
    .maybeSingle();
  if (!sala || sala.paired_at) return;
  const { error } = await ctx.admin
    .from("clinic_devices")
    .update({
      token_hash: hexAleatorio(),
      paired_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -6), "08:30"),
      last_used_at: new Date().toISOString(),
      pairing_code_hash: null,
      pairing_expires_at: null,
    })
    .eq("id", sala.id)
    .eq("clinic_id", ctx.clinicId);
  if (error) throw new Error(`dispositivo vinculado: ${error.message}`);
}

// ─── Mensajes de hoy y de los pacientes inactivos ────────────────────────

/**
 * Los recordatorios de las citas de hoy (salen por WhatsApp a mano desde la clínica: aquí solo
 * queda el registro de ejemplo) y, para los pacientes que hace meses no vienen, el aviso de su
 * control: así "Resultados del piloto", la agenda y la pestaña Mensajes de la ficha tienen qué
 * mostrar.
 */
async function sembrarMensajesDeEjemplo(ctx: ContextoDemo) {
  const desdeHoy = instanteDeLaClinica(ctx, ctx.hoy, "00:00");
  const { count } = await ctx.admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .eq("direction", "outbound")
    .eq("template_kind", "appointment_reminder")
    .gte("created_at", desdeHoy);
  if ((count ?? 0) > 0) return;
  const { data: citas } = await ctx.admin
    .from("appointments")
    .select("id, patient_id, starts_at, treatment_label")
    .eq("clinic_id", ctx.clinicId)
    .gte("starts_at", desdeHoy)
    .lt("starts_at", instanteDeLaClinica(ctx, diaRelativo(ctx, 1), "00:00"))
    .neq("status", "cancelada")
    .order("starts_at")
    .limit(5);
  const { data: telefonos } = await ctx.admin
    .from("patients")
    .select("id, full_name, phone")
    .eq("clinic_id", ctx.clinicId)
    .not("phone", "is", null);
  const datos = new Map((telefonos ?? []).map((p) => [p.id, p]));
  const hora = (iso: string) =>
    new Intl.DateTimeFormat("es-CL", {
      timeZone: ctx.zona,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  const recordatorios = (citas ?? []).flatMap((c) => {
    const p = datos.get(c.patient_id);
    if (!p?.phone) return [];
    return [
      {
        clinic_id: ctx.clinicId,
        patient_id: c.patient_id,
        appointment_id: c.id,
        channel: "whatsapp" as const,
        direction: "outbound" as const,
        recipient: p.phone.replace(/\s/g, ""),
        body: `Hola ${p.full_name.split(" ")[0]}, te recordamos tu cita de ${c.treatment_label} hoy a las ${hora(c.starts_at)}. Responde este mensaje si necesitas cambiarla.`,
        status: "delivered" as const,
        template_kind: "appointment_reminder" as const,
        sent_by: USUARIO_DEMO_ID,
        created_at: instanteDeLaClinica(ctx, ctx.hoy, "08:00"),
        sent_at: instanteDeLaClinica(ctx, ctx.hoy, "08:00"),
        delivered_at: instanteDeLaClinica(ctx, ctx.hoy, "08:01"),
      },
    ];
  });
  const inactivos = ctx.pacientes
    .filter((p) => PACIENTES_SIN_VISITA.some((d) => d.nombre === p.nombre))
    .flatMap((p) => {
      const d = datos.get(p.id);
      if (!d?.phone) return [];
      return [
        {
          clinic_id: ctx.clinicId,
          patient_id: p.id,
          channel: "whatsapp" as const,
          direction: "outbound" as const,
          recipient: d.phone.replace(/\s/g, ""),
          body: `Hola ${d.full_name.split(" ")[0]}, ya pasó un tiempo desde tu último control. Responde este mensaje y te ayudamos a agendar una hora.`,
          status: "read" as const,
          sent_by: USUARIO_DEMO_ID,
          created_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -12), "10:30"),
          sent_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -12), "10:30"),
          delivered_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -12), "10:31"),
          read_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -12), "18:02"),
        },
      ];
    });
  const filas = [...recordatorios, ...inactivos];
  if (filas.length === 0) return;
  const { error } = await ctx.admin.from("messages").insert(filas as never);
  if (error) throw new Error(`mensajes de ejemplo: ${error.message}`);
}

export function pasosDePacientes(admin: Admin): PasoDeSiembra[] {
  return [
    paso(admin, "tutor de un menor de edad", sembrarTutor),
    paso(admin, "signos vitales", sembrarSignosVitales),
    paso(admin, "controles de ortodoncia", sembrarControlesDeOrtodoncia),
    paso(admin, "consentimientos firmados", sembrarConsentimientos),
    paso(admin, "formularios previos", sembrarFormulariosPrevios),
    paso(admin, "recetas", sembrarRecetas),
    paso(admin, "ajustes de avisos al paciente", sembrarAjustesDeAvisos),
    paso(admin, "avisos enviados al paciente", sembrarAvisosEnviados),
    paso(admin, "campaña cancelada", sembrarCampanaCancelada),
    paso(admin, "sala de espera", sembrarSalaDeEspera),
    paso(admin, "mensajes de ejemplo", sembrarMensajesDeEjemplo),
    paso(admin, "notificaciones", sembrarNotificaciones),
    paso(admin, "dispositivo vinculado", sembrarDispositivoVinculado),
  ];
}
