import type * as SentryReact from "@sentry/react";

import { redactPostgresLiterals, scrubBreadcrumb, scrubTokensInEvent } from "@/lib/sentry-redact";

/**
 * Init de Sentry seguro y lazy. Si no hay DSN configurado (ni en Vite env
 * ni en process.env), `@sentry/react` ni se descarga — el import es dinámico
 * y solo se dispara la primera vez que hace falta de verdad.
 *
 * Antes de este cambio (corregido 01-sep-2026, ver auditoría externa —
 * hallazgo "JS inicial ~1MB del chunk raíz") el import era estático a nivel
 * de módulo: aunque `initSentry()` era un no-op sin DSN, el bundler igual
 * empaquetaba el SDK entero en el chunk que carga hasta un visitante anónimo
 * de la landing pública. Con import dinámico, sin DSN el chunk de Sentry ni
 * se genera en el grafo de carga real del navegador.
 *
 * Configurar SENTRY_DSN en Vercel Env Vars antes del launch productivo.
 * En dev local: opcional (más ruido que valor).
 */

let sentryPromise: Promise<typeof SentryReact> | null = null;
let inited = false;

function loadSentry(): Promise<typeof SentryReact> {
  sentryPromise ??= import("@sentry/react");
  return sentryPromise;
}

function readDsn(): string | undefined {
  // Vite inyecta VITE_* en el bundle del cliente.
  const viteDsn =
    typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_SENTRY_DSN;
  if (viteDsn) return viteDsn;
  // En el servidor (Node) leer del process.env.
  if (typeof process !== "undefined" && process.env?.SENTRY_DSN) return process.env.SENTRY_DSN;
  return undefined;
}

function readEnv(): string {
  if (typeof process !== "undefined" && process.env?.SENTRY_ENVIRONMENT) {
    return process.env.SENTRY_ENVIRONMENT;
  }
  // En el navegador no hay process.env: sin esto todo llegaba a Sentry como
  // "development". El build de Vite sabe si es producción.
  const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
  return env?.PROD ? "production" : "development";
}

function readSampleRate(): number {
  const raw = typeof process !== "undefined" ? process.env?.SENTRY_TRACES_SAMPLE_RATE : undefined;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 0.1;
}

export async function initSentry(): Promise<void> {
  if (inited) return;
  // En el SSR este módulo también se evalúa: el servidor reporta con
  // `sentry.server.ts` (@sentry/node), no con el SDK del navegador.
  if (typeof window === "undefined") return;
  const dsn = readDsn();
  if (!dsn) return;

  const Sentry = await loadSentry();
  if (inited) return; // otra llamada concurrente ya lo hizo mientras esperábamos el import

  Sentry.init({
    dsn,
    environment: readEnv(),
    // Versión desplegada (commit de Vercel): permite saber desde qué deploy viene un error.
    release: (import.meta as unknown as { env?: { VITE_RELEASE?: string } }).env?.VITE_RELEASE,
    tracesSampleRate: readSampleRate(),
    // Sin session replay ni user feedback modal en v1 — se pueden agregar
    // después. Cuidar la cuota gratuita (5k events/mes).
    integrations: [Sentry.browserTracingIntegration()],
    // Redactar PII antes de enviar. Datos clínicos NO deben salir a Sentry.
    //
    // ⚠️ CHECKLIST OBLIGATORIO antes de setear VITE_SENTRY_DSN en producción
    // (hoy no está seteado, así que este hook no tiene efecto todavía — esto
    // es preparación, ver docs/DEPLOY_PRODUCTION.md):
    //
    //   1. ✅ CORRIDO el 07-sep-2026 contra el esquema real (unique, FK, NOT
    //      NULL y CHECK violations con PII sintética). Resultado: el redactado
    //      no se dispara nunca, porque `err.message` de node-postgres NO trae
    //      los valores — solo "duplicate key value violates unique constraint
    //      \"x\"". Los literales viven en `err.detail` (`error.details` en
    //      supabase-js), que este hook no lee y que hoy NO llega a Sentry: la
    //      única integración activa es browserTracing, sin
    //      extraErrorDataIntegration, y nadie mete `.details` en un mensaje.
    //      O sea: no hay fuga hoy, y este hook es un no-op en la práctica.
    //      Dos huecos si eso cambia (agregar esa integración, o incluir
    //      `details` en un mensaje):
    //        a) el hook tendría que mirar también ese campo;
    //        b) POSTGRES_KEY_VALUE_PATTERN solo matchea `(col)=(val)`. Las
    //           violaciones de NOT NULL y CHECK — las más probables sobre
    //           `patients` — emiten "Failing row contains (v1, v2, ...)", que
    //           el regex NO matchea y que trae la FILA ENTERA. Verificado:
    //           filtraba nombre, teléfono y email.
    //   2. ✅ Ya cubierto: `redactPostgresLiterals` recorre
    //      `event.exception.values[].value` además de `event.message`.
    //   3. ⏳ Al 07-sep el único `extra` que se adjunta es
    //      `{ clinicId, leadId }` en api.whatsapp-webhook.ts:381 — UUIDs, sin
    //      PII. Revisar de nuevo cuando se adjunte cualquier otro dato custom.
    beforeSend(event) {
      if (event.request?.cookies) delete event.request.cookies;
      if (event.user) event.user = { id: event.user.id }; // solo id, no email/nombre
      redactPostgresLiterals(event);
      // Tokens de los portales y de Auth en URLs, transacción y breadcrumbs.
      scrubTokensInEvent(event);
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
  });

  inited = true;
}

export async function captureException(
  ...args: Parameters<typeof SentryReact.captureException>
): Promise<ReturnType<typeof SentryReact.captureException> | undefined> {
  if (!readDsn()) return undefined;
  const Sentry = await loadSentry();
  return Sentry.captureException(...args);
}

export async function captureMessage(
  ...args: Parameters<typeof SentryReact.captureMessage>
): Promise<ReturnType<typeof SentryReact.captureMessage> | undefined> {
  if (!readDsn()) return undefined;
  const Sentry = await loadSentry();
  return Sentry.captureMessage(...args);
}

export async function withScope(...args: Parameters<typeof SentryReact.withScope>): Promise<void> {
  if (!readDsn()) return;
  const Sentry = await loadSentry();
  Sentry.withScope(...args);
}

export async function setUser(...args: Parameters<typeof SentryReact.setUser>): Promise<void> {
  if (!readDsn()) return;
  const Sentry = await loadSentry();
  Sentry.setUser(...args);
}
