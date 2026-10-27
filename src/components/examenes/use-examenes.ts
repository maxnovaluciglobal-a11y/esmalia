import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { estadoDelCupo, type EstadoCupo } from "@/lib/examenes/cupo";
import { listarExamenesDelPaciente, usoDeAlmacenamiento } from "@/lib/examenes/examenes.functions";

export const claveExamenes = (clinicId: string, patientId: string) =>
  ["examenes", clinicId, patientId] as const;

export const claveUso = (clinicId: string) => ["uso-almacenamiento", clinicId] as const;

/** Exámenes, sesiones y planes del paciente (una sola consulta compartida). */
export function useExamenes(clinicId: string, patientId: string, habilitado = true) {
  const listar = useServerFn(listarExamenesDelPaciente);
  return useQuery({
    queryKey: claveExamenes(clinicId, patientId),
    queryFn: () => listar({ data: { clinicId, patientId } }),
    enabled: habilitado,
    // Las miniaturas vienen firmadas por 5 minutos: se refresca antes.
    staleTime: 3 * 60 * 1000,
    refetchInterval: 4 * 60 * 1000,
  });
}

export function useUsoDeAlmacenamiento(clinicId: string) {
  const uso = useServerFn(usoDeAlmacenamiento);
  return useQuery({
    queryKey: claveUso(clinicId),
    queryFn: () => uso({ data: { clinicId } }),
    staleTime: 60 * 1000,
  });
}

export function useInvalidarExamenes(clinicId: string, patientId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: claveExamenes(clinicId, patientId) }),
      queryClient.invalidateQueries({ queryKey: claveUso(clinicId) }),
    ]);
}

/** Estado del cupo de la clínica (null mientras carga o sin datos). */
export function useEstadoDelCupo(clinicId: string): EstadoCupo | null {
  const { data } = useUsoDeAlmacenamiento(clinicId);
  return data ? estadoDelCupo(data.usadoBytes, data.cupoBytes) : null;
}
