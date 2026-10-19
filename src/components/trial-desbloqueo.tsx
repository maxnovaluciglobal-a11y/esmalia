import { Link } from "@tanstack/react-router";
import { CheckCircle2, Lock, Sparkles } from "lucide-react";

/**
 * Pantalla de desbloqueo de informes (fin del trial de 14 días).
 *
 * Reemplaza el contenido de una de las 7 rutas de informes cuando
 * `trialInformesBloqueados(sub)` es `true` — nunca redirige. La grilla de
 * dos columnas es a propósito: nunca esconder qué hay del otro lado. Y no
 * ofrece ninguna vía que no funcione de punta a punta (a diferencia del
 * botón "agendar una llamada" de DypOS, que no desbloquea nada porque nadie
 * escribe `onboarding_call_at`) — acá solo hay dos salidas, y las dos
 * funcionan: pagar, o seguir operando sin pagar.
 */

const ABIERTO_SIEMPRE = [
  "Agenda",
  "Pacientes",
  "Ficha clínica",
  "Tratamientos",
  "Aranceles",
  // TODO(export): cuando exista "Exportar todo" en Ajustes, volver a "Exportar datos".
  "Tus datos, a pedido en 72 horas",
];

const SE_ACTIVA_AL_SUSCRIBIRTE = [
  "Finanzas",
  "Gastos",
  "Medios de pago",
  "Comisiones",
  "Panel de desempeño",
  "Inventario",
  "Laboratorios",
  "Convenios",
];

export function TrialDesbloqueo({ pantalla }: { pantalla: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Lock className="size-5" />
      </div>

      <div>
        <h1 className="font-display text-xl font-semibold">{pantalla} se activa al suscribirte</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Tu prueba gratis de 14 días terminó. Puedes seguir atendiendo con total normalidad — lo
          que se activa al suscribirte es el análisis: caja, gastos, medios de pago, comisiones,
          panel de desempeño, inventario, laboratorios y convenios.
        </p>
      </div>

      <div className="grid w-full gap-4 text-left sm:grid-cols-2">
        <section className="card-clinical p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-success">
            <CheckCircle2 className="size-3.5" /> Abierto siempre
          </h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {ABIERTO_SIEMPRE.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="card-clinical p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Lock className="size-3.5" /> Se activa al suscribirte
          </h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {SE_ACTIVA_AL_SUSCRIBIRTE.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Link
          to="/suscripcion"
          className="inline-flex items-center gap-2 rounded-lg border border-brand bg-transparent px-5 py-2.5 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12"
        >
          <Sparkles className="size-4" /> Activar suscripción
        </Link>
        <Link
          to="/agenda"
          search={{
            q: "",
            fecha: "",
            vista: "dia",
            sucursal: "",
            profesional: "",
            estado: "",
            page: 1,
          }}
          className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          Seguir usando Esmalia
        </Link>
      </div>
    </div>
  );
}
