/**
 * Paciente menor de edad y su tutor o representante legal (hallazgo CLI-11,
 * auditoría 360 del 18-oct-2026).
 *
 * Parte pura: cuándo un paciente es menor, quién es su tutor principal y a
 * quién se le escriben las comunicaciones. La base aplica la misma regla de
 * edad al firmar un consentimiento (trigger `stamp_patient_consent_signer`,
 * migración 20261019180000); este módulo es lo que usa la pantalla para
 * avisar antes y lo que usa el servidor para elegir el destinatario.
 * Pruebas en `tests/tutor-menor.test.ts`.
 */
import { z } from "zod";

/** 18 en Chile, Argentina, Colombia, Perú y México. */
export const MAYORIA_DE_EDAD = 18;

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Día en que cumple 18 (YYYY-MM-DD). Quien nació un 29 de febrero cumple el
 * 28 en un año no bisiesto: es lo mismo que hace Postgres con
 * `birth_date + interval '18 years'`, así que la pantalla y el trigger nunca
 * discrepan.
 */
export function fechaDeMayoriaDeEdad(fechaNacimiento: string): string | null {
  const m = FECHA.exec(fechaNacimiento.slice(0, 10));
  if (!m) return null;
  const anio = Number(m[1]) + MAYORIA_DE_EDAD;
  const mes = Number(m[2]);
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(Number(m[3]), ultimoDia);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * `true` si a la fecha `hoy` (YYYY-MM-DD, en la zona horaria de la clínica)
 * todavía no cumplió 18. `null` si no hay fecha de nacimiento válida: no se
 * sabe, y no se inventa (regla 11).
 */
export function esMenorDeEdad(
  fechaNacimiento: string | null | undefined,
  hoy: string,
): boolean | null {
  if (!fechaNacimiento) return null;
  const mayoria = fechaDeMayoriaDeEdad(fechaNacimiento);
  if (!mayoria) return null;
  return hoy.slice(0, 10) < mayoria;
}

// ── Tutores ───────────────────────────────────────────────────────────────

export const PARENTESCOS = ["madre", "padre", "tutor_legal", "familiar", "otro"] as const;
export type Parentesco = (typeof PARENTESCOS)[number];

export const etiquetaParentesco: Record<Parentesco, string> = {
  madre: "Madre",
  padre: "Padre",
  tutor_legal: "Tutor legal",
  familiar: "Otro familiar",
  otro: "Otro representante",
};

export type Tutor = {
  id: string;
  fullName: string;
  documentId: string;
  relationship: Parentesco;
  relationshipDetail: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  archivedAt: string | null;
};

/** Cómo se lee el parentesco: el detalle ("Abuela") manda sobre la categoría. */
export function parentescoLegible(t: Pick<Tutor, "relationship" | "relationshipDetail">): string {
  return t.relationshipDetail?.trim() || etiquetaParentesco[t.relationship];
}

/** Tutores vigentes, el principal primero. */
export function tutoresVigentes(tutores: readonly Tutor[]): Tutor[] {
  return tutores
    .filter((t) => !t.archivedAt)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

/** El principal vigente; si nadie está marcado, el primero vigente. */
export function tutorPrincipal(tutores: readonly Tutor[]): Tutor | null {
  return tutoresVigentes(tutores)[0] ?? null;
}

export const tutorSchema = z
  .object({
    fullName: z.string().trim().min(2, "Escribe el nombre completo.").max(120),
    documentId: z.string().trim().min(3, "Escribe el documento de identidad.").max(40),
    relationship: z.enum(PARENTESCOS),
    relationshipDetail: z.string().trim().max(60).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z
      .string()
      .trim()
      .max(160)
      .email("El correo no tiene un formato válido.")
      .optional()
      .or(z.literal("")),
    isPrimary: z.boolean().default(false),
  })
  .refine((t) => Boolean(t.phone?.trim()) || Boolean(t.email?.trim()), {
    message: "Agrega un teléfono o un correo para poder contactarlo.",
    path: ["phone"],
  });

export type TutorInput = z.input<typeof tutorSchema>;

// ── Destinatario de las comunicaciones ────────────────────────────────────

export type Destinatario = {
  telefono: string | null;
  email: string | null;
  /** A nombre de quién sale el mensaje. */
  para: "paciente" | "tutor";
  tutor: Pick<Tutor, "id" | "fullName"> | null;
};

/**
 * A quién se le escribe. Si el paciente es menor y tiene un tutor vigente,
 * al tutor; si no, al paciente. Canal por canal: si el tutor no dejó
 * teléfono, el WhatsApp cae al teléfono de la ficha del paciente (que en un
 * niño casi siempre es el de un adulto) en vez de quedar sin destino.
 */
export function destinatarioDeComunicaciones(datos: {
  fechaNacimiento: string | null | undefined;
  hoy: string;
  telefonoPaciente: string | null | undefined;
  emailPaciente: string | null | undefined;
  tutores: readonly Tutor[];
}): Destinatario {
  const paciente: Destinatario = {
    telefono: datos.telefonoPaciente?.trim() || null,
    email: datos.emailPaciente?.trim() || null,
    para: "paciente",
    tutor: null,
  };
  if (esMenorDeEdad(datos.fechaNacimiento, datos.hoy) !== true) return paciente;
  const tutor = tutorPrincipal(datos.tutores);
  if (!tutor) return paciente;
  return {
    telefono: tutor.phone?.trim() || paciente.telefono,
    email: tutor.email?.trim() || paciente.email,
    para: "tutor",
    tutor: { id: tutor.id, fullName: tutor.fullName },
  };
}
