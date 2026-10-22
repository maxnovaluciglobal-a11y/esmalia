/**
 * Redacción de PII compartida por el Sentry del navegador (`sentry.ts`) y el
 * del servidor (`sentry.server.ts`). Ver el checklist de PII en `sentry.ts`.
 */
type EventoConMensaje = {
  message?: string;
  exception?: { values?: { value?: string }[] };
};

// Mensajes de error de Postgres suelen citar el valor literal que violó la
// constraint, ej.: `Key (email)=(paciente@real.com) already exists.` o
// `duplicate key value violates unique constraint "patients_dni_key"`.
// Si ese mensaje llega tal cual a Sentry, un campo de columna puede terminar
// filtrando un dato real (email, teléfono, DNI, etc.) fuera de la DB.
// Truncamos/redactamos el patrón `(columna)=(valor)` para no perder la
// causa del error (nombre de columna/constraint) pero sin el valor literal.
const POSTGRES_KEY_VALUE_PATTERN = /\(([^()=]+)\)=\(([^()]*)\)/g;

// Las violaciones de NOT NULL y CHECK traen la fila entera ("Failing row
// contains (uuid, Ana Pérez, +56 9…, ana@…)"): el patrón de arriba no la
// cubre y el checklist de sentry.ts lo marcaba como hueco abierto.
const POSTGRES_FAILING_ROW_PATTERN = /Failing row contains \(.*\)/g;

export function redactPostgresLiteralsInString(message: string): string {
  return message
    .replace(POSTGRES_KEY_VALUE_PATTERN, (_match, column: string) => `(${column})=(redacted)`)
    .replace(POSTGRES_FAILING_ROW_PATTERN, "Failing row contains (redacted)");
}

export function redactPostgresLiterals(event: EventoConMensaje): void {
  if (event.message) {
    event.message = redactPostgresLiteralsInString(event.message);
  }
  for (const value of event.exception?.values ?? []) {
    if (value.value) {
      value.value = redactPostgresLiteralsInString(value.value);
    }
  }
}

// ─── Tokens en URLs (auditoría 10-oct-2026) ──────────────────────────────
//
// Los portales sin login llevan el JWT en el path (`/portal/<jwt>`,
// `/portal-laboratorio/<jwt>`) y los enlaces de Auth traen `token_hash`,
// `code`, `access_token`… en la query o el hash. Sentry guarda la URL de la
// request, la transacción y los breadcrumbs de navegación/fetch: sin esto,
// cualquiera con acceso al proyecto de Sentry podía abrir el portal de un
// paciente copiando la URL de un error.

const TOKEN = "[token]";

/** Segmento que sigue a /portal/, /portal-laboratorio/ o /firmar/ (firma a distancia). */
const PORTAL_PATH_PATTERN = /(\/(?:portal(?:-laboratorio)?|firmar)\/)[^/?#\s"'<>]+/g;

/** Cualquier JWT (tres segmentos base64url, el primero arranca en `eyJ`). */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

const PARAMS_SENSIBLES = ["token", "token_hash", "code", "access_token", "refresh_token"];
const PARAM_PATTERN = new RegExp(
  `((?:^|[?&#;])(?:${PARAMS_SENSIBLES.join("|")})=)[^&#;\\s"'<>]*`,
  "gi",
);

export function scrubTokensInString(texto: string): string {
  return texto
    .replace(PORTAL_PATH_PATTERN, `$1${TOKEN}`)
    .replace(JWT_PATTERN, TOKEN)
    .replace(PARAM_PATTERN, `$1${TOKEN}`);
}

// Fuera de la query, `code` es casi siempre un código de error (Postgres,
// HTTP) y conviene conservarlo: por clave solo se tapan los nombres que no
// pueden ser otra cosa que una credencial.
const CLAVES_SENSIBLES = PARAMS_SENSIBLES.filter((p) => p !== "code");

function scrubValor(valor: unknown, claves = CLAVES_SENSIBLES, profundidad = 0): unknown {
  if (typeof valor === "string") return scrubTokensInString(valor);
  if (profundidad > 4 || valor === null || typeof valor !== "object") return valor;
  if (Array.isArray(valor)) {
    // query_string de Sentry puede venir como pares [["token", "…"], …].
    if (
      valor.length === 2 &&
      typeof valor[0] === "string" &&
      claves.includes(valor[0].toLowerCase())
    ) {
      return [valor[0], TOKEN];
    }
    return valor.map((v) => scrubValor(v, claves, profundidad + 1));
  }
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    salida[k] = claves.includes(k.toLowerCase()) ? TOKEN : scrubValor(v, claves, profundidad + 1);
  }
  return salida;
}

type BreadcrumbConUrl = { message?: string; data?: Record<string, unknown> };

export function scrubBreadcrumb<B extends BreadcrumbConUrl>(breadcrumb: B): B {
  if (breadcrumb.message) breadcrumb.message = scrubTokensInString(breadcrumb.message);
  if (breadcrumb.data) breadcrumb.data = scrubValor(breadcrumb.data) as Record<string, unknown>;
  return breadcrumb;
}

type EventoConUrls = EventoConMensaje & {
  transaction?: string;
  request?: { url?: string; query_string?: unknown; headers?: Record<string, string> };
  breadcrumbs?: BreadcrumbConUrl[];
  tags?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

/** Quita tokens de todos los lugares donde Sentry guarda URLs. */
export function scrubTokensInEvent(event: EventoConUrls): void {
  if (event.message) event.message = scrubTokensInString(event.message);
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = scrubTokensInString(value.value);
  }
  if (event.transaction) event.transaction = scrubTokensInString(event.transaction);
  if (event.request) {
    if (event.request.url) event.request.url = scrubTokensInString(event.request.url);
    if (event.request.query_string !== undefined) {
      event.request.query_string = scrubValor(event.request.query_string, PARAMS_SENSIBLES);
    }
    if (event.request.headers) {
      event.request.headers = scrubValor(event.request.headers) as Record<string, string>;
    }
  }
  for (const b of event.breadcrumbs ?? []) scrubBreadcrumb(b);
  if (event.tags) event.tags = scrubValor(event.tags) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValor(event.contexts) as Record<string, unknown>;
  if (event.extra) event.extra = scrubValor(event.extra) as Record<string, unknown>;
}
