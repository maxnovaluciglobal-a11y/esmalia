import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CircleDollarSign,
  FileSignature,
  History,
  Loader2,
  Package,
  Pencil,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { OrigenDelDescuento } from "@/components/finance/descuento-afiliacion-ui";
import { AceptarPresupuestoDialog } from "@/components/finance/dialogos-presupuesto";
import {
  AceptarParcialDialog,
  RechazarDialog,
  RenovarDialog,
  SeguimientoDialog,
} from "@/components/presupuestos/dialogos-estado";
import { AvisoValidez, ChipEstadoPlan } from "@/components/presupuestos/estado-plan";
import {
  DescargarPdfPresupuestoBoton,
  EnviarPresupuestoCorreoBoton,
} from "@/components/presupuestos/pdf-y-correo-presupuesto";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { FirmasADistanciaCard } from "@/components/firma-distancia/firmas-a-distancia";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { hasPermission } from "@/lib/access/access";
import { requireAnyPermission } from "@/lib/access/route-guards";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  ETIQUETA_ESTADO_PLAN,
  accionesDisponibles,
  estadoDelPlan,
  validezPorDefecto,
} from "@/lib/finance/estados-presupuesto";
import {
  QUOTE_STATUS_LABELS,
  SIN_FASE_LABEL,
  TREATMENT_PLAN_STATUS_LABELS,
  formatMoney,
  groupByPhase,
  type QuoteStatus,
} from "@/lib/finance/finance";
import { setQuoteStatus } from "@/lib/finance/finance.functions";
import {
  actualizarSeguimiento,
  getConfiguracionPresupuestos,
  getDetallePresupuesto,
  listProfesionalesDePresupuesto,
  type DetallePresupuesto,
  type EventoDePresupuesto,
} from "@/lib/finance/presupuestos.functions";
import { fecha, fechaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { EXPLICACION_BOTON_SOLO_LECTURA } from "@/lib/solo-lectura";
import { partirNombre } from "@/lib/patients/encabezado-ficha";
import { cn } from "@/lib/utils";

const PESTANAS = ["prestaciones", "pagos", "documentos", "historial"] as const;
type Pestana = (typeof PESTANAS)[number];

/**
 * Detalle del plan de tratamiento / presupuesto (PLA-03): pestañas
 * Prestaciones, Pagos y abonos, Documentos e Historial, con las acciones de
 * estado (PLA-02) y el seguimiento (UX-16). Crear y corregir las líneas sigue
 * en la ficha del paciente, que tiene el editor.
 */
export const Route = createFileRoute("/_authenticated/_clinic/presupuestos/$presupuestoId")({
  beforeLoad: requireAnyPermission("finance:view", "patients:manage"),
  validateSearch: (search: Record<string, unknown>): { pestana?: Pestana } =>
    typeof search.pestana === "string" && (PESTANAS as readonly string[]).includes(search.pestana)
      ? { pestana: search.pestana as Pestana }
      : {},
  head: () => ({
    meta: [{ title: "Presupuesto | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: DetallePage,
});

function DetallePage() {
  const { access } = Route.useRouteContext();
  const { presupuestoId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const clinicId = access.clinic!.id;
  const tz = access.clinic!.timezone;
  const hoy = hoyISO(tz);
  const puedeEditar = hasPermission(access.role, "patients:manage");
  const puedeVerLista = hasPermission(access.role, "finance:view");
  const queryClient = useQueryClient();

  const fetchDetalle = useServerFn(getDetallePresupuesto);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["presupuesto-detalle", clinicId, presupuestoId],
    queryFn: () => fetchDetalle({ data: { clinicId, quoteId: presupuestoId } }),
  });

  const fetchConfig = useServerFn(getConfiguracionPresupuestos);
  const { data: config } = useQuery({
    queryKey: ["presupuestos-config", clinicId],
    queryFn: () => fetchConfig({ data: { clinicId } }),
    enabled: puedeEditar,
  });

  const fetchProfesionales = useServerFn(listProfesionalesDePresupuesto);
  const { data: profesionales = [] } = useQuery({
    queryKey: ["presupuestos-profesionales", clinicId],
    queryFn: () => fetchProfesionales({ data: { clinicId } }),
    enabled: puedeEditar,
  });

  const invalidar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["presupuesto-detalle", clinicId, presupuestoId] }),
      queryClient.invalidateQueries({ queryKey: ["presupuestos-clinica", clinicId] }),
      data && queryClient.invalidateQueries({ queryKey: ["quotes", clinicId, data.patientId] }),
      data &&
        queryClient.invalidateQueries({ queryKey: ["treatment-plans", clinicId, data.patientId] }),
    ]);
  };

  const setStatusFn = useServerFn(setQuoteStatus);
  const cambiar = useMutation({
    mutationFn: (v: {
      status: QuoteStatus;
      acceptedByName?: string;
      signatureDataUrl?: string;
      acceptedItemIds?: string[];
      rejectionReason?: string;
      validUntil?: string;
    }) => setStatusFn({ data: { quoteId: presupuestoId, ...v } }),
    onSuccess: async (res, v) => {
      await invalidar();
      if (res.signatureUploadFailed) {
        toast.error("Quedó aceptado, pero no pudimos guardar la firma. Vuelve a intentarlo.");
        return;
      }
      const textos: Partial<Record<QuoteStatus, string>> = {
        sent: v.validUntil ? "Presupuesto renovado" : "Presupuesto emitido",
        accepted: "Presupuesto aceptado: se creó el plan de tratamiento",
        partially_accepted: "Aceptación parcial registrada: se creó el plan con lo aceptado",
        rejected: "Presupuesto rechazado",
      };
      toast.success(textos[v.status] ?? "Estado actualizado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const seguimientoFn = useServerFn(actualizarSeguimiento);
  const seguimiento = useMutation({
    mutationFn: (v: {
      contactado: boolean;
      nota?: string;
      proximaAccion: string | null;
      proximaAccionOn: string | null;
      professionalId: string | null;
    }) => seguimientoFn({ data: { clinicId, quoteId: presupuestoId, ...v } }),
    onSuccess: async () => {
      await invalidar();
      toast.success("Seguimiento guardado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const pestana = search.pestana ?? "prestaciones";

  return (
    <AppShell title="Presupuesto" access={access}>
      <div className="space-y-6">
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando presupuesto…
          </p>
        ) : isError || !data ? (
          <ErrorDeCarga
            onReintentar={refetch}
            reintentando={isFetching}
            mensaje="No pudimos cargar el presupuesto."
          />
        ) : (
          <>
            <Encabezado
              d={data}
              hoy={hoy}
              tz={tz}
              puedeVerLista={puedeVerLista}
              acciones={
                puedeEditar ? (
                  <BarraDeAcciones
                    d={data}
                    hoy={hoy}
                    pending={cambiar.isPending}
                    validezSugerida={validezPorDefecto(hoy, config?.diasValidez)}
                    onCambiar={(v) => cambiar.mutate(v)}
                    seguimiento={
                      <SeguimientoDialog
                        inicial={{
                          proximaAccion: data.seguimiento.nextAction,
                          proximaAccionOn: data.seguimiento.nextActionOn,
                          professionalId: data.quote.professionalId,
                        }}
                        profesionales={profesionales}
                        pending={seguimiento.isPending}
                        onConfirm={(v) => seguimiento.mutate(v)}
                      />
                    }
                  />
                ) : null
              }
            />

            <Tabs
              value={pestana}
              onValueChange={(v) =>
                void navigate({ search: { pestana: v as Pestana }, replace: true })
              }
            >
              <TabsList className="w-full justify-start">
                <TabsTrigger value="prestaciones">
                  <Package className="size-4" aria-hidden /> Prestaciones
                </TabsTrigger>
                <TabsTrigger value="pagos">
                  <CircleDollarSign className="size-4" aria-hidden /> Pagos y abonos
                </TabsTrigger>
                <TabsTrigger value="documentos">
                  <FileSignature className="size-4" aria-hidden /> Documentos
                </TabsTrigger>
                <TabsTrigger value="historial">
                  <History className="size-4" aria-hidden /> Historial
                </TabsTrigger>
              </TabsList>
              <TabsContent value="prestaciones">
                <Prestaciones d={data} />
              </TabsContent>
              <TabsContent value="pagos">
                <Pagos d={data} tz={tz} />
              </TabsContent>
              <TabsContent value="documentos">
                <Documentos
                  d={data}
                  tz={tz}
                  clinicaNombre={access.clinic!.name}
                  puedeEnviar={puedeEditar}
                />
              </TabsContent>
              <TabsContent value="historial">
                <Historial eventos={data.eventos} tz={tz} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Encabezado({
  d,
  hoy,
  tz,
  acciones,
  puedeVerLista,
}: {
  d: DetallePresupuesto;
  hoy: string;
  tz: string;
  acciones: React.ReactNode;
  puedeVerLista: boolean;
}) {
  const q = d.quote;
  const estado = estadoDelPlan({ ...q, planStatus: d.plan?.status ?? null }, hoy);
  const pendiente = q.status === "draft" || q.status === "sent";
  const saldo = d.plan ? Math.max(0, d.plan.totalCents - d.pagadoCents) : null;
  const { primero, resto } = partirNombre(d.patientName ?? "Paciente");
  return (
    // Encabezado en tinta, coherente con la ficha (A+): el paciente en
    // Cormorant con los apellidos en itálica ocre, los datos del presupuesto
    // en Geist Mono, el estado en pastilla y las cifras grandes a la derecha.
    <header className="dark tinta-de-pagina relative isolate overflow-hidden rounded-panel bg-night px-5 py-6 text-on-night sm:px-8 sm:py-8">
      <span
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-16 -z-10 size-[340px] rounded-full border border-night-line"
      />
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-on-night-2">
            {puedeVerLista ? (
              <Link
                to="/presupuestos"
                className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-on-night hover:underline"
              >
                <ArrowLeft className="size-4" aria-hidden /> Presupuestos
              </Link>
            ) : (
              <span className="font-semibold text-on-night">Presupuesto</span>
            )}
            <span aria-hidden>·</span>
            <span className="cifra text-on-night">{q.number}</span>
          </p>
          <h2 className="mt-1 font-display text-[40px] leading-[0.95] font-medium tracking-[-0.02em] break-words sm:text-[52px] xl:text-[64px]">
            <Link
              to="/pacientes/$pacienteId"
              params={{ pacienteId: d.patientId }}
              search={{ pestana: "finanzas" }}
              className="rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              {primero}
              {resto && (
                <>
                  {" "}
                  <em className="text-brand">{resto}</em>
                </>
              )}
            </Link>
          </h2>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-[18px] gap-y-2 text-[13px] text-on-night-2">
            <ChipEstadoPlan estado={estado} />
            {pendiente && <AvisoValidez validUntil={q.validUntil} hoy={hoy} />}
            <span className="cifra">Creado {fecha(q.createdAt, tz)}</span>
            {q.validUntil && <span className="cifra">Válido hasta {fecha(q.validUntil)}</span>}
            <span>{d.professionalName ?? "Sin profesional asignado"}</span>
          </div>
          {q.status === "rejected" && q.rejectionReason && (
            <p className="mt-2 text-sm text-on-night-2">Motivo del rechazo: {q.rejectionReason}</p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-7 gap-y-4 sm:grid-cols-4">
          <Cifra etiqueta="Total" valor={formatMoney(q.totalCents, q.currency)} grande />
          <Cifra
            etiqueta="Aceptado"
            valor={
              q.acceptedTotalCents === null
                ? "Sin datos"
                : formatMoney(q.acceptedTotalCents, q.currency)
            }
            tenue={q.acceptedTotalCents === null}
          />
          <Cifra
            etiqueta="Pagado"
            valor={d.plan ? formatMoney(d.pagadoCents, q.currency) : "Sin plan"}
            tenue={!d.plan}
          />
          <Cifra
            etiqueta="Saldo del plan"
            valor={saldo === null ? "Sin plan" : formatMoney(saldo, q.currency)}
            tenue={saldo === null}
          />
        </dl>
      </div>
      {acciones && <div className="mt-6">{acciones}</div>}
    </header>
  );
}

function Cifra({
  etiqueta,
  valor,
  tenue,
  grande,
}: {
  etiqueta: string;
  valor: string;
  tenue?: boolean;
  grande?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] font-semibold text-on-night-2">{etiqueta}</dt>
      <dd
        className={cn(
          "mt-1 whitespace-nowrap font-display text-[26px] font-medium leading-none [font-variant-numeric:lining-nums]",
          grande && "text-brand-on-night",
          tenue && "font-sans text-sm font-normal text-on-night-2",
        )}
      >
        {valor}
      </dd>
    </div>
  );
}

function BarraDeAcciones({
  d,
  hoy,
  pending: enCurso,
  validezSugerida,
  onCambiar,
  seguimiento,
}: {
  d: DetallePresupuesto;
  hoy: string;
  pending: boolean;
  validezSugerida: string;
  onCambiar: (v: {
    status: QuoteStatus;
    acceptedByName?: string;
    signatureDataUrl?: string;
    acceptedItemIds?: string[];
    rejectionReason?: string;
    validUntil?: string;
  }) => void;
  seguimiento: React.ReactNode;
}) {
  const acciones = accionesDisponibles(d.quote, hoy);
  const abierto = acciones.length > 0;
  // Solo lectura (BIL-01): las acciones quedan a la vista pero deshabilitadas;
  // igual las rechaza el servidor.
  const soloLectura = useSoloLectura();
  const pending = enCurso || soloLectura;
  return (
    <>
      {soloLectura && (
        <p className="border-t border-night-line pt-4 text-xs text-on-night-2">
          {EXPLICACION_BOTON_SOLO_LECTURA}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-night-line pt-4">
        {acciones.includes("emitir") && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onCambiar({ status: "sent" })}
          >
            <Send className="size-3.5" /> Marcar como emitido
          </Button>
        )}
        {acciones.includes("aceptar") && (
          <AceptarPresupuestoDialog
            defaultName={d.patientName ?? ""}
            pending={pending}
            onConfirm={(nombre, firma) =>
              onCambiar({ status: "accepted", acceptedByName: nombre, signatureDataUrl: firma })
            }
          />
        )}
        {acciones.includes("aceptar_parcial") && (
          <AceptarParcialDialog
            items={d.quote.items}
            currency={d.quote.currency}
            pending={pending}
            onConfirm={({ itemIds, nombre, firma }) =>
              onCambiar({
                status: "partially_accepted",
                acceptedItemIds: itemIds,
                acceptedByName: nombre,
                signatureDataUrl: firma,
              })
            }
          />
        )}
        {acciones.includes("renovar") && (
          <RenovarDialog
            hoy={hoy}
            sugerida={validezSugerida}
            pending={pending}
            onConfirm={(validUntil) => onCambiar({ status: "sent", validUntil })}
          />
        )}
        {acciones.includes("editar") && (
          <Button size="sm" variant="ghost" asChild>
            <Link
              to="/pacientes/$pacienteId"
              params={{ pacienteId: d.patientId }}
              search={{ pestana: "finanzas" }}
            >
              <Pencil className="size-3.5" /> Editar en la ficha
            </Link>
          </Button>
        )}
        {acciones.includes("rechazar") && (
          <RechazarDialog
            pending={pending}
            onConfirm={(motivo) => onCambiar({ status: "rejected", rejectionReason: motivo })}
          />
        )}
        {!soloLectura && (
          <div className={cn("flex items-center gap-2", abierto && "sm:ml-auto")}>
            {seguimiento}
          </div>
        )}
      </div>
    </>
  );
}

function Prestaciones({ d }: { d: DetallePresupuesto }) {
  const q = d.quote;
  const secciones = groupByPhase(q.items, (it) => it.totalCents);
  const conSecciones = q.items.some((it) => it.phaseLabel);
  const hayNoAceptadas = q.items.some((it) => it.accepted === false);
  return (
    <div className="card-clinical overflow-hidden">
      {secciones.map((s) => (
        <section key={s.label ?? "sin-fase"} aria-label={s.label ?? SIN_FASE_LABEL}>
          {conSecciones && (
            <div className="flex items-center justify-between gap-3 bg-secondary/40 px-4 py-2 sm:px-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {s.label ?? SIN_FASE_LABEL}
              </h3>
              <span className="cifra text-xs text-muted-foreground">
                {formatMoney(s.subtotalCents, q.currency)}
              </span>
            </div>
          )}
          <ul className="divide-y divide-hairline">
            {s.items.map((it) => (
              <li
                key={it.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5",
                  it.accepted === false && "text-muted-foreground",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn(it.accepted === false && "line-through")}>
                    {it.nameSnapshot}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    {it.toothNumber ? <span>Pieza {it.toothNumber}</span> : null}
                    <span>
                      {it.quantity} × {formatMoney(it.unitPriceCents, q.currency)}
                    </span>
                    {it.discountPct !== null ? (
                      <span>Descuento {it.discountPct}%</span>
                    ) : it.discountCents > 0 ? (
                      <span>Descuento {formatMoney(it.discountCents, q.currency)}</span>
                    ) : null}
                    {it.packageNameSnapshot && (
                      <span className="inline-flex items-center gap-1">
                        <Package className="size-3" aria-hidden /> {it.packageNameSnapshot}
                      </span>
                    )}
                    {it.accepted === false && <span>No aceptada</span>}
                  </span>
                </span>
                <span className="cifra font-medium tabular-nums">
                  {formatMoney(it.totalCents, q.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <dl className="space-y-1.5 border-t border-hairline px-4 py-3 text-sm sm:px-5">
        {q.discountCents > 0 && (
          <Fila
            etiqueta={`Descuento comercial${q.commercialDiscountPct !== null ? ` (${q.commercialDiscountPct}%)` : ""}`}
            valor={`− ${formatMoney(q.discountCents, q.currency)}`}
            tenue
          />
        )}
        {q.affiliationDiscount && (
          <OrigenDelDescuento
            rastro={q.affiliationDiscount}
            subtotalCents={q.subtotalCents}
            discountCents={q.discountCents}
            className="text-right"
          />
        )}
        {q.coverageTotalCents !== null && (
          <Fila
            etiqueta={`Cubre ${q.agreementNameSnapshot ?? "el convenio"}`}
            valor={`− ${formatMoney(q.coverageTotalCents, q.currency)}`}
            tenue
          />
        )}
        <Fila etiqueta="Total" valor={formatMoney(q.totalCents, q.currency)} fuerte />
        {hayNoAceptadas && q.acceptedTotalCents !== null && (
          <Fila etiqueta="Aceptado" valor={formatMoney(q.acceptedTotalCents, q.currency)} fuerte />
        )}
      </dl>
      {q.notes && (
        <p className="border-t border-hairline px-4 py-3 text-xs text-muted-foreground sm:px-5">
          {q.notes}
        </p>
      )}
    </div>
  );
}

function Fila({
  etiqueta,
  valor,
  tenue,
  fuerte,
}: {
  etiqueta: string;
  valor: string;
  tenue?: boolean;
  fuerte?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-4">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd
        className={cn(
          "cifra w-32 text-right tabular-nums",
          tenue && "text-muted-foreground",
          fuerte && "font-semibold",
        )}
      >
        {valor}
      </dd>
    </div>
  );
}

function Pagos({ d, tz }: { d: DetallePresupuesto; tz: string }) {
  if (!d.plan) {
    return (
      <div className="card-clinical px-5 py-10 text-center text-sm text-muted-foreground">
        Los pagos y abonos se registran contra el plan de tratamiento, que se crea al aceptar el
        presupuesto.
      </div>
    );
  }
  const q = d.quote;
  const saldo = Math.max(0, d.plan.totalCents - d.pagadoCents);
  return (
    <div className="space-y-4">
      <div className="card-clinical grid gap-4 p-4 sm:grid-cols-4 sm:p-5">
        <Resumen etiqueta="Plan" valor={TREATMENT_PLAN_STATUS_LABELS[d.plan.status]} />
        <Resumen
          etiqueta="Avance"
          valor={`${d.plan.lineasRealizadas} de ${d.plan.lineas} realizadas`}
        />
        <Resumen etiqueta="Pagado" valor={formatMoney(d.pagadoCents, q.currency)} cifra />
        <Resumen etiqueta="Saldo" valor={formatMoney(saldo, q.currency)} cifra />
      </div>
      {d.pagos.length === 0 ? (
        <div className="card-clinical px-5 py-8 text-center text-sm text-muted-foreground">
          Todavía no hay pagos ni abonos contra este plan. Se registran desde la ficha del paciente.
        </div>
      ) : (
        <ul className="card-clinical divide-y divide-hairline">
          {d.pagos.map((p) => (
            <li
              key={p.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-5",
                p.reversedAt && "text-muted-foreground",
              )}
            >
              <span className="min-w-0">
                <span className={cn("cifra font-medium", p.reversedAt && "line-through")}>
                  {formatMoney(p.amountCents, p.currency)}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {p.metodo}
                  {p.reference && ` · Ref. ${p.reference}`}
                  {p.reversedAt && ` · Reversado: ${p.reversalReason ?? "sin motivo"}`}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">{fechaHora(p.paidAt, tz)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Resumen({ etiqueta, valor, cifra }: { etiqueta: string; valor: string; cifra?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{etiqueta}</p>
      <p className={cn("text-sm font-semibold", cifra && "cifra")}>{valor}</p>
    </div>
  );
}

const CANAL: Record<string, string> = { whatsapp: "WhatsApp", email: "Correo", sms: "SMS" };

function Documentos({
  d,
  tz,
  clinicaNombre,
  puedeEnviar,
}: {
  d: DetallePresupuesto;
  tz: string;
  clinicaNombre: string;
  puedeEnviar: boolean;
}) {
  const q = d.quote;
  const aceptado = q.acceptedAt !== null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card-clinical flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 lg:col-span-2">
        <div className="min-w-0 space-y-0.5">
          <h3 className="font-display text-base font-semibold">PDF del presupuesto</h3>
          <p className="text-sm text-muted-foreground">
            Con los datos de la clínica, las prestaciones por sección, los totales y la firma de{" "}
            {d.professionalName ?? "el profesional a cargo"}. El texto se edita en Clínica →
            Plantillas de documentos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DescargarPdfPresupuestoBoton clinicId={d.clinicId} quoteId={q.id} />
          {puedeEnviar && (
            <EnviarPresupuestoCorreoBoton
              clinicId={d.clinicId}
              quoteId={q.id}
              patientId={d.patientId}
              numero={q.number}
              puedeReactivar={puedeEnviar}
            />
          )}
        </div>
      </section>
      <div className="lg:col-span-2">
        {/* DOC-05: el paciente acepta y firma el presupuesto en su celular. */}
        <FirmasADistanciaCard
          clinicId={d.clinicId}
          timezone={tz}
          filtro={{ quoteId: q.id }}
          objetivo={puedeEnviar ? { tipo: "presupuesto", id: q.id } : undefined}
          puedeGestionar={() => puedeEnviar}
          titulo="Aceptación a distancia"
          descripcion="El paciente revisa el presupuesto en su celular y lo acepta completo con su firma: confirma su identidad con su RUT y un código que le llega por correo. Al firmar se crea el plan de tratamiento."
          motivoNoPedir={
            q.status === "draft" || q.status === "sent"
              ? null
              : "Solo se manda a firmar un presupuesto en borrador o enviado."
          }
        />
      </div>
      <section className="card-clinical space-y-3 p-4 sm:p-5">
        <h3 className="font-display text-base font-semibold">Aceptación</h3>
        {!aceptado ? (
          <p className="text-sm text-muted-foreground">
            Todavía no se acepta. Al aceptar quedan acá el nombre de quien aprueba, la fecha y la
            firma del paciente.
          </p>
        ) : (
          <>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Aprobó</dt>
                <dd>{q.acceptedByName ?? "Sin nombre registrado"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Fecha</dt>
                <dd>{fechaHora(q.acceptedAt!, tz)}</dd>
              </div>
            </dl>
            {d.firmaUrl ? (
              <img
                src={d.firmaUrl}
                alt={`Firma de ${q.acceptedByName ?? "el paciente"}`}
                className="max-h-40 rounded-lg border border-hairline bg-white p-2"
              />
            ) : (
              <p className="text-xs text-muted-foreground">Se aceptó sin firma manuscrita.</p>
            )}
          </>
        )}
      </section>
      <section className="card-clinical space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-semibold">Envíos al paciente</h3>
          {puedeEnviar && (
            <WhatsAppButton
              clinicId={d.clinicId}
              patientId={d.patientId}
              quoteId={q.id}
              templateKind="quote_sent"
              variant="full"
              label="Enviar por WhatsApp"
              variables={{
                numero_presupuesto: q.number,
                total: formatMoney(q.totalCents, q.currency),
                clinica: clinicaNombre,
              }}
            />
          )}
        </div>
        {d.mensajes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este presupuesto todavía no se envió.</p>
        ) : (
          <ul className="divide-y divide-hairline text-sm">
            {d.mensajes.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 py-2">
                <span>{CANAL[m.channel] ?? m.channel}</span>
                <span className="text-xs text-muted-foreground">{fechaHora(m.createdAt, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function textoDeEvento(e: EventoDePresupuesto): string {
  switch (e.kind) {
    case "creado":
      return "Presupuesto creado";
    case "validez":
      return e.validUntil ? `Validez cambiada al ${fecha(e.validUntil)}` : "Validez quitada";
    case "contacto":
      return "Contacto con el paciente";
    case "envio":
      return "Enviado por correo";
    case "estado": {
      if (e.fromStatus === "expired" && e.toStatus === "sent") {
        return e.validUntil ? `Renovado hasta el ${fecha(e.validUntil)}` : "Renovado";
      }
      if (e.toStatus === "expired") return "Venció";
      if (e.toStatus === "converted" || e.toStatus === "accepted") return "Aceptado";
      return e.toStatus ? ETIQUETA_ESTADO_PLAN[estadoDeEvento(e.toStatus)] : "Cambio de estado";
    }
  }
}

function estadoDeEvento(s: QuoteStatus) {
  return estadoDelPlan({ status: s, validUntil: null }, "0000-00-00");
}

function Historial({ eventos, tz }: { eventos: EventoDePresupuesto[]; tz: string }) {
  if (!eventos.length) {
    return (
      <div className="card-clinical px-5 py-10 text-center text-sm text-muted-foreground">
        Sin movimientos registrados.
      </div>
    );
  }
  return (
    <ol className="card-clinical divide-y divide-hairline">
      {eventos.map((e) => (
        <li key={e.id} className="space-y-0.5 px-4 py-3 text-sm sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{textoDeEvento(e)}</span>
            <span className="text-xs text-muted-foreground">{fechaHora(e.createdAt, tz)}</span>
          </div>
          {e.note && <p className="text-muted-foreground">{e.note}</p>}
          <p className="text-xs text-muted-foreground">
            {e.actorName ??
              (e.kind === "estado" && e.toStatus === "expired"
                ? "Automático, por la fecha de validez"
                : "Sistema")}
            {e.kind === "estado" && e.fromStatus && e.toStatus && e.toStatus !== "expired"
              ? ` · ${QUOTE_STATUS_LABELS[e.fromStatus]} → ${QUOTE_STATUS_LABELS[e.toStatus]}`
              : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
