import { createFileRoute } from "@tanstack/react-router";

import { Sala } from "@/components/dispositivos/sala";
import { PantallaDeDispositivo } from "@/components/dispositivos/pantalla-dispositivo";
import { META_RESERVA } from "@/lib/reserva/busqueda-reserva";

/**
 * TV de la sala de espera (AUT-04): llamados y quién sigue.
 * Pantalla de dispositivo sin login (AUT-06): se vincula con un código de un
 * solo uso y usa su propio token, que no abre nada de la app ni de la ficha.
 * Sin índice y fuera del sitemap: no es una página pública del sitio.
 */
export const Route = createFileRoute("/sala")({
  head: () => ({ meta: [{ title: "Sala de espera · Esmalia" }, ...META_RESERVA] }),
  component: Pagina,
});

function Pagina() {
  return (
    <PantallaDeDispositivo tipo="sala" oscuro>
      {(ctx) => <Sala {...ctx} />}
    </PantallaDeDispositivo>
  );
}
