import { horaDeMinutos } from "@/components/agenda-hueco";
import { HORA_INICIO, PIXELES_POR_MINUTO, type Cita } from "@/lib/clinic-operations/clinic-data";
import { diaSemana } from "@/lib/formato-fecha";

/**
 * Lógica pura de "arrastrar para reprogramar" (PR 10 del plan A+).
 *
 * Todo trabaja en la misma unidad que `Cita.inicio`: minutos desde
 * HORA_INICIO, en hora de pared de la sucursal. El destino viaja al servidor
 * como `"YYYY-MM-DDTHH:mm"` crudo y allá se interpreta en el huso de la
 * sucursal (`wallTimeInTzToUtc`), igual que Nueva cita. Acá no se convierte
 * ningún huso, a propósito.
 *
 * Nada de esto reemplaza la validación del servidor
 * (`validarHorarioYSolapamiento`): sirve para mostrar la hora destino antes
 * de soltar y para no mandar un movimiento que se sabe inválido. Si el
 * horario cambió en otra pestaña, decide el servidor y la cita vuelve.
 */

/** Encaje por defecto: cuarto de hora, igual que los huecos de la grilla. */
export const PASO_ENCAJE_MIN = 15;
/** Encaje fino (con Shift): 5 minutos. */
export const PASO_FINO_MIN = 5;
/** Distancia mínima del puntero para que un clic pase a ser arrastre. */
export const UMBRAL_ARRASTRE_PX = 6;
/** En pantallas táctiles el arrastre empieza con una pulsación larga, para no pelear con el scroll. */
export const PULSACION_LARGA_MS = 300;

/** Solo se mueven las citas que todavía no pasaron (WCAG: nada se mueve "por accidente" tras atender). */
export const ESTADOS_MOVIBLES: ReadonlySet<Cita["estado"]> = new Set(["tentativa", "confirmada"]);

export function esMovible(cita: Pick<Cita, "estado">): boolean {
  return ESTADOS_MOVIBLES.has(cita.estado);
}

/** Píxeles → minutos (sin redondear). */
export function pxAMinutos(px: number, pxPorMinuto = PIXELES_POR_MINUTO): number {
  if (!Number.isFinite(px) || pxPorMinuto <= 0) return 0;
  return px / pxPorMinuto;
}

/** Encaje al múltiplo de `paso` más cercano. */
export function encajar(minutos: number, paso = PASO_ENCAJE_MIN): number {
  if (!Number.isFinite(minutos)) return 0;
  return Math.round(minutos / paso) * paso;
}

/** Deja la cita entera adentro de [desde, hasta]. */
export function limitarAlRango(
  inicio: number,
  duracion: number,
  rango: { desde: number; hasta: number },
): number {
  const max = Math.max(rango.desde, rango.hasta - duracion);
  return Math.min(max, Math.max(rango.desde, inicio));
}

/**
 * Inicio destino mientras se arrastra: el inicio original más lo que bajó el
 * puntero, encajado y sin salir de la grilla.
 */
export function inicioPorArrastre({
  inicioOriginal,
  deltaPx,
  duracion,
  rango,
  paso = PASO_ENCAJE_MIN,
  pxPorMinuto = PIXELES_POR_MINUTO,
}: {
  inicioOriginal: number;
  deltaPx: number;
  duracion: number;
  rango: { desde: number; hasta: number };
  paso?: number;
  pxPorMinuto?: number;
}): number {
  const crudo = inicioOriginal + pxAMinutos(deltaPx, pxPorMinuto);
  return limitarAlRango(encajar(crudo, paso), duracion, rango);
}

/**
 * Carril más cercano al puntero (por el centro de cada uno). Los carriles
 * con ancho 0 (ocultos en el celular) no cuentan. -1 si no hay ninguno.
 */
export function indiceDeCarril(x: number, carriles: { izquierda: number; derecha: number }[]) {
  let mejor = -1;
  let distancia = Number.POSITIVE_INFINITY;
  carriles.forEach((c, i) => {
    if (c.derecha - c.izquierda <= 0) return;
    if (x >= c.izquierda && x < c.derecha) {
      mejor = i;
      distancia = -1;
      return;
    }
    if (distancia < 0) return;
    const d = Math.abs(x - (c.izquierda + c.derecha) / 2);
    if (d < distancia) {
      distancia = d;
      mejor = i;
    }
  });
  return mejor;
}

// ── Horario declarado del profesional ─────────────────────────────────────

/** Lo que devuelve `listProfessionalSchedules` por profesional. */
export interface BloqueHorario {
  /** 0 = domingo … 6 = sábado (igual que Date.getDay()). */
  dayOfWeek: number;
  /** "HH:mm" */
  startTime: string;
  /** "HH:mm" */
  endTime: string;
}

/** Tramo atendido del día, en minutos desde HORA_INICIO. */
export interface Tramo {
  inicio: number;
  fin: number;
}

export interface HorarioDelDia {
  /**
   * El profesional declaró algún horario en la semana. Si no declaró nada,
   * no hay restricción (mismo criterio que el servidor: compatibilidad con
   * las clínicas que todavía no cargaron horarios).
   */
  declarado: boolean;
  /** Tramos de ese día, ordenados y sin solapes. Entre dos tramos está la colación. */
  tramos: Tramo[];
}

/** "09:30" → minutos desde HORA_INICIO. */
export function minutosDeHora(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0) - HORA_INICIO * 60;
}

/** Día de la semana de una fecha ISO (sin huso: es una fecha de calendario). */
export function diaSemanaDeFecha(fecha: string): number {
  const [y, mo, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, (mo || 1) - 1, d || 1)).getUTCDay();
}

export function horarioDelDia(bloques: BloqueHorario[] | undefined, fecha: string): HorarioDelDia {
  if (!bloques || bloques.length === 0) return { declarado: false, tramos: [] };
  const dia = diaSemanaDeFecha(fecha);
  const tramos = bloques
    .filter((b) => b.dayOfWeek === dia)
    .map((b) => ({ inicio: minutosDeHora(b.startTime), fin: minutosDeHora(b.endTime) }))
    .filter((t) => t.fin > t.inicio)
    .sort((a, b) => a.inicio - b.inicio);
  // Dos bloques que se tocan o se pisan son el mismo tramo.
  const unidos: Tramo[] = [];
  for (const t of tramos) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && t.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, t.fin);
    else unidos.push({ ...t });
  }
  return { declarado: true, tramos: unidos };
}

/** Huecos entre tramos del mismo día (la colación). */
export function colaciones(horario: HorarioDelDia): Tramo[] {
  const huecos: Tramo[] = [];
  for (let i = 1; i < horario.tramos.length; i++) {
    huecos.push({ inicio: horario.tramos[i - 1].fin, fin: horario.tramos[i].inicio });
  }
  return huecos;
}

/**
 * Horas de inicio posibles ese día (para "Mover a…"): dentro de los tramos
 * declarados, con la colación afuera, o de 07:00 a 21:00 si no hay horario.
 */
export function horasPosibles(
  bloques: BloqueHorario[] | undefined,
  fecha: string,
  duracion: number,
): number[] {
  const horario = horarioDelDia(bloques, fecha);
  const amplio = { inicio: minutosDeHora("07:00"), fin: minutosDeHora("21:00") };
  const tramos = horario.declarado ? horario.tramos : [amplio];
  const horas: number[] = [];
  for (const t of tramos) {
    for (let m = t.inicio; m + duracion <= t.fin; m += PASO_ENCAJE_MIN) horas.push(m);
  }
  return horas;
}

// ── Validación del destino ───────────────────────────────────────────────

export interface Destino {
  /** ISO yyyy-mm-dd */
  fecha: string;
  /** Minutos desde HORA_INICIO. */
  inicio: number;
  profesionalId: string;
}

export type MotivoRechazo =
  "sin-cambio" | "estado" | "no-atiende" | "fuera-de-horario" | "colacion" | "ocupado";

export type Veredicto = { ok: true } | { ok: false; motivo: MotivoRechazo; mensaje: string };

const NOMBRE_DIA = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

function seCruzan(a: Tramo, b: Tramo) {
  return a.inicio < b.fin && a.fin > b.inicio;
}

/**
 * ¿Se puede soltar acá? Mismo orden de chequeos que el servidor: primero el
 * horario declarado (bloqueo duro), después el choque. El choque en el
 * servidor es solo un aviso; en el arrastre se bloquea porque soltar encima
 * de otra cita casi siempre es un error de puntería, y quien quiera
 * sobreagendar a propósito tiene el diálogo de edición.
 */
export function validarDestino({
  cita,
  destino,
  horario,
  citasDelCarril,
  nombreProfesional,
}: {
  cita: Pick<Cita, "id" | "fecha" | "inicio" | "duracion" | "profesionalId" | "estado">;
  destino: Destino;
  horario: HorarioDelDia;
  /** Citas del profesional destino ese día (puede incluir la propia: se ignora). */
  citasDelCarril: Pick<Cita, "id" | "inicio" | "duracion">[];
  nombreProfesional: string;
}): Veredicto {
  if (
    destino.fecha === cita.fecha &&
    destino.inicio === cita.inicio &&
    destino.profesionalId === cita.profesionalId
  ) {
    return { ok: false, motivo: "sin-cambio", mensaje: "La cita quedó donde estaba." };
  }
  if (!esMovible(cita)) {
    return {
      ok: false,
      motivo: "estado",
      mensaje: "Solo se mueven citas por confirmar o confirmadas.",
    };
  }

  const ocupa: Tramo = { inicio: destino.inicio, fin: destino.inicio + cita.duracion };

  if (horario.declarado) {
    if (horario.tramos.length === 0) {
      return {
        ok: false,
        motivo: "no-atiende",
        mensaje: `${nombreProfesional} no atiende los ${NOMBRE_DIA[diaSemanaDeFecha(destino.fecha)]}.`,
      };
    }
    const cabe = horario.tramos.some((t) => ocupa.inicio >= t.inicio && ocupa.fin <= t.fin);
    if (!cabe) {
      if (colaciones(horario).some((c) => seCruzan(c, ocupa))) {
        return {
          ok: false,
          motivo: "colacion",
          mensaje: `Ese horario cae en la colación de ${nombreProfesional}. Elige otro.`,
        };
      }
      const rangos = horario.tramos
        .map((t) => `${horaDeMinutos(t.inicio)}–${horaDeMinutos(t.fin)}`)
        .join(" y ");
      return {
        ok: false,
        motivo: "fuera-de-horario",
        mensaje: `Fuera del horario de ${nombreProfesional} (${rangos}).`,
      };
    }
  }

  const choca = citasDelCarril.some(
    (c) => c.id !== cita.id && seCruzan({ inicio: c.inicio, fin: c.inicio + c.duracion }, ocupa),
  );
  if (choca) {
    return {
      ok: false,
      motivo: "ocupado",
      mensaje: `Ese horario ya está ocupado para ${nombreProfesional}. La cita quedó donde estaba.`,
    };
  }
  return { ok: true };
}

// ── Teclado ──────────────────────────────────────────────────────────────

export interface Carril {
  fecha: string;
  profesionalId: string;
}

/**
 * Alt + ↑/↓ mueve la cita un paso; Alt + ←/→ la pasa al carril vecino
 * (otro profesional en la vista de día; otro profesional u otro día en la
 * semana). null si la tecla no aplica o no hay carril hacia ese lado.
 */
export function destinoPorTeclado(
  cita: Pick<Cita, "fecha" | "inicio" | "duracion" | "profesionalId">,
  tecla: string,
  carriles: Carril[],
  rango: { desde: number; hasta: number },
  paso = PASO_ENCAJE_MIN,
): Destino | null {
  const actual: Destino = {
    fecha: cita.fecha,
    inicio: cita.inicio,
    profesionalId: cita.profesionalId,
  };
  if (tecla === "ArrowUp" || tecla === "ArrowDown") {
    const delta = tecla === "ArrowUp" ? -paso : paso;
    const inicio = limitarAlRango(cita.inicio + delta, cita.duracion, rango);
    return inicio === cita.inicio ? null : { ...actual, inicio };
  }
  if (tecla === "ArrowLeft" || tecla === "ArrowRight") {
    const i = carriles.findIndex(
      (c) => c.fecha === cita.fecha && c.profesionalId === cita.profesionalId,
    );
    const j = i + (tecla === "ArrowRight" ? 1 : -1);
    if (i < 0 || j < 0 || j >= carriles.length) return null;
    return { ...actual, fecha: carriles[j].fecha, profesionalId: carriles[j].profesionalId };
  }
  return null;
}

// ── Payload y cola sin conexión ──────────────────────────────────────────

/** Payload de `moveAppointment`: lo mismo online y en la cola, byte por byte. */
export interface PayloadReprogramar extends Record<string, unknown> {
  appointmentId: string;
  clinicId: string;
  professionalId: string;
  /** "YYYY-MM-DDTHH:mm", hora de pared de la sucursal. */
  startsAt: string;
}

export function startsAtDe(destino: Pick<Destino, "fecha" | "inicio">): string {
  return `${destino.fecha}T${horaDeMinutos(destino.inicio)}`;
}

export function payloadDeMovimiento(
  clinicId: string,
  citaId: string,
  destino: Destino,
): PayloadReprogramar {
  return {
    appointmentId: citaId,
    clinicId,
    professionalId: destino.profesionalId,
    startsAt: startsAtDe(destino),
  };
}

/** "2026-10-21T11:30" → { fecha, inicio } (minutos desde HORA_INICIO). null si no se lee. */
export function destinoDeStartsAt(startsAt: string): { fecha: string; inicio: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(startsAt);
  if (!m) return null;
  return { fecha: m[1], inicio: Number(m[2]) * 60 + Number(m[3]) - HORA_INICIO * 60 };
}

/**
 * Pinta en la agenda los movimientos que siguen en la cola sin conexión:
 * sin esto, la cita volvería a su lugar viejo en cuanto React Query
 * refresca desde el cache, y el equipo pensaría que el arrastre no tomó.
 * Solo cuentan los pendientes: un fallido ya no se va a aplicar.
 */
export function aplicarMovimientosPendientes<C extends Cita>(
  citas: C[],
  items: { kind: string; estado: string; payload: Record<string, unknown> }[],
): { citas: C[]; enCola: Set<string> } {
  const porCita = new Map<string, { fecha: string; inicio: number; profesionalId: string }>();
  for (const item of items) {
    if (item.kind !== "reprogramar-cita" || item.estado !== "pendiente") continue;
    const p = item.payload as Partial<PayloadReprogramar>;
    if (typeof p.appointmentId !== "string" || typeof p.startsAt !== "string") continue;
    const destino = destinoDeStartsAt(p.startsAt);
    if (!destino || typeof p.professionalId !== "string") continue;
    porCita.set(p.appointmentId, { ...destino, profesionalId: p.professionalId });
  }
  if (porCita.size === 0) return { citas, enCola: new Set() };
  return {
    citas: citas.map((c) => {
      const mov = porCita.get(c.id);
      return mov ? { ...c, ...mov } : c;
    }),
    enCola: new Set(porCita.keys()),
  };
}

// ── Textos ───────────────────────────────────────────────────────────────

/** "mié 21 oct" para una fecha de calendario. */
export function fechaCorta(fecha: string): string {
  return diaSemana(fecha);
}

/** Frase para el aviso y para `aria-live`. */
export function fraseDeMovimiento({
  paciente,
  destino,
  nombreProfesional,
  cambioProfesional,
}: {
  paciente: string;
  destino: Pick<Destino, "fecha" | "inicio">;
  nombreProfesional: string;
  cambioProfesional: boolean;
}): string {
  const base = `Cita de ${paciente} movida al ${fechaCorta(destino.fecha)} a las ${horaDeMinutos(destino.inicio)}`;
  return cambioProfesional ? `${base} con ${nombreProfesional}.` : `${base}.`;
}
