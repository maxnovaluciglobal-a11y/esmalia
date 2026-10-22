import { z } from "zod";

import { rutEsValido } from "@/lib/patients/rut";

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
  /** FIN-16: datos tributarios (solo para documentos; sin integración con el SII). */
  giro: string | null;
  direccionTributaria: string | null;
  comunaTributaria: string | null;
  tipoBoleta: "exenta" | "afecta" | null;
};

/**
 * FIN-16: en una clínica de Chile, la identificación fiscal es el RUT de la
 * empresa y se valida con el dígito verificador (par de `rut_es_valido`, que
 * la base aplica por trigger cuando cambia). En otros países es texto libre.
 */
export function errorRutEmpresa(taxId: string, country: string): string | null {
  const t = taxId.trim();
  if (!t || country.toUpperCase() !== "CL") return null;
  return rutEsValido(t)
    ? null
    : "El RUT de la empresa no es válido: revisa los números y el dígito verificador (por ejemplo, 76.123.456-0).";
}

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
  giro: z.string().trim().max(160).optional().default(""),
  direccionTributaria: z.string().trim().max(200).optional().default(""),
  comunaTributaria: z.string().trim().max(80).optional().default(""),
  tipoBoleta: z.enum(["exenta", "afecta", ""]).optional().default(""),
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
