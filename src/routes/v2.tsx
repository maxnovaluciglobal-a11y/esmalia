// src/routes/v2.tsx
//
// Landing A+ en construcción (plan del 19-oct-2026, PRs 5 a 8). Vive en /v2
// hasta que se revise en producción; el PR 8 la pasa a "/" y deja /v2 con
// un 308. Mientras tanto: `noindex`, fuera del sitemap y del footer, y "/"
// sin cambios.
import { createFileRoute } from "@tanstack/react-router";

import { faqJsonLdScript } from "@/lib/seo";

import { LandingV2 } from "@/components/marketing/v2/landing-v2";
import { FAQ_CORTA } from "@/components/marketing/v2/faq-corta-datos";
import landingV2Css from "@/components/marketing/v2/landing-v2.css?url";

export const Route = createFileRoute("/v2")({
  head: () => ({
    meta: [
      { title: "Software para clínicas dentales en Latinoamérica | Esmalia" },
      {
        name: "description",
        content:
          "Agenda por profesional, ficha con odontograma, caja del día y recordatorios por WhatsApp que envía tu equipo con un toque. 14 días gratis, sin tarjeta.",
      },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "stylesheet", href: landingV2Css }],
    scripts: faqJsonLdScript(FAQ_CORTA.map((f) => ({ q: f.q, a: f.a }))),
  }),
  component: LandingV2,
});
