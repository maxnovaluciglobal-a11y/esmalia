/**
 * Resultados del piloto (INF-14, Ola 2). Lógica pura: la fila viene de la
 * RPC `pilot_results` (agregada en Postgres en el huso de la clínica) y acá
 * se arman los porcentajes y el reparto por origen. Regla 11: lo que no se
 * puede calcular es `null` y la pantalla dice "Sin datos".
 */

/** Etiqueta de los pacientes sin `acquisition_source`. */
export const ORIGEN_SIN_DATO = "Sin dato";

export interface OrigenDePacientes {
  origen: string;
  pacientes: number;
  /** % del total de pacientes nuevos del período (entero). */
  porcentaje: number;
}

export interface ResultadosDelPiloto {
  desde: string;
  hasta: string;
  currency: string;
  citas: {
    agendadas: number;
    atendidas: number;
    inasistencias: number;
    anuladas: number;
    /** atendidas / (atendidas + inasistencias); null sin ninguna con desenlace. */
    pctAsistencia: number | null;
  };
  recordatoriosEnviados: number;
  pacientesNuevos: number;
  origenes: OrigenDePacientes[];
  /** `null` cuando el rol o la suscripción no dejan ver montos (`requireFinanceView`). */
  dinero: {
    presupuestosEmitidos: number;
    presupuestosEmitidosCents: number;
    presupuestosAceptados: number;
    presupuestosAceptadosCents: number;
    /** aceptados / emitidos; null sin emitidos. */
    pctAceptacion: number | null;
    cobradoCents: number;
    pagos: number;
  } | null;
}

export interface FilaResultadosPiloto {
  currency: string | null;
  appointments_scheduled: number | null;
  appointments_attended: number | null;
  appointments_no_show: number | null;
  appointments_cancelled: number | null;
  reminders_sent: number | null;
  patients_new: number | null;
  patients_by_source: unknown;
  quotes_issued: number | null;
  quotes_issued_cents: number | string | null;
  quotes_accepted: number | null;
  quotes_accepted_cents: number | string | null;
  collected_cents: number | string | null;
  payments_count: number | null;
}

export function porcentaje(parte: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((parte / total) * 100);
}

function entero(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Reparto por origen, de mayor a menor, con "Sin dato" siempre al final. */
export function origenesDesdeJson(json: unknown): OrigenDePacientes[] {
  const filas = Array.isArray(json) ? json : [];
  const conteo = new Map<string, number>();
  for (const f of filas) {
    if (!f || typeof f !== "object") continue;
    const { source, count } = f as { source?: unknown; count?: unknown };
    const origen = typeof source === "string" && source.trim() ? source.trim() : ORIGEN_SIN_DATO;
    conteo.set(origen, (conteo.get(origen) ?? 0) + entero(count as number));
  }
  const total = [...conteo.values()].reduce((s, n) => s + n, 0);
  return [...conteo.entries()]
    .filter(([, n]) => n > 0)
    .map(([origen, pacientes]) => ({
      origen,
      pacientes,
      porcentaje: porcentaje(pacientes, total) ?? 0,
    }))
    .sort((a, b) => {
      if (a.origen === ORIGEN_SIN_DATO) return 1;
      if (b.origen === ORIGEN_SIN_DATO) return -1;
      return b.pacientes - a.pacientes || a.origen.localeCompare(b.origen, "es");
    });
}

export function resultadosDesdeFila(
  fila: FilaResultadosPiloto | null | undefined,
  opciones: { desde: string; hasta: string; currency: string; montosVisibles: boolean },
): ResultadosDelPiloto {
  const atendidas = entero(fila?.appointments_attended);
  const inasistencias = entero(fila?.appointments_no_show);
  const emitidos = entero(fila?.quotes_issued);
  const aceptados = entero(fila?.quotes_accepted);
  return {
    desde: opciones.desde,
    hasta: opciones.hasta,
    currency: fila?.currency ?? opciones.currency,
    citas: {
      agendadas: entero(fila?.appointments_scheduled),
      atendidas,
      inasistencias,
      anuladas: entero(fila?.appointments_cancelled),
      pctAsistencia: porcentaje(atendidas, atendidas + inasistencias),
    },
    recordatoriosEnviados: entero(fila?.reminders_sent),
    pacientesNuevos: entero(fila?.patients_new),
    origenes: origenesDesdeJson(fila?.patients_by_source),
    dinero: opciones.montosVisibles
      ? {
          presupuestosEmitidos: emitidos,
          presupuestosEmitidosCents: entero(fila?.quotes_issued_cents),
          presupuestosAceptados: aceptados,
          presupuestosAceptadosCents: entero(fila?.quotes_accepted_cents),
          pctAceptacion: porcentaje(aceptados, emitidos),
          cobradoCents: entero(fila?.collected_cents),
          pagos: entero(fila?.payments_count),
        }
      : null,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rango del reporte. Por defecto, desde el día en que se creó la clínica (en
 * su huso) hasta hoy. Un rango al revés se da vuelta en vez de devolver
 * vacío, y nada arranca antes de la creación de la clínica.
 */
export function rangoDelPiloto(opciones: {
  creadaEl: string;
  hoy: string;
  desde?: string | null;
  hasta?: string | null;
}): { desde: string; hasta: string } {
  const inicio = opciones.creadaEl;
  let desde = opciones.desde && ISO.test(opciones.desde) ? opciones.desde : inicio;
  let hasta = opciones.hasta && ISO.test(opciones.hasta) ? opciones.hasta : opciones.hoy;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  if (desde < inicio) desde = inicio;
  if (hasta < desde) hasta = desde;
  return { desde, hasta };
}

/** Días del rango, contando las dos puntas ("en 45 días de piloto"). */
export function diasDelRango(desde: string, hasta: string): number {
  const ms = Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000)) + 1;
}

/** ¿Hay algo que mostrar? Sin nada, la pantalla dice "Sin datos" una sola vez. */
export function hayDatos(r: ResultadosDelPiloto): boolean {
  return (
    r.citas.agendadas + r.citas.anuladas + r.recordatoriosEnviados + r.pacientesNuevos > 0 ||
    (r.dinero !== null && r.dinero.presupuestosEmitidos + r.dinero.pagos > 0)
  );
}
