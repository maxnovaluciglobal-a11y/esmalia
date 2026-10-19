import { Link } from "@tanstack/react-router";
import { Calendar, Lock, Sparkles } from "lucide-react";

import { enlacePuestaEnMarcha, MINUTOS_PUESTA_EN_MARCHA } from "@/lib/marketing/puesta-en-marcha";

/**
 * Gate de features avanzadas desde el día 1 del trial.
 *
 * A diferencia de `TrialDesbloqueo` (informes al día 15), este bloquea 3
 * features específicas — WhatsApp automático, portal del paciente, y
 * /efectividad — desde el alta. Dos salidas, las dos reales: agendar la
 * llamada de puesta en marcha (Calendly), o suscribirse ya. Sin tercera vía
 * gratis de auto-activación — Walter, 09-sep-2026: "forzar la llamada".
 *
 * Ver `requiereLlamadaOSuscripcion()` en billing.ts.
 */
export function LlamadaDesbloqueo({
  feature,
  descripcion,
  clinicName,
  clinicEmail,
  /** `"pagina"` (default): gate de página completa — WhatsApp, /efectividad.
   *  `"inline"`: tarjeta chica del tamaño de un botón, para cuando reemplaza
   *  un control puntual dentro de otra pantalla (ej. `PortalLinkButton`
   *  dentro de la ficha del paciente) — el mismo bloque centrado de página
   *  completa se veía roto encajado ahí. */
  variante = "pagina",
}: {
  /** Nombre corto de la feature, ej. "WhatsApp automático". */
  feature: string;
  /** Una frase explicando qué hace la feature y por qué vale la pena la llamada. */
  descripcion: string;
  /** Nombre de la clínica (para prefill del enlace). */
  clinicName?: string | null;
  /** Email del usuario (para prefill del enlace). */
  clinicEmail?: string | null;
  variante?: "pagina" | "inline";
}) {
  const calendlyUrl = enlacePuestaEnMarcha({ clinicName, clinicEmail }).href;

  if (variante === "inline") {
    return (
      <div className="space-y-2 rounded-lg border border-hairline bg-card p-3 text-left">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Lock className="size-3.5 shrink-0 text-muted-foreground" />
          {feature} se activa con tu puesta en marcha
        </p>
        <p className="text-xs text-muted-foreground">{descripcion}</p>
        <div className="flex flex-wrap gap-2 pt-0.5">
          <a
            href={calendlyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-transparent px-3 py-1.5 text-xs font-medium text-brand-700 transition-opacity hover:bg-brand/12"
          >
            <Calendar className="size-3.5" /> Agendar {MINUTOS_PUESTA_EN_MARCHA} min
          </a>
          <Link
            to="/suscripcion"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Sparkles className="size-3.5" /> Suscribirme
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Lock className="size-5" />
      </div>

      <div>
        <h1 className="font-display text-xl font-semibold">
          {feature} se activa con tu puesta en marcha
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{descripcion}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <a
          href={calendlyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-brand bg-transparent px-5 py-2.5 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12"
        >
          <Calendar className="size-4" /> Agendar {MINUTOS_PUESTA_EN_MARCHA} minutos
        </a>
        <Link
          to="/suscripcion"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          <Sparkles className="size-4" /> Suscribirme ahora
        </Link>
      </div>
    </div>
  );
}
