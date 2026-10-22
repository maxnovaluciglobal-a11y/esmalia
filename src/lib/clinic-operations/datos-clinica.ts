import { z } from "zod";

/**
 * Datos editables de la clínica ACTUAL (UX-03, Ola 0). Antes Ajustes llevaba
 * a `/onboarding`, que crea una clínica nueva: quien quería corregir el
 * nombre terminaba con una segunda clínica vacía.
 *
 * País y moneda no se editan acá: todos los montos guardados están en esa
 * moneda (regla 14, el trigger `moneda_desde_la_clinica` la toma de la
 * clínica) y cambiarla reinterpretaría la plata ya cargada.
 */
export type DatosClinica = {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  country: string;
  currency: string;
  timezone: string;
};

/** ¿El navegador/servidor reconoce la zona horaria IANA? */
export function esZonaHorariaValida(zona: string): boolean {
  if (!zona || zona.length > 60) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/** Campos editables (sin `clinicId`, que agrega la server function). */
export const camposDatosClinica = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 letras.").max(120),
  legalName: z.string().trim().max(160),
  taxId: z.string().trim().max(40),
  timezone: z.string().trim().refine(esZonaHorariaValida, "Elige una zona horaria de la lista."),
});

export type CamposDatosClinica = z.infer<typeof camposDatosClinica>;

/** Zonas horarias que ofrece el selector: las de América, más la actual. */
export function zonasHorariasDisponibles(actual: string): string[] {
  let todas: string[] = [];
  try {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] };
    todas = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    todas = [];
  }
  const america = todas.filter((z) => z.startsWith("America/"));
  const lista = new Set([...america, actual].filter(Boolean));
  return [...lista].sort((a, b) => a.localeCompare(b));
}

/** "America/Argentina/Buenos_Aires" → "Argentina / Buenos Aires". */
export function etiquetaZonaHoraria(zona: string): string {
  return zona
    .replace(/^America\//, "")
    .replace(/_/g, " ")
    .replace(/\//g, " / ");
}
