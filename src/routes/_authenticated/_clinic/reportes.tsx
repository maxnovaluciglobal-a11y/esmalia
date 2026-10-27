import { createFileRoute, redirect } from "@tanstack/react-router";

import { destinoDeHub } from "@/lib/access/navegacion";

/**
 * Hub de "Reportes" (rediseño, fase 3): no tiene pantalla propia, abre la primera
 * pestaña que el rol puede ver. Las rutas de cada pestaña siguen siendo las
 * de siempre, así que sus enlaces viejos (emails, resumen diario) no cambian.
 * Desde la Ola 12 (NAV-01) la primera pestaña es Informes; Finanzas tiene su
 * propio destino en Gestión y `/finanzas` sigue en la misma dirección.
 */
export const Route = createFileRoute("/_authenticated/_clinic/reportes")({
  beforeLoad: ({ context }) => {
    throw redirect({ to: destinoDeHub(context.access, "reportes") });
  },
});
