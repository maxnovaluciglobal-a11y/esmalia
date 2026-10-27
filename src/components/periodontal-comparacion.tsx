import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Equal } from "lucide-react";

import { ChipFiltro } from "@/components/a-plus/lista";
import { useZonaClinica } from "@/hooks/use-zona-clinica";
import { getPeriodontalChartById } from "@/lib/clinical/periodontal.functions";
import { POINT_LABELS, type PeriodontalChartSummary } from "@/lib/clinical/periodontal";
import {
  ETIQUETA_TENDENCIA,
  UMBRAL_CAMBIO_MM,
  compararExamenes,
  type SitioComparado,
  type Tendencia,
} from "@/lib/clinical/periodontal-nic";
import { fechaHora } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

const ICONO: Record<Tendencia, typeof ArrowDown> = {
  mejoro: ArrowDown,
  empeoro: ArrowUp,
  estable: Equal,
};

/** Forma + ícono + texto (nunca solo color), con tokens de estado. */
const TONO: Record<Tendencia, string> = {
  mejoro: "border-success-border bg-success-soft text-success",
  empeoro: "border-destructive-border bg-destructive-soft text-destructive",
  estable: "border-border bg-muted text-muted-foreground",
};

const SELECT =
  "h-9 w-full rounded-full border border-control bg-card px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11 pointer-coarse:text-base";

function signo(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Comparar dos exámenes periodontales (Ola 9, PER-03): se eligen dos sondajes
 * y se ve, sitio por sitio, si la inserción mejoró o empeoró. Decide el NIC
 * cuando los dos exámenes tienen la recesión del sitio; si no, la profundidad.
 * Un cambio menor a 2 mm se lee "sin cambio" (error de la sonda manual).
 */
export function ComparacionPeriodontal({
  clinicId,
  examenes,
}: {
  clinicId: string;
  /** Historial del paciente, el más reciente primero (como lo devuelve el servidor). */
  examenes: PeriodontalChartSummary[];
}) {
  const zona = useZonaClinica();
  const idA = useId();
  const idB = useId();
  const byIdFn = useServerFn(getPeriodontalChartById);
  const [aId, setAId] = useState(examenes[1]?.id ?? "");
  const [bId, setBId] = useState(examenes[0]?.id ?? "");
  const [filtro, setFiltro] = useState<Tendencia | null>(null);

  // Misma clave que el visor de un sondaje: comparten la caché.
  const a = useQuery({
    queryKey: ["periodontal-chart", clinicId, aId],
    queryFn: () => byIdFn({ data: { clinicId, chartId: aId } }),
    enabled: Boolean(aId),
  });
  const b = useQuery({
    queryKey: ["periodontal-chart", clinicId, bId],
    queryFn: () => byIdFn({ data: { clinicId, chartId: bId } }),
    enabled: Boolean(bId),
  });

  const comparacion = useMemo(
    () => (a.data && b.data && aId !== bId ? compararExamenes(a.data, b.data) : null),
    [a.data, b.data, aId, bId],
  );
  const porPieza = useMemo(() => {
    const map = new Map<number, SitioComparado[]>();
    for (const s of comparacion?.sitios ?? []) {
      if (filtro && s.tendencia !== filtro) continue;
      const lista = map.get(s.toothNumber) ?? [];
      lista.push(s);
      map.set(s.toothNumber, lista);
    }
    return [...map.entries()];
  }, [comparacion, filtro]);

  const fecha = (id: string) => {
    const e = examenes.find((x) => x.id === id);
    return e ? fechaHora(e.recordedAt, zona) : "—";
  };
  const r = comparacion?.resumen;

  return (
    <section
      aria-labelledby="perio-comparar-titulo"
      className="mt-5 rounded-xl border border-border bg-background p-4"
    >
      <h4
        id="perio-comparar-titulo"
        className="font-display text-[24px] leading-none font-medium tracking-[-0.01em]"
      >
        Comparar <em className="text-brand-600">exámenes</em>
      </h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={idA} className="mb-1 block text-xs font-semibold text-muted-foreground">
            Examen A
          </label>
          <select id={idA} value={aId} onChange={(e) => setAId(e.target.value)} className={SELECT}>
            {examenes.map((e) => (
              <option key={e.id} value={e.id}>
                {fechaHora(e.recordedAt, zona)} · {e.teethCount} piezas
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={idB} className="mb-1 block text-xs font-semibold text-muted-foreground">
            Examen B
          </label>
          <select id={idB} value={bId} onChange={(e) => setBId(e.target.value)} className={SELECT}>
            {examenes.map((e) => (
              <option key={e.id} value={e.id}>
                {fechaHora(e.recordedAt, zona)} · {e.teethCount} piezas
              </option>
            ))}
          </select>
        </div>
      </div>

      {aId === bId && (
        <p className="mt-3 text-sm text-muted-foreground">Elige dos exámenes distintos.</p>
      )}
      {aId !== bId && (a.isLoading || b.isLoading) && (
        <p className="mt-3 text-sm text-muted-foreground">Cargando los exámenes…</p>
      )}

      {comparacion && r && (
        <div aria-live="polite">
          <p className="mt-3 text-sm text-muted-foreground">
            Antes: <span className="cifra text-foreground">{fecha(comparacion.antesId)}</span> ·
            Después: <span className="cifra text-foreground">{fecha(comparacion.despuesId)}</span>.
            Cambio de {UMBRAL_CAMBIO_MM} mm o más para contar como mejora o empeoramiento.
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Dato etiqueta="Sitios comparados" valor={String(r.comparables)} />
            <Dato
              etiqueta="Profundidad media"
              valor={`${r.pdMedioAntes ?? "—"} → ${r.pdMedioDespues ?? "—"} mm`}
            />
            <Dato
              etiqueta="Sangrado al sondaje"
              valor={`${r.sangradoAntesPct ?? "—"}% → ${r.sangradoDespuesPct ?? "—"}%`}
            />
            <Dato
              etiqueta="Bolsas de 4 mm o más"
              valor={`${r.bolsas4Antes} → ${r.bolsas4Despues}`}
            />
          </dl>

          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar sitios">
            <ChipFiltro activo={filtro === null} onClick={() => setFiltro(null)}>
              Todos <span className="cifra font-normal">{r.comparables}</span>
            </ChipFiltro>
            {(
              [
                ["empeoro", r.empeoraron],
                ["mejoro", r.mejoraron],
                ["estable", r.estables],
              ] as const
            ).map(([t, n]) => {
              const Icono = ICONO[t];
              return (
                <ChipFiltro
                  key={t}
                  activo={filtro === t}
                  onClick={() => setFiltro(filtro === t ? null : t)}
                >
                  <Icono aria-hidden className="size-3.5" />
                  {ETIQUETA_TENDENCIA[t]} <span className="cifra font-normal">{n}</span>
                </ChipFiltro>
              );
            })}
          </div>
          {(r.soloAntes > 0 || r.soloDespues > 0) && (
            <p className="mt-2 text-xs text-muted-foreground">
              No se comparan {r.soloAntes + r.soloDespues} sitios medidos en uno solo de los dos
              exámenes.
            </p>
          )}

          {porPieza.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {r.comparables === 0
                ? "Los dos exámenes no tienen sitios medidos en común."
                : "Ningún sitio con ese resultado."}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <caption className="sr-only">
                  Cambio por sitio entre los dos exámenes: profundidad, nivel de inserción y
                  resultado
                </caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Pieza
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Sitio
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">
                      Profundidad
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">
                      NIC
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      Resultado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {porPieza.map(([tooth, sitios]) =>
                    sitios.map((s, i) => {
                      const Icono = ICONO[s.tendencia];
                      return (
                        <tr
                          key={`${tooth}-${s.point}`}
                          className={cn(
                            "border-b border-hairline/60",
                            i === 0 && "border-t border-hairline",
                          )}
                        >
                          <th scope="row" className="py-1.5 pr-3 text-left font-semibold">
                            {i === 0 ? <span className="cifra">{tooth}</span> : null}
                          </th>
                          <td
                            className="py-1.5 pr-3 text-muted-foreground"
                            title={POINT_LABELS[s.point]}
                          >
                            {s.point.toUpperCase()}
                          </td>
                          <td className="cifra py-1.5 pr-3 text-right">
                            {s.pdAntes} → {s.pdDespues}{" "}
                            <span className="text-muted-foreground">({signo(s.deltaPd)})</span>
                          </td>
                          <td className="cifra py-1.5 pr-3 text-right">
                            {s.deltaNic === null ? (
                              <span
                                className="text-muted-foreground"
                                title="Falta la recesión en alguno de los dos exámenes"
                              >
                                —
                              </span>
                            ) : (
                              <>
                                {s.nicAntes} → {s.nicDespues}{" "}
                                <span className="text-muted-foreground">({signo(s.deltaNic)})</span>
                              </>
                            )}
                          </td>
                          <td className="py-1.5">
                            <span
                              className={cn(
                                "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold",
                                TONO[s.tendencia],
                              )}
                            >
                              <Icono aria-hidden className="size-3" />
                              {ETIQUETA_TENDENCIA[s.tendencia]}
                              {s.base === "pd" && s.tendencia !== "estable" && (
                                <span className="font-normal">· por profundidad</span>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="cifra mt-0.5 text-[15px] font-semibold">{valor}</dd>
    </div>
  );
}
