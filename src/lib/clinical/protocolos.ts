/**
 * FIC-15 · Protocolos clínicos (Ola 9). Parte pura: el schema que valida el
 * servidor, cómo se lee la lista de pasos de la base y el texto que entra en
 * la nota al aplicar un protocolo. Se prueba en `tests/ficha-clinica-ola9.test.ts`.
 *
 * Decisión: aplicar un protocolo copia su texto a la nota. Así queda
 * registrado en la versión de la nota (y en su firma) tal como se aplicó,
 * aunque después alguien edite o desactive el protocolo. No hay una tabla
 * intermedia que se pueda separar de lo que dice la nota.
 */
import { z } from "zod";

export const MAX_PASOS_PROTOCOLO = 40;

export const protocoloSchema = z.object({
  name: z.string().trim().min(2, "Ponle un nombre de al menos 2 letras.").max(120),
  procedureLabel: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
  steps: z
    .array(z.string().trim().min(1).max(300))
    .transform((pasos) => pasos.filter((p) => p.length > 0))
    .pipe(
      z
        .array(z.string())
        .min(1, "Agrega al menos un paso.")
        .max(MAX_PASOS_PROTOCOLO, `Hasta ${MAX_PASOS_PROTOCOLO} pasos.`),
    ),
  indications: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type ProtocoloInput = z.input<typeof protocoloSchema>;

export type ProtocoloClinico = {
  id: string;
  name: string;
  procedureLabel: string | null;
  steps: string[];
  indications: string | null;
  active: boolean;
  updatedAt: string;
};

/** Lee `steps` (jsonb) sin confiar en su forma. */
export function leerPasos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Separa un texto pegado (una línea por paso, con o sin viñetas ni números). */
export function pasosDesdeTexto(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

/**
 * El bloque que se agrega a la nota. Texto plano: la nota es texto y su
 * firma es la huella de ese texto. Los pasos van numerados para que la nota
 * firmada diga exactamente qué se indicó y en qué orden.
 */
export function textoDeProtocolo(p: {
  name: string;
  procedureLabel?: string | null;
  steps: readonly string[];
  indications?: string | null;
}): string {
  const titulo = p.procedureLabel?.trim()
    ? `Protocolo aplicado: ${p.name.trim()} (${p.procedureLabel.trim()})`
    : `Protocolo aplicado: ${p.name.trim()}`;
  const pasos = p.steps.map((paso, i) => `${i + 1}. ${paso.trim()}`);
  const indicaciones = p.indications?.trim()
    ? ["", "Indicaciones al paciente:", p.indications.trim()]
    : [];
  return [titulo, ...pasos, ...indicaciones].join("\n");
}

/** Agrega el protocolo al final de lo que ya está escrito, separado por una línea. */
export function agregarProtocoloANota(contenido: string, bloque: string): string {
  const base = contenido.replace(/\s+$/, "");
  return base ? `${base}\n\n${bloque}` : bloque;
}
