import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { boxDe } from "@/components/agenda-conflictos";
import type { Profesional } from "@/lib/clinic-operations/clinic-data";
import {
  AJUSTES_POR_DEFECTO,
  aperturasDelDia,
  bloqueosQueChocan,
  conAperturas,
  franjasDeDisponibilidad,
  sucursalesPorProfesional,
  type AjustesAgenda,
  type BloqueSemanal,
  type ExcepcionAgenda,
  type ExcepcionDelDia,
  type FranjaDisponibilidad,
  type HorarioDeclarado,
} from "@/lib/clinic-operations/disponibilidad";
import {
  getAgendaSettings,
  listAgendaExceptions,
  listBranchHours,
} from "@/lib/clinic-operations/disponibilidad.functions";
import { listProfessionalSchedules } from "@/lib/clinic-operations/professionals.functions";

/**
 * Datos de disponibilidad de la agenda (Ola 2): ajustes de la clínica,
 * horario de atención de las sucursales, horario del profesional por
 * sucursal y bloqueos/aperturas del rango visible. Las claves de React Query
 * se comparten con la agenda (`professional-schedules`) y con la pantalla de
 * configuración, así que invalidar ahí refresca acá.
 */

export const claveAjustesAgenda = (clinicId: string | undefined) =>
  ["agenda-settings", clinicId] as const;
export const claveHorarioSucursales = (clinicId: string | undefined) =>
  ["branch-hours", clinicId] as const;
/** Prefijo de todas las consultas de bloqueos (cualquier rango). */
export const claveExcepciones = (clinicId: string | undefined) =>
  ["agenda-exceptions", clinicId] as const;

/** Ajustes de la agenda; sin fila (o mientras carga), los de siempre. */
export function useAjustesAgenda(clinicId: string | undefined): AjustesAgenda {
  const fetchAjustes = useServerFn(getAgendaSettings);
  const { data } = useQuery({
    queryKey: claveAjustesAgenda(clinicId),
    enabled: Boolean(clinicId),
    staleTime: 5 * 60_000,
    queryFn: () => fetchAjustes({ data: { clinicId: clinicId! } }),
  });
  return data ?? AJUSTES_POR_DEFECTO;
}

/** Horario semanal de cada profesional, con su sucursal (AGE-23). */
export function useHorariosProfesionales(clinicId: string | undefined, enabled = true) {
  const fetchHorarios = useServerFn(listProfessionalSchedules);
  const { data } = useQuery({
    queryKey: ["professional-schedules", clinicId],
    enabled: Boolean(clinicId) && enabled,
    queryFn: () => fetchHorarios({ data: { clinicId: clinicId! } }),
  });
  return data;
}

/** Bloqueos y aperturas que tocan [desde, hasta] (fechas de calendario). */
export function useExcepcionesAgenda(
  clinicId: string | undefined,
  desde: string,
  hasta: string,
  enabled = true,
): ExcepcionAgenda[] {
  const fetchExcepciones = useServerFn(listAgendaExceptions);
  const { data } = useQuery({
    queryKey: [...claveExcepciones(clinicId), desde, hasta],
    enabled: Boolean(clinicId && desde && hasta) && enabled,
    staleTime: 60_000,
    queryFn: () => fetchExcepciones({ data: { clinicId: clinicId!, desde, hasta } }),
  });
  return data ?? SIN_EXCEPCIONES;
}

const SIN_EXCEPCIONES: ExcepcionAgenda[] = [];
const SIN_HORARIO: Record<string, BloqueSemanal[]> = {};

/** Lo que recibe la grilla de día para dibujar la capa de disponibilidad. */
export interface DisponibilidadGrilla {
  /** Intervalo de los huecos clicables (AGE-10). */
  pasoMin: number;
  /** Franjas de una columna (profesional) en la fecha de la grilla. */
  franjasDe: (profesional: Profesional) => FranjaDisponibilidad[];
}

export function useDisponibilidadAgenda({
  clinicId,
  desde,
  hasta,
}: {
  clinicId: string | undefined;
  desde: string;
  hasta: string;
}) {
  const ajustes = useAjustesAgenda(clinicId);
  const horarios = useHorariosProfesionales(clinicId);
  const excepciones = useExcepcionesAgenda(clinicId, desde, hasta);
  const fetchHorarioSucursales = useServerFn(listBranchHours);
  const { data: horarioSucursales = SIN_HORARIO } = useQuery({
    queryKey: claveHorarioSucursales(clinicId),
    enabled: Boolean(clinicId),
    staleTime: 5 * 60_000,
    queryFn: () => fetchHorarioSucursales({ data: { clinicId: clinicId! } }),
  });

  const sucursales = useMemo(() => sucursalesPorProfesional(horarios ?? {}), [horarios]);

  const destinoDe = useCallback(
    (p: Profesional) => ({
      profesionalId: p.id,
      sucursalId: p.sucursalId || null,
      sucursalesDelProfesional: sucursales[p.id],
      boxNombre: boxDe(p),
    }),
    [sucursales],
  );

  /** Capa de la grilla de día para una fecha. */
  const grilla = useCallback(
    (fecha: string): DisponibilidadGrilla => ({
      pasoMin: ajustes.pasoMin,
      franjasDe: (p) =>
        franjasDeDisponibilidad({
          fecha,
          destino: destinoDe(p),
          excepciones,
          horarioSucursal: p.sucursalId ? horarioSucursales[p.sucursalId] : undefined,
        }),
    }),
    [ajustes.pasoMin, destinoDe, excepciones, horarioSucursales],
  );

  /** El horario declarado del día con las aperturas excepcionales sumadas (AGE-08). */
  const conAperturasDe = useCallback(
    <H extends HorarioDeclarado>(horario: H, fecha: string, profesionalId: string): H =>
      conAperturas(horario, aperturasDelDia(excepciones, fecha, profesionalId)),
    [excepciones],
  );

  /** Bloqueos que pisan un destino del arrastre (AGE-07). */
  const bloqueosEn = useCallback(
    (
      profesional: Profesional | undefined,
      destino: { fecha: string; inicio: number; duracion: number; profesionalId: string },
    ): ExcepcionDelDia[] =>
      bloqueosQueChocan(excepciones, {
        ...(profesional
          ? destinoDe(profesional)
          : { profesionalId: destino.profesionalId, sucursalId: null }),
        fecha: destino.fecha,
        inicio: destino.inicio,
        duracion: destino.duracion,
      }),
    [excepciones, destinoDe],
  );

  // Objeto estable: la grilla y la validación del arrastre dependen de él.
  return useMemo(
    () => ({ ajustes, excepciones, horarioSucursales, grilla, conAperturasDe, bloqueosEn }),
    [ajustes, excepciones, horarioSucursales, grilla, conAperturasDe, bloqueosEn],
  );
}
