import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Clock, Sparkles } from "lucide-react";

import { getMySubscription } from "@/lib/billing.functions";
import { accesoPorSuscripcion, isSubscriptionActive, trialDaysLeft } from "@/lib/billing";

/**
 * Banner top-of-app con estado de suscripción.
 *
 * - Sin suscripción (clínica nueva) → aviso suave, sin bloquear: hoy el
 *   acceso es libre hasta que el owner active el plan por su cuenta.
 * - Trialing → días restantes + CTA a activar tarjeta.
 * - Cobro fallido dentro de la gracia (BIL-01) → aviso con los días que
 *   quedan; todo sigue funcionando.
 * - No está al día (gracia agotada, cancelada, impaga) → aviso persistente:
 *   ficha y agenda siguen abiertas, los informes se pausan.
 * - Active → no renderiza nada.
 *
 * Lo ve todo el equipo, no solo el owner: si el owner no entra, alguien de
 * la clínica se entera igual.
 */
export function TrialBanner({ clinicId }: { clinicId: string }) {
  const fn = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fn({ data: { clinicId } }),
    staleTime: 60 * 1000,
  });

  if (sub === undefined) return null;

  if (sub === null) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-2 text-sm sm:px-8">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-success" />
          <span>
            Tienes acceso completo. Activa tu plan cuando quieras — primeros 14 días sin cargo.
          </span>
        </div>
        <Link
          to="/suscripcion"
          className="rounded-md border border-brand bg-transparent px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand/12"
        >
          Ver plan · desde US$29/mes
        </Link>
      </div>
    );
  }

  const active = isSubscriptionActive(sub);
  const daysLeft = trialDaysLeft(sub);

  // Sub activa full → sin banner.
  if (active && sub.status === "active") return null;

  // Trialing → recordatorio suave.
  if (sub.status === "trialing" && daysLeft !== null) {
    const urgente = daysLeft <= 3;
    return (
      <div
        className={
          urgente
            ? "flex items-center justify-between gap-3 border-b border-brand/40 bg-brand-100 px-5 py-2 text-sm sm:px-8"
            : "flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-2 text-sm sm:px-8"
        }
      >
        <div className="flex items-center gap-2">
          <Clock className={urgente ? "size-4 text-brand-700" : "size-4 text-muted-foreground"} />
          <span>
            {daysLeft === 0
              ? "Tu prueba gratis vence hoy."
              : `Tu prueba gratis vence en ${daysLeft} día${daysLeft === 1 ? "" : "s"}.`}
          </span>
        </div>
        <Link
          to="/suscripcion"
          className="rounded-md border border-brand bg-transparent px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand/12"
        >
          Activar suscripción
        </Link>
      </div>
    );
  }

  const acceso = accesoPorSuscripcion(sub);

  if (acceso.nivel === "gracia") {
    const { diasRestantes } = acceso;
    return (
      <div className="flex items-center justify-between gap-3 border-b border-warning-border bg-warning-soft px-5 py-2 text-sm sm:px-8">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0 text-warning" />
          <span className="font-medium">
            {diasRestantes === null
              ? "No pudimos cobrar tu suscripción. Actualiza el medio de pago; mientras tanto todo sigue funcionando."
              : `No pudimos cobrar tu suscripción. Tienes ${diasRestantes} día${diasRestantes === 1 ? "" : "s"} para actualizar el medio de pago; mientras tanto todo sigue funcionando.`}
          </span>
        </div>
        <Link
          to="/suscripcion"
          className="shrink-0 rounded-md border border-warning-border px-3 py-1 text-xs font-medium text-warning hover:bg-warning-soft"
        >
          Actualizar medio de pago
        </Link>
      </div>
    );
  }

  // No está al día: nunca cierra la app, avisa qué sigue abierto.
  return (
    <div className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-5 py-2 text-sm sm:px-8">
      <div className="flex items-center gap-2">
        <AlertCircle className="size-4 shrink-0 text-destructive" />
        <span className="font-medium">
          {sub.status === "past_due"
            ? "Seguimos sin poder cobrar tu suscripción. Pacientes, agenda y ficha clínica siguen disponibles; los informes se pausan hasta regularizar el pago."
            : "Tu suscripción está inactiva. Pacientes, agenda y ficha clínica siguen disponibles; los informes se pausan hasta reactivarla."}
        </span>
      </div>
      <Link
        to="/suscripcion"
        className="shrink-0 rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
      >
        {sub.status === "past_due" ? "Regularizar el pago" : "Reactivar"}
      </Link>
    </div>
  );
}
