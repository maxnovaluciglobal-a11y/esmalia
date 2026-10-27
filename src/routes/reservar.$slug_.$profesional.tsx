import { createFileRoute } from "@tanstack/react-router";

import { FlujoReserva } from "@/components/reserva/flujo-reserva";
import { PaginaReserva } from "@/components/reserva/pagina-reserva";
import { META_RESERVA, validarBusquedaReserva } from "@/lib/reserva/busqueda-reserva";

/**
 * Reserva en línea con un profesional (RES-03): `/reservar/<slug>/<profesional>`.
 * Mismo flujo, sin el paso de elegir profesional.
 */
export const Route = createFileRoute("/reservar/$slug_/$profesional")({
  validateSearch: validarBusquedaReserva,
  head: () => ({ meta: [{ title: "Reserva tu hora · Esmalia" }, ...META_RESERVA] }),
  component: ReservarConProfesionalPage,
});

function ReservarConProfesionalPage() {
  const { slug, profesional } = Route.useParams();
  const { embed, r } = Route.useSearch();
  return (
    <PaginaReserva embebida={Boolean(embed)}>
      <FlujoReserva slug={slug} profesional={profesional} recall={r} />
    </PaginaReserva>
  );
}
