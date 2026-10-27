// src/routes/recorrido.tsx
//
// Recorrido comercial para mandar por WhatsApp cuando una clínica responde
// (plan aprobado por Walter el 21-oct-2026). `noindex` a propósito: es
// material de venta 1 a 1, no una página para buscadores, y por eso no va al
// sitemap ni al pie del sitio. El kit de envíos le pone
// `?utm_source=whatsapp&utm_medium=kit&utm_campaign=c<id>` para saber qué
// clínica lo abrió (el page_view de entrada guarda los UTM, sin cookies).
import { createFileRoute } from "@tanstack/react-router";

import { canonicalHead } from "@/lib/seo";

import { Recorrido } from "@/components/marketing/v2/recorrido";
import landingV2Css from "@/components/marketing/v2/landing-v2.css?url";
import recorridoCss from "@/components/marketing/v2/recorrido.css?url";

const TITULO = "Recorrido por Esmalia · Agenda, ficha y caja para tu clínica dental";
const DESCRIPCION =
  "Pantallas reales de Esmalia: agenda por profesional, ficha con odontograma, caja con arqueo y recordatorios por WhatsApp. Desde US$19,99 al mes, 14 días gratis.";

export const Route = createFileRoute("/recorrido")({
  head: () => {
    const canonical = canonicalHead("/recorrido");
    return {
      meta: [
        { title: TITULO },
        { name: "description", content: DESCRIPCION },
        { name: "robots", content: "noindex" },
        { property: "og:title", content: "Recorrido por Esmalia" },
        { property: "og:description", content: DESCRIPCION },
        { property: "og:type", content: "website" },
        ...canonical.meta,
      ],
      links: [
        ...canonical.links,
        { rel: "stylesheet", href: landingV2Css },
        { rel: "stylesheet", href: recorridoCss },
      ],
    };
  },
  component: Recorrido,
});
