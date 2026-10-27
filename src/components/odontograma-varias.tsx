import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";

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
import { Muestra } from "@/components/odontograma-muestra";
import { SEGMENTO, claseOpcion } from "@/lib/clinical/odontograma-texto";
import {
  CONDITION_LABELS,
  MARK_STATUS_LABELS,
  SURFACE_LABELS,
  TOOTH_SURFACES,
  type MarkConservation,
  type MarkStatus,
  type OdontogramMark,
  type ToothCondition,
  type ToothSurface,
} from "@/lib/clinical/odontogram";
import {
  COLORES_SIMBOLOGIA,
  aplicaConservacion,
  condicionesDisponibles,
} from "@/lib/clinical/odontograma-reglas";
import {
  describirAplicacion,
  planDeMarcas,
  type MarcaDelLote,
  type PlanDeLote,
} from "@/lib/clinical/odontograma-seleccion";
import { cn } from "@/lib/utils";

/** Superficies que se ofrecen para un lote: la pieza completa primero. */
const ZONAS: ToothSurface[] = ["whole", ...TOOTH_SURFACES.filter((s) => s !== "whole")];

const ZONA_CORTA: Record<ToothSurface, string> = {
  whole: "Pieza completa",
  mesial: "M",
  distal: "D",
  oclusal: "O/I",
  vestibular: "V",
  lingual: "L/P",
};

/**
 * Editor de varias piezas a la vez (Ola 9, ODO-05). Se elige la zona, el
 * estado y la condición; antes de guardar, una confirmación dice qué se va a
 * registrar, en cuántas piezas y cuáles se omiten. Nada se guarda sin ese
 * segundo clic (acciones masivas con confirmación y cifra afectada).
 */
export function EditorVariasPiezas({
  piezas,
  vigentesPorPieza,
  puedeEditar,
  enCurso,
  bloqueo,
  onQuitar,
  onLimpiar,
  onAplicar,
}: {
  piezas: number[];
  vigentesPorPieza: ReadonlyMap<number, readonly OdontogramMark[]>;
  puedeEditar: boolean;
  enCurso: boolean;
  /** Motivo por el que no se puede guardar ahora (sin conexión, solo lectura). */
  bloqueo: string | null;
  onQuitar: (tooth: number) => void;
  onLimpiar: () => void;
  onAplicar: (marcas: MarcaDelLote[]) => void;
}) {
  const [zona, setZona] = useState<ToothSurface>("whole");
  const [estado, setEstado] = useState<MarkStatus>("existente");
  const [conservacion, setConservacion] = useState<MarkConservation>("bueno");
  const [plan, setPlan] = useState<(PlanDeLote & { condition: ToothCondition }) | null>(null);

  const ordenadas = useMemo(() => [...piezas].sort((a, b) => a - b), [piezas]);
  const condiciones = condicionesDisponibles(zona, estado);

  function preparar(condition: ToothCondition) {
    const nuevo = planDeMarcas({
      piezas: ordenadas,
      surface: zona,
      condition,
      status: estado,
      conservation: conservacion,
      vigentesPorPieza,
    });
    setPlan({ ...nuevo, condition });
  }

  const descripcion = plan
    ? describirAplicacion({ condition: plan.condition, surface: zona, status: estado })
    : "";
  const cifra = plan?.marcas.length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-[34px] leading-none font-medium">
            <span className="cifra text-brand-600">{ordenadas.length}</span>{" "}
            <em className="text-brand-600">piezas</em>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {ordenadas.length < 2
              ? "Toca más piezas para sumarlas (en computador, Ctrl o Cmd + clic; Shift + clic para un rango)."
              : "Lo que elijas abajo se registra igual en todas."}
          </p>
        </div>
        <button
          type="button"
          onClick={onLimpiar}
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
        >
          Terminar selección
        </button>
      </div>

      {ordenadas.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Piezas seleccionadas">
          {ordenadas.map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => onQuitar(t)}
                aria-label={`Quitar la pieza ${t} de la selección`}
                className="cifra inline-flex h-7 items-center gap-1 rounded-full border border-foreground bg-foreground px-2.5 text-xs font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
              >
                {t}
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!puedeEditar ? (
        <p className="text-xs text-muted-foreground">Tu rol no puede modificar el odontograma.</p>
      ) : (
        <div className="space-y-2 border-t border-border pt-3">
          <div className={cn(SEGMENTO, "flex-wrap")} role="group" aria-label="Zona que se marca">
            {ZONAS.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZona(z)}
                aria-pressed={zona === z}
                title={SURFACE_LABELS[z]}
                aria-label={SURFACE_LABELS[z]}
                className={claseOpcion(zona === z)}
              >
                {ZONA_CORTA[z]}
              </button>
            ))}
          </div>
          <div className={SEGMENTO} role="group" aria-label="Estado de la marca">
            {(["existente", "planificado"] as const).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEstado(e)}
                aria-pressed={estado === e}
                className={cn("flex-1", claseOpcion(estado === e))}
              >
                {MARK_STATUS_LABELS[e]}
              </button>
            ))}
          </div>
          {estado === "existente" && (
            <div
              className="flex items-center gap-1 text-[11px] text-muted-foreground"
              role="group"
              aria-label="Estado de conservación del tratamiento"
            >
              <span>Tratamiento en</span>
              {(["bueno", "malo"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setConservacion(c)}
                  aria-pressed={conservacion === c}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium pointer-coarse:min-h-11",
                    conservacion === c
                      ? "border-foreground/30 bg-secondary text-foreground"
                      : "border-hairline hover:text-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor:
                        c === "bueno" ? COLORES_SIMBOLOGIA.azul : COLORES_SIMBOLOGIA.rojo,
                    }}
                  />
                  {c === "bueno" ? "buen estado" : "mal estado"}
                </button>
              ))}
            </div>
          )}
          {bloqueo && <p className="text-xs text-muted-foreground">{bloqueo}</p>}
          <div className="grid max-h-60 grid-cols-2 gap-1.5 overflow-y-auto">
            {condiciones.map((cond) => (
              <button
                key={cond}
                type="button"
                onClick={() => preparar(cond)}
                disabled={enCurso || ordenadas.length === 0 || Boolean(bloqueo)}
                className="flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-secondary/60 disabled:opacity-50 pointer-coarse:min-h-11"
              >
                {cond === "sano" ? (
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-sm border border-hairline"
                    style={{ backgroundColor: COLORES_SIMBOLOGIA.neutro }}
                  />
                ) : (
                  <Muestra
                    marca={{
                      condition: cond,
                      status: estado,
                      conservation: aplicaConservacion(cond, estado) ? conservacion : null,
                    }}
                  />
                )}
                {CONDITION_LABELS[cond]}
              </button>
            ))}
          </div>
          {enCurso && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Guardando…
            </span>
          )}
        </div>
      )}

      <AlertDialog open={plan !== null} onOpenChange={(o) => !o && setPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {plan?.error
                ? "No se puede aplicar"
                : cifra === 0
                  ? "No hay piezas para marcar"
                  : `Registrar en ${cifra} ${cifra === 1 ? "pieza" : "piezas"}`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {plan?.error ? (
                  <p>{plan.error}</p>
                ) : (
                  <>
                    {cifra > 0 && (
                      <p>
                        Vas a registrar <strong className="text-foreground">{descripcion}</strong>{" "}
                        en las piezas{" "}
                        <span className="cifra text-foreground">
                          {plan?.marcas.map((m) => m.toothNumber).join(", ")}
                        </span>
                        . Lo que cada pieza tenía del mismo tipo queda en la historia.
                      </p>
                    )}
                    {(plan?.omitidas.length ?? 0) > 0 && (
                      <p>
                        Se omiten:{" "}
                        {plan?.omitidas.map((o) => `${o.tooth} (${o.motivo})`).join(", ")}.
                      </p>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {plan?.error || cifra === 0 ? "Volver" : "Cancelar"}
            </AlertDialogCancel>
            {!plan?.error && cifra > 0 && (
              <AlertDialogAction
                onClick={() => {
                  if (plan) onAplicar(plan.marcas);
                  setPlan(null);
                }}
              >
                Registrar en {cifra} {cifra === 1 ? "pieza" : "piezas"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
