import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listGuardians } from "@/lib/patients/guardians.functions";

export const guardiansQueryKey = (clinicId: string, patientId: string) => [
  "patient-guardians",
  clinicId,
  patientId,
];

/** Tutores vigentes del paciente (CLI-11): ficha, tarjeta y consentimiento comparten la query. */
export function useGuardians(clinicId: string, patientId: string, enabled = true) {
  const fetchFn = useServerFn(listGuardians);
  return useQuery({
    queryKey: guardiansQueryKey(clinicId, patientId),
    queryFn: () => fetchFn({ data: { clinicId, patientId } }),
    enabled: enabled && Boolean(clinicId),
  });
}
