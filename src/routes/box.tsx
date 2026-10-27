import { createFileRoute } from "@tanstack/react-router";

import { Box } from "@/components/dispositivos/box";
import { PantallaDeDispositivo } from "@/components/dispositivos/pantalla-dispositivo";
import { META_RESERVA } from "@/lib/reserva/busqueda-reserva";

/**
 * Pantalla del box (AUT-05): cita actual, la siguiente y llamar.
 * Pantalla de dispositivo sin login (AUT-06): se vincula con un código de un
 * solo uso y usa su propio token, que no abre nada de la app ni de la ficha.
 * Sin índice y fuera del sitemap: no es una página pública del sitio.
 */
export const Route = createFileRoute("/box")({
  head: () => ({ meta: [{ title: "Box · Esmalia" }, ...META_RESERVA] }),
  component: Pagina,
});

function Pagina() {
  return (
    <PantallaDeDispositivo tipo="box" oscuro>
      {(ctx) => <Box {...ctx} />}
    </PantallaDeDispositivo>
  );
}
