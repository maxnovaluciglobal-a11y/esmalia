/**
 * Períodos de los reportes (A+, segundo pase): los chips "Este mes",
 * "Mes anterior", "90 días" y "Personalizado" de Finanzas y Comisiones.
 *
 * Todo trabaja con fechas civiles YYYY-MM-DD; "hoy" lo pone quien llama con
 * `hoyISO(clinic.timezone)` (regla 7). Sin Date locales: la aritmética va
 * en UTC para que un cambio de horario no corra un día.
 */
import { fechaCorta, mesAnio } from "@/lib/formato-fecha";

export type PeriodoId = "mes" | "mes-anterior" | "90-dias" | "personalizado";

export const PERIODOS: readonly { id: PeriodoId; label: string }[] = [
  { id: "mes", label: "Este mes" },
  { id: "mes-anterior", label: "Mes anterior" },
  { id: "90-dias", label: "90 días" },
  { id: "personalizado", label: "Personalizado" },
];

export type Rango = { desde: string; hasta: string };

function aUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function aIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** "2026-10-27" + 3 → "2026-10-30" (n puede ser negativo). */
export function sumarDias(iso: string, n: number): string {
  const f = aUtc(iso);
  f.setUTCDate(f.getUTCDate() + n);
  return aIso(f);
}

/** Último día del mes de `iso`. */
function finDeMes(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return aIso(new Date(Date.UTC(y, m, 0)));
}

/** El rango de un chip; "personalizado" no tiene rango propio. */
export function rangoDePeriodo(id: PeriodoId, hoy: string): Rango | null {
  switch (id) {
    case "mes":
      return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
    case "mes-anterior": {
      const ultimo = sumarDias(`${hoy.slice(0, 7)}-01`, -1);
      return { desde: `${ultimo.slice(0, 7)}-01`, hasta: ultimo };
    }
    case "90-dias":
      return { desde: sumarDias(hoy, -89), hasta: hoy };
    case "personalizado":
      return null;
  }
}

/** Qué chip queda marcado para un rango: el que coincide o "Personalizado". */
export function periodoActivo(desde: string, hasta: string, hoy: string): PeriodoId {
  for (const id of ["mes", "mes-anterior", "90-dias"] as const) {
    const r = rangoDePeriodo(id, hoy);
    if (r && r.desde === desde && r.hasta === hasta) return id;
  }
  return "personalizado";
}

/**
 * Cómo se nombra el período en el título: "octubre", "septiembre 2025",
 * "los últimos 90 días" o "1 oct — 15 oct". Va en itálica ocre.
 */
export function nombreDelPeriodo(desde: string, hasta: string, hoy: string): string {
  const activo = periodoActivo(desde, hasta, hoy);
  if (activo === "90-dias") return "los últimos 90 días";
  const mesCompleto =
    desde.slice(0, 7) === hasta.slice(0, 7) &&
    desde.endsWith("-01") &&
    (hasta === finDeMes(hasta) || activo === "mes");
  if (mesCompleto) {
    const [mes, anio] = mesAnio(desde).split(" ");
    return anio === hoy.slice(0, 4) ? mes : `${mes} ${anio}`;
  }
  if (desde === hasta) return fechaCorta(desde);
  return `${fechaCorta(desde)} — ${fechaCorta(hasta)}`;
}

/** Días civiles de un rango, incluidos los dos extremos. */
export function diasDelRango(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta).getTime() - aUtc(desde).getTime()) / 86_400_000) + 1;
}

export type PuntoDeCaja = { date: string; totalCents: number };

/**
 * Serie del gráfico "Caja por día": hasta 31 días, un punto por día del
 * rango (los días sin cobros valen 0, para que el hueco se vea); más largo,
 * se agrupa por semana de lunes a domingo, con la fecha del lunes.
 */
export function serieDeCaja(
  byDay: PuntoDeCaja[],
  desde: string,
  hasta: string,
): { porSemana: boolean; puntos: PuntoDeCaja[] } {
  const total = new Map(byDay.map((d) => [d.date, d.totalCents]));
  const dias = diasDelRango(desde, hasta);
  if (dias <= 0) return { porSemana: false, puntos: [] };
  if (dias <= 31) {
    return {
      porSemana: false,
      puntos: Array.from({ length: dias }, (_, i) => {
        const date = sumarDias(desde, i);
        return { date, totalCents: total.get(date) ?? 0 };
      }),
    };
  }
  const semanas = new Map<string, number>();
  for (let i = 0; i < dias; i++) {
    const date = sumarDias(desde, i);
    const lunes = sumarDias(date, -((aUtc(date).getUTCDay() + 6) % 7));
    semanas.set(lunes, (semanas.get(lunes) ?? 0) + (total.get(date) ?? 0));
  }
  return {
    porSemana: true,
    puntos: [...semanas.entries()].map(([date, totalCents]) => ({ date, totalCents })),
  };
}
