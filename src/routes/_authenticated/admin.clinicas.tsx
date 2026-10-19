// src/routes/_authenticated/admin.clinicas.tsx
//
// Pantalla para que Walter marque "llamada hecha" después de la puesta en
// marcha con una clínica — desbloquea WhatsApp automático, portal del
// paciente y /efectividad (ver `requiereLlamadaOSuscripcion` en billing.ts).
//
// Mismo criterio que `admin.leads.tsx`: NO vive bajo `_authenticated/_clinic/`
// (el gate real es la allowlist `ESMALIA_STAFF_EMAILS`, no un rol de clínica —
// `listClinicsForStaff`/`marcarLlamadaHecha` lo resuelven del lado del
// servidor vía `requireEsmaliaStaffEmail`), y por eso tampoco usa `AppShell` ni
// `sin-acceso.tsx` (ambos piden un `ClinicAccess` con rol de clínica que esta
// ruta no tiene en su contexto).

import { useEffect, useState } from "react";
import { createFileRoute, Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarCheck, Phone, PhoneCall } from "lucide-react";

import { EsmaliaLogo } from "@/components/esmalia-logo";
import { marcarEquipoInterno } from "@/lib/marketing/eventos";
import { MENSAJE_STAFF_REQUIERE_MFA } from "@/lib/auth/mfa";
import {
  activadaEn72h,
  listClinicsForStaff,
  marcarLlamadaHecha,
  type ClinicaStaffRow,
} from "@/lib/admin/clinicas.functions";
import {
  SUBSCRIPTION_STATUS_LABELS,
  trialDaysLeft,
  type Subscription,
  type SubscriptionStatus,
} from "@/lib/billing";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/admin/clinicas")({
  loader: () => listClinicsForStaff({}),
  head: () => ({
    meta: [
      { title: "Clínicas | Esmalia" },
      {
        name: "description",
        content: "Estado de suscripción y llamada de puesta en marcha por clínica.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: AccesoRestringido,
  component: AdminClinicasPage,
});

/** Mismo criterio que `admin.leads.tsx`: `listClinicsForStaff` siempre tira
 *  con `Error("...")` con texto ya seguro para mostrar tal cual. */
function AccesoRestringido({ error: errorDesconocido }: ErrorComponentProps) {
  const error =
    errorDesconocido instanceof Error ? errorDesconocido : new Error(String(errorDesconocido));
  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-6 text-foreground">
      <div className="card-clinical max-w-md p-8 text-center">
        <EsmaliaLogo variant="icon" size={40} className="mx-auto mb-4 block" />
        <h1 className="mb-2 font-display text-xl font-semibold">Acceso restringido</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {error?.message || "No pudimos mostrar esta sección."}
        </p>
        <Link
          to="/dashboard"
          className="inline-block rounded-lg border border-brand bg-transparent px-4 py-2 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12"
        >
          Volver al dashboard
        </Link>
        {/* SEG-01: acá NO se ofrece activar el factor (revisión del PR #65):
            con una contraseña robada de staff, eso alcanzaba para inscribir
            un TOTP propio y subir a aal2. Se activa desde /preferencias, con
            un inicio de sesión reciente. */}
        {error.message === MENSAJE_STAFF_REQUIERE_MFA && (
          <p className="mt-4 text-xs text-muted-foreground">
            Actívala desde{" "}
            <Link to="/preferencias" className="font-medium text-brand-700 hover:underline">
              Preferencias
            </Link>{" "}
            justo después de iniciar sesión.
          </p>
        )}
      </div>
    </div>
  );
}

/** Igual criterio que `admin.leads.tsx::formatFechaHora`: `Intl`/`toLocaleString`
 *  directo, sin luxon. */
function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ESTADO_TONO: Record<SubscriptionStatus, string> = {
  incomplete: "bg-secondary text-muted-foreground",
  incomplete_expired: "bg-destructive/10 text-destructive",
  trialing: "bg-info-soft text-info",
  active: "bg-success-soft text-success",
  past_due: "bg-warning-soft text-warning",
  canceled: "bg-destructive/10 text-destructive",
  unpaid: "bg-destructive/10 text-destructive",
  paused: "bg-secondary text-muted-foreground",
};

/** `listClinicsForStaff` solo trae `status`/`trialEnd` (no la fila completa de
 *  `subscriptions` — no hace falta stripeCustomerId acá). `trialDaysLeft` de
 *  billing.ts pide un `Subscription` completo; se arma uno mínimo para
 *  reusar esa única fuente de verdad en vez de reimplementar el cálculo de
 *  días acá. */
function comoSubscription(row: ClinicaStaffRow): Subscription | null {
  if (!row.subscriptionStatus) return null;
  const estado = (Object.keys(SUBSCRIPTION_STATUS_LABELS) as SubscriptionStatus[]).includes(
    row.subscriptionStatus as SubscriptionStatus,
  )
    ? (row.subscriptionStatus as SubscriptionStatus)
    : "incomplete";
  return {
    clinicId: row.id,
    status: estado,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    trialEnd: row.trialEnd,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
}

/** Métrica de activación del benchmark de onboarding (25-sep): sin cita
 *  todavía no es una cruz roja (puede activarse mañana), solo "sin dato" —
 *  ver `activadaEn72h` en clinicas.functions.ts para el porqué del `null`. */
function Activacion({ row }: { row: ClinicaStaffRow }) {
  if (!row.firstAppointmentAt) {
    return <span className="text-xs text-muted-foreground">Sin cita todavía</span>;
  }
  const activada = activadaEn72h(row.createdAt, row.firstAppointmentAt);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
          activada ? "bg-success-soft text-success" : "bg-secondary text-muted-foreground"
        }`}
      >
        <CalendarCheck className="size-3" />
        {activada ? "Activada en <72h" : "Activada, pero después de 72h"}
      </span>
      <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatFechaHora(row.firstAppointmentAt)}
      </span>
    </div>
  );
}

function EstadoSuscripcion({ row }: { row: ClinicaStaffRow }) {
  const sub = comoSubscription(row);
  if (!sub) {
    return <span className="text-xs text-muted-foreground">Sin suscripción</span>;
  }
  const dias = trialDaysLeft(sub);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${ESTADO_TONO[sub.status]}`}
      >
        {SUBSCRIPTION_STATUS_LABELS[sub.status]}
      </span>
      {dias !== null && (
        <span className="text-xs text-muted-foreground">
          {dias === 0 ? "vence hoy" : `${dias} ${dias === 1 ? "día" : "días"} de prueba`}
        </span>
      )}
    </div>
  );
}

function AdminClinicasPage() {
  const clinicas = Route.useLoaderData();
  // El loader ya pasó el gate de staff: las visitas de este equipo a las
  // páginas públicas se marcan `interno` (docs/MEDICION.md).
  useEffect(() => {
    marcarEquipoInterno();
  }, []);
  const router = useRouter();
  const marcarFn = useServerFn(marcarLlamadaHecha);
  // Cuál fila está en vuelo — sin esto, disparar la mutation en una fila
  // muestra "Marcando..." en TODAS (una sola mutation compartida entre filas).
  const [clinicIdEnVuelo, setClinicIdEnVuelo] = useState<string | null>(null);

  const marcar = useMutation({
    mutationFn: (clinicId: string) => marcarFn({ data: { clinicId } }),
    onMutate: (clinicId: string) => setClinicIdEnVuelo(clinicId),
    onSuccess: async () => {
      // `clinicas` viene del loader de la ruta, no de React Query — mismo
      // motivo por el que el saldo del paciente usa router.invalidate() y no
      // invalidateQueries (ver pacientes.$pacienteId.tsx).
      await router.invalidate();
      toast.success("Llamada marcada como hecha");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
    onSettled: () => setClinicIdEnVuelo(null),
  });

  return (
    <div className="min-h-dvh bg-surface px-4 py-10 sm:py-12">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <EsmaliaLogo variant="icon" size={36} />
            <div>
              <h1 className="font-display text-xl font-semibold sm:text-2xl">Clínicas</h1>
              <p className="text-sm text-muted-foreground">
                Suscripción y llamada de puesta en marcha — {clinicas.length}{" "}
                {clinicas.length === 1 ? "clínica" : "clínicas"}.
              </p>
            </div>
          </div>
          <Link
            to="/dashboard"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Volver al dashboard
          </Link>
        </header>

        {clinicas.length === 0 ? (
          <div className="card-clinical p-8 text-center">
            <p className="mb-1 font-display text-lg font-semibold">Todavía no hay clínicas</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              En cuanto se dé de alta la primera clínica, va a aparecer aquí.
            </p>
          </div>
        ) : (
          <section className="card-clinical overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Clínica</th>
                    <th className="px-3 py-2 text-left font-medium">Alta</th>
                    <th className="px-3 py-2 text-left font-medium">Suscripción</th>
                    <th className="px-3 py-2 text-left font-medium">Activación</th>
                    <th className="px-3 py-2 text-left font-medium">Llamada de puesta en marcha</th>
                    <th className="px-3 py-2 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {clinicas.map((row) => (
                    <tr key={row.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2 font-medium">{row.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                        {formatFechaHora(row.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <EstadoSuscripcion row={row} />
                      </td>
                      <td className="px-3 py-2">
                        <Activacion row={row} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {row.onboardingCallAt ? (
                          <span className="inline-flex items-center gap-1.5">
                            <PhoneCall className="size-3.5 text-success" />
                            {formatFechaHora(row.onboardingCallAt)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {!row.onboardingCallAt && (
                          <button
                            type="button"
                            onClick={() => marcar.mutate(row.id)}
                            disabled={marcar.isPending && clinicIdEnVuelo === row.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Phone className="size-3.5" />
                            {marcar.isPending && clinicIdEnVuelo === row.id
                              ? "Marcando…"
                              : "Marcar llamada hecha"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
