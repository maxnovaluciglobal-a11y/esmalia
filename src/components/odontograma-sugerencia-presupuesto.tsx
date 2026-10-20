import { useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Receipt, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { BloqueoEscritura } from "@/components/solo-lectura";
import {
  CONDITION_LABELS,
  SURFACE_LABELS,
  type ToothCondition,
  type ToothSurface,
} from "@/lib/clinical/odontogram";
import { formatMoney, type Procedure, type Quote } from "@/lib/finance/finance";
import {
  quitarItemSugerido,
  sumarMarcaAlPresupuesto,
  type ResultadoSugerencia,
} from "@/lib/finance/finance.functions";
import {
  fasesParaSugerir,
  presupuestoBorrador,
  procedimientoSugerido,
} from "@/lib/finance/sugerencia-presupuesto";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/** Marca recién guardada que se ofrece sumar al presupuesto. */
export interface MarcaSugerida {
  id: string;
  tooth: number;
  surface: ToothSurface;
  condition: ToothCondition;
}

interface Props {
  clinicId: string;
  patientId: string;
  currency: string;
  marca: MarcaSugerida;
  quotes: Quote[];
  procedures: Procedure[];
  /** Si el movimiento está permitido (reduced-motion y "Pausar movimiento"). */
  animar: boolean;
  onCerrar: () => void;
  onVerPresupuesto?: () => void;
}

type Fase =
  | { paso: "ofrecer" }
  | { paso: "sumando" }
  | { paso: "sumada"; resultado: ResultadoSugerencia }
  | { paso: "deshaciendo"; resultado: ResultadoSugerencia }
  | { paso: "deshecha" };

const SELECT_CLASS =
  "w-full rounded-md border border-hairline bg-transparent px-2 py-1 text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Sugerencia en línea del popover del odontograma (PR 11 del rediseño A+):
 * al guardar una marca "por realizar", ofrece sumarla a una fase del
 * presupuesto en borrador con el precio del arancel, y deja deshacerlo.
 *
 * Nada se suma sin el clic del profesional. Los colores son los de la marca
 * (ocre) y no los del odontograma: esto es dinero, no una condición clínica.
 */
export function SugerenciaPresupuesto({
  clinicId,
  patientId,
  currency,
  marca,
  quotes,
  procedures,
  animar,
  onCerrar,
  onVerPresupuesto,
}: Props) {
  const queryClient = useQueryClient();
  const sumarFn = useServerFn(sumarMarcaAlPresupuesto);
  const quitarFn = useServerFn(quitarItemSugerido);
  const idFase = useId();
  const idPrestacion = useId();

  const borrador = useMemo(() => presupuestoBorrador(quotes), [quotes]);
  const fases = useMemo(() => fasesParaSugerir(borrador), [borrador]);
  const activas = useMemo(() => procedures.filter((p) => p.isActive), [procedures]);
  const sugerido = useMemo(
    () => procedimientoSugerido(marca.condition, procedures),
    [marca.condition, procedures],
  );

  const [fase, setFase] = useState(fases.sugerida);
  const [procedureId, setProcedureId] = useState<string>(sugerido?.id ?? "");
  const [estado, setEstado] = useState<Fase>({ paso: "ofrecer" });

  const elegido = activas.find((p) => p.id === procedureId) ?? null;
  const zona =
    marca.surface === "whole"
      ? `la ${marca.tooth}`
      : `la ${marca.tooth} (${SURFACE_LABELS[marca.surface].toLowerCase()})`;

  // Un borrador no mueve el saldo: alcanza con refrescar los presupuestos
  // (misma clave que la pestaña de Finanzas, que comparte la caché).
  const refrescar = () =>
    queryClient.invalidateQueries({ queryKey: ["quotes", clinicId, patientId] });

  async function sumar() {
    if (!elegido) return;
    setEstado({ paso: "sumando" });
    try {
      const resultado = await sumarFn({
        data: { clinicId, patientId, markId: marca.id, procedureId: elegido.id, phaseLabel: fase },
      });
      await refrescar();
      setEstado({ paso: "sumada", resultado });
    } catch (error) {
      toast.error(mensajeDeError(error, "No pudimos sumarlo al presupuesto."));
      setEstado({ paso: "ofrecer" });
    }
  }

  async function deshacer(resultado: ResultadoSugerencia) {
    setEstado({ paso: "deshaciendo", resultado });
    try {
      await quitarFn({
        data: {
          clinicId,
          quoteId: resultado.quoteId,
          itemId: resultado.itemId,
          borrarPresupuestoVacio: resultado.presupuestoCreado,
        },
      });
      await refrescar();
      setEstado({ paso: "deshecha" });
    } catch (error) {
      toast.error(mensajeDeError(error, "No pudimos deshacerlo."));
      setEstado({ paso: "sumada", resultado });
    }
  }

  const entrada = animar && "animate-in fade-in-50 slide-in-from-bottom-1 duration-300 ease-out";

  return (
    <section
      aria-label="Sumar al presupuesto"
      className={cn("space-y-2 rounded-md border border-brand/40 bg-brand-soft/60 p-2.5", entrada)}
    >
      {/* Lo que cambia de paso se anuncia sin mover el foco. */}
      <div aria-live="polite" className="space-y-2">
        {(estado.paso === "ofrecer" || estado.paso === "sumando") && (
          <>
            <p className="flex items-start gap-1.5 text-xs">
              <Receipt aria-hidden className="mt-0.5 size-3.5 shrink-0 text-brand-700" />
              <span>
                Quedó <strong className="font-semibold">por realizar</strong> en {zona}:{" "}
                {CONDITION_LABELS[marca.condition].toLowerCase()}. ¿La sumas al presupuesto?
              </span>
            </p>

            {activas.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Tu arancel todavía no tiene prestaciones. Agrégalas en Aranceles para presupuestar
                desde el odontograma.
              </p>
            ) : (
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-[11px]">
                <label htmlFor={idPrestacion} className="text-muted-foreground">
                  Prestación
                </label>
                <select
                  id={idPrestacion}
                  value={procedureId}
                  onChange={(e) => setProcedureId(e.target.value)}
                  className={SELECT_CLASS}
                  disabled={estado.paso === "sumando"}
                >
                  {!sugerido && <option value="">Elige del arancel…</option>}
                  {activas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {formatMoney(p.defaultPriceCents, currency)}
                    </option>
                  ))}
                </select>
                <label htmlFor={idFase} className="text-muted-foreground">
                  Fase
                </label>
                <select
                  id={idFase}
                  value={fase}
                  onChange={(e) => setFase(e.target.value)}
                  className={SELECT_CLASS}
                  disabled={estado.paso === "sumando"}
                >
                  {fases.opciones.map((f) => (
                    <option key={f} value={f}>
                      {f === fases.nueva && borrador ? `${f} (nueva)` : f}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              {borrador
                ? `Va al presupuesto en borrador ${borrador.number}.`
                : "Se crea un presupuesto en borrador para este paciente."}{" "}
              {elegido && (
                <>
                  Arancel sugerido:{" "}
                  <span className="tabular-nums text-foreground">
                    {formatMoney(elegido.defaultPriceCents, currency)}
                  </span>
                  .
                </>
              )}
            </p>

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <BloqueoEscritura>
                <button
                  type="button"
                  onClick={() => void sumar()}
                  disabled={!elegido || estado.paso === "sumando"}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-500 disabled:opacity-50"
                >
                  {estado.paso === "sumando" && <Loader2 className="size-3 animate-spin" />}
                  Sumar a {fase}
                </button>
              </BloqueoEscritura>
              <button
                type="button"
                onClick={onCerrar}
                disabled={estado.paso === "sumando"}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                Ahora no
              </button>
            </div>
          </>
        )}

        {(estado.paso === "sumada" || estado.paso === "deshaciendo") && (
          <>
            <p className="flex items-start gap-1.5 text-xs">
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>
                Se sumó a la {estado.resultado.phaseLabel} del presupuesto{" "}
                {estado.resultado.quoteNumber}: {estado.resultado.nameSnapshot} en la {marca.tooth},{" "}
                <span className="tabular-nums">
                  {formatMoney(estado.resultado.unitPriceCents, currency)}
                </span>
                . Total del presupuesto:{" "}
                <span className="tabular-nums font-semibold">
                  {formatMoney(estado.resultado.quoteTotalCents, currency)}
                </span>
                .
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void deshacer(estado.resultado)}
                disabled={estado.paso === "deshaciendo"}
                className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 text-xs font-medium hover:bg-secondary/60 disabled:opacity-50"
              >
                {estado.paso === "deshaciendo" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Undo2 aria-hidden className="size-3" />
                )}
                Deshacer
              </button>
              {onVerPresupuesto && (
                <button
                  type="button"
                  onClick={onVerPresupuesto}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand/12"
                >
                  Ver presupuesto
                </button>
              )}
              <button
                type="button"
                onClick={onCerrar}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                Listo
              </button>
            </div>
          </>
        )}

        {estado.paso === "deshecha" && (
          <>
            <p className="text-xs">
              Se quitó del presupuesto. La marca sigue por realizar en el odontograma.
            </p>
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            >
              Listo
            </button>
          </>
        )}
      </div>
    </section>
  );
}
