/**
 * MKT-09 · Seguimiento de implantes (Ola 9). Parte pura: estados, schemas
 * con los mismos límites que los CHECK de la migración 20261030200300, la
 * pieza en numeración FDI y la normalización del lote para buscar. Se prueba
 * en `tests/ficha-clinica-ola9.test.ts`.
 */
import { z } from "zod";

import { numero } from "@/lib/formato-fecha";

export const ESTADOS_IMPLANTE = [
  "colocado",
  "oseointegrado",
  "cargado",
  "en_observacion",
  "fallido",
  "retirado",
] as const;
export type EstadoImplante = (typeof ESTADOS_IMPLANTE)[number];

export const ETIQUETA_ESTADO_IMPLANTE: Record<EstadoImplante, string> = {
  colocado: "Colocado",
  oseointegrado: "Oseointegrado",
  cargado: "Con prótesis",
  en_observacion: "En observación",
  fallido: "Fallido",
  retirado: "Retirado",
};

export function esEstadoImplante(v: unknown): v is EstadoImplante {
  return typeof v === "string" && (ESTADOS_IMPLANTE as readonly string[]).includes(v);
}

/** Pieza permanente en numeración FDI (11-18, 21-28, 31-38, 41-48). */
export function esPiezaFdiPermanente(n: number): boolean {
  if (!Number.isInteger(n)) return false;
  const cuadrante = Math.floor(n / 10);
  const pieza = n % 10;
  return cuadrante >= 1 && cuadrante <= 4 && pieza >= 1 && pieza <= 8;
}

/**
 * El lote tal como se compara al buscar: sin espacios a los lados y sin
 * distinguir mayúsculas (la base indexa `lower(btrim(lot))`).
 */
export function normalizarLote(lote: string): string {
  return lote.trim().toLocaleLowerCase("es");
}

/** Para un `ilike`: escapa los comodines de LIKE y las comas/paréntesis de PostgREST. */
export function patronDeLote(lote: string): string {
  const limpio = lote.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${limpio}%`;
}

const medida = (min: number, max: number, nombre: string) =>
  z
    .number()
    .min(min, `${nombre}: entre ${min} y ${max} mm.`)
    .max(max, `${nombre}: entre ${min} y ${max} mm.`)
    .transform((v) => Math.round(v * 100) / 100)
    .optional();

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const fechaCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

export const implanteSchema = z.object({
  tooth: z
    .number()
    .int()
    .refine(esPiezaFdiPermanente, "Indica la pieza en numeración FDI (11 a 48)."),
  brand: z.string().trim().min(1, "Indica la marca.").max(80),
  model: textoOpcional(80),
  diameterMm: medida(2, 8, "Diámetro"),
  lengthMm: medida(4, 25, "Largo"),
  lot: z
    .string()
    .trim()
    .min(1, "Indica el lote: es lo que se busca si el fabricante lo retira.")
    .max(60),
  reference: textoOpcional(60),
  placedOn: fechaCivil,
  professionalId: z.string().uuid().optional(),
  status: z.enum(ESTADOS_IMPLANTE).default("colocado"),
  notes: textoOpcional(1000),
});

export type ImplanteInput = z.input<typeof implanteSchema>;

export const controlImplanteSchema = z.object({
  controlledOn: fechaCivil,
  finding: z.string().trim().min(2, "Escribe qué se encontró en el control.").max(1000),
  isq: z.number().int().min(1).max(99).optional(),
  statusAfter: z.enum(ESTADOS_IMPLANTE).optional(),
});

export type ControlImplanteInput = z.input<typeof controlImplanteSchema>;

export type ControlImplante = {
  id: string;
  controlledOn: string;
  finding: string;
  isq: number | null;
  statusAfter: EstadoImplante | null;
  recordedByName: string | null;
  createdAt: string;
};

export type Implante = {
  id: string;
  patientId: string;
  tooth: number;
  brand: string;
  model: string | null;
  diameterMm: number | null;
  lengthMm: number | null;
  lot: string;
  reference: string | null;
  placedOn: string;
  professionalId: string | null;
  professionalName: string | null;
  status: EstadoImplante;
  removedOn: string | null;
  notes: string | null;
  controles: ControlImplante[];
};

/** "4,1 × 10 mm", "Ø 4,1 mm", "10 mm de largo" o null. */
export function formatearMedidas(diametro: number | null, largo: number | null): string | null {
  const f = (n: number) => numero(n, { maximumFractionDigits: 2 });
  if (diametro != null && largo != null) return `${f(diametro)} × ${f(largo)} mm`;
  if (diametro != null) return `Ø ${f(diametro)} mm`;
  if (largo != null) return `${f(largo)} mm de largo`;
  return null;
}

/** Lee un número de un input de texto ("4,1" o "4.1"); vacío = undefined, inválido = null. */
export function leerMedida(texto: string): number | undefined | null {
  const t = texto.trim().replace(",", ".");
  if (!t) return undefined;
  return /^\d{1,2}(\.\d{1,2})?$/.test(t) ? Number(t) : null;
}

/** Implante activo: el que el paciente todavía tiene puesto. */
export function estaEnBoca(estado: EstadoImplante): boolean {
  return estado !== "retirado" && estado !== "fallido";
}
