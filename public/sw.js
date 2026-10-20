/**
 * Service worker de Esmalia — escrito a mano, a propósito.
 *
 * Por qué no `vite-plugin-pwa`: el plugin arma su manifiesto de precache en el
 * hook `closeBundle` de Vite, pero en este stack (TanStack Start + Nitro) los
 * assets recién existen en `.output/public/assets` DESPUÉS, cuando Nitro
 * ensambla la salida. El plugin globea antes y no encuentra nada — falla el
 * build con "Couldn't find configuration for either precaching or runtime
 * caching". Es un choque de orden de build, no algo que se arregle con
 * configuración. Los archivos de `public/` sí se copian tal cual, así que el
 * SW vive acá y cachea sobre la marcha en vez de precachear.
 *
 * Consecuencia asumida: después de cada deploy, la primera visita tiene que
 * ser con conexión para que se cacheen los chunks nuevos. Para una clínica que
 * abre la app todos los días es irrelevante.
 *
 * Estrategia:
 *  - Assets con hash en el nombre → CacheFirst (son inmutables).
 *  - Navegaciones (documentos HTML) → NetworkFirst, con respaldo al último
 *    shell conocido. Las rutas de la app son `ssr: false`, así que el servidor
 *    devuelve el mismo shell para todas y sirve de respaldo para cualquiera.
 *  - Todo lo demás (server functions, Supabase, otros orígenes) → NO se toca.
 */

const VERSION = "esmalia-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_KEY = "/__esmalia_shell__";

self.addEventListener("install", () => {
  // Toma el control enseguida: si sale un arreglo, la clínica no debería tener
  // que cerrar todas las pestañas para recibirlo.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/**
 * Nunca interceptar: datos y sondas.
 *
 * Los server functions y Supabase se dejan pasar siempre — sus respuestas ya
 * las cachea React Query en IndexedDB, con su propia lista blanca de qué puede
 * tocar disco. Cachearlas acá también las duplicaría fuera de esa lista.
 *
 * `_probe` es el ping de conectividad (`hooks/use-connectivity.ts`): si el SW
 * lo respondiera desde cache, la app se creería siempre conectada y el banner
 * de "sin conexión" no aparecería nunca.
 */
function debeIgnorarse(url, request) {
  if (url.origin !== self.location.origin) return true;
  if (url.searchParams.has("_probe")) return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/_serverFn/")) return true;
  if (request.method !== "GET") return true;
  return false;
}

/**
 * Solo `/assets/`: Vite le pone hash al nombre, así que un archivo cacheado
 * nunca puede estar "viejo" — si cambia, cambia la URL. Lo de `public/`
 * (favicon, imágenes del landing) NO lleva hash, y cachearlo con CacheFirst
 * serviría versiones viejas después de un deploy.
 */
function esAssetVersionado(url) {
  return url.pathname.startsWith("/assets/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (debeIgnorarse(url, request)) return;

  if (request.mode === "navigate") {
    event.respondWith(navegacion(request));
    return;
  }

  if (esAssetVersionado(url)) {
    event.respondWith(assetConCache(request));
  }
});

/** NetworkFirst + respaldo al último shell que sí cargó. */
async function navegacion(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const respuesta = await fetch(request);
    // Guardamos una copia como shell genérico: sirve para cualquier ruta,
    // porque la app renderiza del lado del cliente.
    if (respuesta.ok) cache.put(SHELL_KEY, respuesta.clone());
    return respuesta;
  } catch {
    const shell = await cache.match(SHELL_KEY);
    if (shell) return shell;
    throw new Error("offline y sin shell cacheado");
  }
}

/** CacheFirst: los nombres llevan hash, así que un hit siempre es correcto. */
async function assetConCache(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cacheado = await cache.match(request);
  if (cacheado) return cacheado;

  const respuesta = await fetch(request);
  if (respuesta.ok) cache.put(request, respuesta.clone());
  return respuesta;
}
