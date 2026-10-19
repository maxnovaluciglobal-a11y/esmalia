// src/lib/marketing/medicion.ts
//
// Tracking plan del embudo, como código (auditoría 360, IA-14 / MKT-02 /
// COM-06). Todo lo de acá es puro: sin DOM, sin red, sin base. El cliente
// (`eventos.ts`), el endpoint (`api.ev.ts`) y los eventos de servidor
// (`eventos-servidor.server.ts`) lo usan, y `tests/medicion-embudo.test.ts`
// lo vigila contra la migración y `docs/MEDICION.md`.
//
// Regla de la casa: medición propia, sin cookies y sin terceros (lo promete
// `privacidad.tsx`, sección 10). Ningún evento lleva IP, email, nombre,
// teléfono, ids de clínica o de usuario, ni cifras de la clínica.

/** Eventos que el navegador manda a `/api/ev` (anónimos). */
export const EVENTOS_CLIENTE = [
  "calculadora_vista",
  "calculadora_usada",
  "lead_enviado",
  "cta_click",
  "page_view",
] as const;

/** Eventos que pide el navegador de un usuario con sesión, pero que valida y
 *  escribe el servidor (`eventos-cuenta.functions.ts`): así el servidor
 *  decide si son reales y si el usuario es del equipo. */
export const EVENTOS_CUENTA = [
  "registro_completado",
  "checkout_iniciado",
  "suscripcion_activada",
] as const;

/** Eventos que sólo emite el servidor, como efecto de una acción real. */
export const EVENTOS_SERVIDOR = [
  "lead_intento",
  "onboarding_completado",
  "primera_cita_creada",
] as const;

/** Todos los nombres válidos. Tiene que coincidir con el CHECK
 *  `marketing_events_name_valido` de la última migración que lo toca. */
export const EVENTOS_DEL_PLAN = [...EVENTOS_CLIENTE, ...EVENTOS_CUENTA, ...EVENTOS_SERVIDOR];

export type EventoCliente = (typeof EVENTOS_CLIENTE)[number];
export type EventoCuenta = (typeof EVENTOS_CUENTA)[number];
export type EventoServidor = (typeof EVENTOS_SERVIDOR)[number];
export type EventoDelPlan = EventoCliente | EventoCuenta | EventoServidor;

/** Mismo tope que el esquema de `/api/ev` para los valores de texto. */
export const MAX_VALOR = 60;

// ---------------------------------------------------------------------------
// page_view: qué páginas se miden
// ---------------------------------------------------------------------------

/** Páginas públicas exactas. Lista blanca a propósito: una ruta que no está
 *  acá no se mide. Nunca entran `/portal/*`, `/portal-laboratorio/*` (llevan
 *  el token en la ruta) ni las pantallas de la app. */
const RUTAS_EXACTAS = new Set([
  "/",
  "/precios",
  "/nosotros",
  "/faq",
  "/demo",
  "/auth",
  "/privacidad",
  "/terminos",
  "/dpa",
  "/calculadora-rentabilidad-dental",
]);

/** Secciones de contenido público (la sección y todo lo que cuelga de ella). */
const SECCIONES = [
  "/funciones",
  "/guias",
  "/comparar",
  "/alternativas",
  "/para",
  "/plantillas",
  "/recursos",
  "/docs",
];

/** Ruta sin barra final (salvo la raíz), recortada al tope de props. */
export function normalizarRuta(pathname: string): string {
  const sinQuery = pathname.split(/[?#]/)[0] || "/";
  const sinBarra = sinQuery.length > 1 ? sinQuery.replace(/\/+$/, "") : sinQuery;
  return (sinBarra || "/").slice(0, MAX_VALOR);
}

export function esRutaMedible(pathname: string): boolean {
  const ruta = normalizarRuta(pathname);
  if (RUTAS_EXACTAS.has(ruta)) return true;
  if (ruta.startsWith("/software-dental-")) return true;
  return SECCIONES.some((s) => ruta === s || ruta.startsWith(s + "/"));
}

// ---------------------------------------------------------------------------
// Origen de la visita
// ---------------------------------------------------------------------------

const DOMINIOS_PROPIOS = ["esmalia.com"];

function sinWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * Dominio de origen (nunca la URL completa: puede traer búsquedas o tokens).
 * `null` cuando no hay referrer o es el mismo sitio (navegación interna).
 */
export function hostDeReferrer(referrer: string, hostPropio: string): string | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = sinWww(new URL(referrer).hostname);
  } catch {
    return null;
  }
  if (!host) return null;
  const propio = sinWww(hostPropio);
  if (host === propio) return null;
  if (DOMINIOS_PROPIOS.some((d) => host === d || host.endsWith("." + d))) return null;
  return host.slice(0, MAX_VALOR);
}

export const CLAVES_UTM = ["utm_source", "utm_medium", "utm_campaign"] as const;
export type Utm = Partial<Record<(typeof CLAVES_UTM)[number], string>>;

/** `utm_source/medium/campaign` de la URL de entrada, saneados. Un valor con
 *  `@` se descarta: alguien podría pegar un email en un enlace. */
export function utmDeBusqueda(search: string): Utm {
  const params = new URLSearchParams(search);
  const utm: Utm = {};
  for (const clave of CLAVES_UTM) {
    const valor = (params.get(clave) ?? "")
      .trim()
      .toLowerCase()
      // Fuera caracteres de control (no se ven y ensucian la agrupación).
      .split("")
      .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
      .join("")
      .slice(0, MAX_VALOR);
    if (valor && !valor.includes("@")) utm[clave] = valor;
  }
  return utm;
}

/**
 * Propiedades de un `page_view`. La primera vista de la pestaña (`entrada`)
 * lleva el origen: dominio de referencia y UTM. Las siguientes, sólo la ruta:
 * en una SPA `document.referrer` no cambia al navegar, así que repetirlo
 * contaría como externa cada navegación interna.
 */
export function propsDeVista(args: {
  pathname: string;
  search: string;
  referrer: string;
  hostPropio: string;
  esEntrada: boolean;
}): Record<string, string | boolean> {
  const props: Record<string, string | boolean> = { path: normalizarRuta(args.pathname) };
  if (!args.esEntrada) return props;
  props.entrada = true;
  props.ref_host = hostDeReferrer(args.referrer, args.hostPropio) ?? "directo";
  Object.assign(props, utmDeBusqueda(args.search));
  return props;
}

// ---------------------------------------------------------------------------
// Tráfico interno
// ---------------------------------------------------------------------------

/** Dominios reservados para pruebas (RFC 2606/6761) y los de los tests. */
const DOMINIOS_DE_PRUEBA = [".invalid", ".test", ".example", ".localhost"];
const DOMINIOS_EJEMPLO = ["example.com", "example.net", "example.org"];

/**
 * ¿El correo es del equipo, de la demo o de una prueba? Se marca
 * `interno: true` y las consultas lo excluyen (IA-15).
 */
export function esCorreoInterno(
  email: string | null | undefined,
  staffEmailsCsv: string | null | undefined,
  demoEmail: string,
): boolean {
  const correo = (email ?? "").trim().toLowerCase();
  if (!correo) return false;
  if (correo === demoEmail.toLowerCase()) return true;
  const staff = (staffEmailsCsv ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (staff.includes(correo)) return true;
  const dominio = correo.split("@")[1] ?? "";
  if (DOMINIOS_DE_PRUEBA.some((d) => dominio.endsWith(d))) return true;
  return DOMINIOS_EJEMPLO.some((d) => dominio === d || dominio.endsWith("." + d));
}

/** Señales del navegador: `?qa=1`, un navegador automatizado (Playwright,
 *  agentes) o un equipo del staff marcado desde `/admin`. */
export function esNavegadorInterno(senales: {
  qa: boolean;
  webdriver: boolean;
  equipo: boolean;
}): boolean {
  return senales.qa || senales.webdriver || senales.equipo;
}

// ---------------------------------------------------------------------------
// Validaciones del servidor
// ---------------------------------------------------------------------------

/** Ventana para aceptar `registro_completado`: el usuario se creó hace poco.
 *  Evita contar como registro un inicio de sesión de una cuenta vieja. */
export const VENTANA_REGISTRO_MIN = 30;

export function esAltaReciente(
  createdAtIso: string | null | undefined,
  ahora: Date,
  minutos = VENTANA_REGISTRO_MIN,
): boolean {
  if (!createdAtIso) return false;
  const creado = new Date(createdAtIso).getTime();
  if (Number.isNaN(creado)) return false;
  const diff = ahora.getTime() - creado;
  return diff >= -60_000 && diff <= minutos * 60_000;
}

/** Horas enteras entre el alta de la clínica y la primera cita, y si entra en
 *  la ventana de activación de `/admin/clinicas` (72 h). */
export function horasDesdeAlta(
  createdAtIso: string | null | undefined,
  ahora: Date,
): { horas_desde_alta: string; dentro_72h: boolean } | null {
  if (!createdAtIso) return null;
  const creado = new Date(createdAtIso).getTime();
  if (Number.isNaN(creado)) return null;
  const horas = Math.max(0, Math.floor((ahora.getTime() - creado) / 3_600_000));
  return { horas_desde_alta: String(horas), dentro_72h: horas <= 72 };
}

/** País por la cabecera de Vercel (`x-vercel-ip-country`): dos letras o nada.
 *  Se guarda el país, nunca la IP. */
export function paisDeCabecera(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

/** Una suscripción cuenta como activada por el checkout sólo si Stripe ya la
 *  creó: la fila de `subscriptions` existe en `trialing` desde el alta, sin
 *  `stripe_subscription_id`, antes de cualquier checkout. */
export function suscripcionConfirmada(
  sub: { status: string; stripe_subscription_id: string | null } | null,
): boolean {
  if (!sub?.stripe_subscription_id) return false;
  return sub.status === "active" || sub.status === "trialing";
}
