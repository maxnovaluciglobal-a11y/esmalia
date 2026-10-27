import { z } from "zod";

import { formatearRut, rutEsValido } from "@/lib/patients/rut";

/**
 * Reserva en línea (Ola 7 · RES-01 a RES-07): lógica pura compartida por la
 * página pública, la configuración y el servidor. Sin I/O.
 */

// ─── Dirección del link (slug) ────────────────────────────────────────────

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
export const LARGO_MAX_SLUG = 48;

export function esSlugValido(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG.test(slug);
}

/** "Clínica Dental Ñuñoa" → "clinica-dental-nunoa". Vacío si no queda nada. */
export function normalizarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LARGO_MAX_SLUG)
    .replace(/-+$/g, "");
}

/** Problema del slug para mostrar en la configuración, o null si sirve. */
export function problemaDeSlug(slug: string): string | null {
  if (slug.length < 3) return "La dirección necesita al menos 3 letras o números.";
  if (slug.length > LARGO_MAX_SLUG)
    return `La dirección admite hasta ${LARGO_MAX_SLUG} caracteres.`;
  if (!SLUG.test(slug)) {
    return "Usa solo letras minúsculas sin tildes, números y guiones (sin guion al inicio ni al final).";
  }
  return null;
}

/**
 * Slug de cada profesional para `/reservar/<clínica>/<profesional>`: su
 * nombre normalizado ("dra-paz-rojas"). Si dos se llaman igual, el segundo
 * lleva el inicio de su id para no chocar.
 */
export function slugsDeProfesionales(
  profesionales: readonly { id: string; nombre: string }[],
): Map<string, string> {
  const usados = new Map<string, number>();
  const out = new Map<string, string>();
  const ordenados = [...profesionales].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of ordenados) {
    const base = normalizarSlug(p.nombre) || "profesional";
    const n = usados.get(base) ?? 0;
    usados.set(base, n + 1);
    out.set(p.id, n === 0 ? base : `${base}-${p.id.slice(0, 4).toLowerCase()}`);
  }
  return out;
}

// ─── Motivos reservables ──────────────────────────────────────────────────

export type TipoMotivo = "procedimiento" | "tipo";

export interface MotivoReserva {
  tipo: TipoMotivo;
  id: string;
  nombre: string;
  duracion: number;
}

export function claveDeMotivo(m: Pick<MotivoReserva, "tipo" | "id">): string {
  return `${m.tipo === "procedimiento" ? "p" : "t"}:${m.id}`;
}

export function duracionLegible(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ─── Datos del paciente ───────────────────────────────────────────────────

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function esEmailValido(email: string): boolean {
  const e = normalizarEmail(email);
  return e.length <= 254 && EMAIL.test(e);
}

/** RUT opcional: vacío = null; con texto, tiene que ser válido (mod 11). */
export function rutDeReserva(rut: string | null | undefined): string | null | "invalido" {
  const t = (rut ?? "").trim();
  if (!t) return null;
  return rutEsValido(t) ? formatearRut(t) : "invalido";
}

// ─── Solicitud ────────────────────────────────────────────────────────────

const Uuid = z.string().uuid();
const HoraLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Horario inválido.");

/** Lo que manda la página pública para pedir el código y para confirmar. */
export const SolicitudReservaSchema = z.object({
  slug: z.string().refine(esSlugValido, "Link inválido."),
  sucursalId: Uuid,
  profesionalId: Uuid,
  motivo: z.object({ tipo: z.enum(["procedimiento", "tipo"]), id: Uuid }),
  /** Hora de pared de la sucursal, "YYYY-MM-DDTHH:mm". */
  inicio: HoraLocal,
  nombre: z
    .string()
    .trim()
    .min(2, "Escribe tu nombre y apellido.")
    .max(200, "El nombre es demasiado largo."),
  email: z
    .string()
    .trim()
    .max(254, "El correo es demasiado largo.")
    .refine(esEmailValido, "Revisa tu correo: ahí te llega el código."),
  telefono: z.string().trim().min(6, "Escribe tu teléfono.").max(40, "Teléfono inválido."),
  rut: z.string().trim().max(20).optional().default(""),
  nota: z.string().trim().max(500, "La nota admite hasta 500 caracteres.").optional().default(""),
  /** Trampa para bots: el campo está oculto, una persona lo deja vacío. */
  sitioWeb: z.string().max(200).optional().default(""),
});

export type SolicitudReserva = z.infer<typeof SolicitudReservaSchema>;

/**
 * Texto canónico de la solicitud: el código queda atado a ESTA reserva
 * (horario, profesional, motivo y datos). Si algo cambia, hay que pedir otro.
 */
export function textoCanonicoSolicitud(
  s: SolicitudReserva,
  telefonoNormalizado: string,
  rut: string | null,
): string {
  return JSON.stringify([
    "reserva-v1",
    s.slug,
    s.sucursalId.toLowerCase(),
    s.profesionalId.toLowerCase(),
    s.motivo.tipo,
    s.motivo.id.toLowerCase(),
    s.inicio,
    s.nombre.trim().replace(/\s+/g, " "),
    normalizarEmail(s.email),
    telefonoNormalizado,
    rut ?? "",
    s.nota.trim(),
  ]);
}

/** "jperez@gmail.com" → "j•••@gmail.com" (para decir a dónde llegó el código). */
export function enmascararEmail(email: string): string {
  const [u, d] = normalizarEmail(email).split("@");
  if (!u || !d) return "tu correo";
  return `${u.slice(0, 1)}•••@${d}`;
}

// ─── Mensajes al paciente ─────────────────────────────────────────────────

export const MENSAJES_RESERVA: Record<string, string> = {
  invalida: "No pudimos procesar la reserva. Vuelve a elegir el horario.",
  apagada: "Esta clínica no está recibiendo reservas en línea en este momento.",
  limitada: "Demasiados intentos desde esta conexión. Espera unos minutos.",
  demasiados: "Ya pediste varios códigos hoy. Intenta mañana o llama a la clínica.",
  usado: "Este código ya se usó. Si no ves tu cita, vuelve a empezar.",
  codigo_vencido: "El código venció. Pide uno nuevo.",
  codigo_incorrecto: "El código no coincide.",
  bloqueado: "Por seguridad, este código quedó bloqueado. Pide uno nuevo.",
  fuera_de_plazo: "Ese horario ya no se puede reservar. Elige otro.",
  ocupado: "Alguien acaba de tomar ese horario. Elige otro.",
  demasiadas_reservas:
    "Ya tienes varias reservas pendientes en esta clínica. Espera a que te confirmen o llama a la clínica.",
  no_existe: "No encontramos esta cita.",
  no_disponible: "Esta cita ya no se puede cambiar desde el link. Llama a la clínica.",
};

export function mensajeDeReserva(motivo: string | null | undefined): string {
  return MENSAJES_RESERVA[motivo ?? ""] ?? MENSAJES_RESERVA.invalida;
}
