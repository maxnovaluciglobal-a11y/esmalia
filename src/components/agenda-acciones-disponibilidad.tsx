import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Ban, CalendarClock, CalendarPlus, Settings2, UserX } from "lucide-react";

import { BloqueoDialog, type ModoBloqueo } from "@/components/agenda-bloqueo-dialog";
import { ReprogramarAusenciaDialog } from "@/components/agenda-reprogramar-ausencia";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Profesional, Sucursal } from "@/lib/clinic-operations/clinic-data";
import type { ExcepcionAgenda } from "@/lib/clinic-operations/disponibilidad";

/**
 * Botón "Disponibilidad" de la barra de la agenda (Ola 2): bloquear horario
 * (AGE-07), abrir horario excepcional (AGE-08), ausencia del profesional
 * (MKT-02) y el atajo a la configuración (AGE-10).
 *
 * Solo lo ve quien tiene `settings:manage` (owner y admin), que es lo mismo
 * que exige la RLS de `agenda_exceptions` (`can_manage_clinic`).
 */
export function AccionesDeDisponibilidad({
  clinicId,
  clinicName,
  fecha,
  hoy,
  sucursales,
  profesionales,
  puedeMover,
}: {
  clinicId: string;
  clinicName: string | undefined;
  /** Fecha que mira la agenda: con ella arranca el formulario. */
  fecha: string;
  hoy: string;
  sucursales: readonly Sucursal[];
  profesionales: readonly Profesional[];
  /** `agenda:manage`, para mover las citas afectadas. */
  puedeMover: boolean;
}) {
  const [modo, setModo] = useState<ModoBloqueo | null>(null);
  const [ausencia, setAusencia] = useState<ExcepcionAgenda | null>(null);
  const atienden = profesionales.filter((p) => p.atiende !== false);

  return (
    <>
      <DropdownMenu>
        <BloqueoEscritura>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="pointer-coarse:min-h-11">
              <CalendarClock aria-hidden /> Disponibilidad
            </Button>
          </DropdownMenuTrigger>
        </BloqueoEscritura>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => setModo("bloqueo")}>
            <Ban aria-hidden /> Bloquear horario
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setModo("apertura")}>
            <CalendarPlus aria-hidden /> Abrir horario excepcional
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setModo("ausencia")}>
            <UserX aria-hidden /> Ausencia del profesional
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/configuracion-de-agenda">
              <Settings2 aria-hidden /> Configurar la agenda
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BloqueoDialog
        clinicId={clinicId}
        modo={modo ?? "bloqueo"}
        open={modo !== null}
        onOpenChange={(o) => !o && setModo(null)}
        sucursales={sucursales}
        profesionales={atienden}
        fechaInicial={fecha}
        onAusenciaCreada={setAusencia}
      />
      <ReprogramarAusenciaDialog
        clinicId={clinicId}
        clinicName={clinicName}
        excepcion={ausencia}
        hoy={hoy}
        profesionales={profesionales}
        puedeMover={puedeMover}
        onClose={() => setAusencia(null)}
      />
    </>
  );
}
