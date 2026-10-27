import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { ErrorDeCarga } from "@/components/estado-error";
import { PANEL_LISTA } from "@/components/a-plus/lista";
import { BarraFina } from "@/components/reportes/aplus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ORTHO_CASE_STATUS_LABELS,
  ORTHO_STAGES,
  ORTHO_STAGE_LABELS,
  ORTHO_SYSTEMS,
  ORTHO_SYSTEM_LABELS,
  progresoOrtodoncia,
  type OrthoCaseConSeguimiento,
  type OrthoStage,
  type OrthoSystem,
} from "@/lib/clinical/ortho";
import { nombreDelSistema, textoCambioAlineador } from "@/lib/clinical/ortho-vistas";
import {
  addOrthoStage,
  advanceOrthoAligner,
  listOrthoCases,
  listOrthoStages,
  updateOrthoTracking,
} from "@/lib/clinical/ortho.functions";
import { formatoFecha } from "@/lib/clinic-operations/clinic-data";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Chip de la etapa vigente (ORT-05). */
export function ChipEtapa({ stage, className }: { stage: OrthoStage | null; className?: string }) {
  if (!stage) return null;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border border-hairline bg-secondary/60 px-2 text-xs font-semibold text-foreground/80",
        className,
      )}
    >
      {ORTHO_STAGE_LABELS[stage]}
    </span>
  );
}

/**
 * ORT-04: barra de progreso en cobalto (es un dato) con el porcentaje y los
 * meses. Sin con qué calcular el porcentaje, muestra solo los meses.
 */
export function ProgresoOrto({
  caso,
  hoy,
  className,
}: {
  caso: OrthoCaseConSeguimiento;
  hoy: string;
  className?: string;
}) {
  const p = progresoOrtodoncia(caso, hoy);
  const alineadores =
    caso.alignerTotal && caso.alignerCurrent !== null
      ? `alineador ${caso.alignerCurrent} de ${caso.alignerTotal}`
      : null;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          <span className="cifra text-foreground">{p.mesesTranscurridos}</span>
          {p.mesesEstimados !== null ? (
            <>
              {" de "}
              <span className="cifra text-foreground">{p.mesesEstimados}</span> meses
            </>
          ) : (
            ` ${p.mesesTranscurridos === 1 ? "mes" : "meses"}`
          )}
          {alineadores && ` · ${alineadores}`}
        </span>
        <span className="cifra font-semibold text-cobalt-ink">
          {p.porcentaje === null ? "Sin término estimado" : `${p.porcentaje} %`}
        </span>
      </div>
      {p.porcentaje !== null && (
        <BarraFina pct={p.porcentaje} color="var(--cobalt)" className="mt-1.5 h-1.5" />
      )}
    </div>
  );
}

function numeroODefecto(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * ORT-02/03/05: sistema, alineadores, término estimado y etapas de un caso.
 * El historial de etapas solo crece (evento versionado).
 */
export function SeguimientoDialog({
  clinicId,
  caso,
  hoy,
  puedeEditar,
}: {
  clinicId: string;
  caso: OrthoCaseConSeguimiento;
  hoy: string;
  puedeEditar: boolean;
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState<OrthoSystem | "">("");
  const [expectedEnd, setExpectedEnd] = useState("");
  const [actual, setActual] = useState("");
  const [total, setTotal] = useState("");
  const [cadaDias, setCadaDias] = useState("");
  const [desde, setDesde] = useState("");
  const [nuevaEtapa, setNuevaEtapa] = useState<OrthoStage>("alineacion");
  const [etapaDesde, setEtapaDesde] = useState(hoy);
  const queryClient = useQueryClient();
  const updateFn = useServerFn(updateOrthoTracking);
  const advanceFn = useServerFn(advanceOrthoAligner);
  const fetchStages = useServerFn(listOrthoStages);
  const addStageFn = useServerFn(addOrthoStage);

  useEffect(() => {
    if (!open) return;
    setSystem(caso.system ?? (caso.kind === "aligners" ? "alineadores" : ""));
    setExpectedEnd(caso.expectedEndOn ?? "");
    setActual(caso.alignerCurrent?.toString() ?? "");
    setTotal(caso.alignerTotal?.toString() ?? "");
    setCadaDias(caso.alignerChangeDays?.toString() ?? "");
    setDesde(caso.alignerChangedOn ?? "");
    const siguiente = caso.stage
      ? ORTHO_STAGES[Math.min(ORTHO_STAGES.indexOf(caso.stage) + 1, ORTHO_STAGES.length - 1)]
      : "alineacion";
    setNuevaEtapa(siguiente);
    setEtapaDesde(hoy);
  }, [open, caso, hoy]);

  const {
    data: etapas = [],
    isError: etapasConError,
    refetch: reintentarEtapas,
  } = useQuery({
    queryKey: ["ortho-stages", caso.id],
    enabled: open,
    queryFn: () => fetchStages({ data: { clinicId, orthoCaseId: caso.id } }),
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ["ortho-cases", clinicId] });
    queryClient.invalidateQueries({ queryKey: ["ortho-stages", caso.id] });
  };

  const esAlineadores = system === "alineadores";
  const nActual = numeroODefecto(actual);
  const nTotal = numeroODefecto(total);
  const nCada = numeroODefecto(cadaDias);
  const numerosValidos =
    !Number.isNaN(nActual) &&
    !Number.isNaN(nTotal) &&
    !Number.isNaN(nCada) &&
    (nActual === null || nTotal === null || nActual <= nTotal);

  const guardar = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          clinicId,
          caseId: caso.id,
          system: system || null,
          expectedEndOn: expectedEnd || null,
          alineadores: esAlineadores
            ? {
                alignerCurrent: nActual,
                alignerTotal: nTotal,
                alignerChangeDays: nCada,
                alignerChangedOn: desde || null,
              }
            : {},
        },
      }),
    onSuccess: () => {
      refrescar();
      toast.success("Seguimiento guardado.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const avanzar = useMutation({
    mutationFn: () => advanceFn({ data: { clinicId, caseId: caso.id, changedOn: hoy } }),
    onSuccess: (r) => {
      refrescar();
      setActual(String(r.alignerCurrent));
      setDesde(hoy);
      toast.success(`Pasó al alineador ${r.alignerCurrent}.`);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const agregarEtapa = useMutation({
    mutationFn: () =>
      addStageFn({
        data: { clinicId, orthoCaseId: caso.id, stage: nuevaEtapa, startedOn: etapaDesde },
      }),
    onSuccess: () => {
      refrescar();
      toast.success(`Etapa registrada: ${ORTHO_STAGE_LABELS[nuevaEtapa]}.`);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const ultimo = caso.alignerTotal !== null && (caso.alignerCurrent ?? 0) >= caso.alignerTotal;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Seguimiento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Seguimiento — {caso.patientName}</DialogTitle>
          <DialogDescription>
            {nombreDelSistema(caso)} · Desde {formatoFecha(caso.startedOn)} ·{" "}
            {ORTHO_CASE_STATUS_LABELS[caso.status]}
          </DialogDescription>
        </DialogHeader>

        <ProgresoOrto caso={caso} hoy={hoy} />

        <fieldset disabled={!puedeEditar} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-sistema`}>Sistema</Label>
              <select
                id={`${fid}-sistema`}
                value={system}
                onChange={(e) => setSystem(e.target.value as OrthoSystem | "")}
                className={INPUT}
              >
                <option value="">Sin especificar</option>
                {ORTHO_SYSTEMS.map((s) => (
                  <option key={s} value={s}>
                    {ORTHO_SYSTEM_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-termino`}>Término estimado</Label>
              <input
                id={`${fid}-termino`}
                type="date"
                value={expectedEnd}
                min={caso.startedOn}
                onChange={(e) => setExpectedEnd(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>

          {esAlineadores && (
            <div className="space-y-3 rounded-[12px] border border-hairline p-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${fid}-actual`}>Actual</Label>
                  <input
                    id={`${fid}-actual`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                    className={cn(INPUT, "cifra")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fid}-total`}>Total</Label>
                  <input
                    id={`${fid}-total`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    className={cn(INPUT, "cifra")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fid}-cada`}>Cada (días)</Label>
                  <input
                    id={`${fid}-cada`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={60}
                    value={cadaDias}
                    onChange={(e) => setCadaDias(e.target.value)}
                    className={cn(INPUT, "cifra")}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[10rem] flex-1 space-y-1.5">
                  <Label htmlFor={`${fid}-desde`}>Usa el actual desde</Label>
                  <input
                    id={`${fid}-desde`}
                    type="date"
                    value={desde}
                    onChange={(e) => setDesde(e.target.value)}
                    className={INPUT}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={avanzar.isPending || ultimo || caso.system !== "alineadores"}
                  onClick={() => avanzar.mutate()}
                  title={
                    caso.system !== "alineadores"
                      ? "Guarda primero el sistema de alineadores."
                      : undefined
                  }
                >
                  {avanzar.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Cambió hoy al siguiente
                </Button>
              </div>
              {nActual !== null &&
                nTotal !== null &&
                !Number.isNaN(nActual) &&
                nActual > nTotal && (
                  <p className="text-xs font-semibold text-destructive">
                    El alineador actual no puede pasar del total.
                  </p>
                )}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => guardar.mutate()}
              disabled={!numerosValidos || guardar.isPending}
            >
              {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Guardar seguimiento
            </Button>
          </div>
        </fieldset>

        <section
          aria-labelledby={`${fid}-etapas`}
          className="space-y-2 border-t border-hairline pt-3"
        >
          <h3 id={`${fid}-etapas`} className="font-display text-xl font-medium">
            Etapas
          </h3>
          {puedeEditar && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[9rem] flex-1 space-y-1.5">
                <Label htmlFor={`${fid}-etapa`}>Pasa a</Label>
                <select
                  id={`${fid}-etapa`}
                  value={nuevaEtapa}
                  onChange={(e) => setNuevaEtapa(e.target.value as OrthoStage)}
                  className={INPUT}
                >
                  {ORTHO_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {ORTHO_STAGE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[9rem] flex-1 space-y-1.5">
                <Label htmlFor={`${fid}-etapa-desde`}>Desde</Label>
                <input
                  id={`${fid}-etapa-desde`}
                  type="date"
                  value={etapaDesde}
                  onChange={(e) => setEtapaDesde(e.target.value)}
                  className={INPUT}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => agregarEtapa.mutate()}
                disabled={!etapaDesde || agregarEtapa.isPending}
              >
                {agregarEtapa.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Registrar etapa
              </Button>
            </div>
          )}
          {etapasConError && (
            <ErrorDeCarga onReintentar={reintentarEtapas} mensaje="No pudimos cargar las etapas." />
          )}
          {!etapasConError && etapas.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin etapas registradas todavía.</p>
          )}
          {etapas.length > 0 && (
            <ol className="space-y-1.5">
              {etapas.map((e, i) => (
                <li
                  key={e.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2 text-sm",
                    i === 0 && "border-foreground/30",
                  )}
                >
                  <span className="font-medium">
                    {ORTHO_STAGE_LABELS[e.stage]}
                    {i === 0 && (
                      <span className="ml-2 text-xs font-semibold text-muted-foreground">
                        Vigente
                      </span>
                    )}
                  </span>
                  <span className="cifra text-xs text-muted-foreground">
                    {formatoFecha(e.startedOn)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <DialogFooter className="sm:justify-start">
          <p className="text-xs text-muted-foreground">
            El historial de etapas no se edita: si una quedó mal, registra la correcta.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ORT-06: la ortodoncia en la ficha del paciente. Si no tiene casos no
 * ocupa lugar; si tiene, muestra cada uno con sistema, etapa, progreso y
 * próximo cambio de alineador, y lleva a la lista de Ortodoncia.
 */
export function OrtodonciaEnLaFicha({
  clinicId,
  patientId,
  hoy,
  puedeEditar,
}: {
  clinicId: string;
  patientId: string;
  hoy: string;
  puedeEditar: boolean;
}) {
  const fetchCases = useServerFn(listOrthoCases);
  const { data: casos = [] } = useQuery({
    queryKey: ["ortho-cases", clinicId, "paciente", patientId],
    queryFn: () => fetchCases({ data: { clinicId, patientId } }),
  });
  if (casos.length === 0) return null;

  return (
    <section aria-labelledby="ficha-ortodoncia" className={cn(PANEL_LISTA, "p-5")}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="ficha-ortodoncia" className="font-display text-2xl font-medium">
          Tratamiento de <em className="text-brand-600">ortodoncia</em>
        </h3>
        <Link
          to="/ortodoncia"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          Ver todos los casos <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <ul className="divide-y divide-hairline">
        {casos.map((c) => {
          const cambio = textoCambioAlineador(c, hoy);
          return (
            <li key={c.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {nombreDelSistema(c)}
                  <ChipEtapa stage={c.stage} />
                  <span className="text-xs font-normal text-muted-foreground">
                    {ORTHO_CASE_STATUS_LABELS[c.status]} · desde {formatoFecha(c.startedOn)}
                  </span>
                </p>
                <SeguimientoDialog
                  clinicId={clinicId}
                  caso={c}
                  hoy={hoy}
                  puedeEditar={puedeEditar}
                />
              </div>
              <ProgresoOrto caso={c} hoy={hoy} />
              {cambio && c.status === "active" && (
                <p
                  className={cn(
                    "text-xs",
                    cambio.vencido ? "font-semibold text-destructive" : "text-muted-foreground",
                  )}
                >
                  {cambio.texto}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
