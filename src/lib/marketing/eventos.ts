// src/lib/marketing/eventos.ts
//
// Helper de cliente para el embudo propio (ver src/routes/api.ev.ts y el
// tracking plan en src/lib/marketing/medicion.ts / docs/MEDICION.md).
//
// Sin cookies y sin terceros. El identificador de sesión es aleatorio y vive
// en `sessionStorage`: dura lo que la pestaña (sobrevive a la vuelta de
// Google OAuth y de Stripe, que es lo que permite atribuir un registro a la
// visita que lo trajo) y desaparece al cerrarla. Mismo patrón que
// `plan-intent.ts`. Si el almacenamiento está bloqueado cae a memoria.

import {
  esNavegadorInterno,
  esRutaMedible,
  normalizarRuta,
  propsDeVista,
  type EventoCliente,
} from "@/lib/marketing/medicion";

const CLAVE_SESION = "esmalia:ev-sesion";
/** Ya se mandó la vista de entrada de esta pestaña (la que lleva el origen). */
const CLAVE_ENTRADA = "esmalia:ev-entrada";
/** `?qa=1`: la pestaña es una prueba (dura lo que la pestaña). */
const CLAVE_QA = "esmalia:ev-qa";
/** Equipo del staff: lo marca `/admin` en los equipos de quien ya pasó el
 *  gate de `ESMALIA_STAFF_EMAILS`. Es un "sí" sin identificador, y nunca se
 *  escribe en el navegador de un visitante. */
export const CLAVE_EQUIPO_INTERNO = "esmalia:medicion-interna";

let sesionEnMemoria: string | null = null;

function leer(storage: "session" | "local", clave: string): string | null {
  try {
    return (storage === "session" ? window.sessionStorage : window.localStorage).getItem(clave);
  } catch {
    return null;
  }
}

function escribir(storage: "session" | "local", clave: string, valor: string | null): void {
  try {
    const s = storage === "session" ? window.sessionStorage : window.localStorage;
    if (valor === null) s.removeItem(clave);
    else s.setItem(clave, valor);
  } catch {
    // Almacenamiento bloqueado (modo privado, etc.): se sigue sin él.
  }
}

/** Id de sesión de la pestaña (32 hex). Sólo en cliente. */
export function hashDeSesion(): string {
  const guardado = leer("session", CLAVE_SESION);
  if (guardado && /^[0-9a-f]{32}$/.test(guardado)) return guardado;
  if (!sesionEnMemoria) {
    sesionEnMemoria = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  }
  escribir("session", CLAVE_SESION, sesionEnMemoria);
  return sesionEnMemoria;
}

/** ¿Este navegador es del equipo, una prueba o un agente automatizado? */
export function esTraficoInterno(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const qa = new URLSearchParams(window.location.search).get("qa");
    if (qa === "1") escribir("session", CLAVE_QA, "1");
    if (qa === "0") {
      escribir("session", CLAVE_QA, null);
      escribir("local", CLAVE_EQUIPO_INTERNO, null);
    }
  } catch {
    // no-op
  }
  return esNavegadorInterno({
    qa: leer("session", CLAVE_QA) === "1",
    webdriver: typeof navigator !== "undefined" && navigator.webdriver === true,
    equipo: leer("local", CLAVE_EQUIPO_INTERNO) === "1",
  });
}

/** La llama `/admin` cuando el gate de staff ya pasó: las visitas de este
 *  equipo a las páginas públicas quedan con `interno: true`. `?qa=0` lo
 *  revierte. */
export function marcarEquipoInterno(): void {
  if (typeof window === "undefined") return;
  escribir("local", CLAVE_EQUIPO_INTERNO, "1");
}

/** Envía un evento sin bloquear ni romper nunca la página. */
export function registrarEvento(
  name: EventoCliente,
  props?: Record<string, string | boolean>,
): void {
  if (typeof window === "undefined") return;
  try {
    const conInterno = esTraficoInterno() ? { ...props, interno: true } : props;
    void fetch("/api/ev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, props: conInterno, sessionHash: hashDeSesion() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nunca romper la página por telemetría.
  }
}

let ultimaRutaVista: string | null = null;

/** `page_view` de una página pública. Lo llama la raíz en cada cambio de
 *  ruta; las rutas que no están en la lista blanca se ignoran. */
export function registrarVistaDePagina(pathname: string): void {
  if (typeof window === "undefined") return;
  if (!esRutaMedible(pathname)) return;
  const ruta = normalizarRuta(pathname);
  // StrictMode y re-renders: una vista por ruta, no por efecto.
  if (ruta === ultimaRutaVista) return;
  ultimaRutaVista = ruta;

  const esEntrada = leer("session", CLAVE_ENTRADA) !== "1";
  if (esEntrada) escribir("session", CLAVE_ENTRADA, "1");

  registrarEvento(
    "page_view",
    propsDeVista({
      pathname,
      search: window.location.search,
      referrer: document.referrer,
      hostPropio: window.location.hostname,
      esEntrada,
    }),
  );
}
