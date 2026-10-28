import {
  contarFilas,
  diaRelativo,
  instanteDeLaClinica,
  paso,
  USUARIO_DEMO_ID,
  type Admin,
  type ContextoDemo,
  type PasoDeSiembra,
} from "@/lib/demo/contexto.server";

/**
 * Demo completa · cumplimiento y trazabilidad: derechos de los titulares con casos en distinto
 * estado, registro de incidentes con un ejemplo cerrado, importaciones de ejemplo, registro de
 * quién leyó cada ficha y el modo de prueba del correo. Todo ficticio.
 *
 * Los registros de derechos e incidentes son inmutables por diseño (triggers de la base): se
 * crean por su camino real, no se editan después. Los plazos de los derechos los fija la base
 * (30 días corridos desde que llega la solicitud), por eso los casos de ejemplo difieren en
 * estado y prórroga, no en la fecha de recepción.
 */

// ─── Derechos de los titulares (Ley 21.719) ──────────────────────────────

async function sembrarDerechosDeLosTitulares(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "data_subject_requests", ctx.clinicId)) > 0) return;
  const p = ctx.pacientes;
  if (p.length < 5) return;
  const casos = [
    {
      paciente: p[2],
      kind: "acceso",
      detail: "Quiero una copia de mi ficha clínica y de mis exámenes.",
      destino: "recibida" as const,
    },
    {
      paciente: p[3],
      kind: "rectificacion",
      detail: "Mi teléfono y mi correo cambiaron; necesito actualizarlos en la ficha.",
      destino: "en_revision" as const,
    },
    {
      paciente: p[4],
      kind: "portabilidad",
      detail: "Necesito mis datos en un formato que pueda llevar a otra clínica.",
      destino: "en_revision" as const,
      prorroga: "Hay que reunir los exámenes de dos sucursales antes de entregar la copia.",
    },
    {
      paciente: p[5 % p.length],
      kind: "supresion",
      detail: "Ya no atiendo mi salud con ustedes; pido eliminar mis datos de contacto.",
      destino: "respondida" as const,
      respuesta:
        "Eliminamos tus datos de contacto. Conservamos la ficha clínica por el plazo legal de resguardo.",
    },
    {
      paciente: p[6 % p.length],
      kind: "oposicion",
      detail: "No quiero recibir recordatorios de campañas.",
      destino: "rechazada" as const,
      respuesta:
        "Los recordatorios de tus citas son parte de la atención y no se pueden desactivar; sí quitamos tu ficha de las campañas.",
    },
  ];
  for (const c of casos) {
    const { data: req, error } = await ctx.admin
      .from("data_subject_requests")
      .insert({
        clinic_id: ctx.clinicId,
        patient_id: c.paciente.id,
        kind: c.kind,
        channel: "portal",
        detail: c.detail,
        due_date: diaRelativo(ctx, 30),
        received_at: new Date().toISOString(),
        status: "recibida",
      })
      .select("id")
      .single();
    if (error) throw new Error(`derechos: ${error.message}`);
    if (c.destino === "recibida") continue;
    const paso1 = await ctx.admin
      .from("data_subject_requests")
      .update({ status: "en_revision" })
      .eq("id", req.id)
      .eq("clinic_id", ctx.clinicId);
    if (paso1.error) throw new Error(`derechos (revisión): ${paso1.error.message}`);
    if ("prorroga" in c && c.prorroga) {
      const r = await ctx.admin
        .from("data_subject_requests")
        .update({ extended_due_date: diaRelativo(ctx, 60), extension_reason: c.prorroga })
        .eq("id", req.id)
        .eq("clinic_id", ctx.clinicId);
      if (r.error) throw new Error(`derechos (prórroga): ${r.error.message}`);
    }
    if (c.destino === "respondida" || c.destino === "rechazada") {
      const r = await ctx.admin
        .from("data_subject_requests")
        .update({ status: c.destino, response: c.respuesta })
        .eq("id", req.id)
        .eq("clinic_id", ctx.clinicId);
      if (r.error) throw new Error(`derechos (respuesta): ${r.error.message}`);
    }
  }
}

// ─── Incidentes de seguridad ─────────────────────────────────────────────

async function sembrarIncidentes(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "security_incidents", ctx.clinicId)) > 0) return;
  const base = {
    clinic_id: ctx.clinicId,
    created_by: USUARIO_DEMO_ID,
    responsible_name: "Rodrigo Pinto Salas",
  };
  const { data: cerrado, error } = await ctx.admin
    .from("security_incidents")
    .insert({
      ...base,
      title: "Correo con un presupuesto enviado a una dirección equivocada",
      description:
        "Recepción envió el PDF de un presupuesto a una dirección escrita con un error. El correo no rebotó y llegó a una persona ajena a la clínica.",
      detected_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -42), "10:15"),
      occurred_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -42), "09:40"),
      data_categories: ["identificacion", "contacto", "financieros"],
      affected_subjects_estimate: 1,
      risk_level: "por_evaluar",
      risk_assessment: null,
      measures: null,
      notify_agency: "por_decidir",
      notify_subjects: "por_decidir",
      status: "abierto",
    })
    .select("id")
    .single();
  if (error) throw new Error(`incidentes: ${error.message}`);
  const { error: errUpdates } = await ctx.admin.from("security_incident_updates").insert([
    {
      clinic_id: ctx.clinicId,
      incident_id: cerrado.id,
      created_by: USUARIO_DEMO_ID,
      note: "Se pidió a quien recibió el correo que lo eliminara y lo confirmó por escrito.",
      status: "contenido",
      risk_level: "bajo",
      risk_assessment:
        "El documento incluía nombre, correo y monto del presupuesto; sin datos clínicos ni de pago.",
      measures: "Verificación de la dirección antes de enviar y confirmación en pantalla.",
      notify_agency: "no",
      notify_subjects: "si",
      notification_reason:
        "Riesgo bajo: no hay datos clínicos ni de pago. Se avisó a la persona afectada.",
      subjects_notified_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -41), "12:00"),
    },
    {
      clinic_id: ctx.clinicId,
      incident_id: cerrado.id,
      created_by: USUARIO_DEMO_ID,
      note: "Cerrado: se revisó el procedimiento de envío y se capacitó al equipo de recepción.",
      status: "cerrado",
    },
  ]);
  if (errUpdates) throw new Error(`incidentes (seguimiento): ${errUpdates.message}`);
}

// ─── Importaciones de ejemplo ────────────────────────────────────────────

async function sembrarImportaciones(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "import_batches", ctx.clinicId)) > 0) return;
  const { error } = await ctx.admin.from("import_batches").insert([
    {
      clinic_id: ctx.clinicId,
      created_by: USUARIO_DEMO_ID,
      kind: "pacientes",
      source: "csv_generico",
      file_name: "pacientes-sistema-anterior.csv",
      status: "completado",
      duplicate_policy: "omitir",
      rows_total: 42,
      rows_created: 38,
      rows_updated: 0,
      rows_skipped: 3,
      rows_failed: 1,
      include_in_reminders: false,
      created_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -50), "11:20"),
      completed_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -50), "11:21"),
    },
    {
      clinic_id: ctx.clinicId,
      created_by: USUARIO_DEMO_ID,
      kind: "citas",
      source: "csv_generico",
      file_name: "agenda-proximas-semanas.csv",
      status: "completado",
      duplicate_policy: "omitir",
      rows_total: 27,
      rows_created: 27,
      rows_updated: 0,
      rows_skipped: 0,
      rows_failed: 0,
      include_in_reminders: false,
      created_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -49), "09:05"),
      completed_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -49), "09:06"),
    },
  ]);
  if (error) throw new Error(`importaciones: ${error.message}`);
}

// ─── Registro de accesos ─────────────────────────────────────────────────

const SECCIONES = ["datos", "notas", "odontograma", "anamnesis", "documentos", "examenes"] as const;

async function sembrarRegistroDeAccesos(ctx: ContextoDemo) {
  if ((await contarFilas(ctx.admin, "clinical_access_log", ctx.clinicId)) === 0) {
    const filas = Array.from({ length: 16 }, (_, i) => ({
      clinic_id: ctx.clinicId,
      actor_id: USUARIO_DEMO_ID,
      patient_id: ctx.pacientes[i % ctx.pacientes.length].id,
      section: SECCIONES[i % SECCIONES.length],
      accessed_at: instanteDeLaClinica(
        ctx,
        diaRelativo(ctx, -Math.floor(i / 3)),
        `${String(9 + (i % 8)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}`,
      ),
    }));
    const { error } = await ctx.admin.from("clinical_access_log").insert(filas);
    if (error) throw new Error(`accesos a fichas: ${error.message}`);
  }
  if ((await contarFilas(ctx.admin, "portal_access_log", ctx.clinicId)) === 0) {
    const filas = ctx.pacientes.slice(0, 5).flatMap((p, i) => [
      {
        clinic_id: ctx.clinicId,
        patient_id: p.id,
        event: "session_opened",
        created_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -i), "19:10"),
      },
      {
        clinic_id: ctx.clinicId,
        patient_id: p.id,
        event: "overview_viewed",
        created_at: instanteDeLaClinica(ctx, diaRelativo(ctx, -i), "19:11"),
      },
    ]);
    const { error } = await ctx.admin.from("portal_access_log").insert(filas);
    if (error) throw new Error(`accesos al portal: ${error.message}`);
  }
}

// ─── Correo: modo prueba ─────────────────────────────────────────────────

async function sembrarModoPruebaDelCorreo(ctx: ContextoDemo) {
  const { error } = await ctx.admin.from("email_sandbox_config").upsert(
    {
      clinic_id: ctx.clinicId,
      mode: "sandbox",
      redirect_enabled: true,
      redirect_to: "pruebas@demo.esmalia.com",
      prefix_subject: true,
      allowlist: [],
      min_entregas_produccion: 3,
      updated_by: USUARIO_DEMO_ID,
    },
    { onConflict: "clinic_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`modo prueba del correo: ${error.message}`);
}

export function pasosDeCumplimiento(admin: Admin): PasoDeSiembra[] {
  return [
    paso(admin, "derechos de los titulares", sembrarDerechosDeLosTitulares),
    paso(admin, "incidentes de seguridad", sembrarIncidentes),
    paso(admin, "importaciones", sembrarImportaciones),
    paso(admin, "registro de accesos", sembrarRegistroDeAccesos),
    paso(admin, "modo prueba del correo", sembrarModoPruebaDelCorreo),
  ];
}
