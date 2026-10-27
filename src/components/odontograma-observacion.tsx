import { useId, useState } from "react";
import { Loader2, StickyNote } from "lucide-react";

import type { OdontogramMark } from "@/lib/clinical/odontogram";
import { fechaHora } from "@/lib/formato-fecha";

export const MAX_OBSERVACION = 500;

/**
 * Observación libre de la pieza (Ola 9, ODO-08). Se guarda como evento: cada
 * cambio inserta una observación nueva y la anterior queda en la historia
 * (regla 9). "Quitar" inserta una observación vacía.
 */
export function ObservacionDePieza({
  tooth,
  actual,
  puedeEditar,
  enCurso,
  zona,
  onGuardar,
}: {
  tooth: number;
  actual: OdontogramMark | null;
  puedeEditar: boolean;
  enCurso: boolean;
  zona?: string;
  onGuardar: (texto: string | null) => void;
}) {
  const id = useId();
  // El padre lo monta con `key` = pieza + observación vigente: al cambiar de
  // pieza, o cuando la observación cambia, el borrador vuelve a empezar.
  const [texto, setTexto] = useState(actual?.notes ?? "");

  const limpio = texto.trim();
  const cambio = limpio !== (actual?.notes ?? "").trim();

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
      >
        <StickyNote aria-hidden className="size-3.5" /> Observación de la pieza {tooth}
      </label>
      {puedeEditar ? (
        <>
          <textarea
            id={id}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={MAX_OBSERVACION}
            rows={2}
            placeholder="Nota libre: sensibilidad, controlar en la próxima cita, indicación del especialista…"
            className="mt-1.5 w-full rounded-md border border-hairline bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring pointer-coarse:text-base"
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="cifra text-[11px] text-muted-foreground">
              {texto.length}/{MAX_OBSERVACION}
            </span>
            <div className="flex items-center gap-1.5">
              {actual && (
                <button
                  type="button"
                  onClick={() => onGuardar(null)}
                  disabled={enCurso}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50 pointer-coarse:min-h-11"
                >
                  Quitar
                </button>
              )}
              <button
                type="button"
                onClick={() => onGuardar(limpio || null)}
                disabled={enCurso || !cambio || (!limpio && !actual)}
                className="inline-flex items-center gap-1 rounded-md border border-foreground bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background disabled:opacity-40 pointer-coarse:min-h-11"
              >
                {enCurso && <Loader2 className="size-3 animate-spin" />}
                Guardar observación
              </button>
            </div>
          </div>
        </>
      ) : (
        <p id={id} className="mt-1.5 text-sm">
          {actual?.notes ?? <span className="text-muted-foreground">Sin observación.</span>}
        </p>
      )}
      {actual && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {actual.recordedByName ?? "—"} · {fechaHora(actual.recordedAt, zona)} · los cambios quedan
          en la historia.
        </p>
      )}
    </div>
  );
}
