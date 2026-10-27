import { MutationCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";
import { fuentesSupabaseParaCsp } from "@/lib/csp";
import { esErrorSoloLectura } from "@/lib/solo-lectura";

/** Igual que el cache persistido en disco (ver `lib/offline-cache.ts`). */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * CSP con nonce real (urgente #4 del plan de remediación). El primer intento
 * (05-sep-2026) se descartó porque la versión de @tanstack/react-router de
 * entonces no soportaba nonce — confirmado ahora, releyendo el código fuente
 * instalado, que SÍ lo soporta (`router.options.ssr.nonce`, ya threadeado
 * por `Scripts`/`HeadContent`/`Asset`/`headContentUtils` a cada script y
 * meta que el router mismo inyecta, incluidos el manifest de rutas y el
 * JSON-LD de SEO — ambos con contenido que cambia por request, la razón
 * original por la que ni `'unsafe-inline'` a secas ni un CSP por hash
 * alcanzaban).
 *
 * El nonce se genera acá (no en vercel.json) porque tiene que ser random
 * por request — vercel.json se queda con los headers que sí pueden ser
 * estáticos (HSTS, X-Frame-Options, etc.), aplicados incluso a los
 * archivos estáticos que nunca pasan por acá.
 *
 * `style-src` sigue con `'unsafe-inline'` a propósito, sin tocar: Radix UI
 * (Popover/Dialog/Tooltip, usados en toda la app) inyecta `style=""` en
 * runtime para posicionar — un ATRIBUTO inline, no una etiqueta `<style>`.
 * CSP nonce/hash nunca cubre atributos, solo elementos — sacar
 * `'unsafe-inline'` de `style-src` rompería todo diálogo/popover de la app
 * sin que el nonce pueda arreglarlo. Consistente con que esta app no usa
 * `inlineCss` de TanStack Start (el CSS real carga por `<link>` a un
 * archivo hasheado, nunca inline).
 */
function leerSupabaseUrl(): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (
    (typeof process !== "undefined" ? process.env?.SUPABASE_URL : undefined) ||
    (typeof process !== "undefined" ? process.env?.VITE_SUPABASE_URL : undefined) ||
    env?.VITE_SUPABASE_URL
  );
}

/**
 * RES-07: la reserva en línea se puede embeber en el sitio de la clínica
 * (widget con iframe). Solo esas páginas aceptan cualquier sitio https como
 * marco; el resto de la app sigue con `frame-ancestors 'self'`. Con
 * frame-ancestors presente, los navegadores ignoran el X-Frame-Options
 * SAMEORIGIN estático de vercel.json.
 */
export function frameAncestorsPara(pathname: string): string {
  return /^\/reservar\/[^/]+(?:\/[^/]+)?\/?$/.test(pathname)
    ? "frame-ancestors 'self' https:"
    : "frame-ancestors 'self'";
}

function buildCsp(nonce: string, pathname = "/"): string {
  const supabase = fuentesSupabaseParaCsp(leerSupabaseUrl());
  return [
    "default-src 'self'",
    // connect.facebook.net / *.facebook.com: SDK de Facebook para conectar el
    // WhatsApp de la clínica (Embedded Signup en /whatsapp). La CSP es la del
    // primer documento que se carga y /whatsapp se abre navegando dentro de
    // la app, así que tiene que ir en la política general.
    `script-src 'self' 'nonce-${nonce}' https://connect.facebook.net`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: ${supabase.https} https://*.facebook.com https://*.fbcdn.net`,
    `connect-src 'self' ${supabase.https} ${supabase.wss} https://*.sentry.io https://*.facebook.com https://graph.facebook.com`,
    "frame-src 'self' https://*.facebook.com",
    // Videos de ayuda y Academia: bucket público `videos-ayuda` de Supabase.
    `media-src 'self' ${supabase.https}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frameAncestorsPara(pathname),
  ].join("; ");
}

/** 128 bits de entropía real (crypto.getRandomValues), no Math.random. */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// `createIsomorphicFn` (no un simple `if (typeof document === "undefined")`)
// porque el plugin de Vite de TanStack Start bloquea en build cualquier
// import de `@tanstack/react-start/server` alcanzable desde el bundle de
// cliente, aunque esté detrás de un guard en runtime — el análisis es
// estático, no ve que la rama nunca corre en el browser. Este es el
// mecanismo que el propio error de Vite sugiere para separar limpiamente
// la rama server (con el import) de la rama cliente (no-op, nunca headerea
// nada: no hay request/response en el browser, y el navegador igual oculta
// el atributo `nonce` post-parseo).
const nonceForRequest = createIsomorphicFn()
  .server(async () => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const nonce = generateNonce();
    let pathname = "/";
    try {
      pathname = new URL(getRequest().url).pathname;
    } catch {
      // sin request: política por defecto
    }
    setResponseHeader("Content-Security-Policy", buildCsp(nonce, pathname));
    return nonce;
  })
  .client(() => undefined);

export const getRouter = async () => {
  const nonce = await nonceForRequest();

  const queryClient: QueryClient = new QueryClient({
    // Si el servidor rechaza una escritura por modo solo lectura (BIL-01) y
    // la pantalla todavía no lo sabía (suscripción en caché), se refresca
    // la suscripción para que aparezcan el banner y los botones bloqueados.
    mutationCache: new MutationCache({
      onError: (error) => {
        if (esErrorSoloLectura(error)) {
          void queryClient.invalidateQueries({ queryKey: ["my-subscription"] });
        }
      },
      // Con `staleTime` de 60 s (abajo), un dato cacheado se mostraría sin
      // recargar al volver a una pantalla dentro de ese minuto. Toda escritura
      // que sale bien marca TODO el caché como viejo, sin recargar nada en el
      // momento (`refetchType: "none"`): cada pantalla recarga lo suyo al
      // montarse, igual que con el `staleTime: 0` de antes. Lo que se ve en
      // pantalla lo sigue refrescando el `invalidateQueries` de cada mutación.
      onSuccess: () => {
        void queryClient.invalidateQueries({ refetchType: "none" });
      },
    }),
    defaultOptions: {
      queries: {
        // El default ("online") deja las queries en pausa y SIN datos apenas
        // el browser se cree desconectado. "offlineFirst" entrega lo que haya
        // en cache y recién ahí intenta la red: es lo que permite que la
        // clínica siga viendo la agenda durante un corte.
        networkMode: "offlineFirst",
        // Auditoría de rendimiento (20-oct-2026): con el default (0) cada
        // vuelta a la pestaña relanzaba TODAS las consultas montadas, incluido
        // el badge de recordatorios (nueve consultas sobre la clínica entera).
        // Un minuto alcanza para no repetir lecturas al cambiar de ventana;
        // las escrituras siguen invalidando (ver `mutationCache` arriba).
        staleTime: 60_000,
        // El default de 5 min descartaría de memoria justo lo que acabamos de
        // guardar en disco. Tiene que durar al menos lo mismo que el cache
        // persistido, o al volver de un corte largo no queda nada que mostrar.
        gcTime: WEEK_MS,
        // Sin red, 3 reintentos con backoff exponencial tardan ~7s en darse
        // por vencidos: el usuario mira una pantalla cargando sin saber por
        // qué. Con 1 el fallo se ve enseguida y el banner aparece a tiempo.
        retry: 1,
      },
      mutations: {
        // Todavía no hay cola de escritura (llega en la Tanda 3). Hasta
        // entonces queremos que una mutación sin red FALLE, no que espere.
        // Ojo con "online" acá: React Query no la falla, la deja en pausa
        // hasta que vuelva la red — el botón se queda girando para siempre y
        // el usuario no sabe si guardó. "always" la deja intentar y fallar.
        networkMode: "always",
        retry: 0,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    ssr: nonce ? { nonce } : undefined,
  });

  return router;
};
