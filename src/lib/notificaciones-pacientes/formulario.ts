/**
 * MKT-07 · Formulario antes de la cita: lógica pura.
 *
 * El paciente actualiza sus datos de contacto y responde el mismo
 * cuestionario de anamnesis de la ficha (`src/lib/clinical/anamnesis.ts`).
 * Lo que envía NO toca la ficha: el staff lo revisa y decide qué pasar.
 * Acá: los schemas que valida el servidor, qué cambió respecto de la ficha y
 * cómo se suma a la anamnesis sin borrar nada de lo que ya estaba.
 */
import { z } from "zod";

import {
  conciliarAlergias,
  cuestionarioSchema,
  leerCuestionario,
  leerDetallesDeAlergias,
  type AlergiaDetallada,
  type CuestionarioRiesgo,
} from "@/lib/clinical/anamnesis";
import { esTokenValido } from "@/lib/firma-distancia/token";

export const CAMPOS_CONTACTO = [
  { key: "email", label: "Correo" },
  { key: "phone", label: "Teléfono" },
  { key: "address", label: "Dirección" },
  { key: "commune", label: "Comuna" },
  { key: "emergency_contact_name", label: "Contacto de emergencia" },
  { key: "emergency_contact_phone", label: "Teléfono de emergencia" },
  { key: "emergency_contact_relationship", label: "Parentesco del contacto de emergencia" },
] as const;

export type CampoContacto = (typeof CAMPOS_CONTACTO)[number]["key"];
export type Contacto = Partial<Record<CampoContacto, string | null>>;

const textoCorto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const ContactoSchema = z.object({
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, {
      message: "Revisa el correo: no parece válido.",
    })
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  phone: textoCorto(30),
  address: textoCorto(200),
  commune: textoCorto(80),
  emergency_contact_name: textoCorto(120),
  emergency_contact_phone: textoCorto(30),
  emergency_contact_relationship: textoCorto(60),
});

const listaCorta = z.array(z.string().trim().max(120)).max(30);

export const TokenSchema = z.string().refine(esTokenValido, "Link inválido.");

export const EnvioFormularioSchema = z.object({
  token: TokenSchema,
  contacto: ContactoSchema,
  cuestionario: cuestionarioSchema,
  alergias: listaCorta,
  medicacion: listaCorta,
  comentario: z.string().trim().max(1000).optional(),
});

export type EnvioFormulario = z.input<typeof EnvioFormularioSchema>;

/** Una lista escrita en un campo de texto: una por línea o separadas por coma. */
export function listaDesdeTexto(texto: string): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const bruto of texto.split(/[\n,;]+/)) {
    const v = bruto.trim().slice(0, 120);
    if (!v || vistos.has(v.toLocaleLowerCase("es"))) continue;
    vistos.add(v.toLocaleLowerCase("es"));
    salida.push(v);
    if (salida.length >= 30) break;
  }
  return salida;
}

export interface CambioDeContacto {
  campo: CampoContacto;
  etiqueta: string;
  antes: string | null;
  despues: string;
}

function limpio(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Qué datos de contacto cambiarían en la ficha (solo lo que el paciente escribió y es distinto). */
export function cambiosDeContacto(actual: Contacto, enviado: unknown): CambioDeContacto[] {
  const env =
    enviado && typeof enviado === "object" && !Array.isArray(enviado)
      ? (enviado as Record<string, unknown>)
      : {};
  const cambios: CambioDeContacto[] = [];
  for (const { key, label } of CAMPOS_CONTACTO) {
    const despues = limpio(env[key]);
    if (!despues) continue;
    const antes = limpio(actual[key]);
    const igual =
      key === "email"
        ? antes?.toLowerCase() === despues.toLowerCase()
        : antes?.replace(/\s+/g, " ") === despues.replace(/\s+/g, " ");
    if (!igual) cambios.push({ campo: key, etiqueta: label, antes, despues });
  }
  return cambios;
}

export interface AnamnesisActual {
  allergies: string[];
  allergy_details: unknown;
  chronic_medications: string[];
  risk_questionnaire: unknown;
}

export interface AnamnesisFusionada {
  allergies: string[];
  allergy_details: AlergiaDetallada[];
  chronic_medications: string[];
  risk_questionnaire: CuestionarioRiesgo;
}

function unir(base: readonly string[], extra: readonly string[]): string[] {
  const vistos = new Set(base.map((v) => v.trim().toLocaleLowerCase("es")));
  const salida = [...base];
  for (const v of extra) {
    const t = v.trim();
    if (!t || vistos.has(t.toLocaleLowerCase("es"))) continue;
    vistos.add(t.toLocaleLowerCase("es"));
    salida.push(t);
  }
  return salida;
}

/**
 * Suma lo que envió el paciente a la anamnesis de la ficha, sin borrar nada:
 * - cuestionario: cada respuesta del paciente reemplaza la de esa pregunta
 *   (es lo más reciente y el staff lo está aceptando); las que no respondió
 *   quedan como estaban;
 * - alergias y medicación: se agregan las nuevas (sin repetir). Una alergia
 *   nueva entra "sin especificar": la severidad la decide el profesional.
 */
export function fusionarAnamnesis(
  actual: AnamnesisActual | null,
  enviado: {
    cuestionario: unknown;
    alergias: readonly string[] | null;
    medicacion: readonly string[] | null;
  },
): AnamnesisFusionada {
  const base: AnamnesisActual = actual ?? {
    allergies: [],
    allergy_details: [],
    chronic_medications: [],
    risk_questionnaire: {},
  };
  const nombres = unir(base.allergies ?? [], enviado.alergias ?? []);
  return {
    allergies: nombres,
    allergy_details: conciliarAlergias(nombres, leerDetallesDeAlergias(base.allergy_details)),
    chronic_medications: unir(base.chronic_medications ?? [], enviado.medicacion ?? []),
    risk_questionnaire: {
      ...leerCuestionario(base.risk_questionnaire),
      ...leerCuestionario(enviado.cuestionario),
    },
  };
}
