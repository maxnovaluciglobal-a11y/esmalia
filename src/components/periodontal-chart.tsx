import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, History, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

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
  createPeriodontalChart,
  getLatestPeriodontalChart,
  getPeriodontalChartById,
  listPeriodontalCharts,
} from "@/lib/clinical/periodontal.functions";
import {
  FDI_ADULT_QUADRANTS,
  FURCATION_LABELS,
  MOBILITY_LABELS,
  PERIODONTAL_POINTS,
  POINT_LABELS,
  SEVERITY_COLORS,
  isMolar,
  pocketSeverity,
  type PeriodontalChart as PeriodontalChartData,
  type PeriodontalPoint,
} from "@/lib/clinical/periodontal";
import { mensajeDeError } from "@/lib/mensaje-error";
import { useZonaClinica } from "@/hooks/use-zona-clinica";
import { fechaHora } from "@/lib/formato-fecha";
import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { TituloSeccion } from "@/components/titulo-seccion";

type Props = {
  clinicId: string;
  patientId: string;
  puedeEditar: boolean;
  userId?: string | null;
};

function formatoFechaHora(iso: string, zona?: string): string {
  return fechaHora(iso, zona);
}

function PocketCell({ mm, bleeding }: { mm: number | null; bleeding: boolean | null }) {
  const severity = pocketSeverity(mm);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="text-xs font-medium"
        style={severity ? { color: SEVERITY_COLORS[severity] } : undefined}
      >
        {mm ?? "—"}
      </span>
      {bleeding && (
        <>
          <span aria-hidden className="size-1.5 rounded-full bg-destructive" title="Sangrado" />
          <span className="sr-only">Sangrado</span>
        </>
      )}
    </div>
  );
}

function ChartTable({ chart }: { chart: PeriodontalChartData }) {
  if (chart.teeth.length === 0) {
    return <p className="text-xs text-muted-foreground">Este sondaje no tiene piezas cargadas.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-hairline text-[11px] text-muted-foreground">
            <th className="py-1.5 pr-3 text-left">Pieza</th>
            {PERIODONTAL_POINTS.map((p) => (
              <th key={p} className="px-1.5 py-1.5 text-center" title={POINT_LABELS[p]}>
                {p.toUpperCase()}
              </th>
            ))}
            <th className="px-2 py-1.5 text-center">Movilidad</th>
            <th className="px-2 py-1.5 text-center">Furca</th>
          </tr>
        </thead>
        <tbody>
          {chart.teeth.map((tooth) => {
            const byPoint = new Map(tooth.points.map((p) => [p.point, p]));
            return (
              <tr key={tooth.toothNumber} className="border-b border-hairline/60">
                <td className="py-1.5 pr-3 font-medium">{tooth.toothNumber}</td>
                {PERIODONTAL_POINTS.map((p) => {
                  const m = byPoint.get(p);
                  return (
                    <td key={p} className="px-1.5 py-1.5">
                      <PocketCell mm={m?.pocketDepthMm ?? null} bleeding={m?.bleeding ?? null} />
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center text-muted-foreground">
                  {tooth.mobility ?? "—"}
                </td>
                <td className="px-2 py-1.5 text-center text-muted-foreground">
                  {isMolar(tooth.toothNumber) ? (tooth.furcation ?? "—") : "N/A"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Profundidad de sondaje en mm por punto (mv, v, dv, ml, l, dl) · el punto rojo indica
        sangrado al sondeo · color según severidad (verde ≤3mm, ámbar 4-5mm, naranja 6mm, rojo
        &gt;6mm).
      </p>
    </div>
  );
}

const ALL_ADULT_TEETH = [
  ...FDI_ADULT_QUADRANTS.upperRight,
  ...FDI_ADULT_QUADRANTS.upperLeft,
  ...FDI_ADULT_QUADRANTS.lowerRight,
  ...FDI_ADULT_QUADRANTS.lowerLeft,
];

type DraftPoint = { pocketDepthMm: string; bleeding: boolean; recessionMm: string };
type DraftTooth = {
  points: Record<PeriodontalPoint, DraftPoint>;
  mobility: string;
  furcation: string;
};

function emptyPoint(): DraftPoint {
  return { pocketDepthMm: "", bleeding: false, recessionMm: "" };
}

function emptyTooth(): DraftTooth {
  return {
    points: Object.fromEntries(PERIODONTAL_POINTS.map((p) => [p, emptyPoint()])) as Record<
      PeriodontalPoint,
      DraftPoint
    >,
    mobility: "",
    furcation: "",
  };
}

function NuevoSondajeDialog({ clinicId, patientId }: { clinicId: string; patientId: string }) {
  const idBase = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Record<number, DraftTooth>>({});
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();
  const createFn = useServerFn(createPeriodontalChart);

  const toothList = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  function toggleTooth(n: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) {
        next.delete(n);
        setDrafts((d) => {
          const { [n]: _removed, ...rest } = d;
          return rest;
        });
      } else {
        next.add(n);
        setDrafts((d) => ({ ...d, [n]: d[n] ?? emptyTooth() }));
      }
      return next;
    });
  }

  function updatePoint(tooth: number, point: PeriodontalPoint, patch: Partial<DraftPoint>) {
    setDrafts((d) => ({
      ...d,
      [tooth]: {
        ...d[tooth],
        points: { ...d[tooth].points, [point]: { ...d[tooth].points[point], ...patch } },
      },
    }));
  }

  function updateTooth(tooth: number, patch: Partial<Pick<DraftTooth, "mobility" | "furcation">>) {
    setDrafts((d) => ({ ...d, [tooth]: { ...d[tooth], ...patch } }));
  }

  const create = useMutation({
    mutationFn: () => {
      const teeth = toothList.map((toothNumber) => {
        const draft = drafts[toothNumber];
        return {
          toothNumber,
          points: PERIODONTAL_POINTS.map((point) => {
            const p = draft.points[point];
            return {
              point,
              pocketDepthMm: p.pocketDepthMm.trim() === "" ? null : Number(p.pocketDepthMm),
              bleeding: p.bleeding,
              recessionMm: p.recessionMm.trim() === "" ? null : Number(p.recessionMm),
            };
          }),
          mobility: draft.mobility === "" ? null : Number(draft.mobility),
          furcation: draft.furcation === "" ? null : Number(draft.furcation),
        };
      });
      return createFn({
        data: { clinicId, patientId, notes: notes.trim() || undefined, teeth },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["periodontal-latest", clinicId, patientId] });
      queryClient.invalidateQueries({ queryKey: ["periodontal-history", clinicId, patientId] });
      toast.success("Sondaje registrado");
      setOpen(false);
      setSelected(new Set());
      setDrafts({});
      setNotes("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const puedeCrear = toothList.length > 0 && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Nuevo sondaje
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Nuevo sondaje periodontal</DialogTitle>
          <DialogDescription>
            Elige las piezas medidas en esta sesión. El sondaje queda registrado como evento
            inmutable — para corregir un dato hay que cargar un sondaje nuevo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Piezas medidas
            </p>
            <div className="flex flex-wrap gap-1">
              {ALL_ADULT_TEETH.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleTooth(n)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                    selected.has(n)
                      ? "border-brand/40 bg-brand-soft text-brand-700"
                      : "border-hairline text-muted-foreground hover:bg-secondary/60"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {toothList.length > 0 && (
            <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
              {toothList.map((tooth) => {
                const draft = drafts[tooth];
                const molar = isMolar(tooth);
                return (
                  <div key={tooth} className="rounded-lg border border-hairline p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold">Pieza {tooth}</p>
                      <button
                        type="button"
                        onClick={() => toggleTooth(tooth)}
                        aria-label={`Quitar pieza ${tooth}`}
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Quitar
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-xs">
                        <thead>
                          <tr className="text-[11px] text-muted-foreground">
                            <th className="pb-1 pr-2 text-left">Punto</th>
                            <th className="px-1.5 pb-1 text-center">PD (mm)</th>
                            <th className="px-1.5 pb-1 text-center">Sangrado</th>
                            <th className="px-1.5 pb-1 text-center">Recesión (mm)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {PERIODONTAL_POINTS.map((point) => (
                            <tr key={point}>
                              <td className="py-1 pr-2 text-muted-foreground">
                                {POINT_LABELS[point]}
                              </td>
                              <td className="px-1.5 py-1 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  max={15}
                                  aria-label={`Pieza ${tooth}, sitio ${point.toUpperCase()}, profundidad en mm`}
                                  value={draft.points[point].pocketDepthMm}
                                  onChange={(e) =>
                                    updatePoint(tooth, point, { pocketDepthMm: e.target.value })
                                  }
                                  className="w-14 rounded-md border border-input bg-transparent px-1.5 py-1 text-center text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                                />
                              </td>
                              <td className="px-1.5 py-1 text-center">
                                <input
                                  type="checkbox"
                                  aria-label={`Pieza ${tooth}, sitio ${point.toUpperCase()}, sangrado`}
                                  checked={draft.points[point].bleeding}
                                  onChange={(e) =>
                                    updatePoint(tooth, point, { bleeding: e.target.checked })
                                  }
                                  className="size-3.5"
                                />
                              </td>
                              <td className="px-1.5 py-1 text-center">
                                <input
                                  type="number"
                                  min={-10}
                                  max={15}
                                  aria-label={`Pieza ${tooth}, sitio ${point.toUpperCase()}, recesión en mm`}
                                  value={draft.points[point].recessionMm}
                                  onChange={(e) =>
                                    updatePoint(tooth, point, { recessionMm: e.target.value })
                                  }
                                  className="w-14 rounded-md border border-input bg-transparent px-1.5 py-1 text-center text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`${idBase}-${tooth}-movilidad`} className="text-xs">
                          Movilidad (Miller)
                        </Label>
                        <select
                          id={`${idBase}-${tooth}-movilidad`}
                          value={draft.mobility}
                          onChange={(e) => updateTooth(tooth, { mobility: e.target.value })}
                          className="rounded-md border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                        >
                          <option value="">Sin dato</option>
                          {[0, 1, 2, 3].map((v) => (
                            <option key={v} value={v}>
                              {MOBILITY_LABELS[v]}
                            </option>
                          ))}
                        </select>
                      </div>
                      {molar && (
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`${idBase}-${tooth}-furca`} className="text-xs">
                            Furca
                          </Label>
                          <select
                            id={`${idBase}-${tooth}-furca`}
                            value={draft.furcation}
                            onChange={(e) => updateTooth(tooth, { furcation: e.target.value })}
                            className="rounded-md border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                          >
                            <option value="">Sin dato</option>
                            {[0, 1, 2, 3].map((v) => (
                              <option key={v} value={v}>
                                {FURCATION_LABELS[v]}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="perio-notes">Notas</Label>
            <textarea
              id="perio-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              placeholder="Observaciones generales de la sesión de sondaje"
            />
          </div>
        </div>

        <DialogFooter>
          <AccionDeshabilitada motivo={toothList.length === 0 && "Elige al menos una pieza."}>
            <Button onClick={() => create.mutate()} disabled={!puedeCrear}>
              {create.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Guardar sondaje
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PeriodontalChart({ clinicId, patientId, puedeEditar }: Props) {
  const zona = useZonaClinica();
  const latestFn = useServerFn(getLatestPeriodontalChart);
  const historyFn = useServerFn(listPeriodontalCharts);
  const byIdFn = useServerFn(getPeriodontalChartById);
  const [viewChartId, setViewChartId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: latest, isLoading } = useQuery({
    queryKey: ["periodontal-latest", clinicId, patientId],
    queryFn: () => latestFn({ data: { clinicId, patientId } }),
  });

  const { data: history = [] } = useQuery({
    queryKey: ["periodontal-history", clinicId, patientId],
    queryFn: () => historyFn({ data: { clinicId, patientId } }),
    enabled: showHistory,
  });

  const { data: viewedChart } = useQuery({
    queryKey: ["periodontal-chart", clinicId, viewChartId],
    queryFn: () => byIdFn({ data: { clinicId, chartId: viewChartId! } }),
    enabled: Boolean(viewChartId),
  });

  const chartToShow = viewChartId ? viewedChart : latest;

  return (
    <div className="card-clinical p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <TituloSeccion>Periodontograma</TituloSeccion>
          <p className="text-xs text-muted-foreground">
            Sondaje de 6 puntos por pieza (AAP): profundidad, sangrado y recesión, más movilidad y
            furca por diente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowHistory((v) => !v);
              setViewChartId(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-secondary/60"
          >
            <History className="size-3" /> {showHistory ? "Ocultar historial" : "Ver historial"}
          </button>
          {puedeEditar && <NuevoSondajeDialog clinicId={clinicId} patientId={patientId} />}
        </div>
      </div>

      {showHistory && (
        <div className="mb-4 flex flex-wrap gap-2">
          {history.length === 0 && (
            <p className="text-xs text-muted-foreground">Aún no hay sondajes registrados.</p>
          )}
          {history.map((h) => (
            <button
              key={h.id}
              onClick={() => setViewChartId(h.id === viewChartId ? null : h.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                h.id === viewChartId || (!viewChartId && latest?.id === h.id)
                  ? "border-brand/40 bg-brand-soft text-brand-700"
                  : "border-hairline text-muted-foreground hover:bg-secondary/60"
              }`}
            >
              <Activity className="size-3" />
              {formatoFechaHora(h.recordedAt, zona)}
              <span className="text-[11px] opacity-70">{h.teethCount} piezas</span>
              {h.bleedingSitesCount > 0 && (
                <span className="rounded-full bg-destructive/10 px-1.5 text-[11px] text-destructive">
                  {h.bleedingSitesCount} con sangrado
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : !chartToShow ? (
        <p className="text-xs text-muted-foreground">
          Este paciente todavía no tiene un periodontograma registrado.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {viewChartId ? "Sondaje" : "Sondaje más reciente"} ·{" "}
            {formatoFechaHora(chartToShow.recordedAt, zona)} ·{" "}
            {chartToShow.recordedByName ?? "Usuario"}
            {chartToShow.notes ? ` · ${chartToShow.notes}` : ""}
          </p>
          <ChartTable chart={chartToShow} />
        </div>
      )}
    </div>
  );
}
