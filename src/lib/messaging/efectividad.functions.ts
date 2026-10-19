import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwIfRequiresLlamadaOSuscripcion } from "@/lib/billing.functions";
import { mensajeDb } from "@/lib/db-errors";
import {
  ausenciaSegunAviso,
  ausenciaSegunRecordatorio,
  coberturaDeMensajes,
  medianaDeRespuestaEnMinutos,
  proporcion,
  tasaDeAusencia,
  type CitaMedible,
  type Comparacion,
  type CoberturaDeMensajes,
  type EstadoCita,
  type MensajeMedible,
  type Proporcion,
} from "@/lib/messaging/efectividad";
import { esPalabraDeBaja } from "@/lib/messaging/baja-whatsapp";
import { hoyEnLaClinica, interpretarMensajeDeAgenda } from "@/lib/messaging/intencion-de-agenda";
import { esConfirmacionDePaciente } from "@/lib/messaging/patient-confirmation";

/** Ventana de análisis. Más atrás el dato existe pero ya no describe cómo trabaja hoy la clínica. */
const DIAS_DE_VENTANA = 90;
/** Techos de lectura, para que la pantalla no se caiga en una clínica grande. */
const TOPE_CITAS = 3000;
const TOPE_MENSAJES = 3000;

const KINDS_DE_RECORDATORIO = ["appointment_reminder", "appointment_checkin"];

const SIN_PERMISOS_EFECTIVIDAD =
  "Para ver Efectividad primero tienes que agendar la llamada de puesta en marcha o suscribirte.";

export interface Efectividad {
  desde: string;
  ausencia: Proporcion;
  porRecordatorio: Comparacion;
  porAviso: Comparacion;
  cobertura: CoberturaDeMensajes;
  medianaRespuestaMin: number | null;
  sinResponder: number;
  solicitudes: { total: number; agendadas: Proporcion };
  /** true si se tocó alguno de los techos y la muestra quedó recortada. */
  recortado: boolean;
}

/**
 * Todo lo que hace falta para saber si la automatización sirve, calculado
 * sobre datos reales de la clínica.
 *
 * ⚠️ Las comparaciones "con y sin recordatorio" son **observacionales**: la
 * clínica elige a quién le manda, y esa elección puede correlacionar con
 * quién iba a faltar igual. La pantalla lo dice en voz alta; acá se deja
 * asentado para que nadie convierta el número en una promesa de marketing.
 */
export const getEfectividad = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Efectividad> => {
    const { supabase } = context;
    await throwIfRequiresLlamadaOSuscripcion(supabase, data.clinicId, SIN_PERMISOS_EFECTIVIDAD);
    const desde = new Date(Date.now() - DIAS_DE_VENTANA * 24 * 60 * 60 * 1000).toISOString();

    const [citasRes, mensajesRes, solicitudesRes, clinicaRes] = await Promise.all([
      supabase
        .from("appointments")
        .select("id, status, patient_confirmed_at")
        .eq("clinic_id", data.clinicId)
        .gte("starts_at", desde)
        .lte("starts_at", new Date().toISOString())
        .limit(TOPE_CITAS),
      supabase
        .from("messages")
        .select("patient_id, direction, body, created_at, appointment_id, template_kind")
        .eq("clinic_id", data.clinicId)
        .gte("created_at", desde)
        .order("created_at", { ascending: true })
        .limit(TOPE_MENSAJES),
      supabase
        .from("appointment_requests")
        .select("status")
        .eq("clinic_id", data.clinicId)
        .eq("source", "whatsapp")
        .gte("created_at", desde),
      supabase.from("clinics").select("timezone").eq("id", data.clinicId).maybeSingle(),
    ]);

    if (citasRes.error) throw new Error(mensajeDb(citasRes.error, "No pudimos leer las citas."));
    if (mensajesRes.error)
      throw new Error(mensajeDb(mensajesRes.error, "No pudimos leer los mensajes."));

    const filasMensajes = mensajesRes.data ?? [];

    // Qué citas recibieron recordatorio: se deduce de los mensajes, que ya
    // están traídos. Una consulta menos y un dato menos que puede divergir.
    const conRecordatorio = new Set(
      filasMensajes
        .filter(
          (m) =>
            m.appointment_id &&
            m.direction === "outbound" &&
            KINDS_DE_RECORDATORIO.includes(m.template_kind ?? ""),
        )
        .map((m) => m.appointment_id as string),
    );

    const citas: CitaMedible[] = (citasRes.data ?? []).map((c) => ({
      status: c.status as EstadoCita,
      tuvoRecordatorio: conRecordatorio.has(c.id),
      avisoElPaciente: c.patient_confirmed_at !== null,
    }));

    const mensajes: MensajeMedible[] = filasMensajes.map((m) => ({
      patientId: m.patient_id ?? "",
      direction: m.direction === "inbound" ? "inbound" : "outbound",
      body: m.body,
      createdAt: m.created_at,
    }));

    // El mismo orden de precedencia que aplica el webhook, para que la
    // pantalla mida lo que realmente pasa y no una versión idealizada.
    const hoy = hoyEnLaClinica(clinicaRes.data?.timezone ?? "America/Santiago");
    const clasificar = (texto: string): "agenda" | "aviso" | "baja" | null => {
      if (esPalabraDeBaja(texto)) return "baja";
      if (esConfirmacionDePaciente(texto)) return "aviso";
      return interpretarMensajeDeAgenda(texto, hoy) ? "agenda" : null;
    };

    // Hilos cuyo último mensaje sigue siendo del paciente.
    const ultimoPorPaciente = new Map<string, string>();
    for (const m of mensajes) if (m.patientId) ultimoPorPaciente.set(m.patientId, m.direction);
    const sinResponder = [...ultimoPorPaciente.values()].filter((d) => d === "inbound").length;

    const solicitudes = solicitudesRes.data ?? [];

    return {
      desde,
      ausencia: tasaDeAusencia(citas),
      porRecordatorio: ausenciaSegunRecordatorio(citas),
      porAviso: ausenciaSegunAviso(citas),
      cobertura: coberturaDeMensajes(mensajes, clasificar),
      medianaRespuestaMin: medianaDeRespuestaEnMinutos(mensajes),
      sinResponder,
      solicitudes: {
        total: solicitudes.length,
        agendadas: proporcion(
          solicitudes.filter((s) => s.status === "scheduled").length,
          solicitudes.length,
        ),
      },
      recortado:
        (citasRes.data ?? []).length >= TOPE_CITAS || filasMensajes.length >= TOPE_MENSAJES,
    };
  });
