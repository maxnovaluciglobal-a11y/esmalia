/**
 * CRM-07 · Riesgo de abandono (Ola 8). Lógica pura: un puntaje de 0 a 100
 * que se explica solo, factor por factor, para que recepción sepa por qué un
 * paciente aparece arriba y qué hacer.
 *
 * Regla 11 (nullable en vez de fabricar cero): sin ninguna visita atendida no
 * hay de dónde sacar el riesgo y el puntaje es `null` ("Sin datos"). Lo mismo
 * con el saldo: si no se pudo leer, no suma ni resta.
 *
 * Los pesos son deliberadamente simples (sumas, sin modelo): se pueden leer
 * en voz alta y discutir con la clínica.
 */

export const DIA_MS = 86_400_000;

export interface DatosDeRiesgo {
  /** Última cita atendida (finalizada), ISO. */
  ultimaVisita: string | null;
  /** Citas atendidas en total. */
  visitas: number;
  tieneCitaFutura: boolean;
  /** Inasistencias (estado "ausente") en los últimos 12 meses. */
  inasistencias12m: number;
  /** Citas que el paciente canceló en los últimos 12 meses. */
  cancelaciones12m: number;
  /** Presupuestos rechazados o vencidos en los últimos 12 meses. */
  presupuestosRechazados12m: number;
  /** Saldo en cents; null si no se pudo saber. */
  saldoCents: number | null;
  /** Tiene un plan de tratamiento detenido (CRM-06). */
  planDetenido?: boolean;
}

export type NivelDeRiesgo = "alto" | "medio" | "bajo";

export interface FactorDeRiesgo {
  clave:
    | "sin_visita"
    | "sin_cita"
    | "inasistencias"
    | "cancelaciones"
    | "presupuesto"
    | "saldo"
    | "plan_detenido"
    | "cita_agendada";
  texto: string;
  /** Puntos que suma (o resta, si es negativo). */
  puntos: number;
}

export interface Riesgo {
  puntaje: number | null;
  nivel: NivelDeRiesgo | null;
  factores: FactorDeRiesgo[];
  diasSinVisita: number | null;
}

export const UMBRAL_ALTO = 60;
export const UMBRAL_MEDIO = 35;

export const ETIQUETA_NIVEL: Record<NivelDeRiesgo, string> = {
  alto: "Riesgo alto",
  medio: "Riesgo medio",
  bajo: "Riesgo bajo",
};

export function nivelDe(puntaje: number): NivelDeRiesgo {
  if (puntaje >= UMBRAL_ALTO) return "alto";
  if (puntaje >= UMBRAL_MEDIO) return "medio";
  return "bajo";
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

export function calcularRiesgo(d: DatosDeRiesgo, ahora: number): Riesgo {
  if (d.visitas <= 0 || !d.ultimaVisita) {
    return { puntaje: null, nivel: null, factores: [], diasSinVisita: null };
  }
  const ultima = new Date(d.ultimaVisita).getTime();
  if (!Number.isFinite(ultima)) {
    return { puntaje: null, nivel: null, factores: [], diasSinVisita: null };
  }
  const diasSinVisita = Math.max(0, Math.floor((ahora - ultima) / DIA_MS));
  const meses = Math.floor(diasSinVisita / 30);
  const factores: FactorDeRiesgo[] = [];

  if (diasSinVisita >= 540) {
    factores.push({ clave: "sin_visita", texto: `Sin visita hace ${meses} meses`, puntos: 40 });
  } else if (diasSinVisita >= 365) {
    factores.push({ clave: "sin_visita", texto: `Sin visita hace ${meses} meses`, puntos: 30 });
  } else if (diasSinVisita >= 180) {
    factores.push({ clave: "sin_visita", texto: `Sin visita hace ${meses} meses`, puntos: 20 });
  }

  // Sin cita agendada solo pesa cuando ya pasó un tiempo desde la última
  // visita: a quien vino la semana pasada no le falta nada.
  if (!d.tieneCitaFutura && diasSinVisita >= 90) {
    factores.push({ clave: "sin_cita", texto: "Sin cita agendada", puntos: 10 });
  }

  if (d.inasistencias12m > 0) {
    factores.push({
      clave: "inasistencias",
      texto: `${plural(d.inasistencias12m, "inasistencia", "inasistencias")} en 12 meses`,
      puntos: Math.min(d.inasistencias12m, 3) * 8,
    });
  }

  if (d.cancelaciones12m > 0) {
    factores.push({
      clave: "cancelaciones",
      texto: `${plural(d.cancelaciones12m, "cita cancelada", "citas canceladas")} por el paciente en 12 meses`,
      puntos: Math.min(d.cancelaciones12m, 3) * 4,
    });
  }

  if (d.presupuestosRechazados12m > 0) {
    factores.push({
      clave: "presupuesto",
      texto:
        d.presupuestosRechazados12m === 1
          ? "Un presupuesto rechazado o vencido"
          : `${d.presupuestosRechazados12m} presupuestos rechazados o vencidos`,
      puntos: 15,
    });
  }

  if (d.saldoCents !== null && d.saldoCents > 0) {
    factores.push({ clave: "saldo", texto: "Tiene saldo pendiente", puntos: 10 });
  }

  if (d.planDetenido) {
    factores.push({ clave: "plan_detenido", texto: "Tratamiento detenido", puntos: 10 });
  }

  if (d.tieneCitaFutura) {
    factores.push({ clave: "cita_agendada", texto: "Tiene una cita agendada", puntos: -20 });
  }

  const suma = factores.reduce((n, f) => n + f.puntos, 0);
  const puntaje = Math.max(0, Math.min(100, suma));
  return { puntaje, nivel: nivelDe(puntaje), factores, diasSinVisita };
}

/** Orden de la lista: mayor puntaje primero; "Sin datos" al final. */
export function compararPorRiesgo(
  a: { riesgo: Riesgo; nombre: string },
  b: { riesgo: Riesgo; nombre: string },
): number {
  const pa = a.riesgo.puntaje;
  const pb = b.riesgo.puntaje;
  if (pa === null && pb === null) return a.nombre.localeCompare(b.nombre, "es");
  if (pa === null) return 1;
  if (pb === null) return -1;
  if (pb !== pa) return pb - pa;
  return (b.riesgo.diasSinVisita ?? 0) - (a.riesgo.diasSinVisita ?? 0);
}
