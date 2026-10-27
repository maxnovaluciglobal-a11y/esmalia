/**
 * Ola 13: cupo de almacenamiento por clínica (cálculo puro).
 *
 * El valor que manda está en la base (`storage_quota_plans`, migración
 * 20261109100000) y lo devuelve `uso_de_almacenamiento()`. Estos valores son
 * los cupos decididos por Walter (27-oct-2026: 25 GB Solo, 75 GB Clínica) y solo
 * se usan como respaldo de la pantalla. `tests/examenes-cupo.test.ts` vigila
 * que coincidan con la migración 20261111100000.
 */
import { MB } from "@/lib/examenes/tipos";

export const GB = 1024 * MB;

export type PlanAlmacenamiento = "solo" | "clinica";

export const CUPO_POR_PLAN: Record<PlanAlmacenamiento, number> = {
  solo: 25 * GB,
  clinica: 75 * GB,
};

export const ETIQUETA_PLAN: Record<PlanAlmacenamiento, string> = {
  solo: "Solo",
  clinica: "Clínica",
};

/** Desde qué fracción del cupo se avisa. */
export const UMBRAL_AVISO = 0.8;

export type NivelCupo = "normal" | "aviso" | "lleno";

export interface EstadoCupo {
  usado: number;
  cupo: number;
  restante: number;
  /** 0-100, entero, sin pasar de 100 aunque el uso lo supere. */
  porcentaje: number;
  nivel: NivelCupo;
}

export function estadoDelCupo(usado: number, cupo: number): EstadoCupo {
  const u = Math.max(0, usado);
  const c = Math.max(0, cupo);
  const fraccion = c > 0 ? u / c : 1;
  const nivel: NivelCupo = fraccion >= 1 ? "lleno" : fraccion >= UMBRAL_AVISO ? "aviso" : "normal";
  // Sin redondear hacia arriba a 100 si todavía queda lugar (99,6 % no es lleno).
  const porcentaje = nivel === "lleno" ? 100 : Math.min(99, Math.floor(fraccion * 100));
  return { usado: u, cupo: c, restante: Math.max(0, c - u), porcentaje, nivel };
}

/** ¿Entra un archivo de `tamano` bytes? Misma regla que el trigger de la base. */
export function cabeEnElCupo(usado: number, cupo: number, tamano: number): boolean {
  return usado + tamano <= cupo;
}

/** Texto del aviso según el nivel; null si no hay que avisar. */
export function avisoDelCupo(estado: EstadoCupo): string | null {
  if (estado.nivel === "lleno") {
    return "Tu clínica usó todo su almacenamiento. No se pueden subir más exámenes hasta ampliar el cupo: escríbenos y lo resolvemos.";
  }
  if (estado.nivel === "aviso") {
    return `Tu clínica ya usó el ${estado.porcentaje} % de su almacenamiento. Cuando llegue al 100 % no se podrán subir más exámenes.`;
  }
  return null;
}

/** Códigos que devuelve la base (migración 20261109100100). */
export const CODIGO_CUPO_LLENO = "ES001";
export const CODIGO_ARCHIVO_GRANDE = "ES002";
