import { createFileRoute } from "@tanstack/react-router";

import { Totem } from "@/components/dispositivos/totem";
import { PantallaDeDispositivo } from "@/components/dispositivos/pantalla-dispositivo";
import { META_RESERVA } from "@/lib/reserva/busqueda-reserva";

/**
 * Tótem de la sala de espera (AUT-01 a AUT-03): check-in, agendar y saldo.
 * Pantalla de dispositivo sin login (AUT-06): se vincula con un código de un
 * solo uso y usa su propio token, que no abre nada de la app ni de la ficha.
 * Sin índice y fuera del sitemap: no es una página pública del sitio.
 */
export const Route = createFileRoute("/totem")({
  head: () => ({ meta: [{ title: "Tótem · Esmalia" }, ...META_RESERVA] }),
  component: Pagina,
});

function Pagina() {
  return <PantallaDeDispositivo tipo="totem">{(ctx) => <Totem {...ctx} />}</PantallaDeDispositivo>;
}
