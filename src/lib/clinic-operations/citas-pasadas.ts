/**
 * Cierre en lote de las citas pasadas (PAN-05, Ola 2).
 *
 * Una cita que ya terminó y sigue "Sin respuesta", "Confirmada" o "En sala"
 * ensucia todo lo que se mide después: la asistencia, el recall, el riesgo de
 * ausencia y los resultados del piloto. Esto es la lógica pura (sin Supabase)
 * que comparten el aviso de Hoy/Agenda, la lista de cierre y el servidor.
 */

/** Estados en los que una cita sigue "abierta": falta decir qué pasó. */
export const ESTADOS_ABIERTOS = ["tentativa", "confirmada", "en-sala"] as const;
export type EstadoAbierto = (typeof ESTADOS_ABIERTOS)[number];

/** Los tres desenlaces con los que se cierra una cita pasada. */
export const ESTADOS_DE_CIERRE = ["finalizada", "ausente", "cancelada"] as const;
export type EstadoDeCierre = (typeof ESTADOS_DE_CIERRE)[number];

/** Nombre de cada desenlace cuando la clínica no tiene uno propio. */
export const ETIQUETA_CIERRE_POR_DEFECTO: Record<EstadoDeCierre, string> = {
  finalizada: "Atendida",
  ausente: "No asistió",
  cancelada: "Cancelada",
};

/** Tope de citas por tanda (lista y servidor). Más que eso no se revisa a ojo. */
export const MAX_CIERRE_POR_TANDA = 200;

export function esEstadoAbierto(estado: string): estado is EstadoAbierto {
  return (ESTADOS_ABIERTOS as readonly string[]).includes(estado);
}

export function esEstadoDeCierre(estado: string): estado is EstadoDeCierre {
  return (ESTADOS_DE_CIERRE as readonly string[]).includes(estado);
}

/**
 * Pasada = ya terminó (su fin es anterior a este instante). Un instante es el
 * mismo en todos los husos: una cita de 10:00 a 10:30 en Santiago terminó a
 * las 13:30 UTC, la mire quien la mire. Una cita en curso no es pasada.
 */
export function esPasadaSinCerrar(
  cita: { estado: string; terminaEn: string | Date },
  ahora: Date = new Date(),
): boolean {
  const fin = cita.terminaEn instanceof Date ? cita.terminaEn : new Date(cita.terminaEn);
  if (Number.isNaN(fin.getTime())) return false;
  return esEstadoAbierto(cita.estado) && fin.getTime() < ahora.getTime();
}

/** Un estado del catálogo configurable de la clínica (`appointment_statuses`). */
export interface EstadoConfigurado {
  label: string;
  canonical: string;
  isActive: boolean;
  position: number;
}

export interface OpcionDeCierre {
  estado: EstadoDeCierre;
  etiqueta: string;
}

/**
 * Las tres opciones de cierre con el nombre que la clínica les dio en
 * "Estados y tipos de cita": la primera etiqueta activa (por posición) de cada
 * estado canónico. Si la clínica no tiene ninguna activa para uno, se usa el
 * nombre por defecto: la opción nunca desaparece, porque sin ella la cita no
 * se podría cerrar (el resto del sistema sigue contando el canónico).
 */
export function opcionesDeCierre(catalogo: readonly EstadoConfigurado[] = []): OpcionDeCierre[] {
  return ESTADOS_DE_CIERRE.map((estado) => {
    const propia = catalogo
      .filter((e) => e.isActive && e.canonical === estado && e.label.trim())
      .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, "es"))[0];
    return { estado, etiqueta: propia?.label.trim() ?? ETIQUETA_CIERRE_POR_DEFECTO[estado] };
  });
}

/** "Tienes 1 cita pasada sin cerrar" / "Tienes 4 citas pasadas sin cerrar". */
export function textoAvisoCitasPasadas(total: number): string {
  return total === 1
    ? "Tienes 1 cita pasada sin cerrar"
    : `Tienes ${total} citas pasadas sin cerrar`;
}

export interface CambioDeCierre {
  appointmentId: string;
  estado: EstadoDeCierre;
}

/**
 * Agrupa los cambios por estado para hacer un UPDATE por grupo. Si la misma
 * cita viene dos veces, gana el último cambio (el que el usuario eligió al
 * final).
 */
export function agruparCambiosPorEstado(
  cambios: readonly CambioDeCierre[],
): Map<EstadoDeCierre, string[]> {
  const ultimo = new Map<string, EstadoDeCierre>();
  for (const c of cambios) {
    ultimo.delete(c.appointmentId);
    ultimo.set(c.appointmentId, c.estado);
  }
  const grupos = new Map<EstadoDeCierre, string[]>();
  for (const [id, estado] of ultimo) {
    const ids = grupos.get(estado) ?? [];
    ids.push(id);
    grupos.set(estado, ids);
  }
  return grupos;
}

/**
 * Resumen para el toast: "3 citas cerradas: 2 Atendida, 1 No asistió".
 * Las que no se cerraron (otra persona ya las había cerrado, o dejaron de
 * ser pasadas) se cuentan aparte para que no parezca un error.
 */
export function resumenDeCierre(
  porEstado: Partial<Record<EstadoDeCierre, number>>,
  omitidas: number,
  opciones: readonly OpcionDeCierre[] = opcionesDeCierre(),
): string {
  const partes = opciones
    .filter((o) => (porEstado[o.estado] ?? 0) > 0)
    .map((o) => `${porEstado[o.estado]} ${o.etiqueta}`);
  const total = Object.values(porEstado).reduce((s, n) => s + (n ?? 0), 0);
  const base =
    total === 0
      ? "No se cerró ninguna cita"
      : `${total === 1 ? "1 cita cerrada" : `${total} citas cerradas`}: ${partes.join(", ")}`;
  if (omitidas === 0) return `${base}.`;
  const resto =
    omitidas === 1
      ? "1 ya estaba cerrada o todavía no termina"
      : `${omitidas} ya estaban cerradas o todavía no terminan`;
  return `${base}. ${resto}.`;
}
