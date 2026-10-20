import { createFileRoute } from "@tanstack/react-router";

import { VistaPagina } from "@/components/marketing/vista-pagina";
import { cargarPagina, headDePagina } from "@/lib/marketing/ruta-contenido";

// Contenido en src/content/paginas/pais-argentina.ts.
export const Route = createFileRoute("/software-dental-argentina")({
  loader: () => cargarPagina("/software-dental-argentina"),
  head: ({ loaderData }) => headDePagina(loaderData),
  component: Pagina,
});

function Pagina() {
  return <VistaPagina datos={Route.useLoaderData()} />;
}
