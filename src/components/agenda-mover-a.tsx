import { useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";

import {
  horasPosibles,
  type BloqueHorario,
  type Destino,
  type Veredicto,
} from "@/components/agenda-movimiento";
import { horaDeMinutos } from "@/components/agenda-hueco";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Cita, Profesional } from "@/lib/clinic-operations/clinic-data";

const CAMPO =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";

/**
 * "Mover a…": la alternativa de un solo puntero al arrastre (WCAG 2.5.7) y
 * la que sirve en el celular sin pulsación larga. Mismo camino que el
 * arrastre: misma validación, mismo aviso, misma cola sin conexión.
 */
export function MoverCitaDialog({
  cita,
  profesionales,
  horarios,
  validar,
  onMover,
  onClose,
}: {
  cita: Cita | null;
  profesionales: Pick<Profesional, "id" | "nombre">[];
  horarios: Record<string, BloqueHorario[]> | undefined;
  validar: (cita: Cita, destino: Destino) => Veredicto;
  onMover: (cita: Cita, destino: Destino) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={cita !== null} onOpenChange={(abierto) => !abierto && onClose()}>
      <DialogContent>
        {cita && (
          <Formulario
            key={cita.id}
            cita={cita}
            profesionales={profesionales}
            horarios={horarios}
            validar={validar}
            onMover={(d) => {
              onMover(cita, d);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  cita,
  profesionales,
  horarios,
  validar,
  onMover,
}: {
  cita: Cita;
  profesionales: Pick<Profesional, "id" | "nombre">[];
  horarios: Record<string, BloqueHorario[]> | undefined;
  validar: (cita: Cita, destino: Destino) => Veredicto;
  onMover: (destino: Destino) => void;
}) {
  const [fecha, setFecha] = useState(cita.fecha);
  const [profesionalId, setProfesionalId] = useState(cita.profesionalId);
  const [inicio, setInicio] = useState(cita.inicio);

  const horas = useMemo(() => {
    const lista = horasPosibles(horarios?.[profesionalId], fecha, cita.duracion);
    // La hora elegida siempre aparece, aunque hoy quede fuera del horario.
    return lista.includes(inicio) ? lista : [...lista, inicio].sort((a, b) => a - b);
  }, [horarios, profesionalId, fecha, cita.duracion, inicio]);

  const destino: Destino = { fecha, inicio, profesionalId };
  const veredicto = validar(cita, destino);
  const sinCambio = !veredicto.ok && veredicto.motivo === "sin-cambio";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (veredicto.ok) onMover(destino);
      }}
    >
      <DialogHeader>
        <DialogTitle>Mover cita</DialogTitle>
        <DialogDescription>
          {cita.paciente} · {cita.tratamiento} · {cita.duracion} min. La hora es la de la sucursal.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="mover-fecha">Fecha</Label>
          <input
            id="mover-fecha"
            type="date"
            required
            value={fecha}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
            className={CAMPO}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mover-hora">Hora</Label>
          <select
            id="mover-hora"
            value={inicio}
            onChange={(e) => setInicio(Number(e.target.value))}
            className={`${CAMPO} tabular-nums`}
          >
            {horas.map((m) => (
              <option key={m} value={m}>
                {horaDeMinutos(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mover-profesional">Profesional</Label>
          <select
            id="mover-profesional"
            value={profesionalId}
            onChange={(e) => setProfesionalId(e.target.value)}
            className={CAMPO}
          >
            {profesionales.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status" className="mt-3 flex min-h-5 items-start gap-1.5 text-sm text-destructive">
        {!veredicto.ok && !sinCambio && (
          <>
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {veredicto.mensaje}
          </>
        )}
      </p>
      <DialogFooter className="mt-2">
        <Button type="submit" disabled={!veredicto.ok}>
          Mover cita
        </Button>
      </DialogFooter>
    </form>
  );
}
