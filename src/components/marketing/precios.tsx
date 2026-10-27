// src/components/marketing/precios.tsx
//
// Planes y precios, compartidos por la sección #precios de la landing y la
// página /precios. Un solo lugar para los montos y lo que incluye cada plan,
// así la landing y la página no pueden contar dos historias distintas.
//
// Veracidad (ver el comentario al inicio de src/routes/index.tsx):
// - Los montos son los de los dos tiers de Stripe (src/lib/stripe.server.ts):
//   Solo US$19,99 y Clínica US$49,99, ambos con 14 días de trial sin tarjeta
//   (`payment_method_collection: "if_required"`, billing.functions.ts).
// - El precio en moneda local es decorativo (`precioEnMoneda`,
//   pricing-display.ts): el cobro real siempre es en USD.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button";
import { enlaceWhatsAppVentas } from "@/lib/marketing/contacto";
import { registrarEvento } from "@/lib/marketing/eventos";
import { etiquetaUsd, PRECIO_CLINICA_CENTS, PRECIO_SOLO_CENTS } from "@/lib/marketing/precio-lista";
import { detectarPaisVisitante, monedaPorPais } from "@/lib/marketing/pais-visitante";
import { setPlanIntent, type PlanIntent } from "@/lib/marketing/plan-intent";
import { MONEDAS_PRECIO, precioEnMoneda, type MonedaPrecio } from "@/lib/pricing-display";
import { cn } from "@/lib/utils";
import {
  PRECIO_FUNDADOR_EXPLICACION,
  PRECIO_FUNDADOR_TITULO,
} from "@/lib/marketing/precio-fundador";

type Plan = {
  id: "solo" | "clinica" | "red";
  alcance: string;
  nombre: string;
  usd: number | null;
  incluye: readonly string[];
  recomendado?: boolean;
};

const PLANES: readonly Plan[] = [
  {
    id: "solo",
    alcance: "1 profesional",
    nombre: "Solo",
    usd: PRECIO_SOLO_CENTS / 100,
    incluye: [
      "Agenda y ficha clínica",
      "Recordatorios por WhatsApp",
      "Caja y presupuestos",
      "Importación de pacientes por planilla",
      "15 GB para radiografías, fotos y escaneos",
      "Soporte directo con el equipo que lo construye",
    ],
  },
  {
    id: "clinica",
    alcance: "Hasta 3 profesionales",
    nombre: "Clínica",
    usd: PRECIO_CLINICA_CENTS / 100,
    recomendado: true,
    incluye: [
      "Todo lo de Solo",
      "Comisiones y roles",
      "Portal de pacientes",
      "45 GB para radiografías, fotos y escaneos",
    ],
  },
  {
    id: "red",
    alcance: "Varias sedes",
    nombre: "Red",
    usd: null,
    incluye: [
      "Todo lo de Clínica",
      "Multisede e inventario",
      "Reportes por sede",
      "Migración acompañada",
    ],
  },
];

/**
 * Selector de moneda + tarjetas de planes con su CTA. `encabezado` deja usar
 * el mismo bloque como sección de la landing (h2) o como cabecera de /precios
 * (h1); `lugar` separa los clics de una y otra en la analítica.
 */
export function PreciosPlanes({
  encabezado = "h2",
  lugar = "precios",
}: {
  encabezado?: "h1" | "h2";
  lugar?: string;
}) {
  const [moneda, setMoneda] = useState<MonedaPrecio>("USD");
  const whatsapp = enlaceWhatsAppVentas();
  const Titulo = encabezado;

  // La moneda por defecto sigue al país probable del visitante (zona
  // horaria), la misma regla que la calculadora. En cliente, para no romper
  // la hidratación con un valor distinto del SSR.
  useEffect(() => {
    setMoneda(monedaPorPais(detectarPaisVisitante()));
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Titulo className="font-display text-4xl font-normal leading-tight sm:text-5xl">
            {PRECIO_FUNDADOR_TITULO}
          </Titulo>
          <p className="mt-3 max-w-xl text-muted-foreground">
            14 días gratis y sin tarjeta. {PRECIO_FUNDADOR_EXPLICACION}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Moneda"
          className="flex rounded-md border border-border p-0.5"
        >
          {MONEDAS_PRECIO.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={moneda === m}
              onClick={() => setMoneda(m)}
              className={cn(
                "min-h-9 rounded-sm px-3 text-sm tabular-nums transition-colors",
                moneda === m
                  ? "bg-brand-100 text-brand-800"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {PLANES.map((p) => (
          <article
            key={p.id}
            className={cn(
              "flex flex-col rounded-lg border p-7",
              p.recomendado ? "border-brand" : "border-border",
            )}
          >
            <p className="kicker">
              {p.alcance}
              {p.recomendado && " · Recomendado"}
            </p>
            <h3 className="mt-2 font-display text-3xl font-semibold">{p.nombre}</h3>
            {p.usd === null ? (
              <>
                <p className="mt-4 font-display text-4xl font-normal">A medida</p>
                <p className="mt-1 text-sm text-muted-foreground">Desde 4 profesionales</p>
              </>
            ) : (
              <>
                <p className="mt-4 font-display text-4xl font-normal tabular-nums">
                  {precioEnMoneda(p.usd, moneda)}
                  <span className="ml-1 font-body text-base text-muted-foreground">/mes</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  ${etiquetaUsd(Math.round(p.usd * 100))} al mes
                  {moneda !== "USD" && " · referencial, el cobro es en USD"}
                </p>
              </>
            )}
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {p.incluye.map((i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="text-brand-700">
                    —
                  </span>
                  {i}
                </li>
              ))}
            </ul>
            {p.id === "red" ? (
              <a
                href={whatsapp.href}
                onClick={() => registrarEvento("cta_click", { cta: "red", lugar })}
                className={cn(buttonVariants({ variant: "outline" }), "mt-8 w-full")}
              >
                {whatsapp.esWhatsApp ? "Cotizar por WhatsApp" : "Escríbenos"}
              </a>
            ) : (
              <ComprarPlanLink plan={p.id} recomendado={p.recomendado} />
            )}
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * CTA de compra directa por tarjeta de precio. Esmalia es trial-first (no hay
 * checkout público sin cuenta — `createCheckoutSession` necesita un
 * `clinicId` real), así que "comprar" acá significa: guardar qué plan eligió
 * ANTES de mandarlo a crear la cuenta, para que auth → onboarding →
 * suscripción lo lleven derecho al checkout de Stripe sin que tenga que
 * volver a elegir el plan ni encontrar el botón de pago por su cuenta (ver
 * `src/lib/marketing/plan-intent.ts`).
 */
function ComprarPlanLink({ plan, recomendado }: { plan: PlanIntent; recomendado?: boolean }) {
  return (
    <Link
      to="/auth"
      search={{ signup: true }}
      onClick={() => setPlanIntent(plan)}
      className={cn(
        buttonVariants({ variant: recomendado ? "default" : "outline" }),
        "mt-8 w-full",
      )}
    >
      Empezar con {plan === "solo" ? "Solo" : "Clínica"}
    </Link>
  );
}
