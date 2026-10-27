// src/routes/precios.tsx
//
// Página propia de precios (antes era un 301 a /#precios). Reusa el mismo
// bloque de planes que la landing (`PreciosPlanes`) y suma una FAQ corta.
//
// Cada respuesta de la FAQ está respaldada por el código, no por el deseo:
// - Trial de 14 días sin tarjeta: `trial_period_days: 14` +
//   `payment_method_collection: "if_required"` (billing.functions.ts) y el
//   trial que nace con la clínica (migración 20260907240000).
// - Qué sigue abierto sin suscripción: `ABIERTO_SIEMPRE` /
//   `SE_ACTIVA_AL_SUSCRIBIRTE` en components/trial-desbloqueo.tsx.
// - Cobro en USD vía Stripe, moneda local solo de referencia:
//   lib/pricing-display.ts y lib/stripe.server.ts.
// - Cancelar: portal de facturación de Stripe desde /suscripcion
//   (`createBillingPortalSession`); la cancelación corre al fin del período
//   (`cancel_at_period_end`, "Cancelada — vence el …" en suscripcion.tsx).
import { createFileRoute, Link } from "@tanstack/react-router";

import { PreciosPlanes } from "@/components/marketing/precios";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { buttonVariants } from "@/components/ui/button";
import { registrarEvento } from "@/lib/marketing/eventos";
import { PRECIO_FUNDADOR_EXPLICACION } from "@/lib/marketing/precio-fundador";
import { canonicalHead, faqJsonLdScript } from "@/lib/seo";
import { cn } from "@/lib/utils";

const TITULO = "Precios · Esmalia — software dental desde US$19,99";
const DESCRIPCION =
  "Planes de Esmalia para clínicas dentales: Solo US$19,99/mes (1 profesional), Clínica US$49,99/mes (hasta 3) y Red a medida. 14 días gratis, sin tarjeta. Cobro en USD.";

const preguntas: { q: string; a: string }[] = [
  {
    q: "¿Necesito tarjeta para probar Esmalia?",
    a: "No. Tienes 14 días gratis desde que creas tu clínica, sin dejar tarjeta. Si al terminar no te suscribes, agenda, pacientes y ficha clínica siguen abiertos; finanzas, comisiones, inventario y los demás informes se activan al suscribirte.",
  },
  {
    q: "¿Qué incluye cada plan?",
    a: "Solo (US$19,99/mes, 1 profesional): agenda, ficha clínica, recordatorios por WhatsApp, caja, presupuestos e importación de pacientes por planilla. Clínica (US$49,99/mes, hasta 3 profesionales): todo lo de Solo, más comisiones, roles y portal de pacientes. Red (varias sedes): a medida, con multisede, inventario, reportes por sede y migración acompañada.",
  },
  {
    q: "¿Cuánto espacio tengo para radiografías y fotos?",
    a: "Plan Solo: 25 GB. Plan Clínica: 75 GB. Alcanza para años de radiografías, fotos y escaneos de una clínica normal. Te avisamos al llegar al 80 % y, si se llena, puedes pedir ampliarlo.",
  },
  {
    q: "¿Puedo probar Esmalia sin dejar mi sistema actual?",
    a: "Sí, y es lo que recomendamos: usa los dos en paralelo la primera semana y deja el anterior cuando todo coincida. Puedes traer tus pacientes y tus citas futuras desde una planilla CSV (hasta 2.000 filas por carga, con plantillas descargables). El historial clínico y los odontogramas no se importan: se siguen llenando en Esmalia a medida que atiendes. Tienes la guía paso a paso en esmalia.com/docs/migrar-desde-otro-sistema.",
  },
  {
    q: "¿En qué moneda me cobran?",
    a: "En dólares (USD), a través de Stripe. El precio en tu moneda que ves en esta página es una referencia aproximada: el monto final lo define el tipo de cambio de tu banco o tarjeta.",
  },
  {
    q: "¿Puedo cancelar cuando quiera?",
    a: "Sí. Desde Suscripción entras al portal de pagos de Stripe, donde cancelas, cambias el método de pago o descargas tus facturas. Si cancelas durante el trial no te cobramos; si ya pagaste, la suscripción sigue activa hasta el fin del período.",
  },
  {
    q: "¿Qué es el precio fundador?",
    a: PRECIO_FUNDADOR_EXPLICACION,
  },
];

export const Route = createFileRoute("/precios")({
  head: () => {
    const canonical = canonicalHead("/precios");
    return {
      meta: [
        { title: TITULO },
        { name: "description", content: DESCRIPCION },
        { property: "og:title", content: TITULO },
        { property: "og:description", content: DESCRIPCION },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...canonical.meta,
      ],
      links: canonical.links,
      // Las ofertas viven en el SoftwareApplication sitewide (lib/seo.ts): un
      // Product aparte duplicaba la entidad.
      scripts: faqJsonLdScript(preguntas),
    };
  },
  component: PaginaPrecios,
});

function PaginaPrecios() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      <main id="main-content">
        <section className="mx-auto max-w-6xl px-6 pt-14 pb-16 sm:pt-20">
          {/* El H1 nombra el producto y el precio; el precio fundador
              queda como H2 dentro de PreciosPlanes. */}
          <h1 className="kicker mb-4">Precios de Esmalia, software dental desde US$19,99/mes</h1>
          <PreciosPlanes encabezado="h2" lugar="pagina-precios" />
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="max-w-3xl">
            <h2 className="font-display text-3xl font-normal leading-tight sm:text-4xl">
              Preguntas sobre el precio
            </h2>
            <Accordion type="single" collapsible className="mt-6">
              {preguntas.map((p, i) => (
                <AccordionItem key={p.q} value={`p-${i}`}>
                  <AccordionTrigger className="text-left text-base">{p.q}</AccordionTrigger>
                  {/* forceMount: igual que /faq, la respuesta queda en el HTML del SSR
                      y coincide con el FAQPage del JSON-LD. */}
                  <AccordionContent forceMount className="leading-relaxed text-muted-foreground">
                    {p.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <p className="mt-8 text-sm text-muted-foreground">
              ¿Otra duda?{" "}
              <Link to="/faq" className="text-brand-700 underline underline-offset-4">
                Revisa las preguntas frecuentes
              </Link>{" "}
              o entra a la demo y mira la clínica por dentro.
            </p>
            <a
              href="/demo"
              onClick={() => registrarEvento("cta_click", { cta: "demo", lugar: "pagina-precios" })}
              className={cn(buttonVariants({ size: "lg" }), "mt-6")}
            >
              Entrar a la demo
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
