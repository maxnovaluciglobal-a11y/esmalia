/**
 * Nivel de inserción clínica y comparación de exámenes periodontales
 * (Ola 9, PER-02 y PER-03). Lógica pura.
 *
 * NIC = profundidad de sondaje + posición del margen gingival respecto del
 * límite amelocementario. En `periodontal_measurements` la recesión es
 * positiva cuando el margen está apical al límite (recesión) y negativa
 * cuando está coronal (agrandamiento), así que NIC = PD + recesión.
 *
 * Regla 11: sin recesión registrada no hay NIC (no se asume 0). Para un
 * margen justo en el límite amelocementario se carga recesión 0.
 */
import {
  PERIODONTAL_POINTS,
  type PeriodontalChart,
  type PeriodontalPoint,
} from "@/lib/clinical/periodontal";

/** NIC de un sitio en mm, o `null` si falta la profundidad o la recesión. Nunca negativo. */
export function nicDeSitio(pd: number | null, recesion: number | null): number | null {
  if (pd === null || recesion === null || !Number.isFinite(pd) || !Number.isFinite(recesion)) {
    return null;
  }
  // Un agrandamiento mayor que la bolsa deja la inserción en el límite: 0, no negativa.
  return Math.max(0, pd + recesion);
}

export type SeveridadNic = "sin_perdida" | "leve" | "moderada" | "severa";

export const ETIQUETA_SEVERIDAD_NIC: Record<SeveridadNic, string> = {
  sin_perdida: "Sin pérdida",
  leve: "Leve (1-2 mm)",
  moderada: "Moderada (3-4 mm)",
  severa: "Severa (5 mm o más)",
};

/**
 * Severidad por pérdida de inserción (rangos de la clasificación AAP/EFP
 * 2017: 1-2, 3-4 y 5 o más mm). Orientativa: el estadio lo decide el
 * profesional con la radiografía y el resto del examen.
 */
export function severidadNic(mm: number | null): SeveridadNic | null {
  if (mm === null) return null;
  if (mm <= 0) return "sin_perdida";
  if (mm <= 2) return "leve";
  if (mm <= 4) return "moderada";
  return "severa";
}

export interface ResumenNic {
  /** Sitios con NIC calculable (PD y recesión cargadas). */
  sitiosConNic: number;
  /** Sitios con profundidad cargada pero sin recesión: les falta el dato para el NIC. */
  sitiosSinRecesion: number;
  promedio: number | null;
  maximo: number | null;
  /** Pieza y sitio del NIC máximo (el primero, si hay empate). */
  sitioMaximo: { toothNumber: number; point: PeriodontalPoint } | null;
  porSeveridad: Record<SeveridadNic, number>;
}

/** NIC de cada sitio de una pieza, en el orden de `PERIODONTAL_POINTS`. */
export function nicDePieza(
  tooth: PeriodontalChart["teeth"][number],
): Record<PeriodontalPoint, number | null> {
  const porPunto = new Map(tooth.points.map((p) => [p.point, p]));
  return Object.fromEntries(
    PERIODONTAL_POINTS.map((point) => {
      const m = porPunto.get(point);
      return [point, nicDeSitio(m?.pocketDepthMm ?? null, m?.recessionMm ?? null)];
    }),
  ) as Record<PeriodontalPoint, number | null>;
}

/** Resumen del NIC de un examen: promedio, máximo y sitios por severidad. */
export function resumenNic(chart: Pick<PeriodontalChart, "teeth">): ResumenNic {
  const porSeveridad: Record<SeveridadNic, number> = {
    sin_perdida: 0,
    leve: 0,
    moderada: 0,
    severa: 0,
  };
  let suma = 0;
  let sitiosConNic = 0;
  let sitiosSinRecesion = 0;
  let maximo: number | null = null;
  let sitioMaximo: ResumenNic["sitioMaximo"] = null;
  for (const tooth of chart.teeth) {
    for (const p of tooth.points) {
      if (p.pocketDepthMm === null) continue;
      const nic = nicDeSitio(p.pocketDepthMm, p.recessionMm);
      if (nic === null) {
        sitiosSinRecesion += 1;
        continue;
      }
      sitiosConNic += 1;
      suma += nic;
      porSeveridad[severidadNic(nic)!] += 1;
      if (maximo === null || nic > maximo) {
        maximo = nic;
        sitioMaximo = { toothNumber: tooth.toothNumber, point: p.point };
      }
    }
  }
  return {
    sitiosConNic,
    sitiosSinRecesion,
    promedio: sitiosConNic ? Math.round((suma / sitiosConNic) * 10) / 10 : null,
    maximo,
    sitioMaximo,
    porSeveridad,
  };
}

// ─── Comparación de exámenes (PER-03) ────────────────────────────────────

/**
 * Cambio mínimo en mm para decir que un sitio mejoró o empeoró. Con sonda
 * manual, 1 mm está dentro del error de medición; 2 mm es el umbral que usa
 * la literatura periodontal para un cambio real de inserción.
 */
export const UMBRAL_CAMBIO_MM = 2;

export type Tendencia = "mejoro" | "empeoro" | "estable";

export const ETIQUETA_TENDENCIA: Record<Tendencia, string> = {
  mejoro: "Mejoró",
  empeoro: "Empeoró",
  estable: "Sin cambio",
};

export interface SitioComparado {
  toothNumber: number;
  point: PeriodontalPoint;
  pdAntes: number;
  pdDespues: number;
  /** Después menos antes: negativo = la bolsa se achicó. */
  deltaPd: number;
  nicAntes: number | null;
  nicDespues: number | null;
  /** `null` si alguno de los dos exámenes no tiene recesión en el sitio. */
  deltaNic: number | null;
  sangradoAntes: boolean | null;
  sangradoDespues: boolean | null;
  /** Decide con el NIC si se puede (es la inserción); si no, con la profundidad. */
  tendencia: Tendencia;
  /** Qué medida decidió la tendencia. */
  base: "nic" | "pd";
}

export interface ResumenComparacion {
  comparables: number;
  mejoraron: number;
  empeoraron: number;
  estables: number;
  /** Sitios medidos solo en uno de los dos exámenes (no se comparan). */
  soloAntes: number;
  soloDespues: number;
  pdMedioAntes: number | null;
  pdMedioDespues: number | null;
  /** % de sitios comparables con sangrado, antes y después. `null` sin datos de sangrado. */
  sangradoAntesPct: number | null;
  sangradoDespuesPct: number | null;
  /** Sitios comparables con bolsa de 4 mm o más, antes y después. */
  bolsas4Antes: number;
  bolsas4Despues: number;
}

export interface Comparacion {
  /** El examen más antiguo y el más reciente, sin importar el orden en que se eligieron. */
  antesId: string;
  despuesId: string;
  sitios: SitioComparado[];
  resumen: ResumenComparacion;
}

function tendenciaDe(delta: number): Tendencia {
  if (delta <= -UMBRAL_CAMBIO_MM) return "mejoro";
  if (delta >= UMBRAL_CAMBIO_MM) return "empeoro";
  return "estable";
}

function promedio(valores: number[]): number | null {
  if (!valores.length) return null;
  return Math.round((valores.reduce((s, v) => s + v, 0) / valores.length) * 10) / 10;
}

function pct(parte: number, total: number): number | null {
  return total ? Math.round((parte / total) * 100) : null;
}

type ExamenComparable = Pick<PeriodontalChart, "id" | "recordedAt" | "teeth">;

/**
 * Compara dos exámenes sitio por sitio. Solo se comparan los sitios con
 * profundidad cargada en los dos; el resto se cuenta aparte. El orden de los
 * argumentos no importa: el más antiguo es siempre "antes".
 */
export function compararExamenes(a: ExamenComparable, b: ExamenComparable): Comparacion {
  const [antes, despues] = a.recordedAt <= b.recordedAt ? [a, b] : [b, a];
  const clave = (t: number, p: PeriodontalPoint) => `${t}:${p}`;
  const indice = (chart: ExamenComparable) => {
    const map = new Map<
      string,
      {
        toothNumber: number;
        point: PeriodontalPoint;
        pd: number;
        rec: number | null;
        bop: boolean | null;
      }
    >();
    for (const tooth of chart.teeth) {
      for (const p of tooth.points) {
        if (p.pocketDepthMm === null) continue;
        map.set(clave(tooth.toothNumber, p.point), {
          toothNumber: tooth.toothNumber,
          point: p.point,
          pd: p.pocketDepthMm,
          rec: p.recessionMm,
          bop: p.bleeding,
        });
      }
    }
    return map;
  };
  const ia = indice(antes);
  const ib = indice(despues);

  const sitios: SitioComparado[] = [];
  let soloAntes = 0;
  for (const [k, x] of ia) {
    const y = ib.get(k);
    if (!y) {
      soloAntes += 1;
      continue;
    }
    const nicAntes = nicDeSitio(x.pd, x.rec);
    const nicDespues = nicDeSitio(y.pd, y.rec);
    const deltaNic = nicAntes !== null && nicDespues !== null ? nicDespues - nicAntes : null;
    const deltaPd = y.pd - x.pd;
    sitios.push({
      toothNumber: x.toothNumber,
      point: x.point,
      pdAntes: x.pd,
      pdDespues: y.pd,
      deltaPd,
      nicAntes,
      nicDespues,
      deltaNic,
      sangradoAntes: x.bop,
      sangradoDespues: y.bop,
      tendencia: tendenciaDe(deltaNic ?? deltaPd),
      base: deltaNic !== null ? "nic" : "pd",
    });
  }
  const soloDespues = [...ib.keys()].filter((k) => !ia.has(k)).length;

  const orden = (p: PeriodontalPoint) => PERIODONTAL_POINTS.indexOf(p);
  sitios.sort((x, y) => x.toothNumber - y.toothNumber || orden(x.point) - orden(y.point));

  const conSangradoAntes = sitios.filter((s) => s.sangradoAntes !== null);
  const conSangradoDespues = sitios.filter((s) => s.sangradoDespues !== null);
  return {
    antesId: antes.id,
    despuesId: despues.id,
    sitios,
    resumen: {
      comparables: sitios.length,
      mejoraron: sitios.filter((s) => s.tendencia === "mejoro").length,
      empeoraron: sitios.filter((s) => s.tendencia === "empeoro").length,
      estables: sitios.filter((s) => s.tendencia === "estable").length,
      soloAntes,
      soloDespues,
      pdMedioAntes: promedio(sitios.map((s) => s.pdAntes)),
      pdMedioDespues: promedio(sitios.map((s) => s.pdDespues)),
      sangradoAntesPct: pct(
        conSangradoAntes.filter((s) => s.sangradoAntes).length,
        conSangradoAntes.length,
      ),
      sangradoDespuesPct: pct(
        conSangradoDespues.filter((s) => s.sangradoDespues).length,
        conSangradoDespues.length,
      ),
      bolsas4Antes: sitios.filter((s) => s.pdAntes >= 4).length,
      bolsas4Despues: sitios.filter((s) => s.pdDespues >= 4).length,
    },
  };
}
