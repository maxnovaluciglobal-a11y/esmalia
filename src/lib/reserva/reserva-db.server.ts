import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { addDaysISO } from "@/lib/clinic-operations/agenda-fechas";
import type { BloqueSemanal, CitaDisponibilidad } from "@/lib/clinic-operations/disponibilidad";
import {
  COLUMNAS_EXCEPCION,
  leerAjustesAgenda,
  mapExcepcion,
} from "@/lib/clinic-operations/disponibilidad-db";
import type { EntradaHoras, OcupacionBox } from "@/lib/reserva/disponibilidad-reserva";
import { momentoLocal } from "@/lib/reserva/hora-local";
import { slugsDeProfesionales, type MotivoReserva } from "@/lib/reserva/reserva";
import { checkRateLimit } from "@/lib/rate-limit.server";

/**
 * Lecturas de la reserva en línea con el rol de servicio (la página es
 * pública). Todo queda acotado a la clínica del slug: cada consulta filtra
 * por `clinic_id` y el contexto lo arma la función `reserva_en_linea_contexto`
 * (solo clínicas con la reserva encendida).
 */

type Db = SupabaseClient<Database>;

export interface SucursalPublica {
  id: string;
  nombre: string;
  direccion: string | null;
  ciudad: string | null;
  zona: string;
}

export interface ProfesionalPublico {
  id: string;
  nombre: string;
  sucursalId: string | null;
  boxId: string | null;
  slug: string;
}

export interface ContextoPublico {
  clinicId: string;
  clinica: string;
  zona: string;
  pais: string | null;
  nota: string | null;
  minNoticeHours: number;
  maxDaysAhead: number;
  sucursales: SucursalPublica[];
  profesionales: ProfesionalPublico[];
  motivos: MotivoReserva[];
}

export type LecturaContexto =
  | { estado: "activa"; contexto: ContextoPublico }
  | { estado: "apagada"; clinica: string | null }
  | { estado: "no_existe" };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const numero = (v: unknown, def: number): number => (typeof v === "number" ? v : def);

export async function leerContextoPublico(db: Db, slug: string): Promise<LecturaContexto> {
  const { data, error } = await db.rpc("reserva_en_linea_contexto", { p_slug: slug });
  if (error) throw new Error("No pudimos abrir la reserva. Vuelve a intentarlo.");
  const j = obj(data);
  const estado = texto(j.estado);
  if (estado === "apagada") return { estado, clinica: texto(j.clinica) };
  if (estado !== "activa") return { estado: "no_existe" };

  const profesionalesBase = lista(j.profesionales).map((p) => ({
    id: String(p.id),
    nombre: texto(p.nombre) ?? "Profesional",
    sucursalId: texto(p.sucursal_id),
    boxId: texto(p.box_id),
  }));
  const slugs = slugsDeProfesionales(profesionalesBase);
  const motivos: MotivoReserva[] = [
    ...lista(j.procedimientos).map((m) => ({
      tipo: "procedimiento" as const,
      id: String(m.id),
      nombre: texto(m.nombre) ?? "Atención",
      duracion: numero(m.duracion, 30),
    })),
    ...lista(j.tipos).map((m) => ({
      tipo: "tipo" as const,
      id: String(m.id),
      nombre: texto(m.nombre) ?? "Consulta",
      duracion: numero(m.duracion, 30),
    })),
  ];
  return {
    estado: "activa",
    contexto: {
      clinicId: String(j.clinic_id),
      clinica: texto(j.clinica) ?? "Clínica",
      zona: texto(j.zona) ?? "America/Santiago",
      pais: texto(j.pais),
      nota: texto(j.nota),
      minNoticeHours: numero(j.min_notice_hours, 2),
      maxDaysAhead: numero(j.max_days_ahead, 30),
      sucursales: lista(j.sucursales).map((s) => ({
        id: String(s.id),
        nombre: texto(s.nombre) ?? "Sucursal",
        direccion: texto(s.direccion),
        ciudad: texto(s.ciudad),
        zona: texto(s.zona) ?? texto(j.zona) ?? "America/Santiago",
      })),
      profesionales: profesionalesBase.map((p) => ({ ...p, slug: slugs.get(p.id) ?? p.id })),
      motivos,
    },
  };
}

/** Datos para calcular horas libres en una sucursal y una ventana de días. */
export async function armarEntradaHoras(
  db: Db,
  p: {
    clinicId: string;
    sucursalId: string;
    zona: string;
    profesionales: readonly { id: string; sucursalId: string | null }[];
    profesionalIds: readonly string[];
    duracion: number;
    minNoticeHours: number;
    maxDaysAhead: number;
    desde?: string;
    dias: number;
    ignorarCitaId?: string;
    ahora?: Date;
  },
): Promise<EntradaHoras> {
  const ahora = p.ahora ?? new Date();
  const minimo = momentoLocal(new Date(ahora.getTime() + p.minNoticeHours * 3_600_000), p.zona);
  const hoy = momentoLocal(ahora, p.zona).fecha;
  const ultimoDia = momentoLocal(
    new Date(ahora.getTime() + p.maxDaysAhead * 86_400_000),
    p.zona,
  ).fecha;
  const desde = p.desde && p.desde > hoy ? p.desde : hoy;
  const hasta = addDaysISO(desde, p.dias);
  // Ventana en UTC con un día de margen por el huso.
  const desdeUtc = new Date(`${addDaysISO(desde, -1)}T00:00:00Z`).toISOString();
  const hastaUtc = new Date(`${addDaysISO(hasta, 1)}T00:00:00Z`).toISOString();

  const [ajustes, horasSucursal, horarios, excepciones, boxes, citas, defaults] = await Promise.all(
    [
      leerAjustesAgenda(db, p.clinicId),
      db
        .from("branch_hours")
        .select("day_of_week, opens_at, closes_at")
        .eq("clinic_id", p.clinicId)
        .eq("branch_id", p.sucursalId),
      p.profesionalIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : db
            .from("professional_schedules")
            .select("professional_id, day_of_week, start_time, end_time, branch_id")
            .eq("clinic_id", p.clinicId)
            .in("professional_id", [...p.profesionalIds]),
      db
        .from("agenda_exceptions")
        .select(COLUMNAS_EXCEPCION)
        .eq("clinic_id", p.clinicId)
        .lt("starts_local", `${hasta}T23:59`),
      db
        .from("operatories")
        .select("id, branch_id")
        .eq("clinic_id", p.clinicId)
        .eq("branch_id", p.sucursalId)
        .eq("is_active", true),
      db
        .from("appointments")
        .select("id, professional_id, branch_id, operatory_id, starts_at, ends_at, status")
        .eq("clinic_id", p.clinicId)
        .neq("status", "cancelada")
        .lt("starts_at", hastaUtc)
        .gt("ends_at", desdeUtc)
        .limit(5000),
      db.from("professionals").select("id, default_operatory_id").eq("clinic_id", p.clinicId),
    ],
  );
  for (const r of [horasSucursal, horarios, excepciones, boxes, citas, defaults]) {
    if (r.error) throw new Error("No pudimos revisar la disponibilidad. Vuelve a intentarlo.");
  }

  const bloquesSucursal: BloqueSemanal[] = (horasSucursal.data ?? []).map((f) => ({
    dayOfWeek: f.day_of_week,
    startTime: f.opens_at.slice(0, 5),
    endTime: f.closes_at.slice(0, 5),
  }));
  const porProfesional: Record<string, BloqueSemanal[]> = {};
  for (const f of horarios.data ?? []) {
    (porProfesional[f.professional_id] ??= []).push({
      dayOfWeek: f.day_of_week,
      startTime: f.start_time.slice(0, 5),
      endTime: f.end_time.slice(0, 5),
      branchId: f.branch_id,
    });
  }

  const boxPorDefecto: Record<string, string | null> = {};
  for (const d of defaults.data ?? []) boxPorDefecto[d.id] = d.default_operatory_id;

  const citasCtx: CitaDisponibilidad[] = [];
  const ocupacionBoxes: OcupacionBox[] = [];
  for (const c of citas.data ?? []) {
    const ini = momentoLocal(c.starts_at, p.zona);
    const duracion = Math.round(
      (new Date(c.ends_at).getTime() - new Date(c.starts_at).getTime()) / 60_000,
    );
    citasCtx.push({
      id: c.id,
      profesionalId: c.professional_id,
      sucursalId: c.branch_id,
      fecha: ini.fecha,
      inicio: ini.minutos,
      duracion,
      estado: c.status,
    });
    if (c.status === "ausente") continue;
    // Box efectivo: el de la cita o, si no tiene, el del profesional (como
    // el aviso de choques de la agenda).
    const boxId = c.operatory_id ?? boxPorDefecto[c.professional_id] ?? null;
    if (boxId && c.branch_id === p.sucursalId) {
      ocupacionBoxes.push({ boxId, fecha: ini.fecha, inicio: ini.minutos, duracion, citaId: c.id });
    }
  }

  const excepcionesCtx = (excepciones.data ?? [])
    .filter((f) => f.repeat_weekly || f.ends_local.slice(0, 10) >= desde)
    .map((f) => mapExcepcion(f));

  return {
    ctx: {
      profesionales: p.profesionales.map((x) => ({
        id: x.id,
        sucursalId: x.sucursalId ?? "",
        atiende: true,
      })),
      horarios: porProfesional,
      horarioSucursal: { [p.sucursalId]: bloquesSucursal },
      citas: citasCtx,
      excepciones: excepcionesCtx,
      paso: ajustes.pasoMin,
    },
    sucursalId: p.sucursalId,
    profesionalIds: p.profesionalIds,
    duracion: p.duracion,
    desde,
    dias: p.dias,
    minimo,
    ultimoDia,
    boxes: (boxes.data ?? []).map((b) => ({ id: b.id, sucursalId: b.branch_id })),
    ocupacionBoxes,
    boxPorDefecto,
    ignorarCitaId: p.ignorarCitaId,
  };
}

/**
 * Límite por IP en memoria para las páginas públicas de la reserva y de la
 * cita (además del de la base). 60 llamadas por minuto alcanzan para mirar
 * varias semanas de horas y reservar.
 */
export function exigirLimiteDeReserva(ip: string | null): void {
  const r = checkRateLimit(ip ?? "unknown", {
    scope: "reserva-en-linea",
    windowMs: 60_000,
    max: 60,
  });
  if (r.limited) {
    throw new Error(
      `Demasiados intentos seguidos. Espera ${r.retryAfterSeconds} segundos y vuelve a intentarlo.`,
    );
  }
}
