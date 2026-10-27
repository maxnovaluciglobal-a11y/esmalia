import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { EtiquetaPastilla, useEtiquetas } from "@/components/pacientes/etiquetas";
import { listLabelsOfPatient } from "@/lib/patients/etiquetas.functions";

/**
 * Etiquetas de la ficha (PAC-07), en una línea bajo el encabezado. Solo
 * muestra: se ponen y se sacan desde la lista (menú ⋮ → Etiquetar). Sin
 * etiquetas no ocupa lugar.
 */
export function EtiquetasDeLaFicha({
  clinicId,
  patientId,
}: {
  clinicId: string;
  patientId: string;
}) {
  const { data: catalogo = [] } = useEtiquetas(clinicId);
  const listar = useServerFn(listLabelsOfPatient);
  const { data: ids = [] } = useQuery({
    queryKey: ["patient-labels-of", clinicId, patientId],
    queryFn: () => listar({ data: { clinicId, patientId } }),
    staleTime: 60_000,
  });
  const propias = catalogo.filter((e) => ids.includes(e.id));
  if (propias.length === 0) return null;
  return (
    <p className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="sr-only">Etiquetas:</span>
      {propias.map((e) => (
        <EtiquetaPastilla key={e.id} etiqueta={e} />
      ))}
    </p>
  );
}
