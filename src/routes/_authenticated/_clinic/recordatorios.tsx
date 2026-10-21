import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Cake,
  Clock,
  MessageCircleMore,
  Receipt,
  Sparkles,
  Star,
  Stethoscope,
  Users,
  Wallet,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { EmailButton } from "@/components/email-button";
import { requirePermission } from "@/lib/access/route-guards";
import {
  listPendingOutreach,
  listPendingReminders,
  listPresupuestosSinRespuesta,
  type PendingOutreachItem,
  type PendingReminder,
} from "@/lib/messaging/messaging.functions";
import {
  DIAS_SIN_RESPUESTA_POR_DEFECTO,
  OPCIONES_DE_DIAS_SIN_RESPUESTA,
  type PresupuestoSinRespuesta,
} from "@/lib/messaging/presupuestos-sin-respuesta";
import type { OutreachTemplateKind } from "@/lib/messaging/messaging";
import { formatMoney } from "@/lib/finance/finance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_clinic/recordatorios")({
  beforeLoad: requirePermission("agenda:manage"),
  head: () => ({
    meta: [
      { title: "Recordatorios | Esmalia" },
      {
        name: "description",
        content:
          "Cola de recordatorios de 48h, avisos de 3h y presupuestos sin respuesta, listos para mandar por WhatsApp o email con un click.",
      },
      { property: "og:title", content: "Recordatorios | Esmalia" },
      {
        property: "og:description",
        content: "Citas que necesitan recordatorio de 48h o aviso de 3h, sin buscarlas a mano.",
      },
    ],
  }),
  component: RecordatoriosPage,
});

const CLAVE_DIAS_PRESUPUESTO = "esmalia:recordatorios:dias-presupuesto";

function leerDiasPresupuesto(): number {
  try {
    const guardado = Number(localStorage.getItem(CLAVE_DIAS_PRESUPUESTO));
    if ((OPCIONES_DE_DIAS_SIN_RESPUESTA as readonly number[]).includes(guardado)) return guardado;
  } catch {
    // Almacenamiento bloqueado: el valor por defecto.
  }
  return DIAS_SIN_RESPUESTA_POR_DEFECTO;
}

function filaClass(kind: PendingReminder["reminderKind"]) {
  return kind === "appointment_checkin"
    ? "bg-warning-soft text-warning"
    : "bg-brand-soft text-brand-700";
}

const OUTREACH_META: Record<
  OutreachTemplateKind,
  { label: string; icon: typeof Sparkles; badgeClass: string }
> = {
  hygiene_recall: {
    label: "Recall de higiene",
    icon: Sparkles,
    badgeClass: "bg-brand-soft text-brand-700",
  },
  review_request: {
    label: "Pedido de reseña",
    icon: Star,
    badgeClass: "bg-warning-soft text-warning",
  },
  payment_due: {
    label: "Saldo pendiente",
    icon: Wallet,
    badgeClass: "bg-destructive/10 text-destructive",
  },
  quote_follow_up: {
    label: "Seguimiento de presupuesto",
    icon: Receipt,
    badgeClass: "bg-info-soft text-info",
  },
  birthday_greeting: {
    label: "Cumpleaños",
    icon: Cake,
    badgeClass: "bg-warning-soft text-warning",
  },
  treatment_followup: {
    label: "Seguimiento post-tratamiento",
    icon: Stethoscope,
    badgeClass: "bg-brand-soft text-brand-700",
  },
  referral_invite: {
    label: "Invitación a referir",
    icon: Users,
    badgeClass: "bg-success-soft text-success",
  },
  nps_survey: {
    label: "Encuesta de satisfacción",
    icon: Star,
    badgeClass: "bg-brand-soft text-brand-700",
  },
};

function RecordatoriosPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const clinicaNombre = access.clinic?.name ?? "";
  const queryClient = useQueryClient();

  const fetchReminders = useServerFn(listPendingReminders);
  const {
    data: recordatorios = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["pending-reminders", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchReminders({ data: { clinicId: clinicId! } }),
    // Las ventanas de 48h/3h se mueven con el reloj — refrescar cada minuto
    // para que una cita no quede "vieja" en pantalla si nadie navega.
    refetchInterval: 60_000,
  });

  const fetchOutreach = useServerFn(listPendingOutreach);
  const {
    data: outreach = [],
    isLoading: isLoadingOutreach,
    isError: outreachConError,
    refetch: reintentarOutreach,
  } = useQuery({
    queryKey: ["pending-outreach", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchOutreach({ data: { clinicId: clinicId! } }),
  });

  // Se lee después de montar: en SSR no hay localStorage y el primer render
  // tiene que coincidir con el del servidor.
  const [diasPresupuesto, setDiasPresupuesto] = useState<number>(DIAS_SIN_RESPUESTA_POR_DEFECTO);
  useEffect(() => setDiasPresupuesto(leerDiasPresupuesto()), []);
  const cambiarDiasPresupuesto = (dias: number) => {
    setDiasPresupuesto(dias);
    try {
      localStorage.setItem(CLAVE_DIAS_PRESUPUESTO, String(dias));
    } catch {
      // Sin almacenamiento (modo privado): el valor dura lo que la pestaña.
    }
  };
  const fetchPresupuestos = useServerFn(listPresupuestosSinRespuesta);
  const {
    data: presupuestos = [],
    isLoading: isLoadingPresupuestos,
    isError: presupuestosConError,
    refetch: reintentarPresupuestos,
  } = useQuery({
    queryKey: ["presupuestos-sin-respuesta", clinicId, diasPresupuesto],
    enabled: Boolean(clinicId),
    queryFn: () => fetchPresupuestos({ data: { clinicId: clinicId!, dias: diasPresupuesto } }),
  });

  const { aviso3h, recordatorio48h } = useMemo(() => {
    const aviso3h = recordatorios.filter((r) => r.reminderKind === "appointment_checkin");
    const recordatorio48h = recordatorios.filter((r) => r.reminderKind === "appointment_reminder");
    return { aviso3h, recordatorio48h };
  }, [recordatorios]);

  const outreachByKind = useMemo(() => {
    const groups: Record<OutreachTemplateKind, PendingOutreachItem[]> = {
      hygiene_recall: [],
      review_request: [],
      payment_due: [],
      quote_follow_up: [],
      birthday_greeting: [],
      treatment_followup: [],
      referral_invite: [],
      nps_survey: [],
    };
    for (const item of outreach) groups[item.kind].push(item);
    return groups;
  }, [outreach]);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["pending-reminders", clinicId] });
  };
  const invalidarOutreach = () => {
    queryClient.invalidateQueries({ queryKey: ["pending-outreach", clinicId] });
  };
  const invalidarPresupuestos = () => {
    queryClient.invalidateQueries({ queryKey: ["presupuestos-sin-respuesta", clinicId] });
  };

  // Un error no es "nada pendiente": antes la lista vacía decía que no había
  // a quién escribirle cuando en realidad no se pudo consultar.
  const nadaPendiente =
    !isLoading &&
    !isLoadingOutreach &&
    !isLoadingPresupuestos &&
    !isError &&
    !outreachConError &&
    !presupuestosConError &&
    recordatorios.length === 0 &&
    outreach.length === 0 &&
    presupuestos.length === 0;

  return (
    <AppShell title="Recordatorios" access={access}>
      <div className="space-y-6">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Citas que están entrando a la ventana de 48h (recordatorio) o 3h (aviso previo),
          presupuestos que siguen sin respuesta y pacientes candidatos a un recall, un pedido de
          reseña o un aviso de saldo. Se manda por WhatsApp o email con un click — tú revisas antes
          de que salga nada.
        </p>

        {(isLoading || isLoadingOutreach) && (
          <p className="px-1 py-10 text-center text-sm text-muted-foreground">Cargando…</p>
        )}

        {isError && (
          <ErrorDeCarga
            onReintentar={refetch}
            mensaje="No pudimos cargar los recordatorios de citas."
          />
        )}

        {outreachConError && (
          <ErrorDeCarga
            onReintentar={reintentarOutreach}
            mensaje="No pudimos cargar los pacientes candidatos a recall, reseña o saldo."
          />
        )}

        {presupuestosConError && (
          <ErrorDeCarga
            onReintentar={reintentarPresupuestos}
            mensaje="No pudimos cargar los presupuestos sin respuesta."
          />
        )}

        {nadaPendiente && (
          <div className="card-clinical p-10 text-center">
            <MessageCircleMore className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No hay nada pendiente ahora mismo.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Esta lista se arma sola a medida que las citas entran a la ventana de 48h/3h, o
              aparecen pacientes candidatos a recall, reseña o saldo.
            </p>
          </div>
        )}

        {!isLoading && aviso3h.length > 0 && (
          <section className="space-y-3">
            <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold">
              <Clock className="size-4 text-warning" /> Aviso de 3h
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
                {aviso3h.length}
              </span>
            </h2>
            <ReminderList
              items={aviso3h}
              clinicId={clinicId!}
              clinica={clinicaNombre}
              onSent={invalidar}
            />
          </section>
        )}

        {!isLoading && recordatorio48h.length > 0 && (
          <section className="space-y-3">
            <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold">
              <Clock className="size-4 text-brand" /> Recordatorio de 48h
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-700">
                {recordatorio48h.length}
              </span>
            </h2>
            <ReminderList
              items={recordatorio48h}
              clinicId={clinicId!}
              clinica={clinicaNombre}
              onSent={invalidar}
            />
          </section>
        )}

        {!isLoadingPresupuestos && !presupuestosConError && clinicId && (
          <PresupuestosSinRespuesta
            items={presupuestos}
            dias={diasPresupuesto}
            onCambiarDias={cambiarDiasPresupuesto}
            clinicId={clinicId}
            clinica={clinicaNombre}
            onSent={invalidarPresupuestos}
          />
        )}

        {!isLoadingOutreach &&
          (Object.keys(OUTREACH_META) as OutreachTemplateKind[]).map((kind) => {
            const items = outreachByKind[kind];
            if (items.length === 0) return null;
            const meta = OUTREACH_META[kind];
            const Icon = meta.icon;
            return (
              <section key={kind} className="space-y-3">
                <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold">
                  <Icon className="size-4" />
                  {meta.label}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      meta.badgeClass,
                    )}
                  >
                    {items.length}
                  </span>
                </h2>
                <OutreachList
                  items={items}
                  clinicId={clinicId!}
                  clinica={clinicaNombre}
                  onSent={invalidarOutreach}
                />
              </section>
            );
          })}
      </div>
    </AppShell>
  );
}

function ReminderList({
  items,
  clinicId,
  clinica,
  onSent,
}: {
  items: PendingReminder[];
  clinicId: string;
  clinica: string;
  onSent: () => void;
}) {
  return (
    <div className="card-clinical divide-y divide-hairline overflow-hidden">
      {items.map((r) => (
        <div
          key={r.appointmentId}
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{r.patientName}</p>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                  filaClass(r.reminderKind),
                )}
              >
                {r.reminderKind === "appointment_checkin" ? "3h" : "48h"}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {r.treatmentLabel} · {r.professionalName} · {r.fechaLarga} {r.hora}
            </p>
            {!r.patientPhone && !r.patientEmail && (
              <p className="mt-1 text-xs text-destructive">
                Sin teléfono ni email cargados — no se puede enviar.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!r.whatsappSent && r.patientPhone && (
              <WhatsAppButton
                clinicId={clinicId}
                patientId={r.patientId}
                appointmentId={r.appointmentId}
                templateKind={r.reminderKind}
                variant="full"
                label="WhatsApp"
                variables={{
                  tratamiento: r.treatmentLabel,
                  fecha_larga: r.fechaLarga,
                  hora: r.hora,
                  profesional: r.professionalName,
                  clinica,
                }}
                onSent={onSent}
              />
            )}
            {!r.emailSent && r.patientEmail && (
              <EmailButton
                clinicId={clinicId}
                patientId={r.patientId}
                appointmentId={r.appointmentId}
                templateKind={r.reminderKind}
                variant="full"
                label="Email"
                variables={{
                  tratamiento: r.treatmentLabel,
                  fecha_larga: r.fechaLarga,
                  hora: r.hora,
                  profesional: r.professionalName,
                  clinica,
                }}
                onSent={onSent}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Detalle de cada item según el kind — solo cambia la línea secundaria. */
function outreachDetail(item: PendingOutreachItem): string {
  switch (item.kind) {
    case "hygiene_recall":
      return `${item.monthsSinceLastVisit ?? "6+"} meses sin visitarnos`;
    case "review_request":
      return item.treatmentLabel ? `Visita: ${item.treatmentLabel}` : "Visita reciente";
    case "payment_due":
      return item.balanceCents != null
        ? `Saldo: ${formatMoney(item.balanceCents, item.currency ?? "CLP")}`
        : "";
    case "quote_follow_up":
      return item.quoteTotalCents != null
        ? `Presupuesto ${item.quoteNumber ?? ""} · ${formatMoney(item.quoteTotalCents, item.currency ?? "CLP")}`
        : `Presupuesto ${item.quoteNumber ?? ""}`;
    case "birthday_greeting":
      return "Cumple hoy 🎂";
    case "treatment_followup":
      return item.treatmentLabel ? `Tratamiento: ${item.treatmentLabel}` : "Tratamiento reciente";
    case "referral_invite":
      return item.referralCode ? `Código: ${item.referralCode}` : "";
    case "nps_survey":
      return item.treatmentLabel ? `Tratamiento: ${item.treatmentLabel}` : "Tratamiento reciente";
  }
}

/** Variables que necesita cada plantilla — todas comparten {paciente}/{clinica}, agregadas por WhatsAppButton/sendWhatsAppFromTemplate. */
function outreachVariables(item: PendingOutreachItem): Record<string, string> {
  switch (item.kind) {
    case "hygiene_recall":
      return { meses: String(item.monthsSinceLastVisit ?? 6) };
    case "review_request":
      // El motor de templates (renderTemplate) hace reemplazo simple de
      // {variable}, sin condicionales — por eso el "si hay link" se resuelve
      // acá: {link_resena} lleva la frase completa cuando la sucursal tiene
      // google_review_url cargado, o queda vacío (el placeholder desaparece
      // sin dejar undefined ni un hueco feo) cuando no lo tiene.
      return {
        link_resena: item.googleReviewUrl ? ` Directo aquí: ${item.googleReviewUrl}` : "",
      };
    case "payment_due":
      return {
        saldo:
          item.balanceCents != null ? formatMoney(item.balanceCents, item.currency ?? "CLP") : "",
      };
    case "quote_follow_up":
      return {
        numero_presupuesto: item.quoteNumber ?? "",
        total:
          item.quoteTotalCents != null
            ? formatMoney(item.quoteTotalCents, item.currency ?? "CLP")
            : "",
      };
    case "birthday_greeting":
      return {};
    case "treatment_followup":
      return {};
    case "referral_invite":
      return { codigo: item.referralCode ?? "" };
    case "nps_survey":
      return { tratamiento: item.treatmentLabel ?? "tu tratamiento" };
  }
}

function OutreachList({
  items,
  clinicId,
  clinica,
  onSent,
}: {
  items: PendingOutreachItem[];
  clinicId: string;
  clinica: string;
  onSent: () => void;
}) {
  return (
    <div className="card-clinical divide-y divide-hairline overflow-hidden">
      {items.map((item) => (
        <div
          key={`${item.kind}-${item.patientId}-${item.appointmentId ?? item.quoteId ?? ""}`}
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.patientName}</p>
            <p className="truncate text-xs text-muted-foreground">{outreachDetail(item)}</p>
            {!item.patientPhone && (
              <p className="mt-1 text-xs text-destructive">
                Sin teléfono cargado — no se puede enviar.
              </p>
            )}
          </div>
          <WhatsAppButton
            clinicId={clinicId}
            patientId={item.patientId}
            appointmentId={item.appointmentId}
            quoteId={item.quoteId}
            templateKind={item.kind}
            variant="full"
            label="Enviar"
            variables={{ ...outreachVariables(item), clinica }}
            onSent={onSent}
          />
        </div>
      ))}
    </div>
  );
}

function hace(dias: number): string {
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

function PresupuestosSinRespuesta({
  items,
  dias,
  onCambiarDias,
  clinicId,
  clinica,
  onSent,
}: {
  items: PresupuestoSinRespuesta[];
  dias: number;
  onCambiarDias: (dias: number) => void;
  clinicId: string;
  clinica: string;
  onSent: () => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold">
          <Receipt className="size-4 text-info" /> Presupuestos sin respuesta
          <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-semibold text-info">
            {items.length}
          </span>
        </h2>
        <div
          role="group"
          aria-label="Días sin respuesta"
          className="inline-flex items-center gap-0.5 rounded-lg border border-hairline p-0.5"
        >
          <span className="px-2 text-xs text-muted-foreground">Sin respuesta hace</span>
          {OPCIONES_DE_DIAS_SIN_RESPUESTA.map((opcion) => (
            <button
              key={opcion}
              type="button"
              aria-pressed={opcion === dias}
              onClick={() => onCambiarDias(opcion)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                opcion === dias
                  ? "bg-brand-soft text-brand-700"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opcion}+ días
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="card-clinical px-5 py-4 text-sm text-muted-foreground">
          Ningún presupuesto lleva {dias} días o más sin aceptarse.
        </p>
      ) : (
        <div className="card-clinical divide-y divide-hairline overflow-hidden">
          {items.map((item) => {
            const variables = {
              numero_presupuesto: item.quoteNumber,
              total: formatMoney(item.quoteTotalCents, item.currency),
              clinica,
            };
            const sinCanal = !item.puedeWhatsApp && !item.puedeEmail;
            return (
              <div
                key={item.quoteId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{item.patientName}</p>
                    {item.estado === "draft" && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Borrador
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    Presupuesto {item.quoteNumber} ·{" "}
                    <span className="cifra">
                      {formatMoney(item.quoteTotalCents, item.currency)}
                    </span>{" "}
                    · {item.estado === "draft" ? "creado" : "enviado"} {hace(item.diasSinRespuesta)}
                  </p>
                  {item.estado === "draft" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No figura como enviado: confirma que el paciente lo recibió antes de
                      escribirle.
                    </p>
                  )}
                  {sinCanal ? (
                    <p className="mt-1 text-xs text-destructive">
                      {item.motivoSinWhatsApp} Sin email cargado — no se puede enviar.
                    </p>
                  ) : (
                    !item.puedeWhatsApp && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        WhatsApp no disponible: {item.motivoSinWhatsApp}
                      </p>
                    )
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.puedeWhatsApp && (
                    <WhatsAppButton
                      clinicId={clinicId}
                      patientId={item.patientId}
                      quoteId={item.quoteId}
                      templateKind="quote_follow_up"
                      variant="full"
                      label="WhatsApp"
                      variables={variables}
                      onSent={onSent}
                    />
                  )}
                  {item.puedeEmail && (
                    <EmailButton
                      clinicId={clinicId}
                      patientId={item.patientId}
                      quoteId={item.quoteId}
                      templateKind="quote_follow_up"
                      variant="full"
                      label="Email"
                      variables={variables}
                      onSent={onSent}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
