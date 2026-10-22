import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  formatearPresion,
  leerSignosDelFormulario,
  signosVitalesSchema,
} from "@/lib/clinical/anamnesis";
import { listVitalSigns, recordVitalSigns } from "@/lib/clinical/medical-history.functions";
import { fechaHora, numero } from "@/lib/formato-fecha";
import { TituloSeccion } from "@/components/titulo-seccion";

function formatFechaHora(iso: string, timeZone: string | undefined): string {
  return fechaHora(iso, timeZone);
}

const campoClase =
  "w-full rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";

/**
 * Signos vitales por atención (CLI-10): presión y pulso obligatorios,
 * temperatura opcional. Append-only: un error se corrige registrando otra
 * medición, igual que el resto de los eventos clínicos.
 */
export function VitalSignsCard({
  clinicId,
  patientId,
  puedeEditar,
  timezone,
}: {
  clinicId: string;
  patientId: string;
  puedeEditar: boolean;
  timezone?: string;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const fetchFn = useServerFn(listVitalSigns);
  const saveFn = useServerFn(recordVitalSigns);
  const queryKey = ["vital-signs", clinicId, patientId];
  const query = useQuery({
    queryKey,
    queryFn: () => fetchFn({ data: { clinicId, patientId } }),
  });

  const [abierto, setAbierto] = useState(false);
  const [campos, setCampos] = useState({
    sistolica: "",
    diastolica: "",
    pulso: "",
    temperatura: "",
  });
  const [notas, setNotas] = useState("");
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: {
      clinicId: string;
      patientId: string;
      systolicMmhg: number;
      diastolicMmhg: number;
      heartRateBpm: number;
      temperatureC?: number;
      notes?: string;
    }) => saveFn({ data: payload }),
    onSuccess: () => {
      toast.success("Signos vitales registrados.");
      void queryClient.invalidateQueries({ queryKey });
      setCampos({ sistolica: "", diastolica: "", pulso: "", temperatura: "" });
      setNotas("");
      setAbierto(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudieron registrar."),
  });

  if (query.data && !query.data.disponible) return null;
  const items = query.data?.items ?? [];

  function registrar() {
    const leidos = leerSignosDelFormulario(campos);
    if (
      leidos.systolicMmhg === null ||
      leidos.diastolicMmhg === null ||
      leidos.heartRateBpm === null
    ) {
      setErrorForm("Completa la presión (sistólica y diastólica) y el pulso con números enteros.");
      return;
    }
    if (leidos.temperatureC === null) {
      setErrorForm("La temperatura va con un decimal como máximo, por ejemplo 36,5.");
      return;
    }
    const parsed = signosVitalesSchema.safeParse({
      systolicMmhg: leidos.systolicMmhg,
      diastolicMmhg: leidos.diastolicMmhg,
      heartRateBpm: leidos.heartRateBpm,
      temperatureC: leidos.temperatureC,
      notes: notas.trim() || undefined,
    });
    if (!parsed.success) {
      setErrorForm(
        parsed.error.issues[0]?.message.startsWith("La presión")
          ? parsed.error.issues[0].message
          : "Algún valor está fuera de rango. Revisa la presión, el pulso y la temperatura.",
      );
      return;
    }
    setErrorForm(null);
    mutation.mutate({
      clinicId,
      patientId,
      systolicMmhg: parsed.data.systolicMmhg,
      diastolicMmhg: parsed.data.diastolicMmhg,
      heartRateBpm: parsed.data.heartRateBpm,
      temperatureC: parsed.data.temperatureC,
      notes: parsed.data.notes,
    });
  }

  const set = (k: keyof typeof campos, v: string) => setCampos((c) => ({ ...c, [k]: v }));

  return (
    <section className="card-clinical p-6">
      <div className="flex items-center justify-between gap-3">
        <TituloSeccion icono={<Activity className="size-4 text-muted-foreground" aria-hidden />}>
          Signos vitales
        </TituloSeccion>
        {puedeEditar && !abierto && (
          <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>
            <Plus className="size-3.5" aria-hidden /> Registrar
          </Button>
        )}
      </div>

      {abierto && (
        <div className="mt-4 space-y-3 rounded-lg border border-hairline p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor={`${fid}-sis`} className="text-xs">
                Sistólica (mmHg)
              </Label>
              <input
                id={`${fid}-sis`}
                inputMode="numeric"
                value={campos.sistolica}
                onChange={(e) => set("sistolica", e.target.value)}
                className={campoClase}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fid}-dia`} className="text-xs">
                Diastólica (mmHg)
              </Label>
              <input
                id={`${fid}-dia`}
                inputMode="numeric"
                value={campos.diastolica}
                onChange={(e) => set("diastolica", e.target.value)}
                className={campoClase}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fid}-pulso`} className="text-xs">
                Pulso (lpm)
              </Label>
              <input
                id={`${fid}-pulso`}
                inputMode="numeric"
                value={campos.pulso}
                onChange={(e) => set("pulso", e.target.value)}
                className={campoClase}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fid}-temp`} className="text-xs">
                Temperatura (°C, opcional)
              </Label>
              <input
                id={`${fid}-temp`}
                inputMode="decimal"
                value={campos.temperatura}
                onChange={(e) => set("temperatura", e.target.value)}
                className={campoClase}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${fid}-notas`} className="text-xs">
              Nota (opcional)
            </Label>
            <input
              id={`${fid}-notas`}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={500}
              placeholder="Ej. tomada antes de anestesiar"
              className={campoClase}
            />
          </div>
          {errorForm && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {errorForm}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={registrar} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Guardar medición
            </Button>
          </div>
        </div>
      )}

      {query.isLoading ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Cargando…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">Sin mediciones registradas.</p>
      ) : (
        <ul className="mt-4 divide-y divide-hairline text-xs">
          {items.slice(0, 5).map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
              <span className="text-muted-foreground">
                {formatFechaHora(s.measuredAt, timezone)}
              </span>
              <span className="tabular-nums">
                PA {formatearPresion(s.systolicMmhg, s.diastolicMmhg)} · Pulso {s.heartRateBpm} lpm
                {s.temperatureC != null &&
                  ` · ${numero(s.temperatureC, { minimumFractionDigits: 1 })} °C`}
              </span>
              {s.notes && <span className="w-full text-muted-foreground">{s.notes}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
