import { redirect } from "@tanstack/react-router";

import { hasPermission, type ClinicAccess, type Permission } from "@/lib/access/access";

/**
 * Guard de ruta por permiso. El contexto `access` lo provee el layout
 * `_authenticated/_clinic`. La autorización de datos siempre vive en RLS;
 * esto solo evita mostrar pantallas que el rol no puede usar.
 */
export function requirePermission(permission: Permission) {
  return ({ context }: { context: { access: ClinicAccess } }) => {
    if (!hasPermission(context.access.role, permission)) {
      throw redirect({ to: "/sin-acceso" });
    }
  };
}

/**
 * Igual que `requirePermission`, pero pasa si el rol tiene AL MENOS UNO de
 * los permisos dados. Útil para pantallas con dos audiencias distintas (ej.
 * `/comisiones`: `finance:view` ve a todos, `commission:view-own` solo ve lo
 * propio) donde exigir un único permiso dejaría afuera a la segunda.
 */
export function requireAnyPermission(...permissions: Permission[]) {
  return ({ context }: { context: { access: ClinicAccess } }) => {
    if (!permissions.some((p) => hasPermission(context.access.role, p))) {
      throw redirect({ to: "/sin-acceso" });
    }
  };
}

/**
 * Solo el propietario. Para herramientas internas (Pruebas de email, Modo
 * prueba de email). Mira el rol vigente: quien simula un rol menor ve la
 * puerta cerrada, igual que con `requirePermission`. Par en el servidor:
 * `requireClinicRole(..., ["owner"])`, con el rol real.
 */
export function requireOwner() {
  return ({ context }: { context: { access: ClinicAccess } }) => {
    if (context.access.role !== "owner") {
      throw redirect({ to: "/sin-acceso" });
    }
  };
}
