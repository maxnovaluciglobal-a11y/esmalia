import { createFileRoute } from "@tanstack/react-router";

import { GestionMiCita } from "@/components/reserva/mi-cita";
import { PaginaReserva } from "@/components/reserva/pagina-reserva";
import { META_RESERVA } from "@/lib/reserva/busqueda-reserva";

/**
 * Gestión de la cita por link firmado (RES-05 + REC-11): `/mi-cita/<token>`.
 * Pública, sin login y sin índice. El token viaja solo en el path y el
 * servidor lo valida (HMAC con vencimiento, un solo propósito).
 */
export const Route = createFileRoute("/mi-cita/$token")({
  head: () => ({ meta: [{ title: "Tu cita · Esmalia" }, ...META_RESERVA] }),
  component: MiCitaPage,
});

function MiCitaPage() {
  const { token } = Route.useParams();
  return (
    <PaginaReserva embebida={false}>
      <GestionMiCita token={token} />
    </PaginaReserva>
  );
}
