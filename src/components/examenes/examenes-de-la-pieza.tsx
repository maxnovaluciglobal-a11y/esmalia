/**
 * FIC-17 · Enlace desde el odontograma: al elegir una pieza, cuántos
 * exámenes la nombran y un atajo a la pestaña Exámenes filtrada por ella.
 * Usa la misma consulta que la pestaña (queda en caché).
 */
import { ImageIcon } from "lucide-react";

import { useExamenes } from "./use-examenes";

export function ExamenesDeLaPieza({
  clinicId,
  patientId,
  pieza,
  onVer,
}: {
  clinicId: string;
  patientId: string;
  pieza: number;
  onVer: (pieza: number) => void;
}) {
  const { data } = useExamenes(clinicId, patientId);
  const n = (data?.examenes ?? []).filter((e) => !e.archivedAt && e.teeth.includes(pieza)).length;
  if (n === 0) return null;
  return (
    <button
      type="button"
      onClick={() => onVer(pieza)}
      className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-control px-2 py-1.5 text-xs font-medium hover:border-foreground pointer-coarse:min-h-11"
    >
      <ImageIcon className="size-3.5" aria-hidden />
      {n === 1 ? "1 examen de esta pieza" : `${n} exámenes de esta pieza`}
    </button>
  );
}
