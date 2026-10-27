// URL pública del sitio: ÚNICO lugar del código con el dominio de fallback.
// PUBLIC_APP_URL manda si está seteada (en producción: https://esmalia.com,
// desde el 09-oct-2026); el fallback es el mismo dominio propio. Lo usan canonical, og:url, og:image y el JSON-LD;
// el sitemap deriva el host de la request cuando no hay PUBLIC_APP_URL.
export const SITE_URL =
  (typeof process !== "undefined" && process.env.PUBLIC_APP_URL) || "https://esmalia.com";

/** Link `rel=canonical` + `og:url` para una ruta pública. `path` incluye la barra inicial. */
export function canonicalHead(path: string) {
  const url = `${SITE_URL}${path}`;
  return {
    links: [{ rel: "canonical", href: url }],
    meta: [{ property: "og:url", content: url }],
  };
}

// OJO: el shape que espera `head().scripts` NO anida bajo `attrs` — TanStack
// Router mapea `match.headScripts` tomando cada item entero (menos `children`)
// como los atributos HTML directamente (ver headContentUtils.js). Anidar acá
// produce un <script attrs="[object Object]"> roto en vez de type="...".
function ldJsonScript(data: Record<string, unknown>) {
  return { type: "application/ld+json", children: JSON.stringify(data) };
}

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

// Perfiles públicos de la marca para `sameAs`. Solo perfiles que existen de
// verdad: un sameAs a una URL inexistente confunde más de lo que ayuda.
export const SAME_AS: string[] = ["https://www.instagram.com/esmalia_dental/"];

// Lo mismo que dice src/content/llms-base.md (/llms.txt): el schema y el llms.txt no pueden
// contradecirse (los motores de IA los contrastan).
const FEATURE_LIST = [
  "Agenda por sucursal en hora local",
  "Recordatorios por WhatsApp 48 h y 3 h antes, enviados por la clínica con un toque",
  "Ficha clínica y odontograma FDI versionado",
  "Presupuestos y planes de tratamiento",
  "Caja, saldos y comisiones de profesionales",
  "Funciona sin internet y sincroniza al volver la conexión",
  "Patty, IA para notas y resúmenes (en habilitación), sin decisiones clínicas",
];

/** Precio mensual explícito (unitCode MON = mes, UN/CEFACT). */
function ofertaMensual(name: string, price: string, description: string) {
  return {
    "@type": "Offer",
    name,
    price,
    priceCurrency: "USD",
    description,
    url: `${SITE_URL}/precios`,
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price,
      priceCurrency: "USD",
      unitCode: "MON",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
    },
  };
}

export const PLAN_OFFERS = [
  ofertaMensual("Solo", "19.99", "1 profesional, pago mensual. 14 días gratis."),
  ofertaMensual("Clínica", "49.99", "Hasta 3 profesionales, pago mensual. 14 días gratis."),
];

/** Organization + WebSite + SoftwareApplication — sitewide, va en __root.tsx. */
export function siteJsonLdScripts() {
  return [
    ldJsonScript({
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: "Esmalia",
      legalName: "MAXNOVA & LUCI Global LLC",
      url: SITE_URL,
      logo: `${SITE_URL}/icons/apple-touch-icon.png`,
      description: "Software de gestión para clínicas dentales de Latinoamérica.",
      email: "hola@esmalia.com",
      founder: { "@type": "Person", name: "Walter La Madriz" },
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: "soporte@esmalia.com",
          availableLanguage: ["es"],
        },
        {
          "@type": "ContactPoint",
          contactType: "sales",
          email: "ventas@esmalia.com",
          availableLanguage: ["es"],
        },
      ],
      // sameAs: solo perfiles que existan de verdad (ver SAME_AS).
      ...(SAME_AS.length ? { sameAs: SAME_AS } : {}),
    }),
    ldJsonScript({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Esmalia",
      url: SITE_URL,
      publisher: { "@id": ORGANIZATION_ID },
    }),
    ldJsonScript({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Esmalia",
      publisher: { "@id": ORGANIZATION_ID },
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "Agenda, ficha clínica, odontograma, presupuestos, cobranza y WhatsApp integrado para clínicas dentales.",
      inLanguage: "es",
      featureList: FEATURE_LIST,
      // Mismos 5 países que /software-dental-latam y el alta guiada.
      areaServed: [
        ["CL", "Chile"],
        ["PE", "Perú"],
        ["MX", "México"],
        ["CO", "Colombia"],
        ["AR", "Argentina"],
      ].map(([identifier, name]) => ({ "@type": "Country", identifier, name })),
      // Solo (US$19,99) y Clínica (US$49,99), ver src/lib/stripe.server.ts. Sin
      // aggregateRating hasta tener reseñas reales.
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "USD",
        lowPrice: "19.99",
        highPrice: "49.99",
        offerCount: 2,
        description: "Plan Solo desde US$19,99/mes y plan Clínica US$49,99/mes, 14 días gratis.",
        offers: PLAN_OFFERS,
      },
    }),
  ];
}

/** FAQPage JSON-LD a partir de los mismos grupos que renderiza /faq. */
export function faqJsonLdScript(items: { q: string; a: string }[]) {
  return [
    ldJsonScript({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: items.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    }),
  ];
}

/** BreadcrumbList Inicio → colección → página. */
function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return ldJsonScript({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  });
}

/** head() completo de una página editorial de src/content. */
export function contenidoHead(pagina: {
  path: string;
  titulo: string;
  descripcion: string;
  h1: string;
  publicado: string;
  actualizado: string;
  autor: { nombre: string; rol: string };
  revisor?: { nombre: string; credencial: string };
  faq?: { q: string; a: string }[];
  coleccionNombre: string;
  coleccionPath?: string;
}) {
  const canonical = canonicalHead(pagina.path);
  const url = `${SITE_URL}${pagina.path}`;
  const sinMarcas = (t: string) => t.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const migas = [
    { name: "Inicio", path: "/" },
    ...(pagina.coleccionPath ? [{ name: pagina.coleccionNombre, path: pagina.coleccionPath }] : []),
    { name: pagina.h1, path: pagina.path },
  ];
  return {
    meta: [
      { title: pagina.titulo },
      { name: "description", content: pagina.descripcion },
      { property: "og:title", content: pagina.titulo },
      { property: "og:description", content: pagina.descripcion },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
      ...canonical.meta,
    ],
    links: canonical.links,
    scripts: [
      ldJsonScript({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: pagina.h1,
        description: pagina.descripcion,
        url,
        mainEntityOfPage: url,
        inLanguage: "es",
        datePublished: pagina.publicado,
        dateModified: pagina.actualizado,
        author: { "@type": "Person", name: pagina.autor.nombre, jobTitle: pagina.autor.rol },
        ...(pagina.revisor
          ? {
              reviewedBy: {
                "@type": "Person",
                name: pagina.revisor.nombre,
                description: pagina.revisor.credencial,
              },
            }
          : {}),
        publisher: { "@id": ORGANIZATION_ID },
        image: `${SITE_URL}/landing/og-esmalia.png`,
      }),
      breadcrumbJsonLd(migas),
      ...(pagina.faq?.length
        ? faqJsonLdScript(pagina.faq.map((f) => ({ q: f.q, a: sinMarcas(f.a) })))
        : []),
    ],
  };
}
