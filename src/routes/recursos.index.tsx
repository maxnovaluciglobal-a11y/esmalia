import { createFileRoute } from "@tanstack/react-router";

import { IndiceContenido } from "@/components/marketing/pagina-contenido";
import { aEnlace, type Enlace, paginasPublicadas } from "@/content";
import { canonicalHead } from "@/lib/seo";

const TITULO = "Recursos para clínicas dentales | Esmalia";
const DESCRIPCION =
  "Guías, plantillas y herramientas gratis para clínicas dentales: inasistencias, WhatsApp, presupuesto, inventario, rentabilidad y fugas de dinero.";

// Herramientas que no son páginas de src/content (tienen su propia ruta).
const HERRAMIENTAS: Enlace[] = [
  {
    path: "/calculadora-rentabilidad-dental",
    h1: "Calculadora de rentabilidad dental",
    enUnaLinea:
      "El estado de resultados y las fugas de dinero de tu clínica, al instante y sin registrarte.",
    coleccion: "guias",
  },
  {
    path: "/recursos/fugas-clinica-dental",
    h1: "Checklist: 15 fugas de dinero en una clínica dental",
    enUnaLinea:
      "Ausencias, presupuestos sin seguimiento, stock, laboratorio, comisiones y cobranza.",
    coleccion: "guias",
  },
];

// Antes era un 307 a la única guía; ahora es el índice real.
export const Route = createFileRoute("/recursos/")({
  loader: async () => ({
    guias: (await paginasPublicadas("guias")).map(aEnlace),
    plantillas: (await paginasPublicadas("plantillas")).map(aEnlace),
  }),
  head: () => {
    const canonical = canonicalHead("/recursos");
    return {
      meta: [
        { title: TITULO },
        { name: "description", content: DESCRIPCION },
        { property: "og:title", content: TITULO },
        { property: "og:description", content: DESCRIPCION },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: Recursos,
});

function Recursos() {
  const { guias, plantillas } = Route.useLoaderData();
  return (
    <IndiceContenido
      kicker="Recursos"
      titulo="Recursos gratis para clínicas dentales"
      intro="Guías prácticas, mensajes listos para copiar y herramientas para ordenar la agenda y la caja. Todo se lee completo sin registrarte."
      grupos={[
        { titulo: "Herramientas", paginas: HERRAMIENTAS },
        { titulo: "Guías", paginas: guias },
        { titulo: "Plantillas", paginas: plantillas },
      ]}
    />
  );
}
