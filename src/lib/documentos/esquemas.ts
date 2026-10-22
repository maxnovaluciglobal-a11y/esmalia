/**
 * Validación de lo que vuelve de la base y de lo que viaja al emitir. Los
 * bloques guardados (`issued_documents.content_blocks`) se validan al leer:
 * la pantalla los pinta con React y el PDF los recorre, así que una fila
 * escrita a mano por PostgREST con otra forma se descarta en vez de romper.
 */
import { z } from "zod";

import type { Bloque } from "@/lib/documentos/tipos";

const TramoSchema = z.union([
  z.object({
    tipo: z.literal("texto"),
    texto: z.string().max(20_000),
    negrita: z.boolean().optional(),
    variable: z.string().max(80).optional(),
    faltante: z.boolean().optional(),
    desconocida: z.boolean().optional(),
  }),
  z.object({ tipo: z.literal("salto") }),
]);

const BloqueSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("titulo"),
    nivel: z.union([z.literal(1), z.literal(2)]),
    tramos: z.array(TramoSchema).max(500),
  }),
  z.object({ tipo: z.literal("parrafo"), tramos: z.array(TramoSchema).max(2000) }),
  z.object({ tipo: z.literal("lista"), items: z.array(z.array(TramoSchema).max(500)).max(200) }),
  z.object({
    tipo: z.literal("tabla"),
    columnas: z
      .array(z.object({ titulo: z.string().max(80), alineacion: z.enum(["izquierda", "derecha"]) }))
      .min(1)
      .max(8),
    filas: z.array(z.array(z.string().max(500)).max(8)).max(500),
    pie: z.array(z.string().max(200)).max(8).optional(),
    vacia: z.string().max(200).optional(),
    destacadas: z.array(z.number().int().min(0).max(499)).max(500).optional(),
  }),
  z.object({
    tipo: z.literal("firma"),
    nombre: z.string().max(200),
    registro: z.string().max(200).nullable(),
    especialidad: z.string().max(200).nullable(),
  }),
]);

export const BloquesSchema = z.array(BloqueSchema).max(400);

/** Bloques guardados → bloques, o null si la forma no es la esperada. */
export function leerBloques(valor: unknown): Bloque[] | null {
  const r = BloquesSchema.safeParse(valor);
  return r.success ? (r.data as Bloque[]) : null;
}

/** Campos completados al emitir: nombre → texto. */
export const CamposSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Nombre de campo inválido."),
    z.string().trim().max(4000),
  )
  .refine((r) => Object.keys(r).length <= 40, "Demasiados campos.");
