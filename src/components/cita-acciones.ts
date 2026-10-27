import { horaDeMinutos } from "@/components/agenda-hueco";
import type { ClinicAccess } from "@/lib/access/access";
import { etiquetaEstado, type Cita, type EstadoCita } from "@/lib/clinic-operations/clinic-data";
import { clasePastilla, tonoDeEstadoCita } from "@/lib/clinic-operations/estado-cita-tono";
import { cn } from "@/lib/utils";

/**
 * Confirmar una cita es acción exclusiva del profesional asignado a ella,
 * o de owner/admin en su nombre (decisión de Walter: se permite para no
 * trabar la agenda si el dentista no usa el sistema). El resto de roles de
 * agenda (reception, assistant) puede ver y mover otros estados, pero no
 * este — ver migración 20260901130000_appointment_dentist_confirmation.
 */
export function puedeConfirmarCita(
  access: Pick<ClinicAccess, "role" | "myProfessionalId">,
  professionalId: string,
): boolean {
  if (access.role === "owner" || access.role === "admin") return true;
  return Boolean(access.myProfessionalId) && access.myProfessionalId === professionalId;
}

export function claseEstadoBadge(estado: EstadoCita) {
  return cn(
    "w-fit rounded border px-1.5 py-0.5 text-[11px] font-medium",
    clasePastilla[tonoDeEstadoCita[estado]],
  );
}

/**
 * Nombre accesible del bloque de la grilla de día, que abre el popover de
 * acciones: "Cita de Ana Pérez a las 09:30, confirmada". La hora es de pared
 * (minutos desde HORA_INICIO, igual que el resto de la grilla).
 */
export function etiquetaBloqueCita(
  cita: Pick<Cita, "paciente" | "inicio" | "estado"> & Partial<Pick<Cita, "grupal">>,
): string {
  const quien = cita.grupal
    ? `grupal «${cita.paciente}» (${cita.grupal.inscritos} de ${cita.grupal.cupo} inscritos)`
    : `de ${cita.paciente}`;
  return `Cita ${quien} a las ${horaDeMinutos(cita.inicio)}, ${etiquetaEstado[
    cita.estado
  ].toLowerCase()}`;
}

/** Rango "09:30–10:15" de la cita para el encabezado del popover. */
export function rangoHorarioCita(cita: Pick<Cita, "inicio" | "duracion">): string {
  return `${horaDeMinutos(cita.inicio)}–${horaDeMinutos(cita.inicio + cita.duracion)}`;
}
