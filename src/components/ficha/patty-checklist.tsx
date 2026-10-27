import { LockKeyhole } from "lucide-react";

import { PattyCara } from "@/components/patty-cara";
import { MENSAJE_IA_PAUSADA } from "@/lib/ai/estado";
import { cn } from "@/lib/utils";

/**
 * Lo que haría Patty con los apuntes de una nota, paso por paso (A+, pieza 4
 * de B). Mientras la IA está en habilitación (`AI_ENABLED` apagado) es una
 * tarjeta estática: los pasos quedan en espera, los botones desactivados y el
 * texto lo dice. Nada se mueve solo (calma de recepción).
 *
 * "No verá nombres ni RUT" está respaldado por `construirContextoPaciente`
 * (lib/ai/minimizacion.ts): el contexto que viaja al modelo va sin nombre,
 * sin documento y con la edad en tramos.
 */
const PASOS = [
  "Quitar nombre y RUT antes de leer",
  "Leer tus apuntes de la consulta",
  "Ordenarlos en S, O, A y P",
  "Dejar el borrador para tu revisión",
] as const;

export function PattyChecklist({
  pieza,
  className,
}: {
  /** Pieza a la que se refieren los apuntes, si se sabe ("de la pieza 36"). */
  pieza?: number | null;
  className?: string;
}) {
  const pasos = pieza
    ? PASOS.map((p) => (p.startsWith("Leer") ? `Leer los apuntes de la pieza ${pieza}` : p))
    : PASOS;
  return (
    <section
      aria-labelledby="patty-checklist-titulo"
      className={cn(
        "grid grid-cols-[34px_1fr] items-start gap-3 rounded-xl border border-dashed border-ai-border bg-ai-soft p-4",
        className,
      )}
    >
      <PattyCara px={34} decorativa />
      <div className="min-w-0">
        <p id="patty-checklist-titulo" className="text-base leading-snug text-foreground">
          <span className="font-semibold text-ai">Patty</span> pasaría tus apuntes sueltos a una
          nota SOAP para que los revises y firmes.
        </p>
        <ol className="mt-2.5 grid gap-1.5 text-sm font-medium text-muted-foreground">
          {pasos.map((paso) => (
            <li key={paso} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-ai"
              />
              {paso}
            </li>
          ))}
        </ol>
        <p className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ai">
          <LockKeyhole className="size-3.5" aria-hidden /> No verá nombres ni RUT
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">{MENSAJE_IA_PAUSADA}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled
            className="h-9 cursor-not-allowed rounded-full border border-ai bg-ai px-4 text-[13px] font-semibold text-ai-foreground opacity-50"
          >
            Aprobar y firmar
          </button>
          <button
            type="button"
            disabled
            className="h-9 cursor-not-allowed rounded-full border border-ai bg-transparent px-4 text-[13px] font-semibold text-ai opacity-50"
          >
            Descartar
          </button>
        </div>
      </div>
    </section>
  );
}
