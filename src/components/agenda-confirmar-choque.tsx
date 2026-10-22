import { CalendarX2 } from "lucide-react";

import { describirConflicto, type Conflicto } from "@/components/agenda-conflictos";
import { horaDeMinutos } from "@/components/agenda-hueco";
import { fechaCorta, type Destino } from "@/components/agenda-movimiento";
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
import type { Cita } from "@/lib/clinic-operations/clinic-data";

export interface MovimientoPorConfirmar {
  cita: Cita;
  destino: Destino;
  conflictos: Conflicto[];
  /** Nombre del box en choque, para el texto. */
  box: string | null;
}

/**
 * Confirmación antes de mover una cita a un horario con choque. "Mover
 * igual" sigue el camino de siempre (aviso con Deshacer); "Cancelar" deja la
 * cita donde estaba.
 */
export function ConfirmarMovimientoConChoque({
  pendiente,
  nombreProfesional,
  onConfirmar,
  onCancelar,
}: {
  pendiente: MovimientoPorConfirmar | null;
  nombreProfesional: (id: string) => string;
  onConfirmar: (p: MovimientoPorConfirmar) => void;
  onCancelar: () => void;
}) {
  return (
    <AlertDialog open={pendiente !== null} onOpenChange={(abierto) => !abierto && onCancelar()}>
      <AlertDialogContent>
        {pendiente && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <CalendarX2 className="size-4 shrink-0 text-warning" aria-hidden />
                {pendiente.conflictos.length === 1
                  ? "Ese horario choca con otra cita"
                  : `Ese horario choca con ${pendiente.conflictos.length} citas`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Vas a mover la cita de {pendiente.cita.paciente} al{" "}
                {fechaCorta(pendiente.destino.fecha)} a las{" "}
                {horaDeMinutos(pendiente.destino.inicio)} con{" "}
                {nombreProfesional(pendiente.destino.profesionalId)}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="space-y-1 rounded-lg border border-warning-border/60 bg-warning-soft px-3 py-2 text-sm text-warning">
              {pendiente.conflictos.map((x) => (
                <li key={`${x.tipo}-${x.cita.id}`} className="break-words">
                  {describirConflicto(x, nombreProfesional, pendiente.box)}
                </li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => onConfirmar(pendiente)}>
                Mover igual
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
