/**
 * Minimización de datos antes de mandarle algo a un modelo de IA
 * (auditoría 360, IA-02). Funciones puras: sin red, sin base.
 *
 * Regla: al modelo no le llega ningún identificador directo del paciente
 * (nombre, RUT/DNI/CURP, teléfono, email). La edad viaja en tramos, no exacta.
 * Una nota SOAP no necesita saber quién es el paciente para estar bien escrita.
 */

/** Marcadores que reemplazan lo que se quita. Visibles a propósito: el modelo sabe que falta algo. */
export const MARCA_PACIENTE = "[paciente]";
export const MARCA_EMAIL = "[email omitido]";
export const MARCA_DOCUMENTO = "[documento omitido]";
export const MARCA_NUMERO = "[número omitido]";

/** Edad en tramos de 10 años. `null` si no hay edad conocida (0 = sin fecha de nacimiento). */
export function rangoEtario(edad: number | null | undefined): string | null {
  if (edad == null || !Number.isFinite(edad) || edad <= 0) return null;
  if (edad < 18) return "menor de 18 años";
  if (edad >= 80) return "80 años o más";
  const desde = Math.floor(edad / 10) * 10;
  return `${desde}-${desde + 9} años`;
}

type DatosContexto = {
  edad: number | null | undefined;
  etiquetas: string[];
  ultimaVisita: string;
  timeline: Array<{ fecha: string; titulo: string; detalle?: string }>;
};

/**
 * Contexto clínico para Patty, sin nombre ni edad exacta. Recibe solo los
 * campos que necesita (no el `Paciente` entero) para que agregar un campo
 * sensible al tipo no lo filtre al prompt sin querer.
 */
export function construirContextoPaciente(datos: DatosContexto): string {
  const rango = rangoEtario(datos.edad);
  const antecedentes = datos.timeline
    .slice(0, 4)
    .map((e) => `${e.fecha} ${e.titulo}${e.detalle ? ` (${e.detalle})` : ""}`)
    .join("; ");
  return [
    `Paciente${rango ? `: ${rango}` : ""}.`,
    `Etiquetas: ${datos.etiquetas.join(", ") || "ninguna"}.`,
    `Última visita: ${datos.ultimaVisita}.`,
    `Antecedentes recientes: ${antecedentes || "sin registros"}`,
  ].join(" ");
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// RUT chileno con dígito verificador: 12.345.678-5 / 12345678-K.
const RUT = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;
// CURP (MX): 18 caracteres con forma fija.
const CURP = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d\b/gi;
// Secuencias largas de dígitos (teléfonos, DNI, cédulas): 8+ dígitos con separadores comunes.
const NUMERO_LARGO = /\+?\d[\d\s().-]{6,}\d/g;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_DMY = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;

function escaparRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type IdentificadoresConocidos = {
  /** Nombre completo del paciente (se quita entero y por partes de 3+ letras). */
  nombres?: Array<string | null | undefined>;
  /** Valores exactos a quitar: documento, teléfono, email registrados. */
  valores?: Array<string | null | undefined>;
};

/**
 * Quita PII directa de un texto libre. Dos capas:
 *  1. Lo que sabemos del paciente (nombre, documento, teléfono, email) se
 *     quita por valor exacto.
 *  2. Patrones genéricos (email, RUT, CURP, números de 8+ dígitos) por si
 *     el profesional o el paciente los escribieron en el texto.
 * Las fechas (2026-10-15, 15/10/2026) no se tocan: el modelo las necesita.
 */
export function redactarPii(texto: string, conocidos: IdentificadoresConocidos = {}): string {
  let out = texto;

  for (const valor of conocidos.valores ?? []) {
    const v = valor?.trim();
    if (!v || v.length < 4) continue;
    out = out.replace(new RegExp(escaparRegex(v), "gi"), MARCA_NUMERO);
  }

  for (const nombre of conocidos.nombres ?? []) {
    const completo = nombre?.trim();
    if (!completo) continue;
    out = out.replace(new RegExp(escaparRegex(completo), "giu"), MARCA_PACIENTE);
    for (const parte of completo.split(/\s+/)) {
      if (parte.length < 3) continue;
      out = out.replace(
        new RegExp(`(?<![\\p{L}\\p{N}])${escaparRegex(parte)}(?![\\p{L}\\p{N}])`, "giu"),
        MARCA_PACIENTE,
      );
    }
  }

  out = out
    .replace(EMAIL, MARCA_EMAIL)
    .replace(RUT, MARCA_DOCUMENTO)
    .replace(CURP, MARCA_DOCUMENTO)
    .replace(NUMERO_LARGO, (m) => {
      const limpio = m.trim();
      if (FECHA_ISO.test(limpio) || FECHA_DMY.test(limpio)) return m;
      const digitos = limpio.replace(/\D/g, "").length;
      return digitos >= 8 ? MARCA_NUMERO : m;
    });

  // "[paciente] [paciente]" (nombre y apellido quitados por separado) → uno solo.
  return out.replace(/\[paciente\](?:\s+\[paciente\])+/g, MARCA_PACIENTE);
}
