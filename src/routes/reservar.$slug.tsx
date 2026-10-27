import { createFileRoute } from "@tanstack/react-router";

import { FlujoReserva } from "@/components/reserva/flujo-reserva";
import { PaginaReserva } from "@/components/reserva/pagina-reserva";
import { META_RESERVA, validarBusquedaReserva } from "@/lib/reserva/busqueda-reserva";

/**
 * Reserva en línea de una clínica (RES-01): `/reservar/<slug>`. Pública,
 * sin login y sin índice (cada clínica decide dónde compartir su link).
 */
export const Route = createFileRoute("/reservar/$slug")({
  validateSearch: validarBusquedaReserva,
  head: () => ({ meta: [{ title: "Reserva tu hora · Esmalia" }, ...META_RESERVA] }),
  component: ReservarPage,
});

function ReservarPage() {
  const { slug } = Route.useParams();
  const { embed, r } = Route.useSearch();
  return (
    <PaginaReserva embebida={Boolean(embed)}>
      <FlujoReserva slug={slug} recall={r} />
    </PaginaReserva>
  );
}
