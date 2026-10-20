// src/lib/marketing/molar-3d-elegible.ts
//
// El molar 3D del hero de /v2 es decoración: el SVG que llega del servidor ya
// cuenta lo mismo. three.js (~130 KB comprimido) se pide solo si el equipo lo
// puede mover sin esfuerzo y la persona no pidió menos movimiento.

export type CapacidadesEquipo = {
  /** prefers-reduced-motion: reduce. */
  reducido: boolean;
  /** Ahorro de datos (navigator.connection.saveData). */
  ahorroDeDatos: boolean;
  /** navigator.hardwareConcurrency; undefined si el navegador no lo dice. */
  nucleos: number | undefined;
  /** navigator.deviceMemory en GB; undefined si el navegador no lo dice. */
  memoriaGb: number | undefined;
  /** El navegador expone WebGL2. */
  webgl2: boolean;
};

/** Núcleos mínimos: con 4 o menos (gama baja) se queda el SVG. */
const NUCLEOS_MINIMOS = 5;
/** Memoria mínima cuando el navegador la informa (Chrome redondea a 0,5/1/2/4/8). */
const MEMORIA_MINIMA_GB = 4;

export function puedeMostrarMolar3D(c: CapacidadesEquipo): boolean {
  if (c.reducido || c.ahorroDeDatos || !c.webgl2) return false;
  if (c.nucleos === undefined || c.nucleos < NUCLEOS_MINIMOS) return false;
  if (c.memoriaGb !== undefined && c.memoriaGb < MEMORIA_MINIMA_GB) return false;
  return true;
}

/** Lee las capacidades del navegador actual. Solo en el cliente. */
export function capacidadesDelEquipo(): CapacidadesEquipo {
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  return {
    reducido: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true,
    ahorroDeDatos: nav.connection?.saveData === true,
    nucleos: nav.hardwareConcurrency || undefined,
    memoriaGb: nav.deviceMemory,
    webgl2: typeof window.WebGL2RenderingContext === "function",
  };
}
