import { createFileRoute, redirect } from "@tanstack/react-router";

import { destinosVisibles } from "@/lib/access/navegacion";

/**
 * Hub de "Reportes" (rediseño, fase 3): no tiene pantalla propia, abre la primera
 * pestaña que el rol puede ver. Las rutas de cada pestaña siguen siendo las
 * de siempre, así que sus enlaces viejos (emails, resumen diario) no cambian.
 */
export const Route = createFileRoute("/_authenticated/_clinic/reportes")({
  beforeLoad: ({ context }) => {
    const destino = destinosVisibles(context.access).find((d) => d.id === "reportes");
    throw redirect({ to: destino?.pestanas[0]?.to ?? "/sin-acceso" });
  },
});
