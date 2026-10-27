/**
 * Correos automáticos al paciente (Ola 7 · frente B): la corrida del cron.
 *
 * La llama `/api/patient-emails` cada hora (Vercel Cron + GitHub Actions de
 * respaldo, los dos con `CRON_SECRET`). Por cada clínica con algo encendido
 * en `patient_notification_settings`, dentro de su ventana local de 8:00 a
 * 20:59:
 *
 *   - REC-03 confirmación de las citas nuevas;
 *   - REC-02 recordatorio en cada franja configurada (24 h, 2 h…);
 *   - MKT-08 encuesta NPS de las citas finalizadas;
 *   - MKT-07 el link del formulario, adentro de la confirmación o del
 *     recordatorio, según la configuración.
 *
 * Frenos, en orden (nada lanza hacia el endpoint):
 *  1. La clínica demo nunca recibe nada.
 *  2. Baja del paciente (`email_opt_out_at`), ficha archivada o fusionada:
 *     no se envía. Sin enlace de baja firmable no se envía nada.
 *  3. Destinatario: el paciente o, si es menor con tutor vigente, el tutor
 *     (`resolverDestinatario`, CLI-11).
 *  4. Idempotencia: se reclama la fila en `patient_email_dispatches` ANTES
 *     de crear links o enviar. Si choca con el UNIQUE (cita, tipo, franja),
 *     no se envía (el doble disparo del cron no duplica nada). Un `error` se
 *     reintenta hasta 3 veces.
 *  5. Modo de prueba de la clínica (`email_sandbox_config`): en sandbox se
 *     bloquea (queda `skipped` con el motivo) o se desvía a la casilla de
 *     pruebas; nunca le llega a un paciente real.
 *
 * WhatsApp NUNCA sale desde acá.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { bajaDisponible, firmarTokenDeBaja, urlPaginaDeBaja } from "@/lib/email/baja-token.server";
import { esVentanaDeCorreos, TIMEZONE_POR_DEFECTO } from "@/lib/email/ciclo-de-vida";
import { generarSecreto, huellaDeSecreto } from "@/lib/firma-distancia/token";
import { fechaCortaHora } from "@/lib/formato-fecha";
import { resolveEmailRecipient, type EmailSandboxConfig } from "@/lib/messaging/email-sandbox";
import { sendEmail } from "@/lib/messaging/email.server";
import { resolverDestinatario } from "@/lib/patients/destinatario.server";

import {
  correoConfirmacion,
  correoEncuesta,
  correoRecordatorio,
  urlEncuesta,
  urlFormulario,
} from "./plantillas";
import {
  algoEncendido,
  claveFranja,
  correspondeConfirmacion,
  correspondeEncuesta,
  CONFIRMACION_VENTANA_MS,
  ENCUESTA_ENFRIAMIENTO_MS,
  ENCUESTA_TOLERANCIA_MS,
  franjaDeRecordatorio,
  leerConfig,
  llevaFormulario,
  vencimientoEncuesta,
  vencimientoFormulario,
  type CitaParaCorreo,
  type ConfigNotificaciones,
  type TipoDeCorreo,
} from "./reglas";

type Admin = SupabaseClient<Database>;

/**
 * Contrato del frente A (`src/lib/reserva/enlace-cita.server.ts`): URL
 * absoluta de `/mi-cita/:token` para confirmar o cancelar la cita. Se
 * inyecta desde el endpoint; sin él, el correo no lleva los botones.
 */
export type EnlaceGestionCita = (input: {
  appointmentId: string;
  clinicId: string;
  expiraEn?: Date;
}) => string;

export interface OpcionesCorrida {
  appUrl: string;
  topeClinicas: number;
  topeCorreos: number;
  enlaceGestion: EnlaceGestionCita | null;
  /** Para los tests: carga la configuración de sandbox de una clínica. */
  cargarSandbox?: (admin: Admin, clinicId: string) => Promise<EmailSandboxConfig>;
  /** Para los tests: reemplaza el envío real. */
  enviar?: typeof sendEmail;
}

export interface ResumenCorrida {
  clinicasRevisadas: number;
  enviados: number;
  omitidos: number;
  duplicados: number;
  errores: number;
  topeAlcanzado: boolean;
}

export const MAX_INTENTOS = 3;
const UNIQUE_VIOLATION = "23505";
const HORA_MS = 3_600_000;

const PLANTILLA_DE_MENSAJE: Record<
  TipoDeCorreo,
  "appointment_confirmation" | "appointment_reminder" | "nps_survey"
> = {
  confirmation: "appointment_confirmation",
  reminder: "appointment_reminder",
  nps: "nps_survey",
};

const RESUMEN_DE_MENSAJE: Record<TipoDeCorreo, string> = {
  confirmation: "Confirmación automática por correo de la cita",
  reminder: "Recordatorio automático por correo de la cita",
  nps: "Encuesta de satisfacción por correo de la cita",
};

function log(msg: string, extra?: unknown) {
  console.warn(`[patient-emails] ${msg}`, extra ?? "");
}

interface Candidato {
  cita: CitaParaCorreo & {
    patient_id: string;
    professional_id: string | null;
    branch_id: string | null;
  };
  tipo: TipoDeCorreo;
  slot: string;
  horas: number | null;
}

type Resultado = "sent" | "skipped" | "duplicate" | "error" | "nada";

export async function correrCorreosAPacientes(
  admin: Admin,
  ahora: Date,
  opciones: OpcionesCorrida,
): Promise<ResumenCorrida> {
  const resumen: ResumenCorrida = {
    clinicasRevisadas: 0,
    enviados: 0,
    omitidos: 0,
    duplicados: 0,
    errores: 0,
    topeAlcanzado: false,
  };
  if (!bajaDisponible()) {
    // Un correo al paciente sin baja funcional incumple la Ley 21.719.
    log("sin EMAIL_UNSUBSCRIBE_SECRET: no se envía nada");
    return resumen;
  }

  const { data: filas, error } = await admin
    .from("patient_notification_settings")
    .select(
      "clinic_id, confirmation_enabled, confirmation_enabled_at, reminder_enabled, reminder_hours, intake_form_mode, nps_enabled, nps_enabled_at, nps_hours_after, google_review_url",
    )
    .or("confirmation_enabled.eq.true,reminder_enabled.eq.true,nps_enabled.eq.true")
    .order("clinic_id")
    .limit(opciones.topeClinicas);
  if (error) throw new Error(`No se pudo leer la configuración: ${error.message}`);
  if (!filas?.length) return resumen;

  const { data: clinicas, error: errClinicas } = await admin
    .from("clinics")
    .select("id, name, timezone, is_demo")
    .in(
      "id",
      filas.map((f) => f.clinic_id),
    );
  if (errClinicas) throw new Error(`No se pudieron leer las clínicas: ${errClinicas.message}`);
  const clinicaPorId = new Map((clinicas ?? []).map((c) => [c.id, c]));

  const cargarSandbox =
    opciones.cargarSandbox ??
    (async (a: Admin, clinicId: string) => {
      const { loadEmailSandboxConfig } = await import("@/lib/messaging/messaging.functions");
      return loadEmailSandboxConfig(a, clinicId);
    });

  for (const fila of filas) {
    if (resumen.topeAlcanzado) break;
    const clinica = clinicaPorId.get(fila.clinic_id);
    if (!clinica || clinica.is_demo) continue;
    const config = leerConfig(fila);
    if (!algoEncendido(config)) continue;
    const zona = clinica.timezone || TIMEZONE_POR_DEFECTO;
    if (!esVentanaDeCorreos(ahora, zona)) continue;

    resumen.clinicasRevisadas++;
    try {
      const sandbox = await cargarSandbox(admin, clinica.id);
      await correrClinica(admin, ahora, opciones, resumen, {
        id: clinica.id,
        nombre: clinica.name,
        zona,
        config,
        sandbox,
      });
    } catch (err) {
      resumen.errores++;
      log(`falló la clínica ${clinica.id}`, err instanceof Error ? err.message : err);
    }
  }
  return resumen;
}

interface ClinicaCorrida {
  id: string;
  nombre: string;
  zona: string;
  config: ConfigNotificaciones;
  sandbox: EmailSandboxConfig;
}

const COLUMNAS_CITA =
  "id, patient_id, professional_id, branch_id, status, starts_at, ends_at, created_at, reminders_muted";

async function candidatosDeLaClinica(
  admin: Admin,
  ahora: Date,
  c: ClinicaCorrida,
): Promise<Candidato[]> {
  const t = ahora.getTime();
  const candidatos: Candidato[] = [];

  if (c.config.confirmacion && c.config.confirmacionDesde) {
    const desde = new Date(
      Math.max(Date.parse(c.config.confirmacionDesde), t - CONFIRMACION_VENTANA_MS),
    ).toISOString();
    const { data, error } = await admin
      .from("appointments")
      .select(COLUMNAS_CITA)
      .eq("clinic_id", c.id)
      .in("status", ["tentativa", "confirmada"])
      .eq("reminders_muted", false)
      .gte("created_at", desde)
      .gt("starts_at", new Date(t).toISOString())
      .limit(500);
    if (error) throw new Error(`citas nuevas: ${error.message}`);
    for (const cita of data ?? []) {
      if (correspondeConfirmacion(cita, c.config, ahora)) {
        candidatos.push({ cita, tipo: "confirmation", slot: "once", horas: null });
      }
    }
  }

  if (c.config.recordatorio) {
    const maxH = Math.max(...c.config.horasRecordatorio);
    const { data, error } = await admin
      .from("appointments")
      .select(COLUMNAS_CITA)
      .eq("clinic_id", c.id)
      .in("status", ["tentativa", "confirmada"])
      .eq("reminders_muted", false)
      .gt("starts_at", new Date(t).toISOString())
      .lte("starts_at", new Date(t + maxH * HORA_MS).toISOString())
      .limit(1000);
    if (error) throw new Error(`citas próximas: ${error.message}`);
    for (const cita of data ?? []) {
      const h = franjaDeRecordatorio(cita, c.config, ahora);
      if (h !== null) candidatos.push({ cita, tipo: "reminder", slot: claveFranja(h), horas: h });
    }
  }

  if (c.config.encuesta && c.config.encuestaDesde) {
    const hasta = t - c.config.horasEncuesta * HORA_MS;
    const desde = Math.max(hasta - ENCUESTA_TOLERANCIA_MS, Date.parse(c.config.encuestaDesde));
    const { data, error } = await admin
      .from("appointments")
      .select(COLUMNAS_CITA)
      .eq("clinic_id", c.id)
      .eq("status", "finalizada")
      .gte("ends_at", new Date(desde).toISOString())
      .lte("ends_at", new Date(hasta).toISOString())
      .limit(500);
    if (error) throw new Error(`citas finalizadas: ${error.message}`);
    for (const cita of data ?? []) {
      if (correspondeEncuesta(cita, c.config, ahora)) {
        candidatos.push({ cita, tipo: "nps", slot: "once", horas: null });
      }
    }
  }
  return candidatos;
}

async function correrClinica(
  admin: Admin,
  ahora: Date,
  opciones: OpcionesCorrida,
  resumen: ResumenCorrida,
  c: ClinicaCorrida,
): Promise<void> {
  let candidatos = await candidatosDeLaClinica(admin, ahora, c);
  if (candidatos.length === 0) return;

  // AGE-22: una cita grupal no manda correos automáticos. Su `patient_id` es
  // solo el titular (primer inscrito): mandarle "tu cita" a él y a nadie más
  // sería engañoso. El equipo avisa a los inscritos desde la cita.
  const grupales = await admin
    .from("appointment_groups")
    .select("appointment_id")
    .eq("clinic_id", c.id)
    .in("appointment_id", [...new Set(candidatos.map((x) => x.cita.id))]);
  if (grupales.error) throw new Error(`citas grupales: ${grupales.error.message}`);
  if (grupales.data?.length) {
    const esGrupal = new Set(grupales.data.map((g) => g.appointment_id));
    candidatos = candidatos.filter((x) => !esGrupal.has(x.cita.id));
    if (candidatos.length === 0) return;
  }

  // Lo que ya salió (o está saliendo): solo se reintenta un error.
  const ids = [...new Set(candidatos.map((x) => x.cita.id))];
  const { data: previos, error: errPrevios } = await admin
    .from("patient_email_dispatches")
    .select("appointment_id, kind, slot, status, attempts")
    .eq("clinic_id", c.id)
    .in("appointment_id", ids);
  if (errPrevios) throw new Error(`registro de envíos: ${errPrevios.message}`);
  const previoPorClave = new Map(
    (previos ?? []).map((p) => [`${p.appointment_id}|${p.kind}|${p.slot}`, p]),
  );
  candidatos = candidatos.filter((x) => {
    const p = previoPorClave.get(`${x.cita.id}|${x.tipo}|${x.slot}`);
    return !p || (p.status === "error" && p.attempts < MAX_INTENTOS);
  });
  if (candidatos.length === 0) return;

  const pacienteIds = [...new Set(candidatos.map((x) => x.cita.patient_id))];

  // Encuesta: una cada 30 días por paciente.
  if (candidatos.some((x) => x.tipo === "nps")) {
    const { data: recientes } = await admin
      .from("patient_nps_responses")
      .select("patient_id, appointment_id")
      .eq("clinic_id", c.id)
      .in("patient_id", pacienteIds)
      .gte("sent_at", new Date(ahora.getTime() - ENCUESTA_ENFRIAMIENTO_MS).toISOString());
    const encuestados = new Map((recientes ?? []).map((r) => [r.patient_id, r.appointment_id]));
    const vistos = new Set<string>();
    candidatos = candidatos.filter((x) => {
      if (x.tipo !== "nps") return true;
      const previa = encuestados.get(x.cita.patient_id);
      if (previa && previa !== x.cita.id) return false;
      if (vistos.has(x.cita.patient_id)) return false;
      vistos.add(x.cita.patient_id);
      return true;
    });
  }

  const profesionalIds = [
    ...new Set(candidatos.map((x) => x.cita.professional_id).filter((v): v is string => !!v)),
  ];
  const sucursalIds = [
    ...new Set(candidatos.map((x) => x.cita.branch_id).filter((v): v is string => !!v)),
  ];
  const [pacientes, profesionales, sucursales] = await Promise.all([
    admin
      .from("patients")
      .select("id, full_name, email, birth_date, email_opt_out_at, archived_at, merged_into")
      .eq("clinic_id", c.id)
      .in("id", pacienteIds),
    profesionalIds.length
      ? admin.from("professionals").select("id, full_name").in("id", profesionalIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null }),
    sucursalIds.length
      ? admin.from("branches").select("id, name, address").in("id", sucursalIds)
      : Promise.resolve({
          data: [] as { id: string; name: string; address: string | null }[],
          error: null,
        }),
  ]);
  if (pacientes.error) throw new Error(`pacientes: ${pacientes.error.message}`);
  const pacientePorId = new Map((pacientes.data ?? []).map((p) => [p.id, p]));
  const profesionalPorId = new Map((profesionales.data ?? []).map((p) => [p.id, p.full_name]));
  const sucursalPorId = new Map((sucursales.data ?? []).map((s) => [s.id, s]));

  for (const x of candidatos) {
    if (resumen.enviados + resumen.errores >= opciones.topeCorreos) {
      resumen.topeAlcanzado = true;
      return;
    }
    const paciente = pacientePorId.get(x.cita.patient_id);
    if (!paciente) continue;
    const sucursal = x.cita.branch_id ? sucursalPorId.get(x.cita.branch_id) : undefined;
    const r = await enviarUno(admin, ahora, opciones, c, x, {
      paciente,
      profesional: x.cita.professional_id
        ? (profesionalPorId.get(x.cita.professional_id) ?? null)
        : null,
      sucursal: sucursal?.name ?? null,
      direccion: sucursal?.address ?? null,
    });
    if (r === "sent") resumen.enviados++;
    else if (r === "skipped") resumen.omitidos++;
    else if (r === "duplicate") resumen.duplicados++;
    else if (r === "error") resumen.errores++;
  }
}

interface Contexto {
  paciente: {
    id: string;
    full_name: string;
    email: string | null;
    birth_date: string | null;
    email_opt_out_at: string | null;
    archived_at: string | null;
    merged_into: string | null;
  };
  profesional: string | null;
  sucursal: string | null;
  direccion: string | null;
}

/** Reclama el envío. `null` = ya existe y no toca reintentar. */
async function reclamar(
  admin: Admin,
  fila: {
    clinic_id: string;
    patient_id: string;
    appointment_id: string;
    kind: TipoDeCorreo;
    slot: string;
    recipient_role: "paciente" | "tutor";
    recipient: string;
  },
): Promise<string | null> {
  const { data, error } = await admin
    .from("patient_email_dispatches")
    .insert({ ...fila, status: "pending" })
    .select("id")
    .maybeSingle();
  if (!error && data) return data.id;
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`no se pudo reclamar el envío: ${error.message}`);
  }
  const { data: previa } = await admin
    .from("patient_email_dispatches")
    .select("id, status, attempts")
    .eq("appointment_id", fila.appointment_id)
    .eq("kind", fila.kind)
    .eq("slot", fila.slot)
    .maybeSingle();
  if (!previa || previa.status !== "error" || previa.attempts >= MAX_INTENTOS) return null;
  // UPDATE condicional: dos corridas simultáneas no lo toman las dos.
  const { data: retomada } = await admin
    .from("patient_email_dispatches")
    .update({
      status: "pending",
      attempts: previa.attempts + 1,
      reason: null,
      recipient: fila.recipient,
      recipient_role: fila.recipient_role,
      updated_at: new Date().toISOString(),
    })
    .eq("id", previa.id)
    .eq("status", "error")
    .eq("attempts", previa.attempts)
    .select("id");
  return retomada?.length ? previa.id : null;
}

async function cerrar(
  admin: Admin,
  id: string,
  cambios: {
    status: "sent" | "skipped" | "error";
    reason?: string | null;
    provider_id?: string | null;
    redirected_to?: string | null;
  },
) {
  await admin
    .from("patient_email_dispatches")
    .update({
      ...cambios,
      reason: cambios.reason ? cambios.reason.slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/** Link del formulario (MKT-07). null si ya lo respondió: no se rehace. */
async function prepararFormulario(
  admin: Admin,
  ahora: Date,
  c: ClinicaCorrida,
  x: Candidato,
  appUrl: string,
): Promise<string | null> {
  const { data: previo } = await admin
    .from("patient_intake_forms")
    .select("id, status")
    .eq("appointment_id", x.cita.id)
    .maybeSingle();
  if (previo && !["enviado", "abierto"].includes(previo.status)) return null;
  const token = generarSecreto();
  const token_hash = await huellaDeSecreto(token);
  const expires_at = vencimientoFormulario(x.cita.starts_at, ahora).toISOString();
  if (previo) {
    // Un correo nuevo con el formulario (otro recordatorio, un reintento):
    // el link anterior deja de servir.
    const { error } = await admin
      .from("patient_intake_forms")
      .update({ token_hash, expires_at, sent_at: ahora.toISOString() })
      .eq("id", previo.id);
    if (error) throw new Error(`formulario: ${error.message}`);
  } else {
    const { error } = await admin.from("patient_intake_forms").insert({
      clinic_id: c.id,
      patient_id: x.cita.patient_id,
      appointment_id: x.cita.id,
      token_hash,
      expires_at,
      sent_at: ahora.toISOString(),
    });
    if (error) throw new Error(`formulario: ${error.message}`);
  }
  return urlFormulario(appUrl, token);
}

/** Link de la encuesta (MKT-08). null si ya la respondió. */
async function prepararEncuesta(
  admin: Admin,
  ahora: Date,
  c: ClinicaCorrida,
  x: Candidato,
  appUrl: string,
): Promise<string | null> {
  const { data: previa } = await admin
    .from("patient_nps_responses")
    .select("id, responded_at")
    .eq("appointment_id", x.cita.id)
    .maybeSingle();
  if (previa?.responded_at) return null;
  const token = generarSecreto();
  const token_hash = await huellaDeSecreto(token);
  const expires_at = vencimientoEncuesta(ahora).toISOString();
  if (previa) {
    const { error } = await admin
      .from("patient_nps_responses")
      .update({ token_hash, expires_at, sent_at: ahora.toISOString() })
      .eq("id", previa.id);
    if (error) throw new Error(`encuesta: ${error.message}`);
  } else {
    const { error } = await admin.from("patient_nps_responses").insert({
      clinic_id: c.id,
      patient_id: x.cita.patient_id,
      appointment_id: x.cita.id,
      professional_id: x.cita.professional_id,
      token_hash,
      expires_at,
      sent_at: ahora.toISOString(),
    });
    if (error) throw new Error(`encuesta: ${error.message}`);
  }
  return urlEncuesta(appUrl, token);
}

async function enviarUno(
  admin: Admin,
  ahora: Date,
  opciones: OpcionesCorrida,
  c: ClinicaCorrida,
  x: Candidato,
  ctx: Contexto,
): Promise<Resultado> {
  const p = ctx.paciente;
  // 2. Baja, ficha archivada o fusionada: no se le escribe (sin registro: si
  //    vuelve a suscribirse, el próximo correo que corresponda sale).
  if (p.email_opt_out_at || p.archived_at || p.merged_into) return "nada";

  // 3. Destinatario (paciente o tutor).
  const destino = await resolverDestinatario(admin, {
    clinicId: c.id,
    patientId: p.id,
    fechaNacimiento: p.birth_date,
    telefono: null,
    email: p.email,
    timezone: c.zona,
  });
  const email = destino.email?.trim().toLowerCase() || null;
  if (!email) return "nada";

  // 4. Reclamar ANTES de crear links o enviar.
  let filaId: string | null;
  try {
    filaId = await reclamar(admin, {
      clinic_id: c.id,
      patient_id: p.id,
      appointment_id: x.cita.id,
      kind: x.tipo,
      slot: x.slot,
      recipient_role: destino.para,
      recipient: email,
    });
  } catch (err) {
    log("sin registro de idempotencia; no se envía", err instanceof Error ? err.message : err);
    return "error";
  }
  if (!filaId) return "duplicate";

  try {
    // 5. Modo de prueba: si bloquea, no se arma ni se manda nada.
    const decision = resolveEmailRecipient(email, c.sandbox);
    if (decision.action === "block") {
      await cerrar(admin, filaId, { status: "skipped", reason: decision.reason });
      return "skipped";
    }

    const bajaUrl = urlPaginaDeBaja(
      opciones.appUrl,
      await firmarTokenDeBaja(p.id, "correos_paciente"),
    );

    let correo;
    if (x.tipo === "nps") {
      const enlaceEncuesta = await prepararEncuesta(admin, ahora, c, x, opciones.appUrl);
      if (!enlaceEncuesta) {
        await cerrar(admin, filaId, { status: "skipped", reason: "la encuesta ya fue respondida" });
        return "skipped";
      }
      correo = correoEncuesta({
        appUrl: opciones.appUrl,
        clinica: c.nombre,
        zona: c.zona,
        startsAt: x.cita.starts_at,
        paciente: p.full_name,
        para: destino.para,
        nombreTutor: destino.tutor?.fullName ?? null,
        enlaceEncuesta,
        bajaUrl,
      });
    } else {
      let enlaceGestion: string | null = null;
      if (opciones.enlaceGestion) {
        try {
          enlaceGestion = opciones.enlaceGestion({ appointmentId: x.cita.id, clinicId: c.id });
        } catch (err) {
          log("no se pudo armar el enlace de la cita", err instanceof Error ? err.message : err);
        }
      }
      const enlaceFormulario = llevaFormulario(x.tipo, c.config)
        ? await prepararFormulario(admin, ahora, c, x, opciones.appUrl)
        : null;
      const datos = {
        appUrl: opciones.appUrl,
        clinica: c.nombre,
        zona: c.zona,
        startsAt: x.cita.starts_at,
        profesional: ctx.profesional,
        sucursal: ctx.sucursal,
        direccion: ctx.direccion,
        paciente: p.full_name,
        para: destino.para,
        nombreTutor: destino.tutor?.fullName ?? null,
        enlaceGestion,
        enlaceFormulario,
        bajaUrl,
      };
      correo =
        x.tipo === "confirmation"
          ? correoConfirmacion(datos)
          : correoRecordatorio({ ...datos, horasAntes: x.horas ?? 24 });
    }

    const enviar = opciones.enviar ?? sendEmail;
    const r = await enviar(
      { to: email, subject: correo.subject, html: correo.html, text: correo.text },
      c.sandbox,
    );
    if (!r.ok) {
      await cerrar(admin, filaId, { status: "error", reason: r.reason });
      return "error";
    }
    await cerrar(admin, filaId, {
      status: "sent",
      provider_id: r.externalId,
      redirected_to: r.redirected ? r.recipient : null,
    });

    // Historial de la ficha (y la cola de Recordatorios ve que el correo ya
    // salió). Sin el cuerpo del correo: lleva links personales.
    const { error: errMensaje } = await admin.from("messages").insert({
      clinic_id: c.id,
      patient_id: p.id,
      appointment_id: x.cita.id,
      template_kind: PLANTILLA_DE_MENSAJE[x.tipo],
      channel: "email",
      direction: "outbound",
      status: "sent",
      recipient: email,
      body: `${RESUMEN_DE_MENSAJE[x.tipo]} del ${fechaCortaHora(x.cita.starts_at, c.zona)}${
        destino.para === "tutor" ? " (al tutor)" : ""
      }${r.redirected ? ` · modo de prueba: llegó a ${r.recipient}` : ""}.`,
      external_id: r.externalId,
      sent_at: new Date().toISOString(),
      sent_by: null,
    });
    if (errMensaje) log("salió, pero no quedó en el historial", errMensaje.message);
    return "sent";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log(`falló el envío (${x.tipo})`, reason);
    await cerrar(admin, filaId, { status: "error", reason });
    return "error";
  }
}
