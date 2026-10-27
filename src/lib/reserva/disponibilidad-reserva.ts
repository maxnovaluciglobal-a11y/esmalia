import { addDaysISO } from "@/lib/clinic-operations/agenda-fechas";
import {
  DIA_INICIO,
  estaLibre,
  franjasDeDisponibilidad,
  seCruzan,
  sucursalesPorProfesional,
  tramoDelDia,
  tramosAtendidos,
  tramosNoAgendables,
  atiendeEnSucursal,
  type ContextoSugerencia,
  type Tramo,
} from "@/lib/clinic-operations/disponibilidad";

/**
 * Horas que la reserva en línea ofrece (RES-01/02). No es un motor nuevo:
 * arma la lista con las mismas piezas que la agenda usa para validar y
 * sugerir (`tramosAtendidos`, `estaLibre`, `franjasDeDisponibilidad`):
 *
 * - horario del profesional en la sucursal (AGE-23) o, si no declaró, el de
 *   la sucursal; nunca la "jornada por defecto" que la agenda usa para
 *   sugerir: si nadie declaró horario, no se ofrece nada;
 * - sin bloqueos, fuera del horario de la sucursal ni encima de otra cita del
 *   profesional (las canceladas no llegan acá);
 * - un box libre si la sucursal tiene boxes (el del profesional primero);
 * - anticipación mínima y máxima de la clínica.
 *
 * Todo en minutos desde HORA_INICIO y hora de pared de la sucursal.
 */

export interface BoxReserva {
  id: string;
  sucursalId: string;
}

export interface OcupacionBox {
  boxId: string;
  fecha: string;
  inicio: number;
  duracion: number;
  citaId?: string;
}

export interface EntradaHoras {
  ctx: ContextoSugerencia;
  sucursalId: string;
  /** Profesionales candidatos, en orden de preferencia (ya filtrados: atienden). */
  profesionalIds: readonly string[];
  duracion: number;
  /** Primer día a mirar (YYYY-MM-DD). */
  desde: string;
  dias: number;
  /** Lo más temprano que se puede reservar (ahora + anticipación), hora local. */
  minimo: { fecha: string; minutos: number };
  /** Último día reservable (hoy + días hacia adelante). */
  ultimoDia: string;
  boxes: readonly BoxReserva[];
  ocupacionBoxes: readonly OcupacionBox[];
  boxPorDefecto: Readonly<Record<string, string | null>>;
  /** Al reagendar: la propia cita no ocupa su horario. */
  ignorarCitaId?: string;
}

export interface HoraDisponible {
  inicio: number;
  profesionalId: string;
  boxId: string | null;
}

export interface DiaDisponible {
  fecha: string;
  horas: HoraDisponible[];
}

/** ¿Declaró alguien horario para este profesional en esta sucursal? */
function tieneHorarioDeclarado(ctx: ContextoSugerencia, profId: string, sucursalId: string) {
  const propio = ctx.horarios[profId] ?? [];
  if (propio.length > 0) return true;
  return (ctx.horarioSucursal?.[sucursalId] ?? []).length > 0;
}

function boxLibre(e: EntradaHoras, profId: string, fecha: string, ocupa: Tramo): string | null {
  const deLaSucursal = e.boxes.filter((b) => b.sucursalId === e.sucursalId);
  const preferido = e.boxPorDefecto[profId] ?? null;
  const orden = [
    ...deLaSucursal.filter((b) => b.id === preferido),
    ...deLaSucursal.filter((b) => b.id !== preferido),
  ];
  for (const b of orden) {
    const ocupado = e.ocupacionBoxes.some(
      (o) =>
        o.boxId === b.id &&
        o.fecha === fecha &&
        o.citaId !== e.ignorarCitaId &&
        seCruzan({ inicio: o.inicio, fin: o.inicio + o.duracion }, ocupa),
    );
    if (ocupado) continue;
    const bloqueado = e.ctx.excepciones.some((x) => {
      if (x.tipo !== "bloqueo" || x.boxId !== b.id || x.profesionalId) return false;
      const t = tramoDelDia(x, fecha);
      return Boolean(t && seCruzan(t, ocupa));
    });
    if (!bloqueado) return b.id;
  }
  return null;
}

/** Horas libres de un profesional en un día (con su box). */
function horasDelProfesional(e: EntradaHoras, profId: string, fecha: string): HoraDisponible[] {
  const { ctx } = e;
  if (!tieneHorarioDeclarado(ctx, profId, e.sucursalId)) return [];
  const prof = ctx.profesionales.find((p) => p.id === profId);
  if (!prof || prof.atiende === false) return [];
  if (!atiendeEnSucursal(prof, e.sucursalId, ctx.horarios[profId])) return [];

  const sucursales = sucursalesPorProfesional(ctx.horarios)[profId];
  const noAgendables = tramosNoAgendables(
    franjasDeDisponibilidad({
      fecha,
      destino: {
        profesionalId: profId,
        sucursalId: e.sucursalId,
        sucursalesDelProfesional: sucursales,
      },
      excepciones: ctx.excepciones,
      horarioSucursal: ctx.horarioSucursal?.[e.sucursalId],
    }),
  );
  const paso = Math.max(5, ctx.paso);
  const hayBoxes = e.boxes.some((b) => b.sucursalId === e.sucursalId);
  const out: HoraDisponible[] = [];
  for (const t of tramosAtendidos(ctx, profId, e.sucursalId, fecha)) {
    const primero = Math.ceil((t.inicio - DIA_INICIO) / paso) * paso + DIA_INICIO;
    for (let m = primero; m + e.duracion <= t.fin; m += paso) {
      if (fecha === e.minimo.fecha && m < e.minimo.minutos) continue;
      const ocupa = { inicio: m, fin: m + e.duracion };
      if (noAgendables.some((x) => seCruzan(x, ocupa))) continue;
      const hueco = {
        profesionalId: profId,
        sucursalId: e.sucursalId,
        fecha,
        inicio: m,
        duracion: e.duracion,
      };
      if (!estaLibre(ctx, hueco, e.ignorarCitaId)) continue;
      const boxId = hayBoxes ? boxLibre(e, profId, fecha, ocupa) : null;
      if (hayBoxes && !boxId) continue;
      out.push({ inicio: m, profesionalId: profId, boxId });
    }
  }
  return out;
}

/**
 * Días con sus horas libres. Con varios profesionales, cada hora va al
 * primero libre según el orden recibido (el paciente elige la hora, no la
 * persona, cuando dijo "cualquiera").
 */
export function horasDisponibles(e: EntradaHoras): DiaDisponible[] {
  const dias: DiaDisponible[] = [];
  for (let d = 0; d < e.dias; d++) {
    const fecha = addDaysISO(e.desde, d);
    if (fecha > e.ultimoDia) break;
    if (fecha < e.minimo.fecha) {
      dias.push({ fecha, horas: [] });
      continue;
    }
    const porHora = new Map<number, HoraDisponible>();
    for (const profId of e.profesionalIds) {
      for (const h of horasDelProfesional(e, profId, fecha)) {
        if (!porHora.has(h.inicio)) porHora.set(h.inicio, h);
      }
    }
    dias.push({ fecha, horas: [...porHora.values()].sort((a, b) => a.inicio - b.inicio) });
  }
  return dias;
}

/** ¿Sigue libre esta hora exacta? (se vuelve a mirar justo antes de crear). */
export function horaSigueLibre(
  e: Omit<EntradaHoras, "desde" | "dias">,
  fecha: string,
  inicio: number,
  profesionalId: string,
): HoraDisponible | null {
  const dia = horasDisponibles({ ...e, profesionalIds: [profesionalId], desde: fecha, dias: 1 });
  return dia[0]?.horas.find((h) => h.inicio === inicio) ?? null;
}
