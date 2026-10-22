/**
 * Documento de identidad del paciente (Ola 1 · FIC-01 y PAC-03). Lógica
 * pura, sin Supabase: la usan el formulario (cliente), las server functions
 * (servidor) y los tests (tests/rut.test.ts).
 *
 * La base tiene el par exacto de dos funciones:
 * - `rutEsValido` ↔ `public.rut_es_valido(text)` (CHECK patients_rut_valido);
 * - `normalizarDocumento` ↔ `public.normalizar_documento(text)`, que arma el
 *   índice ciego (migración 20261022100200).
 * Si se cambia una, se cambia la otra (tests/pacientes-chile-db.test.ts
 * compara las dos con los mismos casos).
 */

export const TIPOS_DOCUMENTO = ["rut", "pasaporte", "dni", "otro"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const ETIQUETA_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  rut: "RUT",
  pasaporte: "Pasaporte",
  dni: "DNI",
  otro: "Otro",
};

export function esTipoDocumento(valor: unknown): valor is TipoDocumento {
  return typeof valor === "string" && (TIPOS_DOCUMENTO as readonly string[]).includes(valor);
}

/** Tipo de documento por defecto para un paciente nuevo según el país de la clínica. */
export function tipoDocumentoPorDefecto(pais: string | null | undefined): TipoDocumento {
  return (pais ?? "").toUpperCase() === "CL" ? "rut" : "dni";
}

/** Solo letras y dígitos, en mayúscula: "12.345.678-k" → "12345678K". */
export function normalizarDocumento(documento: string | null | undefined): string | null {
  const limpio = (documento ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return limpio || null;
}

/** Dígito verificador (módulo 11) de un cuerpo de RUT: "12345678" → "5". */
export function digitoVerificador(cuerpo: string): string {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/** Cuerpo y dígito verificador, o null si no tiene forma de RUT. */
function partesDelRut(rut: string): { cuerpo: string; dv: string } | null {
  const t = rut.trim();
  if (!/^[0-9. -]+[0-9kK]$/.test(t)) return null;
  const v = t.replace(/[^0-9kK]/g, "").toUpperCase();
  // Cuerpo de 6 a 9 dígitos + dígito verificador.
  if (v.length < 7 || v.length > 10) return null;
  const cuerpo = v.slice(0, -1);
  if (!/^[0-9]+$/.test(cuerpo)) return null;
  return { cuerpo, dv: v.slice(-1) };
}

/** true si el RUT tiene el dígito verificador correcto. Acepta puntos, guion y k minúscula. */
export function rutEsValido(rut: string | null | undefined): boolean {
  if (!rut) return false;
  const partes = partesDelRut(rut);
  return partes !== null && digitoVerificador(partes.cuerpo) === partes.dv;
}

/**
 * "123456785" → "12.345.678-5". Si no tiene forma de RUT, devuelve el texto
 * tal cual (el formulario lo marca como inválido; no se inventa nada).
 */
export function formatearRut(rut: string): string {
  const partes = partesDelRut(rut);
  if (!partes) return rut.trim();
  const cuerpo = partes.cuerpo.replace(/^0+(?=\d)/, "");
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${conPuntos}-${partes.dv}`;
}

/** Mensaje de error del documento según su tipo, o null si se puede guardar. */
export function errorDeDocumento(
  documento: string,
  tipo: TipoDocumento | null | undefined,
): string | null {
  const d = documento.trim();
  if (!d) return null;
  if (d.length > 40) return "El documento es demasiado largo.";
  if (tipo === "rut" && !rutEsValido(d)) {
    return "El RUT no es válido: revisa los números y el dígito verificador (por ejemplo, 12.345.678-5).";
  }
  return null;
}

/**
 * ¿Lo que se escribió en un buscador parece un documento? Dígitos (con o
 * sin puntos y guion) y, al final, opcionalmente una K: "12.345.678-5",
 * "123456785", "12345678-k". Se usa para buscar por el índice ciego.
 */
export function pareceDocumento(termino: string): boolean {
  const t = termino.trim();
  if (!/^[0-9][0-9. -]*[0-9kK]$/.test(t)) return false;
  return t.replace(/[^0-9]/g, "").length >= 6;
}
