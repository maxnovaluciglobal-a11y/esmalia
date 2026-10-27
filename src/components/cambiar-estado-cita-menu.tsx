import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Loader2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmarAccion } from "@/components/confirmar-accion";
import { useOfflineMutation } from "@/hooks/use-offline-mutation";
import { setAppointmentStatus } from "@/lib/clinic-operations/appointments.functions";
import { etiquetaEstado, type EstadoCita } from "@/lib/clinic-operations/clinic-data";
import { claseEstadoBadge } from "@/components/cita-acciones";
import { cn } from "@/lib/utils";

/**
 * Mismos 6 valores que el enum de `setAppointmentStatus`
 * (appointments.functions.ts). "cancelada" no está en `EstadoCita`
 * (clinic-data.ts) porque `listAppointments` excluye las citas canceladas de
 * la agenda — pero sigue siendo un destino válido desde este menú, así que
 * se agrega acá nomás.
 */
const opcionesEstadoCita: { value: EstadoCita | "cancelada"; label: string }[] = [
  ...(["confirmada", "en-sala", "ausente", "finalizada", "tentativa"] as EstadoCita[]).map((e) => ({
    value: e,
    label: etiquetaEstado[e],
  })),
  { value: "cancelada", label: "Cancelada" },
];

/**
 * Cambia el estado de una cita sin salir de la agenda — hoy es la acción más
 * repetida del día de una recepcionista (confirmar, marcar en sala,
 * finalizar, ausente, cancelar). Pasa por la cola offline
 * (`useOfflineMutation`), así que funciona sin conexión.
 *
 * Se usa en dos lugares: la fila del listado (variante "badge", hermana del
 * `<Link>` a la ficha, no adentro — auditoría 07-oct-2026) y el popover de
 * la grilla de día (variante "boton").
 */
export function CambiarEstadoMenu({
  clinicId,
  userId,
  appointmentId,
  estadoActual,
  puedeConfirmar,
  variante = "badge",
}: {
  clinicId: string;
  userId: string;
  appointmentId: string;
  estadoActual: EstadoCita;
  /** Confirmar una cita está reservado al profesional asignado a ella (o
   * admin/owner en su nombre) — ver migración
   * 20260901130000_appointment_dentist_confirmation. El resto de estados
   * (en-sala, ausente, finalizada, cancelada) sigue abierto a cualquier rol
   * de agenda, esa restricción no cambia. */
  puedeConfirmar: boolean;
  variante?: "badge" | "boton";
}) {
  const setEstadoFn = useServerFn(setAppointmentStatus);

  const cambiar = useOfflineMutation({
    kind: "cambiar-estado-cita",
    userId,
    ejecutar: (payload) => setEstadoFn({ data: payload }),
    invalidar: [["appointments", clinicId]],
    resumen: (p) => `Cita → ${String(p.estado)}`,
    // Coalesce: si cambian el estado de la misma cita varias veces sin
    // conexión, solo importa el último valor, no acumular una entrada por click.
    identidad: (p) => String(p.appointmentId),
  });
  // ONB-07: cancelar saca la cita de la agenda; se avisa antes.
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variante === "boton" ? (
            <button
              type="button"
              disabled={cambiar.enCurso}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "justify-between")}
            >
              {cambiar.enCurso ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                "Cambiar estado"
              )}
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              disabled={cambiar.enCurso}
              className={cn(
                "inline-flex items-center gap-0.5 transition-opacity hover:opacity-80 disabled:opacity-50",
                claseEstadoBadge(estadoActual),
              )}
            >
              {cambiar.enCurso ? (
                <Loader2 className="size-2.5 animate-spin" />
              ) : (
                etiquetaEstado[estadoActual]
              )}
              <ChevronDown className="size-2.5" />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {opcionesEstadoCita
            .filter((o) => o.value !== estadoActual)
            .filter((o) => o.value !== "confirmada" || puedeConfirmar)
            .map((o) => (
              <DropdownMenuItem
                key={o.value}
                onSelect={() =>
                  o.value === "cancelada"
                    ? setConfirmarCancelar(true)
                    : cambiar.mutar({ appointmentId, estado: o.value })
                }
              >
                {o.label}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmarAccion
        abierto={confirmarCancelar}
        onAbiertoChange={setConfirmarCancelar}
        titulo="¿Cancelar esta cita?"
        consecuencias={[
          "La cita sale de la agenda y su horario queda libre para otro paciente.",
          "Al paciente no se le avisa solo: si hace falta, escríbele tú.",
        ]}
        etiquetaAccion="Cancelar la cita"
        destructiva
        onConfirmar={() => {
          setConfirmarCancelar(false);
          cambiar.mutar({ appointmentId, estado: "cancelada" });
        }}
      />
    </>
  );
}
