import { HORA_INICIO } from "@/lib/clinic-operations/clinic-data";
import { addDaysISO } from "@/lib/clinic-operations/agenda-fechas";

/**
 * Disponibilidad de la agenda (Ola 2 · frente Disponibilidad): bloqueos
 * (AGE-07), aperturas excepcionales (AGE-08), horario de atención de la
 * sucursal y ajustes de la grilla (AGE-10), horario del profesional por
 * sucursal (AGE-23) y sugerencias para reprogramar en lote (MKT-02).
 *
 * Todo es lógica pura, sin red ni base: la usan la grilla, el formulario de
 * cita, la pantalla de configuración y el servidor
 * (`validarHorarioYSolapamiento`). Se prueba en
 * `tests/disponibilidad.test.ts`.
 *
 * Unidades: igual que `Cita.inicio`, los tramos van en MINUTOS DESDE
 * HORA_INICIO y en hora de PARED de la sucursal. Las fechas son de
 * calendario ("YYYY-MM-DD") y las horas de un bloqueo, "YYYY-MM-DDTHH:mm" sin
 * huso (lo que guarda `agenda_exceptions.starts_local`). Acá no se convierte
 * ningún huso, a propósito.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────

export const MOTIVOS_BLOQUEO = [
  "almuerzo",
  "capacitacion",
  "vacaciones",
  "ausencia",
  "otro",
] as const;
export type MotivoBloqueo = (typeof MOTIVOS_BLOQUEO)[number];

export const ETIQUETA_MOTIVO: Record<MotivoBloqueo, string> = {
  almuerzo: "Almuerzo",
  capacitacion: "Capacitación",
  vacaciones: "Vacaciones",
  ausencia: "Ausencia",
  otro: "Otro",
};

/** Motivos que significan "el profesional no viene": ofrecen reprogramar sus citas (MKT-02). */
export const MOTIVOS_DE_AUSENCIA: ReadonlySet<MotivoBloqueo> = new Set(["vacaciones", "ausencia"]);

export type TipoExcepcion = "bloqueo" | "apertura";

export interface ExcepcionAgenda {
  id: string;
  tipo: TipoExcepcion;
  /** Obligatorio en un bloqueo; null en una apertura. */
  motivo: MotivoBloqueo | null;
  nota: string | null;
  /** null = no es de un profesional (sucursal, box o toda la clínica). */
  profesionalId: string | null;
  sucursalId: string | null;
  boxId: string | null;
  /** Nombre del box, para reconocerlo en la grilla (el profesional trae su box por nombre). */
  boxNombre: string | null;
  /** "YYYY-MM-DDTHH:mm", hora de pared. */
  inicio: string;
  /** "YYYY-MM-DDTHH:mm", hora de pared. */
  fin: string;
  repetirSemanal: boolean;
  /** "YYYY-MM-DD" inclusive; null = sin fin. Solo con `repetirSemanal`. */
  repetirHasta: string | null;
}

/** Tramo en minutos desde HORA_INICIO (la unidad de `Cita.inicio`). */
export interface Tramo {
  inicio: number;
  fin: number;
}

/** Un día entero, en minutos desde HORA_INICIO. */
export const DIA_INICIO = -HORA_INICIO * 60;
export const DIA_FIN = (24 - HORA_INICIO) * 60;

/** Bloque semanal de horario (profesional o sucursal). */
export interface BloqueSemanal {
  /** 0 = domingo … 6 = sábado. */
  dayOfWeek: number;
  /** "HH:mm" */
  startTime: string;
  /** "HH:mm" */
  endTime: string;
  /** Solo en el horario del profesional: sucursal donde atiende (null = cualquiera). */
  branchId?: string | null;
}

// ─── Ajustes de la agenda (AGE-10) ───────────────────────────────────────

export const INTERVALOS_GRILLA = [10, 15, 20, 30] as const;
export type IntervaloGrilla = (typeof INTERVALOS_GRILLA)[number];

export interface AjustesAgenda {
  /** Intervalo de la grilla en minutos. */
  pasoMin: IntervaloGrilla;
  /** Duración con la que arranca una cita nueva. */
  duracionPorDefecto: number;
  /** Dos citas del mismo profesional a la vez. */
  permiteSobrecupos: boolean;
}

/** Sin fila en `clinic_agenda_settings`: los valores de siempre. */
export const AJUSTES_POR_DEFECTO: AjustesAgenda = {
  pasoMin: 15,
  duracionPorDefecto: 30,
  permiteSobrecupos: true,
};

export function esIntervaloGrilla(n: number): n is IntervaloGrilla {
  return (INTERVALOS_GRILLA as readonly number[]).includes(n);
}

// ─── Fechas y horas de pared ─────────────────────────────────────────────

const RE_LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/** "2026-10-23T13:30" → { fecha: "2026-10-23", minutos: 810 } (desde medianoche). */
export function partirLocal(local: string): { fecha: string; minutos: number } | null {
  const m = RE_LOCAL.exec(local);
  if (!m) return null;
  return { fecha: m[1], minutos: Number(m[2]) * 60 + Number(m[3]) };
}

/** Día de la semana de una fecha de calendario (sin huso). */
export function diaDeLaSemana(fecha: string): number {
  const [y, mo, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, (mo || 1) - 1, d || 1)).getUTCDay();
}

/** "13:30" → minutos desde HORA_INICIO. */
export function minutosDeHHMM(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0) - HORA_INICIO * 60;
}

/** Minutos desde HORA_INICIO → "HH:mm" (24:00 para el fin del día). */
export function hhmmDeMinutos(minutos: number): string {
  const total = HORA_INICIO * 60 + minutos;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Suma minutos a una hora de pared "YYYY-MM-DDTHH:mm" (aritmética de calendario, sin huso). */
export function sumarMinutosLocal(local: string, minutos: number): string {
  const p = partirLocal(local);
  if (!p) return local;
  const total = p.minutos + minutos;
  const dias = Math.floor(total / 1440);
  const resto = total - dias * 1440;
  const fecha = dias === 0 ? p.fecha : addDaysISO(p.fecha, dias);
  return `${fecha}T${String(Math.floor(resto / 60)).padStart(2, "0")}:${String(resto % 60).padStart(2, "0")}`;
}

// ─── Tramos ──────────────────────────────────────────────────────────────

export function seCruzan(a: Tramo, b: Tramo): boolean {
  return a.inicio < b.fin && a.fin > b.inicio;
}

/** Ordena y une los tramos que se tocan o se pisan. */
export function unirTramos(tramos: readonly Tramo[]): Tramo[] {
  const ordenados = tramos.filter((t) => t.fin > t.inicio).sort((a, b) => a.inicio - b.inicio);
  const unidos: Tramo[] = [];
  for (const t of ordenados) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && t.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, t.fin);
    else unidos.push({ ...t });
  }
  return unidos;
}

/** `base` menos `quitar`. */
export function restarTramos(base: readonly Tramo[], quitar: readonly Tramo[]): Tramo[] {
  let resto = unirTramos(base);
  for (const q of unirTramos(quitar)) {
    const siguiente: Tramo[] = [];
    for (const t of resto) {
      if (!seCruzan(t, q)) {
        siguiente.push(t);
        continue;
      }
      if (t.inicio < q.inicio) siguiente.push({ inicio: t.inicio, fin: q.inicio });
      if (t.fin > q.fin) siguiente.push({ inicio: q.fin, fin: t.fin });
    }
    resto = siguiente;
  }
  return resto;
}

/** ¿[inicio, fin) entra entero en alguno de los tramos (ya unidos)? */
export function cabeEn(tramo: Tramo, tramos: readonly Tramo[]): boolean {
  return unirTramos(tramos).some((t) => tramo.inicio >= t.inicio && tramo.fin <= t.fin);
}

/** Tramos de un horario semanal para una fecha (unidos). */
export function tramosSemanales(bloques: readonly BloqueSemanal[], fecha: string): Tramo[] {
  const dia = diaDeLaSemana(fecha);
  return unirTramos(
    bloques
      .filter((b) => b.dayOfWeek === dia)
      .map((b) => ({ inicio: minutosDeHHMM(b.startTime), fin: minutosDeHHMM(b.endTime) })),
  );
}

// ─── Excepciones (AGE-07 y AGE-08) ───────────────────────────────────────

/**
 * Tramo que ocupa la excepción en una fecha, o null si ese día no aplica.
 *
 * - Sin repetición, puede abarcar varios días (vacaciones): el primer día
 *   desde la hora de inicio, los del medio enteros y el último hasta la hora
 *   de fin. Un fin a las 00:00 no ocupa ese día.
 * - Con repetición semanal es un tramo del día, el mismo día de la semana,
 *   desde la fecha de inicio hasta `repetirHasta` (inclusive).
 */
export function tramoDelDia(e: ExcepcionAgenda, fecha: string): Tramo | null {
  const ini = partirLocal(e.inicio);
  const fin = partirLocal(e.fin);
  if (!ini || !fin) return null;
  if (e.repetirSemanal) {
    if (fecha < ini.fecha) return null;
    if (e.repetirHasta && fecha > e.repetirHasta) return null;
    if (diaDeLaSemana(fecha) !== diaDeLaSemana(ini.fecha)) return null;
    const finMin = fin.fecha > ini.fecha ? 1440 : fin.minutos;
    if (finMin <= ini.minutos) return null;
    return { inicio: ini.minutos + DIA_INICIO, fin: finMin + DIA_INICIO };
  }
  if (fecha < ini.fecha || fecha > fin.fecha) return null;
  const desde = fecha === ini.fecha ? ini.minutos : 0;
  const hasta = fecha === fin.fecha ? fin.minutos : 1440;
  if (hasta <= desde) return null;
  return { inicio: desde + DIA_INICIO, fin: hasta + DIA_INICIO };
}

/** A quién se le mira la excepción: una columna de la grilla o una cita. */
export interface DestinoExcepcion {
  profesionalId: string;
  /** Sucursal de la cita (o la del profesional en la grilla). */
  sucursalId?: string | null;
  /** Sucursales donde atiende el profesional según su horario (AGE-23). */
  sucursalesDelProfesional?: readonly string[];
  /** Box elegido en la cita, si hay. */
  boxId?: string | null;
  /** Nombre del box por defecto del profesional (la grilla lo trae así). */
  boxNombre?: string | null;
}

/**
 * ¿La excepción le toca a este profesional/cita? De la más específica a la
 * más general: profesional, box, sucursal, toda la clínica.
 */
export function aplicaA(e: ExcepcionAgenda, d: DestinoExcepcion): boolean {
  if (e.profesionalId) return e.profesionalId === d.profesionalId;
  if (e.boxId) {
    if (d.boxId) return d.boxId === e.boxId;
    const mismoNombre =
      Boolean(e.boxNombre && d.boxNombre) &&
      e.boxNombre!.trim().toLowerCase() === d.boxNombre!.trim().toLowerCase();
    const mismaSucursal = !e.sucursalId || !d.sucursalId || e.sucursalId === d.sucursalId;
    return mismoNombre && mismaSucursal;
  }
  if (e.sucursalId) {
    return (
      d.sucursalId === e.sucursalId || Boolean(d.sucursalesDelProfesional?.includes(e.sucursalId))
    );
  }
  return true;
}

export interface ExcepcionDelDia {
  excepcion: ExcepcionAgenda;
  tramo: Tramo;
}

/** Excepciones que tocan a `destino` en `fecha`, con su tramo de ese día. */
export function excepcionesDelDia(
  excepciones: readonly ExcepcionAgenda[],
  fecha: string,
  destino: DestinoExcepcion,
  tipo?: TipoExcepcion,
): ExcepcionDelDia[] {
  const lista: ExcepcionDelDia[] = [];
  for (const e of excepciones) {
    if (tipo && e.tipo !== tipo) continue;
    if (!aplicaA(e, destino)) continue;
    const tramo = tramoDelDia(e, fecha);
    if (tramo) lista.push({ excepcion: e, tramo });
  }
  return lista.sort((a, b) => a.tramo.inicio - b.tramo.inicio);
}

/** Bloqueos que pisan [inicio, inicio + duración) ese día. */
export function bloqueosQueChocan(
  excepciones: readonly ExcepcionAgenda[],
  cita: DestinoExcepcion & { fecha: string; inicio: number; duracion: number },
): ExcepcionDelDia[] {
  const ocupa = { inicio: cita.inicio, fin: cita.inicio + cita.duracion };
  return excepcionesDelDia(excepciones, cita.fecha, cita, "bloqueo").filter((x) =>
    seCruzan(x.tramo, ocupa),
  );
}

/** Aperturas excepcionales del profesional ese día (unidas). */
export function aperturasDelDia(
  excepciones: readonly ExcepcionAgenda[],
  fecha: string,
  profesionalId: string,
): Tramo[] {
  return unirTramos(
    excepcionesDelDia(excepciones, fecha, { profesionalId }, "apertura").map((x) => x.tramo),
  );
}

/** Horario declarado del día (misma forma que `HorarioDelDia` de agenda-movimiento). */
export interface HorarioDeclarado {
  declarado: boolean;
  tramos: Tramo[];
}

/**
 * El horario del día con las aperturas excepcionales sumadas (AGE-08). Sin
 * horario declarado no hay nada que abrir: ya se puede agendar a cualquier
 * hora.
 */
export function conAperturas<H extends HorarioDeclarado>(
  horario: H,
  aperturas: readonly Tramo[],
): H {
  if (!horario.declarado || aperturas.length === 0) return horario;
  return { ...horario, tramos: unirTramos([...horario.tramos, ...aperturas]) };
}

/** "Almuerzo", "Vacaciones: congreso en Lima", "Horario excepcional". */
export function etiquetaExcepcion(e: Pick<ExcepcionAgenda, "tipo" | "motivo" | "nota">): string {
  if (e.tipo === "apertura")
    return e.nota ? `Horario excepcional: ${e.nota}` : "Horario excepcional";
  const base = e.motivo ? ETIQUETA_MOTIVO[e.motivo] : "Bloqueado";
  return e.nota ? `${base}: ${e.nota}` : base;
}

/** "Almuerzo, 13:00–14:00" para avisos. */
export function describirBloqueo(x: ExcepcionDelDia): string {
  return `${etiquetaExcepcion(x.excepcion)}, ${hhmmDeMinutos(x.tramo.inicio)}–${hhmmDeMinutos(x.tramo.fin)}`;
}

// ─── Lo que dibuja la grilla ─────────────────────────────────────────────

export type TipoFranja = "bloqueo" | "apertura" | "cerrado";

export interface FranjaDisponibilidad extends Tramo {
  tipo: TipoFranja;
  etiqueta: string;
  /** Estable para React: id de la excepción o "cerrado-<inicio>". */
  clave: string;
}

/**
 * Franjas de una columna de la grilla en un día:
 *
 * - `cerrado`: fuera del horario de atención de la sucursal (si la sucursal
 *   lo declaró; sin horario declarado no se sombrea nada). Una apertura
 *   excepcional del profesional le gana.
 * - `bloqueo`: franja rayada, no agendable.
 * - `apertura`: horario excepcional, disponible.
 */
export function franjasDeDisponibilidad({
  fecha,
  destino,
  excepciones,
  horarioSucursal,
}: {
  fecha: string;
  destino: DestinoExcepcion;
  excepciones: readonly ExcepcionAgenda[];
  /** Horario semanal de la sucursal de la columna; vacío = no declarado. */
  horarioSucursal?: readonly BloqueSemanal[];
}): FranjaDisponibilidad[] {
  const delDia = excepcionesDelDia(excepciones, fecha, destino);
  const aperturas = delDia.filter((x) => x.excepcion.tipo === "apertura");
  const franjas: FranjaDisponibilidad[] = [];

  if (horarioSucursal && horarioSucursal.length > 0) {
    const abierto = tramosSemanales(horarioSucursal, fecha);
    const cerrado = restarTramos(
      restarTramos([{ inicio: DIA_INICIO, fin: DIA_FIN }], abierto),
      aperturas.map((a) => a.tramo),
    );
    for (const t of cerrado) {
      franjas.push({
        ...t,
        tipo: "cerrado",
        etiqueta: abierto.length === 0 ? "Sucursal cerrada" : "Fuera del horario de atención",
        clave: `cerrado-${t.inicio}`,
      });
    }
  }
  for (const x of delDia) {
    franjas.push({
      ...x.tramo,
      tipo: x.excepcion.tipo === "apertura" ? "apertura" : "bloqueo",
      etiqueta: etiquetaExcepcion(x.excepcion),
      clave: `${x.excepcion.id}-${x.tramo.inicio}`,
    });
  }
  return franjas.sort((a, b) => a.inicio - b.inicio);
}

/** Tramos donde no se ofrece agendar con un clic (bloqueos y sucursal cerrada). */
export function tramosNoAgendables(franjas: readonly FranjaDisponibilidad[]): Tramo[] {
  return unirTramos(franjas.filter((f) => f.tipo !== "apertura"));
}

/** Aperturas como "citas" para estirar la grilla hasta cubrirlas (`rangoDeGrilla`). */
export function aperturasComoRango(
  franjas: readonly FranjaDisponibilidad[],
): { inicio: number; duracion: number }[] {
  return franjas
    .filter((f) => f.tipo === "apertura")
    .map((f) => ({ inicio: f.inicio, duracion: f.fin - f.inicio }));
}

/** Tramos de apertura (para restarlos del "fuera de horario" del profesional). */
export function tramosDeApertura(franjas: readonly FranjaDisponibilidad[]): Tramo[] {
  return franjas
    .filter((f) => f.tipo === "apertura")
    .map((f) => ({ inicio: f.inicio, fin: f.fin }));
}

/** Huecos libres sin los que caen en un bloqueo o con la sucursal cerrada. */
export function filtrarHuecosAgendables(
  huecos: readonly number[],
  paso: number,
  noAgendables: readonly Tramo[],
): number[] {
  if (noAgendables.length === 0) return [...huecos];
  return huecos.filter((m) => !noAgendables.some((t) => seCruzan(t, { inicio: m, fin: m + paso })));
}

// ─── Validación al crear (par del CHECK de la base) ──────────────────────

export interface NuevaExcepcion {
  tipo: TipoExcepcion;
  motivo: MotivoBloqueo | null;
  profesionalId: string | null;
  inicio: string;
  fin: string;
  repetirSemanal: boolean;
  repetirHasta: string | null;
}

/** Tope de largo, igual que `agenda_exceptions_largo_chk`. */
export const DIAS_MAX_EXCEPCION = 120;

/** El primer problema que impide guardar, o null. Mismo criterio que los CHECK de la tabla. */
export function problemaDeExcepcion(e: NuevaExcepcion): string | null {
  const ini = partirLocal(e.inicio);
  const fin = partirLocal(e.fin);
  if (!ini || !fin) return "Completa la fecha y hora de inicio y de término.";
  if (e.fin <= e.inicio) return "El término tiene que ser después del inicio.";
  if (e.tipo === "bloqueo" && !e.motivo) return "Elige el motivo del bloqueo.";
  if (e.tipo === "apertura" && !e.profesionalId)
    return "Elige el profesional que atiende en ese horario.";
  const limite = `${addDaysISO(ini.fecha, DIAS_MAX_EXCEPCION)}T${e.inicio.slice(11, 16)}`;
  if (e.fin > limite) return `Un bloqueo puede durar hasta ${DIAS_MAX_EXCEPCION} días.`;
  if (e.repetirSemanal) {
    const finDelDia = `${addDaysISO(ini.fecha, 1)}T00:00`;
    if (fin.fecha !== ini.fecha && e.fin.slice(0, 16) !== finDelDia)
      return "Lo que se repite cada semana tiene que empezar y terminar el mismo día.";
    if (e.repetirHasta && e.repetirHasta < ini.fecha)
      return "La repetición tiene que terminar después del primer día.";
  } else if (e.repetirHasta) {
    return "La fecha de fin de la repetición solo aplica si se repite cada semana.";
  }
  return null;
}

// ─── Citas afectadas y sugerencias (MKT-02) ──────────────────────────────

export interface CitaDisponibilidad {
  id: string;
  profesionalId: string;
  sucursalId: string;
  fecha: string;
  inicio: number;
  duracion: number;
  estado: string;
}

/** Solo se reprograman las que todavía no pasaron (igual que el arrastre). */
const ESTADOS_REPROGRAMABLES = new Set(["tentativa", "confirmada"]);

/** Citas por confirmar o confirmadas que caen (aunque sea en parte) en la excepción. */
export function citasAfectadas<C extends CitaDisponibilidad>(
  e: ExcepcionAgenda,
  citas: readonly C[],
  sucursalesPorProfesional?: Readonly<Record<string, readonly string[]>>,
): C[] {
  if (e.tipo !== "bloqueo") return [];
  return citas
    .filter((c) => {
      if (!ESTADOS_REPROGRAMABLES.has(c.estado)) return false;
      const destino: DestinoExcepcion = {
        profesionalId: c.profesionalId,
        sucursalId: c.sucursalId,
        sucursalesDelProfesional: sucursalesPorProfesional?.[c.profesionalId],
      };
      if (!aplicaA(e, destino)) return false;
      const tramo = tramoDelDia(e, c.fecha);
      return Boolean(tramo && seCruzan(tramo, { inicio: c.inicio, fin: c.inicio + c.duracion }));
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.inicio - b.inicio);
}

export interface ProfesionalDisponibilidad {
  id: string;
  sucursalId: string;
  atiende?: boolean;
}

export interface ContextoSugerencia {
  profesionales: readonly ProfesionalDisponibilidad[];
  /** Horario semanal por profesional (con su sucursal, AGE-23). Sin filas = sin restricción. */
  horarios: Readonly<Record<string, readonly BloqueSemanal[]>>;
  /** Horario de atención por sucursal; vacío = no declarado. */
  horarioSucursal?: Readonly<Record<string, readonly BloqueSemanal[]>>;
  /** Citas que ya ocupan la agenda (todas las cargadas, no solo las afectadas). */
  citas: readonly CitaDisponibilidad[];
  excepciones: readonly ExcepcionAgenda[];
  /** Intervalo con que se buscan horas libres. */
  paso: number;
  /** Cuántos días hacia adelante se busca con el mismo profesional. */
  diasHaciaAdelante?: number;
}

export type Sugerencia = {
  tipo: "otro-profesional" | "otro-horario";
  profesionalId: string;
  fecha: string;
  inicio: number;
};

/** Sin horario declarado de nadie: una jornada razonable para no sugerir a las 3 AM. */
const JORNADA_POR_DEFECTO: Tramo = { inicio: minutosDeHHMM("09:00"), fin: minutosDeHHMM("19:00") };

/** Sucursales donde atiende cada profesional según su horario (AGE-23). */
export function sucursalesPorProfesional(
  horarios: Readonly<Record<string, readonly BloqueSemanal[]>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, bloques] of Object.entries(horarios)) {
    const set = new Set(bloques.map((b) => b.branchId).filter((b): b is string => Boolean(b)));
    if (set.size > 0) out[id] = [...set];
  }
  return out;
}

/** ¿El profesional atiende en esa sucursal? Su sucursal de ficha o una de su horario. */
export function atiendeEnSucursal(
  p: ProfesionalDisponibilidad,
  sucursalId: string,
  bloques: readonly BloqueSemanal[] | undefined,
): boolean {
  if (!sucursalId) return true;
  if (p.sucursalId === sucursalId) return true;
  return Boolean(bloques?.some((b) => b.branchId === sucursalId));
}

/** Tramos en que el profesional atiende ese día en esa sucursal (con aperturas). */
export function tramosAtendidos(
  ctx: Pick<ContextoSugerencia, "horarios" | "horarioSucursal" | "excepciones">,
  profesionalId: string,
  sucursalId: string,
  fecha: string,
): Tramo[] {
  const bloques = ctx.horarios[profesionalId] ?? [];
  const aperturas = aperturasDelDia(ctx.excepciones, fecha, profesionalId);
  let base: Tramo[];
  if (bloques.length > 0) {
    const deLaSucursal = bloques.filter(
      (b) => !b.branchId || !sucursalId || b.branchId === sucursalId,
    );
    base = tramosSemanales(deLaSucursal, fecha);
  } else {
    const sucursal = sucursalId ? ctx.horarioSucursal?.[sucursalId] : undefined;
    base =
      sucursal && sucursal.length > 0 ? tramosSemanales(sucursal, fecha) : [JORNADA_POR_DEFECTO];
  }
  return unirTramos([...base, ...aperturas]);
}

/** ¿Está libre el profesional en ese horario? Horario, bloqueos y citas. */
export function estaLibre(
  ctx: ContextoSugerencia,
  hueco: {
    profesionalId: string;
    sucursalId: string;
    fecha: string;
    inicio: number;
    duracion: number;
  },
  ignorarCitaId?: string,
  reservadas: readonly CitaDisponibilidad[] = [],
): boolean {
  const ocupa = { inicio: hueco.inicio, fin: hueco.inicio + hueco.duracion };
  if (!cabeEn(ocupa, tramosAtendidos(ctx, hueco.profesionalId, hueco.sucursalId, hueco.fecha)))
    return false;
  const sucursales = sucursalesPorProfesional(ctx.horarios)[hueco.profesionalId];
  if (
    bloqueosQueChocan(ctx.excepciones, {
      profesionalId: hueco.profesionalId,
      sucursalId: hueco.sucursalId,
      sucursalesDelProfesional: sucursales,
      fecha: hueco.fecha,
      inicio: hueco.inicio,
      duracion: hueco.duracion,
    }).length > 0
  )
    return false;
  for (const c of [...ctx.citas, ...reservadas]) {
    if (c.id === ignorarCitaId || c.profesionalId !== hueco.profesionalId) continue;
    if (c.fecha !== hueco.fecha || c.estado === "ausente") continue;
    if (seCruzan({ inicio: c.inicio, fin: c.inicio + c.duracion }, ocupa)) return false;
  }
  return true;
}

/**
 * Dónde mover una cita afectada (MKT-02), en este orden:
 *
 * 1. El mismo día y hora con otro profesional que atiende en esa sucursal y
 *    está libre (al paciente le cambia lo menos posible).
 * 2. Con el mismo profesional, en el primer horario libre después del
 *    original, buscando hasta `diasHaciaAdelante` días.
 *
 * null si no hay nada: queda para coordinar con el paciente.
 */
export function sugerirReprogramacion(
  cita: CitaDisponibilidad,
  ctx: ContextoSugerencia,
  reservadas: readonly CitaDisponibilidad[] = [],
): Sugerencia | null {
  for (const p of ctx.profesionales) {
    if (p.id === cita.profesionalId || p.atiende === false) continue;
    if (!atiendeEnSucursal(p, cita.sucursalId, ctx.horarios[p.id])) continue;
    const hueco = { ...cita, profesionalId: p.id };
    if (estaLibre(ctx, hueco, cita.id, reservadas)) {
      return {
        tipo: "otro-profesional",
        profesionalId: p.id,
        fecha: cita.fecha,
        inicio: cita.inicio,
      };
    }
  }
  const dias = ctx.diasHaciaAdelante ?? 14;
  const paso = Math.max(5, ctx.paso);
  for (let d = 0; d <= dias; d++) {
    const fecha = addDaysISO(cita.fecha, d);
    const tramos = tramosAtendidos(ctx, cita.profesionalId, cita.sucursalId, fecha);
    for (const t of tramos) {
      // Primer múltiplo del paso dentro del tramo.
      const primero = Math.ceil((t.inicio - DIA_INICIO) / paso) * paso + DIA_INICIO;
      for (let m = primero; m + cita.duracion <= t.fin; m += paso) {
        if (d === 0 && m <= cita.inicio) continue;
        const hueco = { ...cita, fecha, inicio: m };
        if (estaLibre(ctx, hueco, cita.id, reservadas)) {
          return { tipo: "otro-horario", profesionalId: cita.profesionalId, fecha, inicio: m };
        }
      }
    }
  }
  return null;
}

/**
 * Sugerencias para todas las citas afectadas, sin que dos caigan en el mismo
 * horario: cada sugerencia reserva su lugar para las siguientes.
 */
export function sugerirReprogramaciones(
  afectadas: readonly CitaDisponibilidad[],
  ctx: ContextoSugerencia,
): Map<string, Sugerencia | null> {
  const out = new Map<string, Sugerencia | null>();
  const reservadas: CitaDisponibilidad[] = [];
  // Las afectadas siguen en `ctx.citas` en su lugar viejo: no ocupan nada
  // porque justamente se van a mover (el bloqueo ya tapa ese horario).
  const idsAfectadas = new Set(afectadas.map((c) => c.id));
  const contexto: ContextoSugerencia = {
    ...ctx,
    citas: ctx.citas.filter((c) => !idsAfectadas.has(c.id)),
  };
  for (const c of afectadas) {
    const s = sugerirReprogramacion(c, contexto, reservadas);
    out.set(c.id, s);
    if (s) reservadas.push({ ...c, id: `reserva-${c.id}`, ...s });
  }
  return out;
}

/** "YYYY-MM-DDTHH:mm" de una sugerencia (lo que recibe `moveAppointment`). */
export function startsAtDeSugerencia(s: Pick<Sugerencia, "fecha" | "inicio">): string {
  return `${s.fecha}T${hhmmDeMinutos(s.inicio)}`;
}

/** Tope de una ausencia que se repite sin fin: no se miran citas más allá. */
export const DIAS_MAX_REPETICION = 90;

/**
 * Rango de fechas que cubre una excepción, desde `hoy` (lo que ya pasó no se
 * reprograma). Si se repite sin fin, hasta 90 días. null si no se lee.
 */
export function rangoDeExcepcion(e: ExcepcionAgenda, hoy: string): [string, string] | null {
  const ini = partirLocal(e.inicio);
  const fin = partirLocal(e.fin);
  if (!ini || !fin) return null;
  const desde = ini.fecha < hoy ? hoy : ini.fecha;
  if (e.repetirSemanal) {
    const tope = addDaysISO(desde, DIAS_MAX_REPETICION);
    return [desde, e.repetirHasta && e.repetirHasta < tope ? e.repetirHasta : tope];
  }
  // Un fin a las 00:00 no ocupa ese día.
  const hasta = fin.minutos === 0 ? addDaysISO(fin.fecha, -1) : fin.fecha;
  return [desde, hasta < desde ? desde : hasta];
}

/** Días en el orden de una semana de clínica (lunes primero), con el número de `Date.getDay()`. */
export const DIAS_SEMANA = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
] as const;

/** Partes de cuándo aplica una excepción, para listarla. Fechas en "YYYY-MM-DD", horas "HH:mm". */
export type CuandoAplica =
  | {
      tipo: "semanal";
      dia: string;
      desdeHora: string;
      hastaHora: string;
      desde: string;
      hasta: string | null;
    }
  | {
      tipo: "rango";
      desdeFecha: string;
      desdeHora: string;
      hastaFecha: string;
      hastaHora: string;
      todoElDia: boolean;
    };

export function cuandoAplica(e: ExcepcionAgenda): CuandoAplica | null {
  const ini = partirLocal(e.inicio);
  const fin = partirLocal(e.fin);
  if (!ini || !fin) return null;
  const hora = (m: number) => hhmmDeMinutos(m + DIA_INICIO);
  if (e.repetirSemanal) {
    const dia = DIAS_SEMANA.find((d) => d.value === diaDeLaSemana(ini.fecha))?.label ?? "";
    return {
      tipo: "semanal",
      dia,
      desdeHora: hora(ini.minutos),
      hastaHora: hora(fin.fecha > ini.fecha ? 1440 : fin.minutos),
      desde: ini.fecha,
      hasta: e.repetirHasta,
    };
  }
  const todoElDia = ini.minutos === 0 && fin.minutos === 0;
  return {
    tipo: "rango",
    desdeFecha: ini.fecha,
    desdeHora: hora(ini.minutos),
    // "Todo el día" termina a las 00:00 del día siguiente: se muestra el último día.
    hastaFecha: todoElDia ? addDaysISO(fin.fecha, -1) : fin.fecha,
    hastaHora: hora(fin.minutos),
    todoElDia,
  };
}
