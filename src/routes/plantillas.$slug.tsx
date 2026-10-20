import { createFileRoute } from "@tanstack/react-router";

import { VistaPagina } from "@/components/marketing/vista-pagina";
import { cargarPagina, headDePagina } from "@/lib/marketing/ruta-contenido";

// Páginas de src/content/paginas/ con path "/plantillas/<slug>".
export const Route = createFileRoute("/plantillas/$slug")({
  loader: ({ params }) => cargarPagina(`/plantillas/${params.slug}`),
  head: ({ loaderData }) => headDePagina(loaderData),
  component: Pagina,
});

function Pagina() {
  return <VistaPagina datos={Route.useLoaderData()} />;
}
