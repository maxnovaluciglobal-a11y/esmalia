// src/routes/index.tsx
//
// Landing A+ (plan del 19-oct-2026, PRs 5 a 8; mezcla con la dirección C
// aprobada por Walter el 20-oct, #114). Se armó en /v2 y el PR 8 la pasó a
// "/": /v2 redirige con 308 (vercel.json y src/routes/v2.tsx).
//
// Las reglas de veracidad de la landing anterior siguen valiendo y viven en
// los componentes de src/components/marketing/v2/: solo hechos del producto,
// ningún recordatorio sale solo, /demo pide nombre y email, sin testimonios ni
// logos sin permiso de la clínica.
import { createFileRoute } from "@tanstack/react-router";

import { canonicalHead, faqJsonLdScript } from "@/lib/seo";

import { LandingV2 } from "@/components/marketing/v2/landing-v2";
import { FAQ_CORTA } from "@/components/marketing/v2/faq-corta-datos";
import landingV2Css from "@/components/marketing/v2/landing-v2.css?url";

export const Route = createFileRoute("/")({
  head: () => {
    const canonical = canonicalHead("/");
    return {
      meta: [
        { title: "Software para clínicas dentales en Latinoamérica | Esmalia" },
        {
          name: "description",
          content:
            "Software para clínicas dentales de Chile, Perú, México, Colombia y Argentina: agenda por profesional, ficha con odontograma, caja del día y recordatorios por WhatsApp que envía tu equipo con un toque. 14 días gratis, sin tarjeta.",
        },
        { property: "og:title", content: "Esmalia · Cada silla vacía es plata que no vuelve" },
        {
          property: "og:description",
          content:
            "Agenda, ficha clínica, odontograma, presupuestos y caja con recordatorios por WhatsApp. Hecho para clínicas de Chile, Perú, México, Colombia y Argentina.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...canonical.meta,
      ],
      // La cara de titulares (Bricolage, ~21 KB) no se precarga: el LCP es el
      // párrafo del hero (Instrument Sans) y una precarga más le compite el
      // ancho de banda (medido en #114).
      links: [...canonical.links, { rel: "stylesheet", href: landingV2Css }],
      scripts: faqJsonLdScript(FAQ_CORTA.map((f) => ({ q: f.q, a: f.a }))),
    };
  },
  component: LandingV2,
});
