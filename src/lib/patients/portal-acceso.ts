/**
 * ¿Puede haber un link del portal vigente para este paciente? Parte pura,
 * probada en `tests/portal-acceso.test.ts`.
 *
 * Los links son JWT sin estado: no hay una tabla de "links emitidos". Lo que
 * sí queda registrado es el envío (`messages` con `template_kind =
 * 'portal_invite'`) y cada apertura (`portal_access_log`). Un link vive como
 * máximo `TTL_MAXIMO_PORTAL_DIAS` (el tope de `generatePortalLink`), y
 * revocar corta todo lo emitido antes de `portal_revoked_at`.
 *
 * Límite conocido: un link generado y copiado a mano (sin teléfono o con la
 * baja de WhatsApp) que nadie abrió todavía no deja rastro. En cuanto alguien
 * lo abre, aparece en `portal_access_log` y el acceso pasa a vigente.
 */

/** Tope de vigencia de un link del portal (`ttlDays` máximo en `generatePortalLink`). */
export const TTL_MAXIMO_PORTAL_DIAS = 14;

const DIA_MS = 24 * 60 * 60 * 1000;

export function portalAccesoVigente(datos: {
  /** `patients.portal_revoked_at`. */
  revocadoEl: string | null;
  /** Fechas (ISO) de envíos o aperturas del portal registrados. */
  actividad: readonly (string | null | undefined)[];
  ahora: Date;
  ttlDias?: number;
}): boolean {
  const ttl = (datos.ttlDias ?? TTL_MAXIMO_PORTAL_DIAS) * DIA_MS;
  const desde = datos.ahora.getTime() - ttl;
  const revocado = datos.revocadoEl ? new Date(datos.revocadoEl).getTime() : null;
  return datos.actividad.some((iso) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t < desde) return false;
    return revocado === null || Number.isNaN(revocado) || t > revocado;
  });
}
