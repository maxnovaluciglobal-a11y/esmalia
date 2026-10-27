/**
 * FIC-14 · Interconsultas y derivaciones (Ola 9). Parte pura: estados y sus
 * transiciones (las mismas que valida el trigger `validar_interconsulta`),
 * etiquetas, schemas y los campos del documento de derivación del motor de
 * plantillas (Ola 4). Se prueba en `tests/ficha-clinica-ola9.test.ts`.
 */
import { z } from "zod";

export const ESTADOS_INTERCONSULTA = [
  "pedida",
  "enviada",
  "respondida",
  "cerrada",
  "cancelada",
] as const;
export type EstadoInterconsulta = (typeof ESTADOS_INTERCONSULTA)[number];

export const ETIQUETA_ESTADO_INTERCONSULTA: Record<EstadoInterconsulta, string> = {
  pedida: "Pedida",
  enviada: "Enviada",
  respondida: "Respondida",
  cerrada: "Cerrada",
  cancelada: "Cancelada",
};

export const URGENCIAS_INTERCONSULTA = ["normal", "preferente", "urgente"] as const;
export type UrgenciaInterconsulta = (typeof URGENCIAS_INTERCONSULTA)[number];

export const ETIQUETA_URGENCIA: Record<UrgenciaInterconsulta, string> = {
  normal: "Normal",
  preferente: "Preferente",
  urgente: "Urgente",
};

/** Especialidades sugeridas (se puede escribir otra). */
export const ESPECIALIDADES_SUGERIDAS = [
  "Cirugía maxilofacial",
  "Endodoncia",
  "Periodoncia",
  "Ortodoncia",
  "Odontopediatría",
  "Rehabilitación oral",
  "Implantología",
  "Trastornos temporomandibulares",
  "Radiología maxilofacial",
  "Medicina interna",
  "Cardiología",
  "Otorrinolaringología",
] as const;

/** A qué estados puede pasar cada uno (igual que el trigger de la base). */
export const TRANSICIONES_INTERCONSULTA: Record<EstadoInterconsulta, EstadoInterconsulta[]> = {
  pedida: ["enviada", "respondida", "cancelada"],
  enviada: ["respondida", "cancelada"],
  respondida: ["cerrada"],
  cerrada: [],
  cancelada: [],
};

export function puedePasarA(desde: EstadoInterconsulta, hasta: EstadoInterconsulta): boolean {
  return TRANSICIONES_INTERCONSULTA[desde].includes(hasta);
}

/** Abierta = todavía espera algo del especialista. */
export function estaAbierta(estado: EstadoInterconsulta): boolean {
  return estado === "pedida" || estado === "enviada";
}

export function esEstadoInterconsulta(v: unknown): v is EstadoInterconsulta {
  return typeof v === "string" && (ESTADOS_INTERCONSULTA as readonly string[]).includes(v);
}

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const nuevaInterconsultaSchema = z.object({
  specialty: z.string().trim().min(2, "Indica la especialidad.").max(80),
  destination: textoOpcional(160),
  destinationContact: textoOpcional(160),
  reason: z.string().trim().min(3, "Escribe el motivo de la interconsulta.").max(2000),
  request: textoOpcional(2000),
  urgency: z.enum(URGENCIAS_INTERCONSULTA).default("normal"),
});

export type NuevaInterconsulta = z.input<typeof nuevaInterconsultaSchema>;

export const cambioDeEstadoSchema = z.discriminatedUnion("estado", [
  z.object({ estado: z.literal("enviada") }),
  z.object({
    estado: z.literal("respondida"),
    response: z.string().trim().min(2, "Escribe la respuesta del especialista.").max(4000),
  }),
  z.object({ estado: z.literal("cerrada") }),
  z.object({
    estado: z.literal("cancelada"),
    cancelReason: z.string().trim().min(3, "Indica por qué se cancela.").max(500),
  }),
]);

export type CambioDeEstado = z.infer<typeof cambioDeEstadoSchema>;

export type Interconsulta = {
  id: string;
  patientId: string;
  specialty: string;
  destination: string | null;
  destinationContact: string | null;
  reason: string;
  request: string | null;
  urgency: UrgenciaInterconsulta;
  status: EstadoInterconsulta;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  sentAt: string | null;
  response: string | null;
  respondedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  issuedDocumentId: string | null;
};

/**
 * Campos de la plantilla "derivacion" del motor de documentos (Ola 4):
 * `derivado_a`, `motivo`, `antecedentes` y `solicitud`. Los antecedentes
 * salen de las alertas de la anamnesis (lo que el especialista necesita
 * saber: alergias, anticoagulantes, embarazo…); si no hay, lo dice en vez de
 * dejar el campo vacío (que la plantilla exige).
 */
export function camposDeDerivacion(
  i: Pick<Interconsulta, "specialty" | "destination" | "reason" | "request" | "urgency">,
  antecedentes: readonly string[],
): Record<"derivado_a" | "motivo" | "antecedentes" | "solicitud", string> {
  const destino = i.destination?.trim()
    ? `${i.specialty.trim()} · ${i.destination.trim()}`
    : i.specialty.trim();
  const urgencia = i.urgency === "normal" ? "" : ` (${ETIQUETA_URGENCIA[i.urgency].toLowerCase()})`;
  return {
    derivado_a: destino,
    motivo: `${i.reason.trim()}${urgencia}`,
    antecedentes: antecedentes.length
      ? antecedentes.join("; ")
      : "Sin antecedentes médicos relevantes registrados en la ficha.",
    solicitud: i.request?.trim() || "Evaluación y tratamiento según corresponda.",
  };
}
