import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { paginasPublicadas } from "@/content";

interface SitemapEntry {
  path: string;
  /** Fecha del último cambio de CONTENIDO (AAAA-MM-DD), a mano: la fecha del
   *  build marcaría todas las páginas como nuevas en cada deploy. */
  lastmod: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Dominio de producción: https://esmalia.com desde el 09-oct-2026 (ver
        // docs/DOMINIO_RUNBOOK.md). PUBLIC_APP_URL manda cuando está seteada; si no, se
        // deriva del host real de la request (previews, local), así el sitemap queda
        // correcto en cada entorno sin hardcodear el dominio acá.
        const BASE_URL =
          (typeof process !== "undefined" && process.env.PUBLIC_APP_URL) ||
          new URL(request.url).origin;

        // Solo rutas públicas indexables: /auth tiene robots:noindex (ver auth.tsx) —
        // no tiene sentido listarla acá, generaba una contradicción con el meta tag.
        const entries: SitemapEntry[] = [
          { path: "/", lastmod: "2026-10-11", changefreq: "weekly", priority: "1.0" },
          { path: "/precios", lastmod: "2026-10-11", changefreq: "monthly", priority: "0.9" },
          {
            path: "/software-dental-latam",
            lastmod: "2026-10-11",
            changefreq: "monthly",
            priority: "0.8",
          },
          {
            path: "/calculadora-rentabilidad-dental",
            lastmod: "2026-10-08",
            changefreq: "monthly",
            priority: "0.8",
          },
          {
            path: "/recursos/fugas-clinica-dental",
            lastmod: "2026-10-10",
            changefreq: "monthly",
            priority: "0.7",
          },
          { path: "/faq", lastmod: "2026-10-09", changefreq: "monthly", priority: "0.6" },
          { path: "/nosotros", lastmod: "2026-10-11", changefreq: "monthly", priority: "0.4" },
          { path: "/estado", lastmod: "2026-10-19", changefreq: "daily", priority: "0.3" },
          { path: "/docs", lastmod: "2026-10-08", changefreq: "monthly", priority: "0.5" },
          {
            path: "/docs/primeros-pasos",
            lastmod: "2026-10-10",
            changefreq: "monthly",
            priority: "0.4",
          },
          {
            path: "/docs/migrar-desde-otro-sistema",
            lastmod: "2026-10-20",
            changefreq: "monthly",
            priority: "0.4",
          },
          {
            path: "/docs/suscripcion-y-prueba",
            lastmod: "2026-10-20",
            changefreq: "monthly",
            priority: "0.4",
          },
          {
            path: "/docs/exportar-tus-datos",
            lastmod: "2026-10-20",
            changefreq: "monthly",
            priority: "0.4",
          },
          { path: "/docs/whatsapp", lastmod: "2026-10-10", changefreq: "monthly", priority: "0.4" },
          {
            path: "/docs/portal-pacientes",
            lastmod: "2026-10-10",
            changefreq: "monthly",
            priority: "0.4",
          },
          {
            path: "/docs/datos-y-seguridad",
            lastmod: "2026-10-10",
            changefreq: "monthly",
            priority: "0.4",
          },
          { path: "/privacidad", lastmod: "2026-10-10", changefreq: "yearly", priority: "0.3" },
          { path: "/terminos", lastmod: "2026-10-10", changefreq: "yearly", priority: "0.3" },
          { path: "/dpa", lastmod: "2026-10-10", changefreq: "yearly", priority: "0.3" },
        ];

        // Páginas editoriales (src/content/paginas/) y sus índices: se suman
        // solas al publicarse; los borradores no aparecen.
        const paginas = await paginasPublicadas();
        const masReciente = (fechas: string[]) => fechas.sort().at(-1) ?? "2026-10-11";
        const indices: [string, string[]][] = [
          ["/funciones", ["funciones", "para"]],
          ["/comparar", ["comparar", "alternativas"]],
          ["/recursos", ["guias", "plantillas"]],
        ];
        for (const [path, colecciones] of indices) {
          const de = paginas.filter((p) => colecciones.includes(p.coleccion));
          if (de.length) {
            entries.push({
              path,
              lastmod: masReciente(de.map((p) => p.actualizado)),
              changefreq: "weekly",
              priority: "0.7",
            });
          }
        }
        for (const p of paginas) {
          entries.push({
            path: p.path,
            lastmod: p.actualizado,
            changefreq: "monthly",
            priority: p.coleccion === "pais" || p.coleccion === "funciones" ? "0.8" : "0.6",
          });
        }

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            `    <lastmod>${e.lastmod}</lastmod>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
