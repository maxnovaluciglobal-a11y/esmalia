import { createFileRoute } from "@tanstack/react-router";

import { VistaPagina } from "@/components/marketing/vista-pagina";
import { cargarPagina, headDePagina } from "@/lib/marketing/ruta-contenido";

// Páginas de src/content/paginas/ con path "/comparar/<slug>".
export const Route = createFileRoute("/comparar/$slug")({
  loader: ({ params }) => cargarPagina(`/comparar/${params.slug}`),
  head: ({ loaderData }) => headDePagina(loaderData),
  component: Pagina,
});

function Pagina() {
  return <VistaPagina datos={Route.useLoaderData()} />;
}
