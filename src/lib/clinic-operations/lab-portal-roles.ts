import type { ClinicRole } from "@/lib/access/access";

/**
 * Quién puede emitir el link del portal de un laboratorio. El link es una
 * credencial: deja que alguien de afuera, sin cuenta, vea nombres de
 * pacientes y mueva el estado de sus órdenes durante 30 días. Por eso queda
 * en quien coordina con el laboratorio (no asistente ni contabilidad, aunque
 * puedan registrar órdenes). Lo usa el server fn y la pantalla.
 */
export const ROLES_EMITEN_LINK_LABORATORIO: readonly ClinicRole[] = [
  "owner",
  "admin",
  "dentist",
  "reception",
];

/** Revocar el portal es gestión del laboratorio: mismo criterio que
 * `can_manage_clinic` (policy `labs_update_managers`). */
export const ROLES_REVOCAN_LINK_LABORATORIO: readonly ClinicRole[] = ["owner", "admin"];

/** Configurar el catálogo de trabajos de un laboratorio (LAB-07): mismo
 * criterio que `can_manage_clinic` (políticas de `lab_catalog_items`). */
export const ROLES_GESTIONAN_CATALOGO_LABORATORIO: readonly ClinicRole[] = ["owner", "admin"];
