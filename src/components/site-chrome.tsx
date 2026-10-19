import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { EsmaliaLogo } from "@/components/esmalia-logo";
import { buttonVariants } from "@/components/ui/button";
import { EMAIL_CONTACTO, enlaceWhatsAppVentas } from "@/lib/marketing/contacto";
import { registrarEvento } from "@/lib/marketing/eventos";
import { cn } from "@/lib/utils";

/** Header compartido por la landing y las páginas de contenido (legal/FAQ/docs).
 *
 * `print:hidden` (revisión final de rama, Important #7): `scripts/build-pdf-recursos.mjs`
 * genera el PDF gateado de `/recursos/fugas-clinica-dental` con
 * `page.emulateMedia({ media: "print" })` sobre esta misma página — sin esta
 * clase el PDF salía con la nav del sitio adentro. Universal a propósito
 * (nunca sólo en esa ruta): ninguna otra página del sitio usa `@media print`
 * hoy, así que esto no cambia nada fuera de la generación del PDF, y es lo
 * correcto igual si alguna vez alguien imprime cualquier otra página. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-background/90 backdrop-blur-sm print:hidden">
      <nav
        aria-label="Principal"
        className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3"
      >
        <Link to="/" className="flex items-center py-1">
          <EsmaliaLogo size={28} />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {navLinks.map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                className="rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:text-brand-700"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1">
          <Link
            to="/auth"
            className="rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:text-brand-700"
          >
            Ingresar
          </Link>
          <a
            href="/demo"
            onClick={() => registrarEvento("cta_click", { cta: "demo", lugar: "nav" })}
            className={buttonVariants({ size: "sm" })}
          >
            Ver la demo
          </a>
        </div>
      </nav>
    </header>
  );
}

/** Anclas a la home (desde otras páginas públicas también llevan a la
 *  sección), salvo Precios, que tiene página propia. */
const navLinks = [
  { label: "Producto", href: "/#producto" },
  { label: "Precios", href: "/precios" },
  { label: "Calculadora", href: "/#calculadora" },
  { label: "Recursos", href: "/recursos" },
] as const;

type FooterLink =
  | {
      label: string;
      kind: "route";
      to:
        | "/auth"
        | "/precios"
        | "/faq"
        | "/docs"
        | "/nosotros"
        | "/terminos"
        | "/privacidad"
        | "/dpa"
        | "/estado"
        | "/calculadora-rentabilidad-dental"
        | "/recursos/fugas-clinica-dental"
        | "/software-dental-latam"
        | "/software-dental-chile"
        | "/software-dental-argentina"
        | "/software-dental-mexico"
        | "/software-dental-colombia"
        | "/software-dental-peru"
        | "/funciones"
        | "/comparar"
        | "/recursos";
    }
  | { label: string; kind: "external"; href: string };

const footerColumns: { t: string; links: FooterLink[] }[] = [
  {
    t: "Producto",
    links: [
      { label: "Ver demo", kind: "external", href: "/demo" },
      { label: "Funciones", kind: "route", to: "/funciones" },
      { label: "Precios", kind: "route", to: "/precios" },
      { label: "Comparativas", kind: "route", to: "/comparar" },
      { label: "Empieza gratis", kind: "route", to: "/auth" },
    ],
  },
  {
    t: "Recursos",
    links: [
      { label: "Todos los recursos", kind: "route", to: "/recursos" },
      { label: "Preguntas frecuentes", kind: "route", to: "/faq" },
      {
        label: "Software dental en Latinoamérica",
        kind: "route",
        to: "/software-dental-latam",
      },
      { label: "Software dental en México", kind: "route", to: "/software-dental-mexico" },
      { label: "Software dental en Colombia", kind: "route", to: "/software-dental-colombia" },
      { label: "Software dental en Chile", kind: "route", to: "/software-dental-chile" },
      { label: "Software dental en Perú", kind: "route", to: "/software-dental-peru" },
      { label: "Software dental en Argentina", kind: "route", to: "/software-dental-argentina" },
      { label: "Documentación", kind: "route", to: "/docs" },
      {
        label: "Calculadora de rentabilidad",
        kind: "route",
        to: "/calculadora-rentabilidad-dental",
      },
      {
        label: "Checklist: 15 fugas de dinero",
        kind: "route",
        to: "/recursos/fugas-clinica-dental",
      },
    ],
  },
  {
    t: "Empresa",
    links: [
      { label: "Quiénes somos", kind: "route", to: "/nosotros" },
      { label: "Estado del servicio", kind: "route", to: "/estado" },
      { label: "Contacto", kind: "external", href: `mailto:${EMAIL_CONTACTO}` },
      // Solo aparece con `VITE_SALES_WHATSAPP` cargado: sin número, "Contacto"
      // ya cubre el email y un link "WhatsApp" que abre el correo engaña.
      ...(enlaceWhatsAppVentas().esWhatsApp
        ? [{ label: "WhatsApp", kind: "external" as const, href: enlaceWhatsAppVentas().href }]
        : []),
    ],
  },
  {
    t: "Legal",
    links: [
      { label: "Términos de servicio", kind: "route", to: "/terminos" },
      { label: "Política de privacidad", kind: "route", to: "/privacidad" },
      { label: "Tratamiento de datos (DPA)", kind: "route", to: "/dpa" },
    ],
  },
];

/** Footer compartido: a diferencia del footer mínimo original, estos links apuntan a páginas reales.
 *
 * `print:hidden`: ver el comentario de `SiteHeader` arriba — mismo motivo. */
export function SiteFooter() {
  return (
    <footer className="border-t border-hairline print:hidden">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-14 sm:grid-cols-4">
        {footerColumns.map((col) => (
          <div key={col.t}>
            <p className="kicker">{col.t}</p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.kind === "route" ? (
                    <Link
                      to={l.to}
                      className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </Link>
                  ) : (
                    <a
                      href={l.href}
                      className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-col items-center justify-between gap-4 border-t border-hairline pt-6 text-sm text-muted-foreground sm:flex-row">
          <EsmaliaLogo size={22} />
          <span className="flex items-center gap-1.5 text-xs">
            Software de gestión dental · Hecho para Latinoamérica
            <Lock className="size-3" /> tus datos son tuyos
          </span>
        </div>
      </div>
    </footer>
  );
}

/**
 * Shell compartido por toda página pública con header+contenido+footer —
 * unifica el patrón que antes tenía dos formas distintas de llegar al mismo
 * resultado (auditoría 19-sep-2026): `calculadora-rentabilidad-dental.tsx`
 * armaba el div a mano, `recursos.fugas-clinica-dental.tsx` pasaba por
 * `LegalPage`. Cualquier página pública nueva debería usar esto en vez de
 * repetir `<div><SiteHeader/>...<SiteFooter/></div>`.
 *
 * `outerClassName` es para el caso `demo.tsx` (necesita `flex flex-col` en
 * el contenedor para que `flex-1` del `<main>` centre el formulario
 * verticalmente) — el resto de las páginas no lo necesita.
 */
export function PublicPageShell({
  children,
  mainClassName,
  outerClassName,
}: {
  children: ReactNode;
  mainClassName?: string;
  outerClassName?: string;
}) {
  return (
    <div className={cn("min-h-dvh bg-background", outerClassName)}>
      <SiteHeader />
      <main
        id="main-content"
        className={cn("mx-auto max-w-6xl px-6 py-12 sm:py-16", mainClassName)}
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
