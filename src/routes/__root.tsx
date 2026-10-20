import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode, useMemo } from "react";

import { buttonVariants } from "@/components/ui/button";
import appCss from "../styles.css?url";
// Las dos caras que pinta el primer pantallazo (cuerpo y titular). Sin
// precarga, el navegador las pedía recién al aplicar el CSS y el cambio de
// fuente movía el layout (todo el CLS medido venía de ahí). Instrument Sans
// es variable: un solo archivo cubre de 400 a 700. Geist Mono (cifras) se
// precarga en el layout de la clínica, que es donde se usa.
import instrumentSans from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url";
import cormorantRegular from "@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff2?url";
import { reportBoundaryError } from "../lib/error-reporting";
import { SITE_URL, siteJsonLdScripts } from "@/lib/seo";
import { migrarAlmacenamientoLocal } from "@/lib/compat/nombres-anteriores";
import { captureException, initSentry } from "@/lib/sentry";
import { attachOfflineCache, resetOfflineCache } from "@/lib/offline/offline-cache";
import { registerServiceWorker } from "@/lib/offline/register-sw";
import { Toaster } from "@/components/ui/sonner";
import { debeDesviarANuevaClave, RUTA_NUEVA_CLAVE } from "@/lib/recuperar-clave";
import { registrarVistaDePagina } from "@/lib/marketing/eventos";

// Se ejecuta una sola vez al importar el módulo raíz. No-op (y sin descargar
// @sentry/react) si no hay DSN — ver src/lib/sentry.ts.
void initSentry();
// Idem: no-op en dev y si el navegador no soporta service workers.
registerServiceWorker();

function NotFoundComponent() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center bg-background px-4"
    >
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">No encontramos esta página</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Puede que el enlace esté mal escrito o que la página se haya movido.
        </p>
        <div className="mt-6">
          <Link to="/" className={buttonVariants()}>
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}

function ErrorComponent({ error: errorDesconocido, reset }: ErrorComponentProps) {
  // Desde @tanstack/react-router 1.170.4x el error llega como `unknown`.
  const error = useMemo(
    () =>
      errorDesconocido instanceof Error ? errorDesconocido : new Error(String(errorDesconocido)),
    [errorDesconocido],
  );
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportBoundaryError(error, { boundary: "tanstack_root_error_component" });
    captureException(error, { tags: { boundary: "tanstack_root_error_component" } });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          No pudimos cargar esta página
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo falló de nuestro lado. Puedes intentarlo de nuevo o volver al inicio.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md border border-brand bg-transparent px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand/12"
          >
            Intentar de nuevo
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Volver al inicio
          </a>
        </div>
      </div>
    </div>
  );
}

// og:image/twitter:image necesitan una URL absoluta (no alcanza con una ruta
// relativa como en <img src>), por eso se arma sobre SITE_URL, que vive en un
// solo lugar: src/lib/seo.ts.
// Pieza de marca 1200×630 (ratio estándar OG): wordmark + claim sobre papel,
// generada con scripts/generar-og.mjs. Reemplaza al recorte de la foto del
// hero (dentist-og.jpg) desde el rebrand a Esmalia (08-oct-2026).
const SOCIAL_IMAGE_URL = `${SITE_URL}/landing/og-esmalia.png`;

// Preferencias guardadas con el nombre anterior de la marca → claves nuevas,
// antes del primer render (ver lib/compat/nombres-anteriores.ts).
if (typeof window !== "undefined") migrarAlmacenamientoLocal();

/**
 * Aplica el modo oscuro antes del primer pintado. El tema lo pone AppShell
 * en un useEffect, así que quien usa modo oscuro veía la pantalla clara un
 * instante en cada carga (auditoría 07-oct-2026). Va en el <head> por
 * `head().scripts`, que lleva el nonce de la CSP. Mismas reglas que
 * AppShell (clave `esmalia:theme`, si no hay elección sigue al sistema) y
 * solo en la app: las páginas públicas siguen siempre en claro.
 */
const SCRIPT_TEMA_SIN_DESTELLO = `(function(){try{var p=location.pathname.split("/")[1]||"";var pub=["","auth","demo","docs","dpa","faq","nosotros","portal","portal-laboratorio","precios","privacidad","recursos","software-dental-latam","software-dental-chile","software-dental-argentina","software-dental-mexico","software-dental-colombia","software-dental-peru","funciones","comparar","alternativas","guias","plantillas","para","terminos","calculadora-rentabilidad-dental"];if(pub.indexOf(p)>=0)return;var t=localStorage.getItem("esmalia:theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})();`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Esmalia · Software de gestión dental" },
      {
        name: "description",
        content:
          "Esmalia es el sistema operativo de la clínica dental: agenda, pacientes, historia clínica e IA en una sola plataforma.",
      },
      { name: "author", content: "Esmalia" },
      { property: "og:title", content: "Esmalia · Software de gestión dental" },
      {
        property: "og:description",
        content: "Agenda, pacientes, historia clínica e IA para clínicas dentales de LatAm.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Esmalia" },
      { property: "og:locale", content: "es_419" },
      { property: "og:image", content: SOCIAL_IMAGE_URL },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Esmalia · Software de gestión dental" },
      {
        name: "twitter:description",
        content: "Agenda, pacientes, historia clínica e IA para clínicas dentales de LatAm.",
      },
      { name: "twitter:image", content: SOCIAL_IMAGE_URL },
      // Pinta la barra del navegador con el papel (claro) o la tinta (oscuro)
      // cuando la app corre instalada (display: standalone).
      { name: "theme-color", content: "#f3f2f2", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#1d1c1b", media: "(prefers-color-scheme: dark)" },
      // Verificación del dominio en el portafolio de Meta (Maxnova & Luci LLC): no es secreto.
      { name: "facebook-domain-verification", content: "b58oz2sxb22bc64yescoo5mrkaul01" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Esmalia" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    ],
    links: [
      {
        rel: "preload",
        href: instrumentSans,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: cormorantRegular,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
    // Organization + WebSite + SoftwareApplication: no dependen de la ruta,
    // por eso van acá y no repetidos por página (mayor impacto GEO, ver
    // memoria esmalia_seo_geo_pendiente).
    scripts: [{ children: SCRIPT_TEMA_SIN_DESTELLO }, ...siteJsonLdScripts()],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Saltar al contenido principal
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Embudo propio sin cookies (IA-14 / MKT-02): una vista por cambio de ruta,
  // sólo en las páginas públicas de la lista blanca de `medicion.ts`. Ni la
  // app ni el portal (lleva el token en la ruta) se miden.
  useEffect(() => {
    registrarVistaDePagina(pathname);
  }, [pathname]);

  // Si la Redirect URL de Supabase no incluye /auth/nueva-clave, el enlace de
  // "Olvidé mi contraseña" cae en la Site URL con el token en el hash. Se
  // desvía antes de que el cliente de Supabase lo consuma (ver recuperar-clave.ts).
  useEffect(() => {
    if (debeDesviarANuevaClave(window.location.pathname, window.location.hash)) {
      window.location.replace(RUTA_NUEVA_CLAVE + window.location.hash);
    }
  }, []);

  // Persistencia del cache en disco. Vive en un efecto (y no en un provider)
  // porque solo puede correr en el browser: en SSR no hay IndexedDB, y
  // `getRouter()` arma un QueryClient distinto por request.
  useEffect(() => {
    let detachCache: (() => void) | undefined;
    let cancelled = false;

    async function bindCacheTo(userId: string | undefined) {
      detachCache?.();
      detachCache = undefined;
      if (!userId) {
        // Sin sesión no dejamos nada del usuario anterior en el equipo.
        await resetOfflineCache();
        return;
      }
      // La restauración ya corrió en el guard de `_clinic`; acá solo queda
      // enganchar el guardado continuo.
      if (!cancelled) detachCache = attachOfflineCache(queryClient, userId);
    }

    // Import diferido, por la misma razón que en `_authenticated/route.tsx`.
    // Acá ya estamos en el browser (es un useEffect), así que no hay costo de
    // SSR. Si la sesión cambiara antes de que resuelva, `getSession()` lo
    // corrige igual al resolver.
    let desuscribir: (() => void) | undefined;

    void import("@/integrations/supabase/client").then(({ supabase }) => {
      if (cancelled) return;
      void supabase.auth.getSession().then(({ data }) => bindCacheTo(data.session?.user.id));

      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
        void bindCacheTo(session?.user.id);
        // `registro_completado`: el servidor decide si la cuenta es nueva
        // (alta o confirmación reciente). Cubre email, Google y el enlace de
        // confirmación, que vuelven todos por acá.
        if (event === "SIGNED_IN" && session?.user) {
          const { created_at, email_confirmed_at } = session.user;
          void import("@/lib/marketing/eventos-cuenta").then((m) =>
            m.registrarRegistroCompletado({
              createdAt: created_at,
              confirmadoAt: email_confirmed_at,
            }),
          );
        }
        // Mejores prácticas 01-sep: acá había además un queryClient.invalidateQueries()
        // sin queryKey — la única de 57 invalidaciones del repo sin scope,
        // refetch-storm de TODO lo montado en cada evento de auth. router.invalidate()
        // ya re-corre los loaders (getMyAccess, etc.) y bindCacheTo ya reata el
        // cache offline al usuario correcto — cubren el caso real de cambio de
        // identidad sin pagar el costo de invalidar todo React Query.
        router.invalidate();
      });
      desuscribir = () => data.subscription.unsubscribe();
      // Si el efecto se desmontó mientras resolvía el import, soltamos ya.
      if (cancelled) desuscribir();
    });

    return () => {
      cancelled = true;
      detachCache?.();
      desuscribir?.();
    };
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster closeButton />
    </QueryClientProvider>
  );
}
