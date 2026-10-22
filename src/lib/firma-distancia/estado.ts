/**
 * Firma a distancia (Ola 5 · DOC-05): estados de una solicitud, plazos y
 * textos. Lógica pura (la usan la ficha, la página pública y los tests).
 *
 * Los plazos son los mismos que aplica la base (migraciones 20261026100000 y
 * 20261026100100); acá solo se muestran.
 */

export const VIGENCIA_HORAS = 72;
export const INTENTOS_MAXIMOS = 5;
export const BLOQUEO_MINUTOS = 15;
export const CODIGO_VIGENCIA_MINUTOS = 10;
export const CODIGO_ESPERA_SEGUNDOS = 60;
export const CODIGOS_POR_SOLICITUD = 5;
export const SESION_MINUTOS = 30;

export const ESTADOS_GUARDADOS = [
  "enviada",
  "abierta",
  "firmada",
  "cancelada",
  "reemplazada",
] as const;
export type EstadoGuardado = (typeof ESTADOS_GUARDADOS)[number];

export type EstadoSolicitud = EstadoGuardado | "vencida";

export type TipoSolicitud = "documento" | "presupuesto";
export type CanalDelLink = "whatsapp" | "correo" | "copiado";
export type Firmante = "paciente" | "tutor";

export const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  enviada: "Enviada",
  abierta: "Abierta",
  firmada: "Firmada",
  vencida: "Vencida",
  cancelada: "Cancelada",
  reemplazada: "Reemplazada",
};

export const ETIQUETA_CANAL: Record<CanalDelLink, string> = {
  whatsapp: "WhatsApp",
  correo: "Correo",
  copiado: "Link copiado",
};

/** Una abierta que pasó su vencimiento se ve como vencida (la base hace lo mismo). */
export function estadoDeSolicitud(
  s: { status: string; expiresAt: string },
  ahora: Date = new Date(),
): EstadoSolicitud {
  const guardado = (ESTADOS_GUARDADOS as readonly string[]).includes(s.status)
    ? (s.status as EstadoGuardado)
    : "cancelada";
  if (guardado === "enviada" || guardado === "abierta") {
    const vence = new Date(s.expiresAt).getTime();
    if (!Number.isNaN(vence) && vence <= ahora.getTime()) return "vencida";
  }
  return guardado;
}

/** Abierta = el paciente todavía puede firmar con ese link. */
export function estaAbierta(estado: EstadoSolicitud): boolean {
  return estado === "enviada" || estado === "abierta";
}

/** Reenviar = link nuevo. Sirve para una abierta o una vencida. */
export function sePuedeReenviar(estado: EstadoSolicitud): boolean {
  return estaAbierta(estado) || estado === "vencida";
}

export function sePuedeCancelar(estado: EstadoSolicitud): boolean {
  return estaAbierta(estado);
}

/**
 * Lo que el paciente declara al firmar. Lo arma el servidor (no el
 * navegador) y queda tal cual en la evidencia.
 */
export function textoDeAceptacion(d: { tipo: TipoSolicitud; titulo: string }): string {
  return d.tipo === "presupuesto"
    ? `Leí el presupuesto "${d.titulo}" y lo acepto completo, con sus prestaciones, valores y condiciones. Lo firmo con firma electrónica simple (Ley 19.799).`
    : `Leí completo el documento "${d.titulo}" y lo acepto. Lo firmo con firma electrónica simple (Ley 19.799).`;
}

/** "a las 15:04" o "en 3 minutos": cuánto falta para que se levante el bloqueo. */
export function minutosHasta(iso: string, ahora: Date = new Date()): number {
  const ms = new Date(iso).getTime() - ahora.getTime();
  return Math.max(1, Math.ceil(ms / 60_000));
}
