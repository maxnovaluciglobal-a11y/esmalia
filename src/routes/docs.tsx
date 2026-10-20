import { Outlet, Link, createFileRoute, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

/**
 * Layout de /docs: header + nav lateral + Outlet + footer, compartido por todas las subpáginas.
 * Sin canonical/og:url propios a propósito: TanStack Router dedupe los `<meta>` por
 * name/property (el hijo gana), pero NO dedupe `<link>` — un canonical acá se sumaría
 * al de la subpágina en vez de reemplazarlo. Cada ruta hija (docs.index.tsx,
 * docs.primeros-pasos.tsx, etc.) ya declara el suyo con canonicalHead().
 */
export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentación · Esmalia" },
      {
        name: "description",
        content:
          "Guías para empezar a usar Esmalia: primeros pasos, WhatsApp, portal de pacientes y cómo tratamos tus datos.",
      },
    ],
  }),
  component: DocsLayout,
});

const nav = [
  { to: "/docs", label: "Introducción" },
  { to: "/docs/primeros-pasos", label: "Primeros pasos" },
  { to: "/docs/migrar-desde-otro-sistema", label: "Migrar desde otro sistema" },
  { to: "/docs/suscripcion-y-prueba", label: "Prueba y suscripción" },
  { to: "/docs/exportar-tus-datos", label: "Exportar tus datos" },
  { to: "/docs/whatsapp", label: "Conectar WhatsApp" },
  { to: "/docs/portal-pacientes", label: "Portal de pacientes" },
  { to: "/docs/datos-y-seguridad", label: "Datos y seguridad" },
] as const;

function DocsLayout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SiteHeader />
      <main
        id="main-content"
        className="mx-auto grid max-w-5xl gap-10 px-6 py-12 sm:py-16 lg:grid-cols-[200px_1fr]"
      >
        <nav className="lg:sticky lg:top-20 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
            Documentación
          </p>
          <ul className="mt-4 space-y-1">
            {nav.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                    pathname === item.to
                      ? "bg-brand-100 font-medium text-brand-700"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
