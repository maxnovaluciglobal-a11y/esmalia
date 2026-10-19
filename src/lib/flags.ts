import { useSyncExternalStore } from "react";

import { esCuentaDemo } from "@/lib/demo-cuenta";

/**
 * Flags de UI del rediseño A+ (plan del 19-oct-2026).
 *
 * Solo cambian lo que se ve: el servidor nunca depende de un flag, y toda
 * regla de permisos o de datos sigue validándose allá.
 *
 * Cómo se resuelve cada flag, en orden:
 *  1. Override en `localStorage` (`esmalia:flag:<nombre>` = "1" | "0"). Solo
 *     se respeta en desarrollo y en la cuenta demo: una clínica real no
 *     puede encenderse un flag a mano.
 *  2. Variable de Vercel `VITE_FLAG_<NOMBRE>` ("true"/"1" enciende,
 *     "false"/"0" apaga).
 *  3. Apagado.
 */
export const FLAGS_UI = [
  "shell-v2",
  "agenda-arrastre",
  "agenda-v2",
  "ficha-sugerencia-presupuesto",
  "caja-arqueo-v2",
] as const;

export type FlagUi = (typeof FLAGS_UI)[number];

// Acceso literal a cada variable: Vite reemplaza `import.meta.env.VITE_*`
// en el build, y así queda explícito qué variables lee el cliente.
function variablesDeEntorno(): Record<FlagUi, string | undefined> {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    "shell-v2": env.VITE_FLAG_SHELL_V2,
    "agenda-arrastre": env.VITE_FLAG_AGENDA_ARRASTRE,
    "agenda-v2": env.VITE_FLAG_AGENDA_V2,
    "ficha-sugerencia-presupuesto": env.VITE_FLAG_FICHA_SUGERENCIA_PRESUPUESTO,
    "caja-arqueo-v2": env.VITE_FLAG_CAJA_ARQUEO_V2,
  };
}

/** `agenda-arrastre` → `VITE_FLAG_AGENDA_ARRASTRE`. */
export function nombreVariable(flag: FlagUi): string {
  return `VITE_FLAG_${flag.toUpperCase().replace(/-/g, "_")}`;
}

export function claveOverride(flag: FlagUi): string {
  return `esmalia:flag:${flag}`;
}

function aBooleano(valor: string | null | undefined): boolean | null {
  const v = (valor ?? "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "on") return true;
  if (v === "false" || v === "0" || v === "off") return false;
  return null;
}

export type ContextoFlag = {
  /** Valor crudo de `VITE_FLAG_*`. */
  env?: string | null;
  /** `import.meta.env.DEV`. */
  dev?: boolean;
  /** Email de la sesión (para reconocer la cuenta demo). */
  email?: string | null;
  /** Valor crudo del override de `localStorage`. */
  override?: string | null;
};

/** Lógica pura de resolución (testeable sin navegador). */
export function resolverFlag(ctx: ContextoFlag): boolean {
  const puedeSobrescribir = ctx.dev === true || esCuentaDemo(ctx.email);
  if (puedeSobrescribir) {
    const override = aBooleano(ctx.override);
    if (override !== null) return override;
  }
  return aBooleano(ctx.env) ?? false;
}

function leerOverride(flag: FlagUi): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(claveOverride(flag));
  } catch {
    // Modo privado o almacenamiento bloqueado: sin override.
    return null;
  }
}

/** Estado del flag en este momento (cliente o servidor). */
export function flag(nombre: FlagUi, email?: string | null): boolean {
  return resolverFlag({
    env: variablesDeEntorno()[nombre],
    dev: import.meta.env.DEV === true,
    email,
    override: leerOverride(nombre),
  });
}

// --- Suscripción para que la UI reaccione al cambiar un override ---

const oyentes = new Set<() => void>();

function avisar() {
  for (const o of oyentes) o();
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  const alCambiarStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("esmalia:flag:")) oyente();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", alCambiarStorage);
  return () => {
    oyentes.delete(oyente);
    if (typeof window !== "undefined") window.removeEventListener("storage", alCambiarStorage);
  };
}

/**
 * Enciende o apaga un flag en este navegador. Solo tiene efecto en
 * desarrollo y en la cuenta demo (ver `resolverFlag`). `null` borra el
 * override y vuelve al valor de la variable de entorno.
 */
export function fijarOverride(nombre: FlagUi, valor: boolean | null): void {
  try {
    if (typeof window === "undefined") return;
    if (valor === null) window.localStorage.removeItem(claveOverride(nombre));
    else window.localStorage.setItem(claveOverride(nombre), valor ? "1" : "0");
  } catch {
    // Sin almacenamiento no hay override: el flag sigue con su valor de entorno.
  }
  avisar();
}

/**
 * Hook SSR seguro: en el servidor y en la hidratación solo cuenta la
 * variable de entorno (no hay `localStorage`), y después del montaje toma
 * el override si corresponde.
 */
export function useFlag(nombre: FlagUi, email?: string | null): boolean {
  return useSyncExternalStore(
    suscribir,
    () => flag(nombre, email),
    () => resolverFlag({ env: variablesDeEntorno()[nombre] }),
  );
}
