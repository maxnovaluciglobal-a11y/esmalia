import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { ipYNavegador } from "@/lib/firma-distancia/firma.server";
import {
  horasDisponibles,
  horaSigueLibre,
  type DiaDisponible,
} from "@/lib/reserva/disponibilidad-reserva";
import { verificarTokenGestionCita } from "@/lib/reserva/enlace-cita.server";
import { partirHoraLocal } from "@/lib/reserva/hora-local";
import { armarEntradaHoras, exigirLimiteDeReserva } from "@/lib/reserva/reserva-db.server";
import { mensajeDeReserva } from "@/lib/reserva/reserva";

/**
 * Gestión de la cita por link firmado (RES-05 + REC-11): `/mi-cita/<token>`.
 *
 * El token (HMAC, un solo propósito, con vencimiento) lo valida el servidor;
 * a la base llegan solo el id de la cita y el de la clínica firmados. Las
 * funciones `cita_gestion_*` corren con el rol de servicio.
 *
 * "Confirmó el paciente" (patient_confirmed_at) es un eje aparte: nada de
 * esto pone `status = 'confirmada'`. Reagendar deja la cita `tentativa`.
 */

const TokenSchema = z.string().min(20).max(500);

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function citaDelToken(token: string): { appointmentId: string; clinicId: string } {
  const r = verificarTokenGestionCita(token);
  if (!r.ok) {
    throw new Error(
      r.motivo === "vencido"
        ? "Este link venció. Pídele a la clínica uno nuevo."
        : "Este link no es válido.",
    );
  }
  return r.cita;
}

export interface MiCita {
  clinica: string;
  zona: string;
  sucursal: string;
  direccion: string | null;
  telefonoClinica: string | null;
  profesional: string;
  motivo: string;
  inicio: string;
  fin: string;
  estado: string;
  pacienteConfirmo: string | null;
  pacienteCancelo: string | null;
  paciente: string | null;
  /** Se puede confirmar, cancelar o reagendar (futura y no cerrada). */
  gestionable: boolean;
  /** Reagendar necesita la reserva en línea encendida. */
  puedeReagendar: boolean;
}

type Obj = Record<string, unknown>;
const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function leerCita(appointmentId: string, clinicId: string): Promise<Obj> {
  const db = await admin();
  const { data, error } = await db.rpc("cita_gestion_ver", {
    p_appointment_id: appointmentId,
    p_clinic_id: clinicId,
  });
  if (error) throw new Error("No pudimos abrir tu cita. Vuelve a intentarlo.");
  if (!data || typeof data !== "object") throw new Error(mensajeDeReserva("no_existe"));
  return data as Obj;
}

async function enSoloLectura(clinicId: string): Promise<boolean> {
  const db = await admin();
  const { clinicaEnSoloLectura } = await import("@/lib/solo-lectura.server");
  return clinicaEnSoloLectura(db, clinicId);
}

export const verMiCita = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: TokenSchema }).parse(input))
  .handler(async ({ data }): Promise<MiCita> => {
    exigirLimiteDeReserva(ipYNavegador().ip);
    const { appointmentId, clinicId } = citaDelToken(data.token);
    const j = await leerCita(appointmentId, clinicId);
    const estado = texto(j.estado) ?? "tentativa";
    const inicio = texto(j.inicio) ?? new Date().toISOString();
    const gestionable =
      (estado === "tentativa" || estado === "confirmada") && new Date(inicio) > new Date();
    return {
      clinica: texto(j.clinica) ?? "Tu clínica",
      zona: texto(j.zona) ?? "America/Santiago",
      sucursal: texto(j.sucursal) ?? "",
      direccion: texto(j.direccion),
      telefonoClinica: texto(j.telefono_clinica),
      profesional: texto(j.profesional) ?? "",
      motivo: texto(j.motivo) ?? "Atención",
      inicio,
      fin: texto(j.fin) ?? inicio,
      estado,
      pacienteConfirmo: texto(j.paciente_confirmo),
      pacienteCancelo: texto(j.paciente_cancelo),
      paciente: texto(j.paciente),
      gestionable,
      puedeReagendar: gestionable && j.reserva_activa === true && !(await enSoloLectura(clinicId)),
    };
  });

type Resultado = { ok: true } | { ok: false; motivo: string };

function resultado(r: unknown): Resultado {
  const j = (r ?? {}) as Obj;
  return j.ok === true ? { ok: true } : { ok: false, motivo: mensajeDeReserva(texto(j.motivo)) };
}

export const confirmarMiCita = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: TokenSchema }).parse(input))
  .handler(async ({ data }): Promise<Resultado> => {
    exigirLimiteDeReserva(ipYNavegador().ip);
    const { appointmentId, clinicId } = citaDelToken(data.token);
    const db = await admin();
    const { data: r, error } = await db.rpc("cita_gestion_confirmar", {
      p_appointment_id: appointmentId,
      p_clinic_id: clinicId,
    });
    if (error) throw new Error("No pudimos guardar tu confirmación. Vuelve a intentarlo.");
    return resultado(r);
  });

export const cancelarMiCita = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: TokenSchema, motivo: z.string().trim().max(300).optional() }).parse(input),
  )
  .handler(async ({ data }): Promise<Resultado> => {
    exigirLimiteDeReserva(ipYNavegador().ip);
    const { appointmentId, clinicId } = citaDelToken(data.token);
    const db = await admin();
    const { data: r, error } = await db.rpc("cita_gestion_cancelar", {
      p_appointment_id: appointmentId,
      p_clinic_id: clinicId,
      p_motivo: data.motivo ?? "",
    });
    if (error) throw new Error("No pudimos cancelar tu cita. Vuelve a intentarlo.");
    return resultado(r);
  });

/** Lo que el motor necesita de la cita para buscar horas (con el rol de servicio). */
async function datosParaReagendar(appointmentId: string, clinicId: string) {
  const j = await leerCita(appointmentId, clinicId);
  const estado = texto(j.estado);
  const inicio = texto(j.inicio);
  const fin = texto(j.fin);
  const sucursalId = texto(j.sucursal_id);
  const profesionalId = texto(j.profesional_id);
  if (
    !inicio ||
    !fin ||
    !sucursalId ||
    !profesionalId ||
    (estado !== "tentativa" && estado !== "confirmada") ||
    new Date(inicio) <= new Date()
  ) {
    throw new Error(mensajeDeReserva("no_disponible"));
  }
  if (j.reserva_activa !== true || (await enSoloLectura(clinicId))) {
    throw new Error(mensajeDeReserva("apagada"));
  }
  return {
    zona: texto(j.zona) ?? "America/Santiago",
    sucursalId,
    profesionalId,
    duracion: Math.round((new Date(fin).getTime() - new Date(inicio).getTime()) / 60_000),
    minNoticeHours: typeof j.min_notice_hours === "number" ? j.min_notice_hours : 2,
    maxDaysAhead: typeof j.max_days_ahead === "number" ? j.max_days_ahead : 30,
  };
}

export interface HorasParaReagendar {
  zona: string;
  dias: DiaDisponible[];
  siguienteDesde: string | null;
}

export const horasParaReagendar = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: TokenSchema,
        desde: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<HorasParaReagendar> => {
    exigirLimiteDeReserva(ipYNavegador().ip);
    const { appointmentId, clinicId } = citaDelToken(data.token);
    const c = await datosParaReagendar(appointmentId, clinicId);
    const db = await admin();
    const entrada = await armarEntradaHoras(db, {
      clinicId,
      sucursalId: c.sucursalId,
      zona: c.zona,
      profesionales: [{ id: c.profesionalId, sucursalId: c.sucursalId }],
      profesionalIds: [c.profesionalId],
      duracion: c.duracion,
      minNoticeHours: c.minNoticeHours,
      maxDaysAhead: c.maxDaysAhead,
      desde: data.desde,
      dias: 14,
      ignorarCitaId: appointmentId,
    });
    const dias = horasDisponibles(entrada);
    const ultimo = dias[dias.length - 1]?.fecha ?? null;
    let siguienteDesde: string | null = null;
    if (ultimo && ultimo < entrada.ultimoDia) {
      const d = new Date(`${ultimo}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      siguienteDesde = d.toISOString().slice(0, 10);
    }
    return { zona: c.zona, dias, siguienteDesde };
  });

export const reagendarMiCita = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: TokenSchema,
        inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Horario inválido."),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<Resultado> => {
    exigirLimiteDeReserva(ipYNavegador().ip);
    const { appointmentId, clinicId } = citaDelToken(data.token);
    const c = await datosParaReagendar(appointmentId, clinicId);
    const hora = partirHoraLocal(data.inicio);
    if (!hora) throw new Error(mensajeDeReserva("invalida"));
    const db = await admin();
    const entrada = await armarEntradaHoras(db, {
      clinicId,
      sucursalId: c.sucursalId,
      zona: c.zona,
      profesionales: [{ id: c.profesionalId, sucursalId: c.sucursalId }],
      profesionalIds: [c.profesionalId],
      duracion: c.duracion,
      minNoticeHours: c.minNoticeHours,
      maxDaysAhead: c.maxDaysAhead,
      desde: hora.fecha,
      dias: 1,
      ignorarCitaId: appointmentId,
    });
    const libre = horaSigueLibre(entrada, hora.fecha, hora.minutos, c.profesionalId);
    if (!libre) return { ok: false, motivo: mensajeDeReserva("ocupado") };
    const { data: r, error } = await db.rpc("cita_gestion_reagendar", {
      p_appointment_id: appointmentId,
      p_clinic_id: clinicId,
      p_starts_at: wallTimeInTzToUtc(data.inicio, c.zona).toISOString(),
      p_operatory_id: libre.boxId,
    });
    if (error) throw new Error("No pudimos cambiar tu hora. Vuelve a intentarlo.");
    return resultado(r);
  });
