import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  camposFaltantes,
  DURACION_POR_DEFECTO,
  duracionAlElegirProcedimiento,
  elegirProcedimientosFrecuentes,
  textoFaltaCompletar,
  type CampoCita,
} from "@/lib/clinic-operations/cita-formulario";
import {
  listAppointmentTypes,
  listFrequentProcedures,
  listOperatories,
} from "@/lib/clinic-operations/cita-formulario.functions";
import { listProcedures } from "@/lib/finance/finance.functions";

/**
 * Estado del formulario de cita compartido por Nueva cita, Editar cita y
 * Agendar solicitud (Ola 1 · frente cita). Los campos los dibuja
 * `CamposCita` (components/agenda-formulario-cita.tsx).
 */

export type ValoresCita = {
  pacienteId: string;
  sucursalId: string;
  profesionalId: string;
  tratamiento: string;
  startsAt: string;
  duracion: number;
  tipoId: string | null;
  boxId: string;
  observaciones: string;
};

export const VALORES_VACIOS: ValoresCita = {
  pacienteId: "",
  sucursalId: "",
  profesionalId: "",
  tratamiento: "",
  startsAt: "",
  duracion: DURACION_POR_DEFECTO,
  tipoId: null,
  boxId: "",
  observaciones: "",
};

/** Ids de los campos dentro del diálogo, con un prefijo por diálogo. */
export function idsDelFormulario(prefijo: string): Record<CampoCita, string> & {
  tipo: string;
  frecuentes: string;
  duracion: string;
  box: string;
  observaciones: string;
  faltan: string;
} {
  return {
    paciente: `${prefijo}-paciente`,
    sucursal: `${prefijo}-sucursal`,
    profesional: `${prefijo}-profesional`,
    tratamiento: `${prefijo}-tratamiento`,
    inicio: `${prefijo}-inicio`,
    tipo: `${prefijo}-tipo`,
    frecuentes: `${prefijo}-frecuentes`,
    duracion: `${prefijo}-duracion`,
    box: `${prefijo}-box`,
    observaciones: `${prefijo}-observaciones`,
    faltan: `${prefijo}-faltan`,
  };
}

/**
 * Estado del formulario y los catálogos que usa (tipos, arancel, frecuentes,
 * boxes). Las consultas corren solo con el diálogo abierto.
 */
export function useFormularioCita({ clinicId, abierto }: { clinicId: string; abierto: boolean }) {
  const [valores, setValores] = useState<ValoresCita>(VALORES_VACIOS);
  // Quien tocó la duración a mano manda: un procedimiento elegido después no
  // la cambia (AGE-13).
  const [duracionManual, setDuracionManual] = useState(false);
  const [duracionLibre, setDuracionLibre] = useState(false);

  const fetchProcedures = useServerFn(listProcedures);
  const fetchFrecuentes = useServerFn(listFrequentProcedures);
  const fetchTipos = useServerFn(listAppointmentTypes);
  const fetchBoxes = useServerFn(listOperatories);

  const procedimientosQ = useQuery({
    queryKey: ["procedures", clinicId],
    enabled: abierto,
    queryFn: () => fetchProcedures({ data: { clinicId } }),
  });
  const frecuentesQ = useQuery({
    queryKey: ["procedimientos-frecuentes", clinicId],
    enabled: abierto,
    staleTime: 5 * 60_000,
    queryFn: () => fetchFrecuentes({ data: { clinicId } }),
  });
  const tiposQ = useQuery({
    queryKey: ["appointment-types", clinicId],
    enabled: abierto,
    staleTime: 5 * 60_000,
    queryFn: () => fetchTipos({ data: { clinicId } }),
  });
  const boxesQ = useQuery({
    queryKey: ["operatories", clinicId],
    enabled: abierto,
    staleTime: 5 * 60_000,
    queryFn: () => fetchBoxes({ data: { clinicId } }),
  });

  const procedimientos = useMemo(() => procedimientosQ.data ?? [], [procedimientosQ.data]);
  const favoritos = useMemo(() => new Set(frecuentesQ.data?.favoritos ?? []), [frecuentesQ.data]);
  const frecuentes = useMemo(
    () =>
      elegirProcedimientosFrecuentes({
        catalogo: procedimientos,
        favoritos: frecuentesQ.data?.favoritos ?? [],
        usos: frecuentesQ.data?.usos ?? [],
      }),
    [procedimientos, frecuentesQ.data],
  );

  const procedimientoSeleccionado = useMemo(() => {
    const t = valores.tratamiento.trim().toLowerCase();
    return t ? procedimientos.find((p) => p.name.trim().toLowerCase() === t) : undefined;
  }, [procedimientos, valores.tratamiento]);

  function set<K extends keyof ValoresCita>(campo: K, valor: ValoresCita[K]) {
    setValores((v) => ({ ...v, [campo]: valor }));
  }

  /** Escribir o elegir un tratamiento: si es del arancel y tiene duración, la propone. */
  function setTratamiento(texto: string) {
    const t = texto.trim().toLowerCase();
    const proc = t ? procedimientos.find((p) => p.name.trim().toLowerCase() === t) : undefined;
    setValores((v) => ({
      ...v,
      tratamiento: texto,
      duracion: duracionAlElegirProcedimiento({
        actual: v.duracion,
        delProcedimiento: proc?.durationMin,
        editadaAMano: duracionManual,
      }),
    }));
  }

  function elegirProcedimiento(procedureId: string) {
    const proc = procedimientos.find((p) => p.id === procedureId);
    if (proc) setTratamiento(proc.name);
  }

  /** Vuelve a los valores dados (al abrir o al cerrar el diálogo). */
  function reiniciar(nuevos: Partial<ValoresCita> = {}) {
    setValores({ ...VALORES_VACIOS, ...nuevos });
    setDuracionManual(false);
    setDuracionLibre(false);
  }

  return {
    valores,
    set,
    setValores,
    setTratamiento,
    elegirProcedimiento,
    reiniciar,
    duracionManual,
    marcarDuracionManual: () => setDuracionManual(true),
    duracionLibre,
    setDuracionLibre,
    procedimientos,
    procedimientoSeleccionado,
    frecuentes,
    favoritos,
    tipos: tiposQ.data ?? [],
    boxes: boxesQ.data ?? [],
  };
}

export type FormularioCita = ReturnType<typeof useFormularioCita>;

/** Qué falta y su texto, según los campos que el diálogo pide. */
export function faltantesDelFormulario(
  valores: ValoresCita,
  campos: { paciente: boolean },
): { faltan: CampoCita[]; texto: string | null } {
  const faltan = camposFaltantes({
    ...(campos.paciente ? { paciente: valores.pacienteId } : {}),
    sucursal: valores.sucursalId,
    profesional: valores.profesionalId,
    tratamiento: valores.tratamiento,
    inicio: valores.startsAt,
  });
  return { faltan, texto: textoFaltaCompletar(faltan) };
}
