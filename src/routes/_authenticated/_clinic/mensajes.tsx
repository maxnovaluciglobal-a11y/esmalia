import { createFileRoute, redirect } from "@tanstack/react-router";

import { destinoDeHub } from "@/lib/access/navegacion";

/**
 * Hub de "Mensajes" (rediseño, fase 3): no tiene pantalla propia, abre la primera
 * pestaña que el rol puede ver. Las rutas de cada pestaña siguen siendo las
 * de siempre, así que sus enlaces viejos (emails, resumen diario) no cambian.
 */
export const Route = createFileRoute("/_authenticated/_clinic/mensajes")({
  beforeLoad: ({ context }) => {
    throw redirect({ to: destinoDeHub(context.access, "mensajes") });
  },
});
