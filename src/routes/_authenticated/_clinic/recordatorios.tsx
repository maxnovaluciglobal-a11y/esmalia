import { useEffect, useId, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Cake,
  ChevronDown,
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
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { fechaHoraPlanilla, montoPlanilla } from "@/lib/exportacion/listas-csv";
import { ErrorDeCarga } from "@/components/estado-error";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { EmailButton } from "@/components/email-button";
import { EnviarTodos, type PasoDeEnvio } from "@/components/recordatorios/enviar-todos";
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
import {
  agruparPorPaciente,
  agruparRecordatorios,
  unirConY,
  variablesDeRecordatorio,
  type EnvioDeRecordatorio,
  type FilaDePaciente,
  type GrupoPorPaciente,
} from "@/lib/messaging/recordatorios-agrupados";
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

const OUTREACH_META: Record<OutreachTemplateKind, { label: string; icon: typeof Sparkles }> = {
  hygiene_recall: {
    label: "Control periódico",
    icon: Sparkles,
  },
  review_request: {
    label: "Pedido de reseña",
    icon: Star,
  },
  payment_due: {
    label: "Saldo pendiente",
    icon: Wallet,
  },
  quote_follow_up: {
    label: "Seguimiento de presupuesto",
    icon: Receipt,
  },
  birthday_greeting: {
    label: "Cumpleaños",
    icon: Cake,
  },
  treatment_followup: {
    label: "Seguimiento post-tratamiento",
    icon: Stethoscope,
  },
  referral_invite: {
    label: "Invitación a referir",
    icon: Users,
  },
  nps_survey: {
    label: "Encuesta de satisfacción",
    icon: Star,
  },
};

const KINDS_DE_OUTREACH = Object.keys(OUTREACH_META) as OutreachTemplateKind[];

type Filtro = "todo" | "citas" | "presupuestos" | "seguimiento";
const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todo", label: "Todo" },
  { id: "citas", label: "Citas" },
  { id: "presupuestos", label: "Presupuestos" },
  { id: "seguimiento", label: "Controles y seguimiento" },
];

/** Orden de urgencia: la primera sección con algo pendiente arranca abierta. */
type IdSeccion = "aviso3h" | "recordatorio48h" | "presupuestos" | OutreachTemplateKind;
const ORDEN_DE_SECCIONES: IdSeccion[] = [
  "aviso3h",
  "recordatorio48h",
  "presupuestos",
  ...KINDS_DE_OUTREACH,
];

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

  // UX-11: una fila por paciente (y un recordatorio por paciente y día).
  const { aviso3h, recordatorio48h } = useMemo(
    () => agruparRecordatorios(recordatorios),
    [recordatorios],
  );
  const presupuestosPorPaciente = useMemo(() => agruparPorPaciente(presupuestos), [presupuestos]);
  const outreachByKind = useMemo(() => {
    const groups = Object.fromEntries(KINDS_DE_OUTREACH.map((k) => [k, []])) as unknown as Record<
      OutreachTemplateKind,
      PendingOutreachItem[]
    >;
    for (const item of outreach) groups[item.kind].push(item);
    return Object.fromEntries(
      KINDS_DE_OUTREACH.map((k) => [k, agruparPorPaciente(groups[k])]),
    ) as Record<OutreachTemplateKind, GrupoPorPaciente<PendingOutreachItem>[]>;
  }, [outreach]);

  // EXP-04: todo lo pendiente en una sola planilla, una fila por envío.
  const filasCsv = useMemo<FilaRecordatorioCsv[]>(
    () => [
      ...recordatorios.map((r) => ({
        tipo: r.reminderKind === "appointment_checkin" ? "Aviso de 3h" : "Recordatorio de 48h",
        paciente: r.patientName,
        telefono: r.patientPhone,
        correo: r.patientEmail,
        detalle: r.treatmentLabel,
        fecha: r.startsAt,
        profesional: r.professionalName,
        montoCents: null,
        moneda: null,
      })),
      ...presupuestos.map((q) => ({
        tipo: "Presupuesto sin respuesta",
        paciente: q.patientName,
        telefono: q.patientPhone,
        correo: q.patientEmail,
        detalle: `Presupuesto ${q.quoteNumber} · ${q.diasSinRespuesta} días sin respuesta`,
        fecha: q.desde,
        profesional: null,
        montoCents: q.quoteTotalCents,
        moneda: q.currency,
      })),
      ...outreach.map((o) => ({
        tipo: OUTREACH_META[o.kind].label,
        paciente: o.patientName,
        telefono: o.patientPhone,
        correo: null,
        detalle: detalleSinMonto(o),
        fecha: null,
        profesional: null,
        montoCents: o.balanceCents ?? o.quoteTotalCents ?? null,
        moneda: o.currency ?? null,
      })),
    ],
    [recordatorios, presupuestos, outreach],
  );
  const timezone = access.clinic?.timezone ?? "America/Santiago";

  const conteo: Record<IdSeccion, number> = {
    aviso3h: aviso3h.length,
    recordatorio48h: recordatorio48h.length,
    presupuestos: presupuestosPorPaciente.length,
    ...(Object.fromEntries(KINDS_DE_OUTREACH.map((k) => [k, outreachByKind[k].length])) as Record<
      OutreachTemplateKind,
      number
    >),
  };
  const masUrgente = ORDEN_DE_SECCIONES.find((id) => conteo[id] > 0) ?? null;
  const [abiertas, setAbiertas] = useState<Partial<Record<IdSeccion, boolean>>>({});
  const abierta = (id: IdSeccion) => abiertas[id] ?? id === masUrgente;
  const alternar = (id: IdSeccion) => setAbiertas((prev) => ({ ...prev, [id]: !abierta(id) }));

  const [filtro, setFiltro] = useState<Filtro>("todo");
  const totalSeguimiento = KINDS_DE_OUTREACH.reduce((n, k) => n + outreachByKind[k].length, 0);
  const conteoFiltro: Record<Filtro, number> = {
    todo:
      aviso3h.length + recordatorio48h.length + presupuestosPorPaciente.length + totalSeguimiento,
    citas: aviso3h.length + recordatorio48h.length,
    presupuestos: presupuestosPorPaciente.length,
    seguimiento: totalSeguimiento,
  };
  const ver = (grupo: Exclude<Filtro, "todo">) => filtro === "todo" || filtro === grupo;

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
      <div className="mx-auto max-w-[84rem] space-y-[18px]">
        {/* Pase A+ (27-oct-2026): encabezado editorial, chips por tipo y cada
            lista como panel con su "Enviar todos (n)". Nada sale solo: cada
            envío lo dispara alguien de la clínica, con vista previa. */}
        <header className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4 pb-1">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground">
              <b className="font-semibold text-foreground/85">Mensajes</b>
              {clinicaNombre && (
                <>
                  <span aria-hidden>·</span>
                  <span>{clinicaNombre}</span>
                </>
              )}
            </p>
            <h2 className="mt-2 font-display text-[clamp(2.25rem,3.6vw,3.5rem)] font-medium leading-none tracking-[-0.02em] text-balance">
              Recordatorios <em className="text-brand-600">por enviar</em>
            </h2>
            <p className="mt-3 max-w-[68ch] text-[15px] text-muted-foreground">
              Citas que entran a la ventana de 48 h (recordatorio) o de 3 h (aviso previo),
              presupuestos sin respuesta y pacientes para un control, una reseña o un aviso de
              saldo. Cada paciente aparece una vez por lista.{" "}
              <b className="font-semibold text-foreground">Nada sale solo:</b> mandas de a uno o con
              «Enviar todos», y revisas antes de que salga.
            </p>
          </div>
          {clinicId && (
            <ExportarCsvLista<FilaRecordatorioCsv>
              clinicId={clinicId}
              rol={access.role}
              lista="recordatorios"
              filas={filasCsv}
              timezone={timezone}
              filtros={{ dias_presupuesto: String(diasPresupuesto) }}
              columnas={[
                { header: "Tipo", value: (f) => f.tipo },
                { header: "Paciente", value: (f) => f.paciente },
                { header: "Teléfono", value: (f) => f.telefono },
                { header: "Correo", value: (f) => f.correo },
                { header: "Detalle", value: (f) => f.detalle },
                { header: "Fecha", value: (f) => fechaHoraPlanilla(f.fecha, timezone) },
                { header: "Profesional", value: (f) => f.profesional },
                {
                  header: "Monto",
                  value: (f) => montoPlanilla(f.montoCents, f.moneda),
                  dinero: true,
                },
                { header: "Moneda", value: (f) => f.moneda, dinero: true },
              ]}
            />
          )}
        </header>

        <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => {
            const activo = filtro === f.id;
            const n = conteoFiltro[f.id];
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={activo}
                onClick={() => setFiltro(f.id)}
                className={cn(
                  "inline-flex h-[34px] items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11",
                  activo
                    ? "border-foreground bg-foreground text-background"
                    : "border-control text-foreground/80 hover:border-foreground",
                )}
              >
                {f.label}
                <span
                  className={cn("cifra text-xs", activo ? "opacity-80" : "text-muted-foreground")}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

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
            mensaje="No pudimos cargar los pacientes candidatos a control periódico, reseña o saldo."
          />
        )}

        {presupuestosConError && (
          <ErrorDeCarga
            onReintentar={reintentarPresupuestos}
            mensaje="No pudimos cargar los presupuestos sin respuesta."
          />
        )}

        {!nadaPendiente && filtro !== "todo" && conteoFiltro[filtro] === 0 && (
          <p className="rounded-[14px] border border-hairline bg-card px-5 py-6 text-sm text-muted-foreground">
            Nada pendiente en esta lista.{" "}
            <button
              type="button"
              onClick={() => setFiltro("todo")}
              className="rounded-sm font-semibold text-brand-700 underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Ver todo
            </button>
          </p>
        )}

        {nadaPendiente && (
          <div className="rounded-[14px] border border-hairline bg-card p-10 text-center">
            <MessageCircleMore className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No hay nada pendiente ahora mismo.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Esta lista se arma sola a medida que las citas entran a la ventana de 48h/3h, o
              aparecen pacientes candidatos a control periódico, reseña o saldo.
            </p>
          </div>
        )}

        {clinicId && !isLoading && ver("citas") && aviso3h.length > 0 && (
          <Seccion
            icono={<Clock className="size-[18px]" aria-hidden />}
            titulo="Aviso de 3 h"
            conteo={aviso3h.length}
            abierta={abierta("aviso3h")}
            onAlternar={() => alternar("aviso3h")}
            acciones={
              <EnviarTodos
                clinicId={clinicId}
                titulo="Enviar todos los avisos de 3h"
                pasos={pasosDeRecordatorios(aviso3h, clinicaNombre)}
                onSent={invalidar}
              />
            }
          >
            <ReminderList
              filas={aviso3h}
              clinicId={clinicId}
              clinica={clinicaNombre}
              onSent={invalidar}
            />
          </Seccion>
        )}

        {clinicId && !isLoading && ver("citas") && recordatorio48h.length > 0 && (
          <Seccion
            icono={<Clock className="size-[18px]" aria-hidden />}
            titulo="Recordatorio de 48 h"
            conteo={recordatorio48h.length}
            abierta={abierta("recordatorio48h")}
            onAlternar={() => alternar("recordatorio48h")}
            acciones={
              <EnviarTodos
                clinicId={clinicId}
                titulo="Enviar todos los recordatorios de 48h"
                pasos={pasosDeRecordatorios(recordatorio48h, clinicaNombre)}
                onSent={invalidar}
              />
            }
          >
            <ReminderList
              filas={recordatorio48h}
              clinicId={clinicId}
              clinica={clinicaNombre}
              onSent={invalidar}
            />
          </Seccion>
        )}

        {!isLoadingPresupuestos && !presupuestosConError && clinicId && ver("presupuestos") && (
          <Seccion
            icono={<Receipt className="size-[18px]" aria-hidden />}
            titulo="Presupuestos sin respuesta"
            conteo={presupuestosPorPaciente.length}
            abierta={abierta("presupuestos")}
            onAlternar={() => alternar("presupuestos")}
            acciones={
              <>
                <SelectorDeDias dias={diasPresupuesto} onCambiar={cambiarDiasPresupuesto} />
                <EnviarTodos
                  clinicId={clinicId}
                  titulo="Seguimiento de todos los presupuestos"
                  pasos={pasosDePresupuestos(presupuestosPorPaciente, clinicaNombre)}
                  onSent={invalidarPresupuestos}
                />
              </>
            }
          >
            <PresupuestosSinRespuesta
              grupos={presupuestosPorPaciente}
              dias={diasPresupuesto}
              clinicId={clinicId}
              clinica={clinicaNombre}
              onSent={invalidarPresupuestos}
            />
          </Seccion>
        )}

        {clinicId &&
          !isLoadingOutreach &&
          ver("seguimiento") &&
          KINDS_DE_OUTREACH.map((kind) => {
            const grupos = outreachByKind[kind];
            if (grupos.length === 0) return null;
            const meta = OUTREACH_META[kind];
            const Icon = meta.icon;
            return (
              <Seccion
                key={kind}
                icono={<Icon className="size-[18px]" aria-hidden />}
                titulo={meta.label}
                conteo={grupos.length}
                abierta={abierta(kind)}
                onAlternar={() => alternar(kind)}
                acciones={
                  <EnviarTodos
                    clinicId={clinicId}
                    titulo={`${meta.label}: enviar a todos`}
                    pasos={pasosDeOutreach(grupos, clinicaNombre)}
                    onSent={invalidarOutreach}
                  />
                }
              >
                <OutreachList
                  grupos={grupos}
                  clinicId={clinicId}
                  clinica={clinicaNombre}
                  onSent={invalidarOutreach}
                />
              </Seccion>
            );
          })}
      </div>
    </AppShell>
  );
}

/**
 * Lista plegable con su cuenta a la vista, como panel A+ (el de la caja).
 * Plegada, la página entera entra en una pantalla; antes medía casi 5000px
 * con todo desplegado.
 */
function Seccion({
  icono,
  titulo,
  conteo,
  abierta,
  onAlternar,
  acciones,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  conteo: number;
  abierta: boolean;
  onAlternar: () => void;
  acciones?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="overflow-hidden rounded-[14px] border border-hairline bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
        <h2
          id={`${id}-titulo`}
          className="min-w-0 font-display text-[23px] font-medium leading-tight"
        >
          <button
            type="button"
            onClick={onAlternar}
            aria-expanded={abierta}
            aria-controls={`${id}-contenido`}
            className="flex min-h-11 items-center gap-2 rounded-md px-1 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                !abierta && "-rotate-90",
              )}
              aria-hidden
            />
            <span className="text-muted-foreground">{icono}</span>
            {titulo}
            <span className="cifra rounded-full border border-hairline px-2 py-px font-sans text-xs font-medium text-muted-foreground">
              {conteo}
            </span>
          </button>
        </h2>
        {acciones && (
          <div className="flex flex-wrap items-center gap-2 [&_button]:rounded-full">
            {acciones}
          </div>
        )}
      </div>
      {abierta && (
        <div id={`${id}-contenido`} className="border-t border-hairline">
          {children}
        </div>
      )}
    </section>
  );
}

function SelectorDeDias({ dias, onCambiar }: { dias: number; onCambiar: (d: number) => void }) {
  return (
    <div
      role="group"
      aria-label="Días sin respuesta"
      className="inline-flex items-center gap-0.5 rounded-full border border-hairline p-[3px]"
    >
      <span className="px-2 text-xs text-muted-foreground">Sin respuesta hace</span>
      {OPCIONES_DE_DIAS_SIN_RESPUESTA.map((opcion) => (
        <button
          key={opcion}
          type="button"
          aria-pressed={opcion === dias}
          onClick={() => onCambiar(opcion)}
          className={cn(
            "h-7 rounded-full px-2.5 text-xs font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring pointer-coarse:h-10",
            opcion === dias
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opcion}+ días
        </button>
      ))}
    </div>
  );
}

// ─── Recordatorios de cita ────────────────────────────────────────────────

function detalleDeEnvio(envio: EnvioDeRecordatorio<PendingReminder>): string {
  const citas = envio.citas
    .map((c) => `${c.hora} ${c.treatmentLabel} (${c.professionalName})`)
    .join(" · ");
  return `${envio.principal.fechaLarga} · ${citas}`;
}

function pasosDeRecordatorios(
  filas: FilaDePaciente<PendingReminder>[],
  clinica: string,
): PasoDeEnvio[] {
  return filas.flatMap((fila) =>
    fila.envios.map((envio) => {
      const base = {
        templateKind: envio.kind,
        variables: variablesDeRecordatorio(envio, clinica),
        appointmentId: envio.principal.appointmentId,
      };
      return {
        clave: envio.clave,
        patientId: fila.patientId,
        patientName: fila.patientName,
        detalle: detalleDeEnvio(envio),
        whatsapp: envio.whatsappPendiente ? base : null,
        email: envio.emailPendiente ? base : null,
      };
    }),
  );
}

function ReminderList({
  filas,
  clinicId,
  clinica,
  onSent,
}: {
  filas: FilaDePaciente<PendingReminder>[];
  clinicId: string;
  clinica: string;
  onSent: () => void;
}) {
  return (
    <ul className="divide-y divide-hairline">
      {filas.map((fila) => {
        const citas = fila.envios.reduce((n, e) => n + e.citas.length, 0);
        return (
          <li key={fila.patientId} className="space-y-2.5 px-5 py-4">
            <div className="flex items-baseline gap-2">
              <p className="truncate font-display text-[20px] font-medium leading-tight">
                {fila.patientName}
              </p>
              {citas > 1 && (
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  <span className="cifra">{citas}</span> citas
                </span>
              )}
            </div>
            {fila.envios.map((envio) => {
              const variables = variablesDeRecordatorio(envio, clinica);
              return (
                <div
                  key={envio.clave}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
                >
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    <ChipVentana kind={envio.kind} />
                    <span>{envio.principal.fechaLarga}</span>
                    {envio.citas.map((c) => (
                      <span key={c.appointmentId} className="min-w-0">
                        <span className="cifra text-foreground">{c.hora}</span> {c.treatmentLabel}{" "}
                        <span className="text-muted-foreground">· {c.professionalName}</span>
                      </span>
                    ))}
                  </p>
                  <div className="flex flex-wrap gap-2 [&_button]:rounded-full">
                    {envio.whatsappPendiente && (
                      <WhatsAppButton
                        clinicId={clinicId}
                        patientId={fila.patientId}
                        appointmentId={envio.principal.appointmentId}
                        templateKind={envio.kind}
                        variant="full"
                        label="WhatsApp"
                        variables={variables}
                        onSent={onSent}
                      />
                    )}
                    {envio.emailPendiente && (
                      <EmailButton
                        clinicId={clinicId}
                        patientId={fila.patientId}
                        appointmentId={envio.principal.appointmentId}
                        templateKind={envio.kind}
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
            {!fila.patientPhone && !fila.patientEmail && (
              <SinCanal texto="Sin teléfono ni email cargados: no se puede enviar." />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Ventana del recordatorio: forma (borde), ícono y texto, no solo color. */
function ChipVentana({ kind }: { kind: EnvioDeRecordatorio<PendingReminder>["kind"] }) {
  const tresHoras = kind === "appointment_checkin";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs font-semibold",
        tresHoras
          ? "border-dashed border-warning-border bg-warning-soft text-warning"
          : "border-hairline text-foreground/80",
      )}
    >
      <Clock aria-hidden className="size-3" strokeWidth={2.4} />
      {tresHoras ? "En 3 h" : "En 48 h"}
    </span>
  );
}

function SinCanal({ texto }: { texto: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[13px] font-medium text-destructive">
      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {texto}
    </p>
  );
}

// ─── Outreach ─────────────────────────────────────────────────────────────

/** Detalle de cada item según el kind — solo cambia la línea secundaria. */
interface FilaRecordatorioCsv {
  tipo: string;
  paciente: string;
  telefono: string | null;
  correo: string | null;
  detalle: string | null;
  fecha: string | null;
  profesional: string | null;
  montoCents: number | null;
  moneda: string | null;
}

/** Detalle para la planilla: el monto va en su propia columna (solo con finanzas). */
function detalleSinMonto(item: PendingOutreachItem): string {
  if (item.kind === "payment_due") return "Saldo pendiente";
  if (item.kind === "quote_follow_up") return `Presupuesto ${item.quoteNumber ?? ""}`.trim();
  return outreachDetail(item);
}

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

/** Una línea por paciente: con varias visitas, las nombra todas. */
function detalleDeGrupo(grupo: GrupoPorPaciente<PendingOutreachItem>): string {
  if (grupo.items.length === 1) return outreachDetail(grupo.principal);
  if (grupo.principal.kind === "review_request") {
    const visitas = unirConY(grupo.items.map((i) => i.treatmentLabel ?? "Consulta"));
    return `${grupo.items.length} visitas recientes: ${visitas}. Se pide una sola reseña.`;
  }
  return `${outreachDetail(grupo.principal)} (y ${grupo.items.length - 1} más)`;
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

function pasosDeOutreach(
  grupos: GrupoPorPaciente<PendingOutreachItem>[],
  clinica: string,
): PasoDeEnvio[] {
  return grupos.map((g) => ({
    clave: `${g.principal.kind}-${g.patientId}`,
    patientId: g.patientId,
    patientName: g.principal.patientName,
    detalle: detalleDeGrupo(g),
    whatsapp: g.principal.patientPhone
      ? {
          templateKind: g.principal.kind,
          variables: { ...outreachVariables(g.principal), clinica },
          appointmentId: g.principal.appointmentId,
          quoteId: g.principal.quoteId,
        }
      : null,
    email: null,
  }));
}

function OutreachList({
  grupos,
  clinicId,
  clinica,
  onSent,
}: {
  grupos: GrupoPorPaciente<PendingOutreachItem>[];
  clinicId: string;
  clinica: string;
  onSent: () => void;
}) {
  return (
    <div className="divide-y divide-hairline">
      {grupos.map((g) => {
        const item = g.principal;
        return (
          <div
            key={`${item.kind}-${g.patientId}`}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
          >
            <div className="min-w-0">
              <p className="truncate font-display text-[20px] font-medium leading-tight">
                {item.patientName}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{detalleDeGrupo(g)}</p>
              {!item.patientPhone && (
                <div className="mt-1">
                  <SinCanal texto="Sin teléfono cargado: no se puede enviar." />
                </div>
              )}
            </div>
            {item.patientPhone && (
              <WhatsAppButton
                className="rounded-full"
                clinicId={clinicId}
                patientId={g.patientId}
                appointmentId={item.appointmentId}
                quoteId={item.quoteId}
                templateKind={item.kind}
                variant="full"
                label="Enviar"
                variables={{ ...outreachVariables(item), clinica }}
                onSent={onSent}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Presupuestos sin respuesta ───────────────────────────────────────────

function hace(dias: number): string {
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

/** Un mensaje por paciente que nombra todos sus presupuestos abiertos. */
function variablesDePresupuestos(
  grupo: GrupoPorPaciente<PresupuestoSinRespuesta>,
  clinica: string,
): Record<string, string> {
  const total = grupo.items.reduce((s, q) => s + q.quoteTotalCents, 0);
  return {
    numero_presupuesto: unirConY(grupo.items.map((q) => q.quoteNumber)),
    total: formatMoney(total, grupo.principal.currency),
    clinica,
  };
}

function pasosDePresupuestos(
  grupos: GrupoPorPaciente<PresupuestoSinRespuesta>[],
  clinica: string,
): PasoDeEnvio[] {
  return grupos.map((g) => {
    const base = {
      templateKind: "quote_follow_up" as const,
      variables: variablesDePresupuestos(g, clinica),
      quoteId: g.principal.quoteId,
    };
    const total = g.items.reduce((s, q) => s + q.quoteTotalCents, 0);
    return {
      clave: `quote-${g.patientId}`,
      patientId: g.patientId,
      patientName: g.principal.patientName,
      detalle: `Presupuesto ${unirConY(g.items.map((q) => q.quoteNumber))} · ${formatMoney(total, g.principal.currency)}`,
      whatsapp: g.principal.puedeWhatsApp ? base : null,
      email: g.principal.puedeEmail ? base : null,
    };
  });
}

function PresupuestosSinRespuesta({
  grupos,
  dias,
  clinicId,
  clinica,
  onSent,
}: {
  grupos: GrupoPorPaciente<PresupuestoSinRespuesta>[];
  dias: number;
  clinicId: string;
  clinica: string;
  onSent: () => void;
}) {
  if (grupos.length === 0) {
    return (
      <p className="px-5 py-4 text-sm text-muted-foreground">
        Ningún presupuesto lleva {dias} días o más sin aceptarse.
      </p>
    );
  }
  return (
    <div className="divide-y divide-hairline">
      {grupos.map((g) => {
        const item = g.principal;
        const variables = variablesDePresupuestos(g, clinica);
        const sinCanal = !item.puedeWhatsApp && !item.puedeEmail;
        const hayBorrador = g.items.some((q) => q.estado === "draft");
        return (
          <div
            key={g.patientId}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
          >
            <div className="min-w-0">
              <p className="truncate font-display text-[20px] font-medium leading-tight">
                {item.patientName}
              </p>
              {g.items.map((q) => (
                <p key={q.quoteId} className="mt-0.5 text-sm text-muted-foreground">
                  Presupuesto {q.quoteNumber} ·{" "}
                  <span className="cifra">{formatMoney(q.quoteTotalCents, q.currency)}</span> ·{" "}
                  {q.estado === "draft" ? "creado" : "enviado"} {hace(q.diasSinRespuesta)}
                  {q.estado === "draft" && (
                    <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Borrador
                    </span>
                  )}
                </p>
              ))}
              {g.items.length > 1 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Un solo mensaje nombra los {g.items.length} presupuestos.
                </p>
              )}
              {hayBorrador && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Un borrador no figura como enviado: confirma que el paciente lo recibió antes de
                  escribirle.
                </p>
              )}
              {sinCanal ? (
                <div className="mt-1">
                  <SinCanal
                    texto={`${item.motivoSinWhatsApp} Sin email cargado: no se puede enviar.`}
                  />
                </div>
              ) : (
                !item.puedeWhatsApp && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    WhatsApp no disponible: {item.motivoSinWhatsApp}
                  </p>
                )
              )}
            </div>
            <div className="flex flex-wrap gap-2 [&_button]:rounded-full">
              {item.puedeWhatsApp && (
                <WhatsAppButton
                  clinicId={clinicId}
                  patientId={g.patientId}
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
                  patientId={g.patientId}
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
  );
}
