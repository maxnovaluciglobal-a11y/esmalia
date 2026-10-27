import type * as SentryNode from "@sentry/node";

import {
  redactPostgresLiterals,
  scrubBreadcrumb,
  scrubTokensInEvent,
  scrubTokensInString,
} from "@/lib/sentry-redact";

/**
 * Sentry del lado del servidor (SSR y server functions en Vercel).
 *
 * `sentry.ts` usa `@sentry/react`, pensado para el navegador (trae
 * browserTracing): en las funciones de Node los errores solo quedaban en
 * `console.error` (auditoría 07-oct-2026). Acá va `@sentry/node`, solo para
 * errores: sin integraciones por defecto ni OpenTelemetry, que en una
 * función serverless suman arranque en frío sin aportar nada.
 *
 * Mismo criterio que el del navegador: sin `SENTRY_DSN` es un no-op y el SDK
 * ni se importa. Cada captura hace `flush` porque la función puede
 * congelarse apenas devuelve la respuesta.
 */
let sentryPromise: Promise<typeof SentryNode> | null = null;

function cargar(): Promise<typeof SentryNode> | null {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  sentryPromise ??= import("@sentry/node").then((Sentry) => {
    Sentry.initWithoutDefaultIntegrations({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
      skipOpenTelemetrySetup: true,
      integrations: [
        Sentry.inboundFiltersIntegration(),
        Sentry.dedupeIntegration(),
        Sentry.linkedErrorsIntegration(),
      ],
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          delete event.request.cookies;
          delete event.request.headers;
          delete event.request.data;
        }
        if (event.user) event.user = { id: event.user.id };
        redactPostgresLiterals(event);
        scrubTokensInEvent(event);
        return event;
      },
      beforeBreadcrumb(breadcrumb) {
        return scrubBreadcrumb(breadcrumb);
      },
    });
    return Sentry;
  });
  return sentryPromise;
}

export async function capturarErrorDelServidor(
  error: unknown,
  contexto: { ruta?: string; metodo?: string } = {},
): Promise<void> {
  const pendiente = cargar();
  if (!pendiente) return;
  try {
    const Sentry = await pendiente;
    Sentry.withScope((scope) => {
      // La ruta de /portal/<jwt> trae el token: se etiqueta ya limpia.
      if (contexto.ruta) scope.setTag("ruta", scrubTokensInString(contexto.ruta));
      if (contexto.metodo) scope.setTag("metodo", contexto.metodo);
      Sentry.captureException(error);
    });
    await Sentry.flush(2000);
  } catch (e) {
    // Reportar nunca puede tirar abajo la respuesta de error.
    console.error("[sentry.server] no se pudo reportar", e);
  }
}
