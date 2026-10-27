import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import {
  DispositivoInvalido,
  exigirDispositivo,
  type Dispositivo,
} from "@/lib/dispositivos/dispositivo.server";
import { esTokenValido, generarSecreto, huellaDeSecreto } from "@/lib/firma-distancia/token";
import { fetchPatientBalances } from "@/lib/patients/patients.functions";
import {
  horasDisponibles,
  horaSigueLibre,
  type DiaDisponible,
} from "@/lib/reserva/disponibilidad-reserva";
import { partirHoraLocal } from "@/lib/reserva/hora-local";
import type { MotivoReserva } from "@/lib/reserva/reserva";
import {
  armarEntradaHoras,
  leerContextoPublico,
  type ContextoPublico,
} from "@/lib/reserva/reserva-db.server";
import { IdentificacionSchema, mensajeDeTotem, normalizarVerificacion } from "@/lib/totem/totem";

/**
 * Tótem de la sala de espera (AUT-01 check-in, AUT-02 agendar, AUT-03 saldo).
 *
 * Sin login: el tótem manda su token de dispositivo y, después de
 * identificar al paciente, el secreto de la sesión (3 minutos, vive solo en
 * la memoria de la página). Todo se ejecuta con el rol de servicio en
 * funciones que exigen un tótem vigente y lo acotan a su clínica y su
 * sucursal. Nada clínico sale de acá: nombre de pila, citas de hoy (hora,
 * profesional, estado) y el saldo.
 */

const TokenSchema = z.string().max(80);
const SesionSchema = z.string().max(80);

type Resultado<T> = { invalido: true } | ({ invalido: false } & T);

async function conTotem<T>(
  token: string,
  fn: (d: Dispositivo, db: Awaited<ReturnType<typeof exigirDispositivo>>["db"]) => Promise<T>,
): Promise<Resultado<T>> {
  try {
    const { db, dispositivo } = await exigirDispositivo(token, "totem");
    return { invalido: false, ...(await fn(dispositivo, db)) };
  } catch (e) {
    if (e instanceof DispositivoInvalido) return { invalido: true };
    throw e;
  }
}

async function huellaDeSesion(sesion: string): Promise<string | null> {
  return esTokenValido(sesion) ? huellaDeSecreto(sesion) : null;
}

// ─── Identificarse ────────────────────────────────────────────────────────

export type Identificacion = { ok: true; sesion: string } | { ok: false; motivo: string };

export const identificarEnTotem = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: TokenSchema, datos: IdentificacionSchema }).parse(input),
  )
  .handler(async ({ data }): Promise<Resultado<{ identificacion: Identificacion }>> =>
    conTotem(data.token, async (d, db) => {
      const valor = normalizarVerificacion(data.datos.valor);
      if (!valor) {
        return { identificacion: { ok: false, motivo: "Escribe los 4 dígitos." } };
      }
      const sesion = generarSecreto();
      const { data: res, error } = await db.rpc("totem_identificar", {
        p_device_id: d.id,
        p_rut: data.datos.rut,
        p_tipo: data.datos.tipo,
        p_valor: valor,
        p_session_hash: await huellaDeSecreto(sesion),
      });
      if (error) throw new Error("No pudimos revisar tus datos. Vuelve a intentarlo.");
      const j = (res ?? {}) as Record<string, unknown>;
      if (j.ok !== true) {
        const motivo = typeof j.motivo === "string" ? j.motivo : null;
        const restantes = typeof j.restantes === "number" ? j.restantes : null;
        return { identificacion: { ok: false, motivo: mensajeDeTotem(motivo, restantes) } };
      }
      return { identificacion: { ok: true, sesion } };
    }),
  );

// ─── Resumen: citas de hoy y saldo ────────────────────────────────────────

export interface CitaDeHoyTotem {
  id: string;
  inicio: string;
  fin: string;
  profesional: string;
  estado: string;
  turno: number | null;
  puedeLlegar: boolean;
}

export interface ResumenTotem {
  nombre: string;
  zona: string;
  citas: CitaDeHoyTotem[];
  /** Saldo pendiente en cents; null si no hay nada facturado (no es cero). */
  saldoCents: number | null;
  moneda: string;
  puedeAgendar: boolean;
}

export type Resumen = { ok: true; resumen: ResumenTotem } | { ok: false; motivo: string };

export const resumenDelTotem = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: TokenSchema, sesion: SesionSchema }).parse(input),
  )
  .handler(async ({ data }): Promise<Resultado<{ resultado: Resumen }>> =>
    conTotem(data.token, async (d, db) => {
      const huella = await huellaDeSesion(data.sesion);
      if (!huella) return { resultado: { ok: false, motivo: mensajeDeTotem("sesion") } };
      const { data: res, error } = await db.rpc("totem_resumen", {
        p_device_id: d.id,
        p_session_hash: huella,
      });
      if (error) throw new Error("No pudimos leer tus citas. Vuelve a intentarlo.");
      const j = (res ?? {}) as Record<string, unknown>;
      if (j.ok !== true || typeof j.patient_id !== "string") {
        return { resultado: { ok: false, motivo: mensajeDeTotem("sesion") } };
      }
      // AUT-03: la misma fuente de saldo que la ficha y la agenda.
      const [saldos, puedeAgendar] = await Promise.all([
        fetchPatientBalances(db, d.clinicId, j.patient_id),
        reservaActiva(db, d.clinicId),
      ]);
      const s = saldos.get(j.patient_id);
      const citas: CitaDeHoyTotem[] = (Array.isArray(j.citas) ? j.citas : []).flatMap((c) => {
        const x = (c ?? {}) as Record<string, unknown>;
        if (typeof x.id !== "string" || typeof x.inicio !== "string" || typeof x.fin !== "string")
          return [];
        return [
          {
            id: x.id,
            inicio: x.inicio,
            fin: x.fin,
            profesional: typeof x.profesional === "string" ? x.profesional : "Profesional",
            estado: typeof x.estado === "string" ? x.estado : "tentativa",
            turno: typeof x.turno === "number" ? x.turno : null,
            puedeLlegar: x.puede_llegar === true,
          },
        ];
      });
      return {
        resultado: {
          ok: true,
          resumen: {
            nombre: typeof j.nombre === "string" && j.nombre ? j.nombre : "Hola",
            zona: d.zona,
            citas,
            saldoCents: s ? Math.max(0, s.billedCents - s.paidCents) : null,
            moneda: d.moneda ?? "CLP",
            puedeAgendar,
          },
        },
      };
    }),
  );

async function reservaActiva(
  db: Awaited<ReturnType<typeof exigirDispositivo>>["db"],
  clinicId: string,
): Promise<boolean> {
  const { data } = await db
    .from("online_booking_settings")
    .select("enabled")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!data?.enabled) return false;
  const { clinicaEnSoloLectura } = await import("@/lib/solo-lectura.server");
  return !(await clinicaEnSoloLectura(db, clinicId));
}

// ─── Marcar llegada (AUT-01) ──────────────────────────────────────────────

export type Llegada =
  { ok: true; turno: number | null; yaEstaba: boolean } | { ok: false; motivo: string };

export const marcarLlegadaEnTotem = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ token: TokenSchema, sesion: SesionSchema, appointmentId: z.string().uuid() })
      .parse(input),
  )
  .handler(async ({ data }): Promise<Resultado<{ llegada: Llegada }>> =>
    conTotem(data.token, async (d, db) => {
      const huella = await huellaDeSesion(data.sesion);
      if (!huella) return { llegada: { ok: false, motivo: mensajeDeTotem("sesion") } };
      const { data: res, error } = await db.rpc("totem_marcar_llegada", {
        p_device_id: d.id,
        p_session_hash: huella,
        p_appointment_id: data.appointmentId,
      });
      if (error) throw new Error("No pudimos marcar tu llegada. Acércate a recepción.");
      const j = (res ?? {}) as Record<string, unknown>;
      if (j.ok !== true) {
        return {
          llegada: {
            ok: false,
            motivo: mensajeDeTotem(typeof j.motivo === "string" ? j.motivo : null),
          },
        };
      }
      return {
        llegada: {
          ok: true,
          turno: typeof j.turno === "number" ? j.turno : null,
          yaEstaba: j.ya_estaba === true,
        },
      };
    }),
  );

// ─── Agendar (AUT-02): el motor de la reserva en línea ───────────────────

/** Contexto de la reserva en línea de la clínica, acotado a la sucursal del tótem. */
async function contextoDelTotem(
  db: Awaited<ReturnType<typeof exigirDispositivo>>["db"],
  d: Dispositivo,
): Promise<ContextoPublico | null> {
  if (!(await reservaActiva(db, d.clinicId))) return null;
  const { data: ajustes } = await db
    .from("online_booking_settings")
    .select("slug")
    .eq("clinic_id", d.clinicId)
    .maybeSingle();
  if (!ajustes?.slug) return null;
  const lectura = await leerContextoPublico(db, ajustes.slug);
  if (lectura.estado !== "activa" || lectura.contexto.clinicId !== d.clinicId) return null;
  const c = lectura.contexto;
  const sucursal = c.sucursales.find((s) => s.id === d.branchId);
  if (!sucursal) return null;
  return {
    ...c,
    sucursales: [sucursal],
    profesionales: c.profesionales.filter(
      (p) => p.sucursalId === null || p.sucursalId === d.branchId,
    ),
  };
}

export interface OpcionesAgendar {
  motivos: MotivoReserva[];
  profesionales: { id: string; nombre: string }[];
}

export type Opciones = { ok: true; opciones: OpcionesAgendar } | { ok: false; motivo: string };

export const opcionesParaAgendar = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: TokenSchema, sesion: SesionSchema }).parse(input),
  )
  .handler(async ({ data }): Promise<Resultado<{ resultado: Opciones }>> =>
    conTotem(data.token, async (d, db) => {
      if (!(await sesionVigente(db, d, data.sesion))) {
        return { resultado: { ok: false, motivo: mensajeDeTotem("sesion") } };
      }
      const c = await contextoDelTotem(db, d);
      if (!c || c.motivos.length === 0 || c.profesionales.length === 0) {
        return { resultado: { ok: false, motivo: mensajeDeTotem("apagada") } };
      }
      return {
        resultado: {
          ok: true,
          opciones: {
            motivos: c.motivos,
            profesionales: c.profesionales.map((p) => ({ id: p.id, nombre: p.nombre })),
          },
        },
      };
    }),
  );

async function sesionVigente(
  db: Awaited<ReturnType<typeof exigirDispositivo>>["db"],
  d: Dispositivo,
  sesion: string,
): Promise<boolean> {
  const huella = await huellaDeSesion(sesion);
  if (!huella) return false;
  const { data, error } = await db.rpc("totem_paciente_de_sesion", {
    p_device_id: d.id,
    p_session_hash: huella,
  });
  return !error && typeof data === "string";
}

const MotivoSchema = z.object({ tipo: z.enum(["procedimiento", "tipo"]), id: z.string().uuid() });
const DIAS_POR_PAGINA = 7;

export interface HorasTotem {
  zona: string;
  dias: DiaDisponible[];
  siguienteDesde: string | null;
}

export type Horas = { ok: true; horas: HorasTotem } | { ok: false; motivo: string };

export const horasParaAgendar = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: TokenSchema,
        sesion: SesionSchema,
        motivo: MotivoSchema,
        profesionalId: z.string().uuid().nullable(),
        desde: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<Resultado<{ resultado: Horas }>> =>
    conTotem(data.token, async (d, db) => {
      if (!(await sesionVigente(db, d, data.sesion))) {
        return { resultado: { ok: false, motivo: mensajeDeTotem("sesion") } };
      }
      const c = await contextoDelTotem(db, d);
      const sucursal = c?.sucursales[0];
      const motivo = c?.motivos.find((m) => m.tipo === data.motivo.tipo && m.id === data.motivo.id);
      if (!c || !sucursal || !motivo) {
        return { resultado: { ok: false, motivo: mensajeDeTotem("apagada") } };
      }
      const candidatos = data.profesionalId
        ? c.profesionales.filter((p) => p.id === data.profesionalId)
        : c.profesionales;
      if (candidatos.length === 0) {
        return { resultado: { ok: false, motivo: mensajeDeTotem(null) } };
      }
      const entrada = await armarEntradaHoras(db, {
        clinicId: d.clinicId,
        sucursalId: sucursal.id,
        zona: sucursal.zona,
        profesionales: c.profesionales,
        profesionalIds: candidatos.map((p) => p.id),
        duracion: motivo.duracion,
        minNoticeHours: c.minNoticeHours,
        maxDaysAhead: c.maxDaysAhead,
        desde: data.desde,
        dias: DIAS_POR_PAGINA,
      });
      const dias = horasDisponibles(entrada);
      const ultimo = dias[dias.length - 1]?.fecha ?? null;
      const hayMas = Boolean(ultimo && ultimo < entrada.ultimoDia);
      return {
        resultado: {
          ok: true,
          horas: {
            zona: sucursal.zona,
            dias,
            siguienteDesde: hayMas && ultimo ? diaSiguiente(ultimo) : null,
          },
        },
      };
    }),
  );

function diaSiguiente(fecha: string): string {
  const x = new Date(`${fecha}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

export type Agendada =
  { ok: true; inicio: string; fin: string; zona: string } | { ok: false; motivo: string };

export const agendarEnTotem = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: TokenSchema,
        sesion: SesionSchema,
        motivo: MotivoSchema,
        profesionalId: z.string().uuid(),
        /** Hora de pared de la sucursal: "YYYY-MM-DDTHH:mm". */
        inicio: z.string().max(16),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<Resultado<{ resultado: Agendada }>> =>
    conTotem(data.token, async (d, db) => {
      const huella = await huellaDeSesion(data.sesion);
      if (!huella) return { resultado: { ok: false, motivo: mensajeDeTotem("sesion") } };
      const c = await contextoDelTotem(db, d);
      const sucursal = c?.sucursales[0];
      const motivo = c?.motivos.find((m) => m.tipo === data.motivo.tipo && m.id === data.motivo.id);
      const prof = c?.profesionales.find((p) => p.id === data.profesionalId);
      const hora = partirHoraLocal(data.inicio);
      if (!c || !sucursal || !motivo || !prof || !hora) {
        return { resultado: { ok: false, motivo: mensajeDeTotem("apagada") } };
      }
      // Misma revisión que la reserva en línea justo antes de crear.
      const entrada = await armarEntradaHoras(db, {
        clinicId: d.clinicId,
        sucursalId: sucursal.id,
        zona: sucursal.zona,
        profesionales: c.profesionales,
        profesionalIds: [prof.id],
        duracion: motivo.duracion,
        minNoticeHours: c.minNoticeHours,
        maxDaysAhead: c.maxDaysAhead,
        desde: hora.fecha,
        dias: 1,
      });
      const libre = horaSigueLibre(entrada, hora.fecha, hora.minutos, prof.id);
      if (!libre) return { resultado: { ok: false, motivo: mensajeDeTotem("ocupado") } };

      const reserva: Json = {
        professional_id: prof.id,
        procedure_id: motivo.tipo === "procedimiento" ? motivo.id : null,
        appointment_type_id: motivo.tipo === "tipo" ? motivo.id : null,
        operatory_id: libre.boxId,
        starts_at: wallTimeInTzToUtc(data.inicio, sucursal.zona).toISOString(),
      };
      const { data: res, error } = await db.rpc("totem_agendar", {
        p_device_id: d.id,
        p_session_hash: huella,
        p_reserva: reserva,
      });
      if (error) throw new Error("No pudimos agendar tu hora. Acércate a recepción.");
      const j = (res ?? {}) as Record<string, unknown>;
      if (j.ok !== true) {
        return {
          resultado: {
            ok: false,
            motivo: mensajeDeTotem(typeof j.motivo === "string" ? j.motivo : null),
          },
        };
      }
      return {
        resultado: {
          ok: true,
          inicio: String(j.starts_at),
          fin: String(j.ends_at),
          zona: sucursal.zona,
        },
      };
    }),
  );

// ─── Terminar (vuelta a la pantalla inicial) ──────────────────────────────

export const terminarSesionDelTotem = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: TokenSchema, sesion: SesionSchema }).parse(input),
  )
  .handler(async ({ data }): Promise<Resultado<{ ok: true }>> =>
    conTotem(data.token, async (d, db) => {
      const huella = await huellaDeSesion(data.sesion);
      if (huella) {
        await db.rpc("totem_terminar", { p_device_id: d.id, p_session_hash: huella });
      }
      return { ok: true as const };
    }),
  );
