import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Ban, CheckCircle2, Loader2, Pause, Pencil, Play, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { DialogoCobrar } from "@/components/finanzas/cobrar-cuota-dialog";
import { INPUT, SelectorMes } from "@/components/finanzas/piezas";
import { MoneyInput } from "@/components/money-input";
import {
  Chips,
  DatosEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  MontoEnTinta,
  PANEL,
  Pastilla,
  SinDatos,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
} from "@/components/reportes/aplus";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { hasPermission } from "@/lib/access/access";
import { requirePermission } from "@/lib/access/route-guards";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import { mesDe } from "@/lib/finance/gastos-fijos";
import {
  ETIQUETA_CUOTA,
  ETIQUETA_PERIODO,
  PERIODOS_MEMBRESIA,
  etiquetaCuota,
  etiquetaPeriodoCuota,
  resumirCuotas,
  validarPlan,
  type PeriodoMembresia,
} from "@/lib/finance/membresias";
import {
  anularCuotaMembresia,
  generarCuotasMembresia,
  listCuotasMembresia,
  listPlanesMembresia,
  previsualizarCuotasMembresia,
  savePlanMembresia,
  setPlanMembresiaActivo,
  type CuotaMembresia,
  type PlanMembresia,
} from "@/lib/finance/membresias.functions";
import { fechaHoraPlanilla, fechaPlanilla, montoPlanilla } from "@/lib/exportacion/listas-csv";
import { fecha, mesAnio, numero } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";

interface MembresiasSearch {
  mes: string;
}

type FiltroCuota = "todas" | "pending" | "paid";

export const Route = createFileRoute("/_authenticated/_clinic/membresias")({
  validateSearch: (search: Record<string, unknown>): MembresiasSearch => ({
    mes: str(search.mes, ""),
  }),
  beforeLoad: requirePermission("cash:manage"),
  head: () => ({
    meta: [
      { title: "Membresías | Esmalia" },
      {
        name: "description",
        content:
          "Planes de membresía de la clínica y las cuotas del mes, que se cobran a mano: sin cobro automático.",
      },
    ],
  }),
  component: MembresiasPage,
});

function MembresiasPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const clinicId = access.clinic?.id;
  const tz = access.clinic?.timezone;
  const currency = access.clinic?.currency ?? "CLP";
  const hoy = hoyISO(tz);
  const mes = /^\d{4}-\d{2}-\d{2}$/.test(search.mes) ? mesDe(search.mes) : mesDe(hoy);
  const veFinanzas = hasPermission(access, "finance:view");
  const puedeAnular = hasPermission(access, "payments:reverse");

  const fetchPlanes = useServerFn(listPlanesMembresia);
  const planes = useQuery({
    queryKey: ["membresias-planes", clinicId],
    queryFn: () => fetchPlanes({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
  });
  const fetchCuotas = useServerFn(listCuotasMembresia);
  const cuotas = useQuery({
    queryKey: ["membresias-cuotas", clinicId, mes],
    queryFn: () => fetchCuotas({ data: { clinicId: clinicId!, mes } }),
    enabled: Boolean(clinicId),
  });

  const [filtro, setFiltro] = useState<FiltroCuota>("pending");
  const [editando, setEditando] = useState<PlanMembresia | "nuevo" | null>(null);
  const [generando, setGenerando] = useState(false);
  const [cobrando, setCobrando] = useState<CuotaMembresia | null>(null);
  const [anulando, setAnulando] = useState<CuotaMembresia | null>(null);

  const lista = cuotas.data ?? [];
  const resumen = resumirCuotas(lista);
  const visibles = lista.filter((c) => filtro === "todas" || c.status === filtro);
  const inscritos = (planes.data ?? []).reduce((s, p) => s + p.inscritos, 0);

  return (
    <AppShell title="Membresías" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-[18px]">
        <EncabezadoEditorial
          seccion="Caja"
          pagina="Membresías"
          titulo={
            <>
              Cuotas de <Destacado>{mesAnio(mes)}</Destacado>
            </>
          }
          conclusion={
            cuotas.data
              ? resumen.porCobrar > 0
                ? `Quedan ${numero(resumen.porCobrar)} ${resumen.porCobrar === 1 ? "cuota" : "cuotas"} por cobrar, ${formatMoney(resumen.porCobrarCents, currency)}. Nada se cobra solo: márcala cuando el paciente pague.`
                : lista.length > 0
                  ? "Todas las cuotas de este mes están cobradas."
                  : `Este mes no hay cuotas generadas. ${numero(inscritos)} ${inscritos === 1 ? "paciente inscrito" : "pacientes inscritos"}.`
              : undefined
          }
          acciones={
            <>
              <SelectorMes mes={mes} onCambiar={(m) => navigate({ search: { mes: m } })} />
              {veFinanzas && (
                <Button size="sm" onClick={() => setGenerando(true)}>
                  <Sparkles className="size-4" /> Generar cuotas del mes
                </Button>
              )}
            </>
          }
        />

        {cuotas.isError ? (
          <ErrorDeCarga
            mensaje="No pudimos cargar las cuotas. Revisa la conexión."
            onReintentar={() => void cuotas.refetch()}
            reintentando={cuotas.isFetching}
          />
        ) : !cuotas.data ? (
          <TintaCargando texto="Cargando las cuotas…" />
        ) : (
          <>
            <section
              aria-label="Resumen de cuotas"
              className={cn(TINTA, "grid gap-6 md:grid-cols-2")}
            >
              <div className="min-w-0">
                <EtiquetaTinta>Por cobrar</EtiquetaTinta>
                <MontoEnTinta cents={resumen.porCobrarCents} currency={currency} />
                <p className="mt-3 text-sm font-medium text-on-night-2">
                  Incluye las atrasadas de meses anteriores. La cuota cobrada no es un pago de
                  tratamiento: no cambia el saldo del paciente.
                </p>
              </div>
              <DatosEnTinta
                columnas={3}
                datos={[
                  {
                    label: "Por cobrar",
                    valor: numero(resumen.porCobrar),
                    nota: resumen.porCobrar === 1 ? "cuota" : "cuotas",
                  },
                  {
                    label: "Cobradas",
                    valor: formatMoney(resumen.cobradasCents, currency),
                    nota: `${numero(resumen.cobradas)} este mes`,
                  },
                  { label: "Anuladas", valor: numero(resumen.anuladas) },
                ]}
              />
            </section>

            <section aria-labelledby="mem-cuotas" className={cn(PANEL, "p-0")}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
                <h2 id="mem-cuotas" className={TITULO_PANEL}>
                  <Destacado>Cuotas</Destacado>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Chips
                    etiqueta="Estado de la cuota"
                    valor={filtro}
                    onCambiar={setFiltro}
                    opciones={[
                      { valor: "pending", label: "Por cobrar", cuenta: resumen.porCobrar },
                      { valor: "paid", label: "Cobradas", cuenta: resumen.cobradas },
                      { valor: "todas", label: "Todas", cuenta: lista.length },
                    ]}
                  />
                  {clinicId && (
                    <ExportarCsvLista
                      clinicId={clinicId}
                      rol={access.role}
                      lista="membresias"
                      timezone={tz ?? "America/Santiago"}
                      filas={visibles}
                      filtros={{ mes, estado: filtro }}
                      columnas={[
                        { header: "Paciente", value: (c) => c.patientName },
                        { header: "Plan", value: (c) => c.planName },
                        { header: "Desde", value: (c) => fechaPlanilla(c.periodStart) },
                        { header: "Hasta", value: (c) => fechaPlanilla(c.periodEnd) },
                        {
                          header: "Monto",
                          value: (c) => montoPlanilla(c.amountCents, c.currency),
                          dinero: true,
                        },
                        { header: "Moneda", value: (c) => c.currency, dinero: true },
                        { header: "Estado", value: (c) => ETIQUETA_CUOTA[c.status] },
                        { header: "Cobrada el", value: (c) => fechaHoraPlanilla(c.paidAt, tz) },
                        { header: "Medio", value: (c) => c.methodName },
                        { header: "Referencia", value: (c) => c.reference },
                      ]}
                    />
                  )}
                </div>
              </div>
              {visibles.length === 0 ? (
                <SinDatos
                  titulo={
                    filtro === "pending"
                      ? "No hay cuotas por cobrar."
                      : "No hay cuotas con este filtro en el mes."
                  }
                  detalle={
                    veFinanzas
                      ? "Las cuotas del mes se generan con «Generar cuotas del mes», con vista previa."
                      : "Las cuotas del mes las genera quien lleva las finanzas."
                  }
                />
              ) : (
                <ul className="mt-3 divide-y divide-hairline">
                  {visibles.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                    >
                      <div className="min-w-0">
                        <Link
                          to="/pacientes/$pacienteId"
                          params={{ pacienteId: c.patientId }}
                          className="truncate text-[15px] font-semibold underline-offset-4 hover:underline"
                        >
                          {c.patientName}
                        </Link>
                        <p className="text-[13px] text-muted-foreground">
                          {c.planName} · {etiquetaPeriodoCuota(c.periodStart, c.periodEnd)}
                          {c.periodStart < mes && c.status === "pending" && " · atrasada"}
                          {c.status === "paid" &&
                            c.paidAt &&
                            ` · cobrada el ${fecha(c.paidAt, tz)}`}
                          {c.methodName && ` · ${c.methodName}`}
                          {c.status === "void" && c.voidReason && ` · ${c.voidReason}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="cifra text-[15px]">
                          {formatMoney(c.amountCents, c.currency)}
                        </span>
                        {c.status === "pending" ? (
                          <>
                            <Button size="sm" onClick={() => setCobrando(c)}>
                              Cobrar
                            </Button>
                            {puedeAnular && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setAnulando(c)}
                                aria-label={`Anular cuota de ${c.patientName}`}
                              >
                                <Ban className="size-3.5" />
                              </Button>
                            )}
                          </>
                        ) : c.status === "paid" ? (
                          <>
                            <Pastilla tono="success" icono={CheckCircle2}>
                              Cobrada
                            </Pastilla>
                            {puedeAnular && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setAnulando(c)}
                                aria-label={`Anular cuota cobrada de ${c.patientName}`}
                              >
                                <Ban className="size-3.5" />
                              </Button>
                            )}
                          </>
                        ) : (
                          <Pastilla tono="neutral" icono={Ban}>
                            Anulada
                          </Pastilla>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <section aria-labelledby="mem-planes" className={cn(PANEL, "p-0")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
            <h2 id="mem-planes" className={TITULO_PANEL}>
              Planes de <Destacado>membresía</Destacado>
            </h2>
            {veFinanzas && (
              <Button size="sm" variant="outline" onClick={() => setEditando("nuevo")}>
                <Plus className="size-4" /> Nuevo plan
              </Button>
            )}
          </div>
          {planes.isError ? (
            <ErrorDeCarga
              className="m-5"
              mensaje="No pudimos cargar los planes."
              onReintentar={() => void planes.refetch()}
              reintentando={planes.isFetching}
            />
          ) : (planes.data ?? []).length === 0 ? (
            <SinDatos
              titulo="Sin planes de membresía todavía."
              detalle="Ejemplo: Plan Sonrisa, $15.000 al mes, con dos limpiezas al año y 10 % en tratamientos. El paciente se inscribe desde su ficha."
            />
          ) : (
            <ul className="mt-3 grid gap-3 p-5 pt-0 sm:grid-cols-2 lg:grid-cols-3">
              {(planes.data ?? []).map((p) => (
                <TarjetaPlan
                  key={p.id}
                  plan={p}
                  clinicId={clinicId!}
                  editable={veFinanzas}
                  onEditar={() => setEditando(p)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {editando && clinicId && (
        <DialogoPlan
          clinicId={clinicId}
          currency={currency}
          plan={editando === "nuevo" ? null : editando}
          onCerrar={() => setEditando(null)}
        />
      )}
      {generando && clinicId && (
        <DialogoGenerar
          clinicId={clinicId}
          currency={currency}
          mes={mes}
          onCerrar={() => setGenerando(false)}
        />
      )}
      {cobrando && clinicId && (
        <DialogoCobrar clinicId={clinicId} cuota={cobrando} onCerrar={() => setCobrando(null)} />
      )}
      {anulando && clinicId && (
        <DialogoAnular clinicId={clinicId} cuota={anulando} onCerrar={() => setAnulando(null)} />
      )}
    </AppShell>
  );
}

function TarjetaPlan({
  plan,
  clinicId,
  editable,
  onEditar,
}: {
  plan: PlanMembresia;
  clinicId: string;
  editable: boolean;
  onEditar: () => void;
}) {
  const qc = useQueryClient();
  const fn = useServerFn(setPlanMembresiaActivo);
  const activar = useMutation({
    mutationFn: () => fn({ data: { clinicId, id: plan.id, active: !plan.active } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["membresias-planes", clinicId] });
      toast.success(plan.active ? "Plan desactivado" : "Plan activado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <li className="flex flex-col rounded-xl border border-hairline p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("text-[15px] font-semibold", !plan.active && "text-muted-foreground")}>
            {plan.name}
          </p>
          <p className="cifra text-sm">
            {etiquetaCuota(plan.feeCents, plan.billingPeriod, plan.currency)}
          </p>
        </div>
        {editable && (
          <div className="flex">
            <Button variant="ghost" size="sm" onClick={onEditar} aria-label={`Editar ${plan.name}`}>
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => activar.mutate()}
              disabled={activar.isPending}
              aria-label={plan.active ? `Desactivar ${plan.name}` : `Activar ${plan.name}`}
            >
              {plan.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
          </div>
        )}
      </div>
      {plan.benefits.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-foreground/80">
          {plan.benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <p className="mt-auto pt-3 text-[13px] text-muted-foreground">
        {numero(plan.inscritos)} {plan.inscritos === 1 ? "inscrito" : "inscritos"}
        {plan.treatmentDiscountPercent !== null &&
          ` · ${String(plan.treatmentDiscountPercent).replace(".", ",")} % en tratamientos`}
        {!plan.active && " · desactivado"}
      </p>
    </li>
  );
}

function DialogoPlan({
  clinicId,
  currency,
  plan,
  onCerrar,
}: {
  clinicId: string;
  currency: string;
  plan: PlanMembresia | null;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState({
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    benefitsText: (plan?.benefits ?? []).join("\n"),
    fee: plan?.feeCents ?? (null as number | null),
    billingPeriod: (plan?.billingPeriod ?? "monthly") as PeriodoMembresia,
    discount: plan?.treatmentDiscountPercent ?? (null as number | null),
  });
  const patch = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const errores = validarPlan({
    name: d.name,
    feeCents: d.fee ?? 0,
    billingPeriod: d.billingPeriod,
    treatmentDiscountPercent: d.discount,
  });
  const fn = useServerFn(savePlanMembresia);
  const guardar = useMutation({
    mutationFn: () =>
      fn({
        data: {
          clinicId,
          ...(plan ? { id: plan.id } : {}),
          name: d.name,
          description: d.description.trim() || null,
          benefitsText: d.benefitsText,
          feeCents: d.fee ?? 0,
          billingPeriod: d.billingPeriod,
          treatmentDiscountPercent: d.discount,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["membresias-planes", clinicId] });
      toast.success(plan ? "Plan actualizado" : "Plan creado");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? "Editar plan" : "Nuevo plan de membresía"}</DialogTitle>
          <DialogDescription>
            Cambiar la cuota no afecta a los ya inscritos: conservan la cuota con que se
            inscribieron.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pl-nombre">Nombre *</Label>
            <input
              id="pl-nombre"
              value={d.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Ej: Plan Sonrisa"
              className={INPUT}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pl-cuota">Cuota *</Label>
              <MoneyInput
                id="pl-cuota"
                currency={currency}
                min={0}
                valueCents={d.fee}
                onValueChange={(v) => patch({ fee: v })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-periodo">Se cobra</Label>
              <select
                id="pl-periodo"
                value={d.billingPeriod}
                onChange={(e) => patch({ billingPeriod: e.target.value as PeriodoMembresia })}
                className={INPUT}
              >
                {PERIODOS_MEMBRESIA.map((p) => (
                  <option key={p} value={p}>
                    {ETIQUETA_PERIODO[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-desc">% en tratamientos</Label>
              <input
                id="pl-desc"
                type="number"
                min={0}
                max={100}
                value={d.discount ?? ""}
                onChange={(e) =>
                  patch({ discount: e.target.value === "" ? null : Number(e.target.value) })
                }
                className={INPUT}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-beneficios">Beneficios (uno por línea)</Label>
            <textarea
              id="pl-beneficios"
              rows={4}
              value={d.benefitsText}
              onChange={(e) => patch({ benefitsText: e.target.value })}
              placeholder={"2 limpiezas al año\nUrgencias sin costo de consulta"}
              className={INPUT}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-descripcion">Descripción</Label>
            <input
              id="pl-descripcion"
              value={d.description}
              onChange={(e) => patch({ description: e.target.value })}
              className={INPUT}
            />
          </div>
        </div>
        <DialogFooter className="flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          {errores.length > 0 && (
            <p id="pl-motivo" className="text-xs text-muted-foreground">
              {errores[0]}
            </p>
          )}
          <Button
            onClick={() => guardar.mutate()}
            disabled={errores.length > 0 || guardar.isPending}
            aria-describedby={errores.length > 0 ? "pl-motivo" : undefined}
          >
            {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoGenerar({
  clinicId,
  currency,
  mes,
  onCerrar,
}: {
  clinicId: string;
  currency: string;
  mes: string;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const previaFn = useServerFn(previsualizarCuotasMembresia);
  const previa = useQuery({
    queryKey: ["membresias-previa", clinicId, mes],
    queryFn: () => previaFn({ data: { clinicId, mes } }),
  });
  const filas = previa.data ?? [];
  const total = filas.reduce((s, f) => s + f.amountCents, 0);
  const fn = useServerFn(generarCuotasMembresia);
  const generar = useMutation({
    mutationFn: () => fn({ data: { clinicId, mes } }),
    onSuccess: ({ creadas }) => {
      void qc.invalidateQueries({ queryKey: ["membresias-cuotas", clinicId] });
      void qc.invalidateQueries({ queryKey: ["membresias-previa", clinicId] });
      toast.success(`${numero(creadas)} ${creadas === 1 ? "cuota generada" : "cuotas generadas"}`);
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <AlertDialog open onOpenChange={(o) => !o && onCerrar()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Generar las cuotas de {mesAnio(mes)}</AlertDialogTitle>
          <AlertDialogDescription>
            {previa.isLoading
              ? "Calculando a quién le corresponde cuota…"
              : filas.length === 0
                ? "No hay cuotas nuevas para este mes: o ya se generaron, o ningún inscrito tiene cuota este mes."
                : `Se crean ${numero(filas.length)} ${filas.length === 1 ? "cuota" : "cuotas"} por ${formatMoney(total, currency)}, como cuentas por cobrar. No se le cobra nada a nadie: cada cuota se cobra a mano.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {filas.length > 0 && (
          <ul className="max-h-[40vh] divide-y divide-hairline overflow-y-auto text-sm">
            {filas.map((f) => (
              <li key={f.membershipId} className="flex justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{f.patientName}</span>
                <span className="cifra">{formatMoney(f.amountCents, currency)}</span>
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={filas.length === 0 || generar.isPending}
            onClick={(e) => {
              e.preventDefault();
              generar.mutate();
            }}
          >
            {generar.isPending && <Loader2 className="size-4 animate-spin" />}
            Generar {numero(filas.length)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DialogoAnular({
  clinicId,
  cuota,
  onCerrar,
}: {
  clinicId: string;
  cuota: CuotaMembresia;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const fn = useServerFn(anularCuotaMembresia);
  const anular = useMutation({
    mutationFn: () => fn({ data: { clinicId, id: cuota.id, reason: motivo.trim() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["membresias-cuotas", clinicId] });
      void qc.invalidateQueries({ queryKey: ["payments", clinicId] });
      void qc.invalidateQueries({ queryKey: ["caja-del-dia", clinicId] });
      void qc.invalidateQueries({ queryKey: ["cash-register-breakdown"] });
      toast.success(cuota.status === "paid" ? "Cuota anulada y pago reversado" : "Cuota anulada");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const valido = motivo.trim().length >= 3;
  return (
    <AlertDialog open onOpenChange={(o) => !o && onCerrar()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Anular la cuota de {cuota.patientName}</AlertDialogTitle>
          <AlertDialogDescription>
            {formatMoney(cuota.amountCents, cuota.currency)} ·{" "}
            {etiquetaPeriodoCuota(cuota.periodStart, cuota.periodEnd)}. Una cuota anulada no se
            puede reactivar.
            {cuota.status === "paid" &&
              " El pago de esta cuota se reversa y sale de la caja y del arqueo; devuelve el dinero por fuera."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="an-motivo">Motivo *</Label>
          <input
            id="an-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={INPUT}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <AlertDialogAction
            disabled={!valido || anular.isPending}
            onClick={(e) => {
              e.preventDefault();
              anular.mutate();
            }}
          >
            Anular cuota
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
