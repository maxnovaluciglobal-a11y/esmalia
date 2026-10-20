import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Mail, MailX, Star } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { VerificacionDosPasosCard } from "@/components/verificacion-dos-pasos";
import { ErrorDeCarga } from "@/components/estado-error";
import { toast } from "sonner";
import {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
} from "@/lib/messaging/notification-preferences.functions";
import {
  DEFAULT_PREFERENCES,
  EMAIL_EVENTS,
  type EmailEventKey,
  type NotificationPreferences,
} from "@/lib/messaging/notification-preferences";
import {
  listBranchesForReviewLinks,
  updateBranchGoogleReviewUrl,
} from "@/lib/clinic-operations/clinic-catalog.functions";
import { hasPermission } from "@/lib/access/access";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/_clinic/preferencias")({
  head: () => ({
    meta: [
      { title: "Preferencias de aviso | Esmalia" },
      {
        name: "description",
        content:
          "Elige qué avisos por email quieres recibir de Esmalia y desuscríbete cuando lo necesites.",
      },
      { property: "og:title", content: "Preferencias de aviso | Esmalia" },
      {
        property: "og:description",
        content: "Control por tipo de evento de los emails y avisos de Esmalia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PreferenciasPage,
});

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border border-border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        checked ? "bg-primary" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4.5 rounded-full bg-background shadow transition-all",
          checked ? "left-[1.4rem]" : "left-0.5",
        )}
      />
    </button>
  );
}

/** Fila editable de una sucursal: link de reseña de Google. Campo opcional
 * (columna nullable) — muchas sucursales todavía no lo van a tener cargado,
 * y eso es un estado válido, no un error. */
function BranchReviewLinkRow({
  branch,
  clinicId,
  onSaved,
}: {
  branch: { id: string; name: string; googleReviewUrl: string | null };
  clinicId: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(branch.googleReviewUrl ?? "");
  const guardarLink = useServerFn(updateBranchGoogleReviewUrl);

  const mutation = useMutation({
    mutationFn: () =>
      guardarLink({ data: { clinicId, branchId: branch.id, googleReviewUrl: value.trim() } }),
    onSuccess: () => {
      toast.success(`Link de reseña de ${branch.name} guardado`);
      onSaved();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const dirty = value.trim() !== (branch.googleReviewUrl ?? "");

  return (
    <li className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 sm:w-40 sm:shrink-0">
        <p className="text-sm font-medium">{branch.name}</p>
        {!branch.googleReviewUrl && (
          <p className="text-xs text-muted-foreground">Sin link cargado</p>
        )}
      </div>
      <div className="flex flex-1 gap-2">
        <input
          type="url"
          inputMode="url"
          placeholder="https://g.page/r/…/review"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={mutation.isPending}
          className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        />
        <button
          type="button"
          disabled={mutation.isPending || !dirty}
          onClick={() => mutation.mutate()}
          className="shrink-0 rounded-lg border border-brand bg-transparent px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand/12 disabled:opacity-50"
        >
          Guardar
        </button>
      </div>
    </li>
  );
}

function BranchReviewLinksSection({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient();
  const cargarBranches = useServerFn(listBranchesForReviewLinks);

  const {
    data: branches = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["branches-review-links", clinicId],
    queryFn: () => cargarBranches({ data: { clinicId } }),
  });

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: ["branches-review-links", clinicId] });

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex gap-3 border-b border-border p-5">
        <Star className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-display text-base font-semibold">Link de reseña de Google</h2>
          <p className="text-sm text-muted-foreground">
            Se usa en el mensaje de pedido de reseña por WhatsApp para que el paciente pueda dejarla
            con un solo click. Sin link cargado, el mensaje sigue funcionando — solo pide buscar la
            clínica en Google.
          </p>
        </div>
      </header>
      {isLoading ? (
        <p className="p-5 text-sm text-muted-foreground">Cargando sucursales…</p>
      ) : isError ? (
        <div className="p-5">
          <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar las sucursales." />
        </div>
      ) : branches.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No hay sucursales activas.</p>
      ) : (
        <ul className="divide-y divide-border">
          {branches.map((b) => (
            <BranchReviewLinkRow key={b.id} branch={b} clinicId={clinicId} onSaved={invalidar} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PreferenciasPage() {
  const { access } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const cargar = useServerFn(getMyNotificationPreferences);
  const guardar = useServerFn(updateMyNotificationPreferences);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => cargar({}),
  });

  const prefs: NotificationPreferences = data ?? DEFAULT_PREFERENCES;
  const desuscrito = Boolean(prefs.unsubscribedAt);

  const mutation = useMutation({
    mutationFn: (input: {
      emailEnabled?: boolean;
      inappEnabled?: boolean;
      unsubscribed?: boolean;
      events?: Record<string, boolean>;
    }) => guardar({ data: input }),

    onSuccess: (nuevo) => {
      queryClient.setQueryData(["notification-preferences"], nuevo);
      toast.success("Preferencias guardadas");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  // Con error, los interruptores muestran los valores por defecto y no los
  // reales: se bloquean para no guardar encima algo que nadie eligió.
  const bloqueado = isLoading || isError || mutation.isPending;
  const emailsActivos = prefs.emailEnabled && !desuscrito;

  const puedeGestionarConfig = hasPermission(access.role, "settings:manage");

  return (
    <AppShell title="Preferencias de aviso" access={access}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* SEG-01: la seguridad de la cuenta es personal, como los avisos:
            cualquier rol la gestiona para sí mismo. */}
        <VerificacionDosPasosCard />

        {puedeGestionarConfig && access.clinic && (
          <BranchReviewLinksSection clinicId={access.clinic.id} />
        )}

        {isError && (
          <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar tus preferencias." />
        )}

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <Mail className="mt-0.5 size-5 text-primary" />
              <div>
                <h2 className="font-display text-base font-semibold">Avisos por email</h2>
                <p className="text-sm text-muted-foreground">
                  Recibe en tu correo los eventos del flujo de revisión clínica y el resumen semanal
                  de la clínica (si tu rol puede ver las finanzas).
                </p>
              </div>
            </div>
            <Switch
              label="Activar avisos por email"
              checked={emailsActivos}
              disabled={bloqueado || desuscrito}
              onChange={(v) => mutation.mutate({ emailEnabled: v })}
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <BellRing className="mt-0.5 size-5 text-primary" />
              <div>
                <h2 className="font-display text-base font-semibold">Avisos dentro de Esmalia</h2>
                <p className="text-sm text-muted-foreground">
                  Campana de notificaciones en tiempo real dentro de la aplicación.
                </p>
              </div>
            </div>
            <Switch
              label="Activar avisos en la aplicación"
              checked={prefs.inappEnabled}
              disabled={bloqueado}
              onChange={(v) => mutation.mutate({ inappEnabled: v })}
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border p-5">
            <h2 className="font-display text-base font-semibold">Emails por tipo de evento</h2>
            <p className="text-sm text-muted-foreground">
              Ajusta cada aviso por separado. Si desactivas los emails generales, ninguno se envía.
            </p>
          </header>
          <ul className="divide-y divide-border">
            {EMAIL_EVENTS.map((evento) => (
              <li key={evento.key} className="flex items-start justify-between gap-4 p-5">
                <div>
                  <p
                    className={cn("text-sm font-medium", !emailsActivos && "text-muted-foreground")}
                  >
                    {evento.label}
                  </p>
                  <p className="text-sm text-muted-foreground">{evento.description}</p>
                </div>
                <Switch
                  label={`Email de ${evento.label}`}
                  checked={prefs.events[evento.key as EmailEventKey]}
                  disabled={bloqueado || !emailsActivos}
                  onChange={(v) => mutation.mutate({ events: { [evento.key]: v } })}
                />
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex gap-3">
            <MailX className="mt-0.5 size-5 text-destructive" />
            <div className="flex-1">
              <h2 className="font-display text-base font-semibold">Desuscripción total</h2>
              <p className="text-sm text-muted-foreground">
                {desuscrito
                  ? "Estás desuscrito: Esmalia no te enviará emails de avisos ni el resumen semanal. Los avisos sobre la cuenta y los pagos siguen llegando, y los avisos clínicos seguirán visibles dentro de la aplicación."
                  : "Detiene todos los emails de avisos de Esmalia de una sola vez. Puedes revertirlo cuando quieras."}
              </p>
              <button
                type="button"
                disabled={bloqueado}
                // La baja desde el enlace del correo apaga también `email_enabled`:
                // volver a suscribirse los reactiva juntos, en un solo clic.
                onClick={() =>
                  mutation.mutate(
                    desuscrito
                      ? { unsubscribed: false, emailEnabled: true }
                      : { unsubscribed: true },
                  )
                }
                className={cn(
                  "mt-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50",
                  desuscrito
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "border border-destructive/40 text-destructive hover:bg-destructive/10",
                )}
              >
                {desuscrito ? "Volver a suscribirme" : "Desuscribirme de todos los emails"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
