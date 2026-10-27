import type { Permission } from "@/lib/access/access";

/**
 * Nombre visible de cada permiso de la matriz (`access.ts`). Las claves
 * técnicas (`dashboard:view`) no se muestran en la interfaz: Equipo y
 * Permisos usan este mapa. `tests/permisos-etiquetas.test.ts` exige que todo
 * permiso nuevo traiga su etiqueta.
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "dashboard:view": "Ver la pantalla Hoy",
  "agenda:view": "Ver agenda",
  "agenda:manage": "Agendar y mover citas",
  "patients:view": "Ver pacientes",
  "patients:manage": "Crear y editar pacientes",
  "clinical:view": "Ver historia clínica",
  "clinical:write": "Escribir historia clínica",
  "treatments:view": "Ver tratamientos",
  "finance:view": "Ver finanzas y presupuestos",
  "cash:manage": "Abrir y cerrar caja",
  "payments:reverse": "Reversar pagos",
  "inventory:view": "Ver inventario",
  "inventory:manage": "Gestionar inventario",
  "team:view": "Ver equipo",
  "team:manage": "Gestionar equipo",
  "settings:manage": "Configurar la clínica",
  "commission:view-own": "Ver su propia comisión",
  "commission:view-all": "Ver las comisiones de todo el equipo",
};

export function etiquetaPermiso(permiso: Permission): string {
  return PERMISSION_LABELS[permiso];
}
