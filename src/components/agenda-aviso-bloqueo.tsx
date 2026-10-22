import { Ban } from "lucide-react";

import { boxDe } from "@/components/agenda-conflictos";
import type { FormularioCita } from "@/hooks/use-formulario-cita";
import { HORA_INICIO, type Profesional } from "@/lib/clinic-operations/clinic-data";
import {
  bloqueosQueChocan,
  describirBloqueo,
  partirLocal,
} from "@/lib/clinic-operations/disponibilidad";

/**
 * Aviso del formulario de cita cuando el horario elegido cae en un bloqueo
 * de la agenda (AGE-07): almuerzo, capacitación, vacaciones… Igual que los
 * choques de horario, no impide guardar: avisa ANTES, y el servidor repite
 * el aviso al guardar (`validarHorarioYSolapamiento` → `bloqueos`).
 */
export function AvisoDeBloqueo({
  form,
  profesionales,
}: {
  form: FormularioCita;
  profesionales: readonly Profesional[];
}) {
  const { valores } = form;
  const partes = partirLocal(valores.startsAt);
  if (!partes || !valores.profesionalId || form.excepcionesDelDia.length === 0) return null;
  const profesional = profesionales.find((p) => p.id === valores.profesionalId);
  const bloqueos = bloqueosQueChocan(form.excepcionesDelDia, {
    profesionalId: valores.profesionalId,
    sucursalId: valores.sucursalId || profesional?.sucursalId || null,
    sucursalesDelProfesional: form.sucursalesDeProfesional[valores.profesionalId],
    boxId: valores.boxId || null,
    boxNombre: valores.boxId ? null : boxDe(profesional),
    fecha: partes.fecha,
    inicio: partes.minutos - HORA_INICIO * 60,
    duracion: valores.duracion,
  });
  if (bloqueos.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-lg border border-warning-border/60 bg-warning-soft px-3 py-2 text-xs text-warning"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <Ban className="size-3.5 shrink-0" aria-hidden />
        {bloqueos.length === 1
          ? "Este horario está bloqueado"
          : `Este horario pisa ${bloqueos.length} bloqueos`}
      </p>
      <ul className="mt-1 space-y-0.5">
        {bloqueos.map((b) => (
          <li key={`${b.excepcion.id}-${b.tramo.inicio}`} className="break-words">
            {describirBloqueo(b)}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-foreground/80">
        Puedes guardarla igual. Revisa si hace falta elegir otro horario.
      </p>
    </div>
  );
}
