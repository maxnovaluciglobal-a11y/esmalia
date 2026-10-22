import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listarOpcionesDeFicha, type OpcionDeFicha } from "@/lib/patients/datos-ficha.functions";

/** Listas de la ficha de la clínica (isapres y origen), con todas o solo las activas. */
export function useOpcionesDeFicha(clinicId: string | null | undefined) {
  const fetchOpciones = useServerFn(listarOpcionesDeFicha);
  const query = useQuery({
    queryKey: ["opciones-ficha", clinicId],
    enabled: Boolean(clinicId),
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchOpciones({ data: { clinicId: clinicId! } }),
  });
  const todas: OpcionDeFicha[] = query.data ?? [];
  const activas = (tipo: OpcionDeFicha["tipo"]) =>
    todas.filter((o) => o.tipo === tipo && o.activa).map((o) => o.texto);
  return {
    ...query,
    todas,
    isapres: activas("isapre"),
    origenes: activas("acquisition_source"),
  };
}
