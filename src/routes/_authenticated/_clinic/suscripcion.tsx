import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import {
  createBillingPortalSession,
  createCheckoutSession,
  getMySubscription,
} from "@/lib/billing.functions";
import { SUBSCRIPTION_STATUS_LABELS, trialDaysLeft } from "@/lib/billing";
import { approxLocalPricesLabel } from "@/lib/pricing-display";
import { consumePlanIntent } from "@/lib/marketing/plan-intent";
import {
  registrarCheckoutIniciado,
  registrarSuscripcionActivada,
} from "@/lib/marketing/eventos-cuenta";
import { mensajeDeError } from "@/lib/mensaje-error";
import { requirePermission } from "@/lib/access/route-guards";

export const Route = createFileRoute("/_authenticated/_clinic/suscripcion")({
  head: () => ({
    meta: [{ title: "Suscripción | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  // Par de UI de `requireClinicPermission(..., "settings:manage")` en
  // billing.functions.ts: solo owner/admin gestionan la suscripción.
  beforeLoad: requirePermission("settings:manage"),
  component: BillingPage,
});

type PlanKey = "solo" | "clinica";

const PLANS: Record<
  PlanKey,
  {
    label: string;
    blurb: string;
    /** Precio de lista mensual en centavos de USD (el de Stripe). */
    priceCents: number;
    priceEnvId: string | undefined;
  }
> = {
  solo: {
    label: "Solo",
    blurb: "1 profesional / 1 sillón",
    priceCents: 2900,
    priceEnvId: import.meta.env.VITE_STRIPE_PRICE_ID_SOLO_MONTHLY,
  },
  clinica: {
    label: "Clínica",
    blurb: "Hasta 3 profesionales / sillones",
    priceCents: 6900,
    priceEnvId: import.meta.env.VITE_STRIPE_PRICE_ID_CLINIC_MONTHLY,
  },
};

function usd(cents: number) {
  return `US$${(cents / 100).toFixed(0)}`;
}

function planFromPriceId(priceId: string | null): PlanKey | null {
  if (!priceId) return null;
  if (priceId === PLANS.solo.priceEnvId) return "solo";
  if (priceId === PLANS.clinica.priceEnvId) return "clinica";
  return null;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function BillingPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic!.id;

  const cargar = useServerFn(getMySubscription);
  const checkout = useServerFn(createCheckoutSession);
  const portal = useServerFn(createBillingPortalSession);

  const {
    data: sub,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => cargar({ data: { clinicId } }),
  });

  const startCheckout = useMutation({
    // Acepta un plan explícito para el disparo automático desde "Comprar
    // Esmalia X" del landing (ver efecto de plan-intent más abajo) — ahí no
    // podemos depender de que `setPlan` ya haya re-renderizado antes de
    // llamar a `.mutate()`. El botón manual de abajo sigue llamando
    // `.mutate()` sin argumento, que cae al `plan` seleccionado en pantalla.
    mutationFn: async (planOverride?: PlanKey) => {
      // Las URLs de retorno las arma el servidor (PUBLIC_APP_URL).
      const planElegido = planOverride ?? plan;
      const { url } = await checkout({
        data: { clinicId, plan: planElegido },
      });
      // Embudo (docs/MEDICION.md). Espera como mucho 0,8 s y nunca falla.
      await registrarCheckoutIniciado(planElegido);
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const openPortal = useMutation({
    mutationFn: async () => {
      const { url } = await portal({ data: { clinicId } });
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const [plan, setPlan] = useState<PlanKey>("clinica");
  const daysLeft = trialDaysLeft(sub ?? null);
  // Deliberadamente NO usa `isSubscriptionActive` (billing.ts): esa función
  // trata un trial vigente como "activo" porque para el resto de la app
  // (gate de features) un trial sin vencer da acceso igual que una
  // suscripción pagada. Acá la pregunta es otra — "¿ya está cobrando
  // Stripe?" — y con ese criterio invertido, una clínica recién creada
  // (trial fresco, sin stripeCustomerId) nunca mostraba ningún botón de
  // pago: rompía en el último paso el flujo de "Comprar Esmalia X" del
  // landing (ver plan-intent.ts), que depende de este mismo botón para
  // saltar el trial. `yaFacturando` solo es `true` con una suscripción
  // realmente pagada — un trial, vencido o no, deja ver el botón.
  const yaFacturando = sub?.status === "active";
  const hasCustomer = Boolean(sub?.stripeCustomerId);
  // Auditoría 360 (BIL-03): con una suscripción viva en Stripe (past_due,
  // trialing con Stripe, unpaid, paused…) no se ofrece otro checkout — se
  // crearía una segunda suscripción que cobra en paralelo. Lo que sirve es el
  // portal: actualizar la tarjeta o cambiar de plan. El servidor aplica la
  // misma regla preguntándole a Stripe, esto es solo la cara visible.
  const suscripcionViva =
    Boolean(sub?.stripeSubscriptionId) &&
    sub?.status !== "canceled" &&
    sub?.status !== "incomplete_expired";
  const ofrecerCheckout = !yaFacturando && !suscripcionViva;
  const activePlan = planFromPriceId(sub?.stripePriceId ?? null);
  const activePlanInfo = activePlan ? PLANS[activePlan] : null;

  // "Comprar Esmalia X" del landing termina acá: auth → onboarding → esta
  // pantalla, con el plan elegido esperando en sessionStorage (ver
  // `plan-intent.ts`). Una vez que sabemos si ya está pagando (`isLoading`
  // ya resolvió), lo consumimos UNA sola vez — `consumePlanIntent` lo borra
  // al leerlo— para preseleccionar el plan y disparar el mismo botón de
  // checkout que ya existía, sin que el usuario tenga que volver a elegir
  // nada. Si la clínica ya tiene una suscripción pagada no dispara nada: no
  // tiene sentido re-cobrar a alguien que ya pagó (un trial vigente SÍ
  // dispara — es justo a quien está apuntado este atajo).
  const intentoDisparado = useRef(false);
  useEffect(() => {
    // Con error no sabemos si ya paga: no se consume la intención ni se abre
    // el checkout (podía cobrarle de nuevo a una clínica activa). Al
    // reintentar con éxito, el efecto vuelve a correr.
    if (intentoDisparado.current || isLoading || isError) return;
    intentoDisparado.current = true;
    const planComprado = consumePlanIntent();
    if (!planComprado || !ofrecerCheckout) return;
    setPlan(planComprado);
    startCheckout.mutate(planComprado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isError, ofrecerCheckout]);

  // Vuelta de Stripe (`success_url` = /suscripcion?checkout=success). El
  // servidor sólo lo cuenta si la suscripción que escribe el webhook ya
  // existe; después se limpia el parámetro para no contarlo de nuevo al
  // recargar. TODO(medicion): el evento autoritativo es el webhook de Stripe
  // (otro PR está cambiando billing; ver docs/MEDICION.md).
  const retornoRegistrado = useRef(false);
  useEffect(() => {
    if (retornoRegistrado.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    retornoRegistrado.current = true;
    void registrarSuscripcionActivada(clinicId);
    params.delete("checkout");
    const resto = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + (resto ? `?${resto}` : "") + window.location.hash,
    );
  }, [clinicId]);

  return (
    <AppShell title="Suscripción" access={access}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <CreditCard className="mt-0.5 size-5 text-primary" />
            <div className="flex-1">
              <h2 className="font-display text-base font-semibold">Plan actual</h2>
              <p className="text-sm text-muted-foreground">
                Esmalia {activePlanInfo?.label ?? "Clínica"} —{" "}
                <span className="font-medium">
                  {usd(activePlanInfo?.priceCents ?? PLANS.clinica.priceCents)} / mes
                </span>{" "}
                · prueba gratis de 14 días.
              </p>
              <p className="mt-1 text-xs text-muted-foreground/80">
                {approxLocalPricesLabel(
                  (activePlanInfo?.priceCents ?? PLANS.clinica.priceCents) / 100,
                )}{" "}
                <span className="italic">(referencial, el cobro es en USD)</span>
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </div>
          ) : isError ? (
            // Un error no es "no tienes suscripción": invitar a empezar la
            // prueba a quien ya paga es peor que no decir nada.
            <ErrorDeCarga
              onReintentar={refetch}
              mensaje="No pudimos cargar el estado de tu suscripción."
              className="mt-6"
            />
          ) : sub ? (
            <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Estado</dt>
                <dd className="mt-1 text-sm font-medium">
                  {SUBSCRIPTION_STATUS_LABELS[sub.status]}
                </dd>
              </div>
              {sub.status === "trialing" && daysLeft !== null && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Días de prueba restantes
                  </dt>
                  <dd className="mt-1 text-sm font-medium">
                    {daysLeft} {daysLeft === 1 ? "día" : "días"}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Próxima renovación
                </dt>
                <dd className="mt-1 text-sm">{formatDate(sub.currentPeriodEnd)}</dd>
              </div>
              {sub.cancelAtPeriodEnd && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Aviso</dt>
                  <dd className="mt-1 text-sm text-warning">
                    Cancelada — vence el {formatDate(sub.currentPeriodEnd)}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">
              Aún no tienes una suscripción activa. Empieza tu prueba gratis de 14 días abajo — no
              cobramos hasta que termine.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-semibold">Acciones</h2>
          <p className="text-sm text-muted-foreground">
            {hasCustomer
              ? "Gestiona método de pago, descarga facturas o cancela desde el portal seguro de Stripe."
              : "Al activar la suscripción vas a Stripe para dejar el método de pago. Puedes cancelar durante la prueba y no te cobramos."}
          </p>

          {ofrecerCheckout && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(Object.entries(PLANS) as [PlanKey, (typeof PLANS)[PlanKey]][]).map(
                ([key, info]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPlan(key)}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      plan === key
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Esmalia {info.label}</span>
                      {plan === key && <Check className="size-4 text-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground">{info.blurb}</p>
                    <p className="mt-2 text-lg font-semibold">
                      {usd(info.priceCents)}
                      <span className="text-xs font-normal text-muted-foreground"> /mes</span>
                    </p>
                  </button>
                ),
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {ofrecerCheckout ? (
              <button
                type="button"
                onClick={() => startCheckout.mutate(undefined)}
                disabled={startCheckout.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-brand bg-transparent px-4 py-2 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12 disabled:opacity-60"
              >
                {startCheckout.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Redirigiendo…
                  </>
                ) : hasCustomer ? (
                  `Reactivar suscripción · Esmalia ${PLANS[plan].label}`
                ) : (
                  `Activar suscripción · ${usd(PLANS[plan].priceCents)}/mes`
                )}
              </button>
            ) : null}

            {hasCustomer && (
              <button
                type="button"
                onClick={() => openPortal.mutate()}
                disabled={openPortal.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              >
                {openPortal.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ExternalLink className="size-4" />
                )}
                {suscripcionViva && !yaFacturando
                  ? "Actualizar medio de pago"
                  : "Gestionar facturación"}
              </button>
            )}
          </div>
        </section>

        <p className="text-xs text-muted-foreground">
          Los pagos los procesa Stripe. Esmalia nunca ve el número de tarjeta.
        </p>
      </div>
    </AppShell>
  );
}
