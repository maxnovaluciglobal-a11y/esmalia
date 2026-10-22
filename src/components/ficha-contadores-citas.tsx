import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getContadoresDeCitas } from "@/lib/patients/contadores-citas.functions";
import { notaInasistencia } from "@/lib/patients/contadores-citas";
import { fecha, fechaHora, numero } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

/**
 * Contadores de citas en la cabecera de la ficha (FIC-12, Ola 2): atendidas,
 * inasistencias (con %), canceladas, próximas, y la fecha de la última visita
 * y de la próxima cita. Se cuentan en la base (`patient_appointment_counters`)
 * con la RLS de quien mira, así que no se cortan en 1000 filas.
 */
export function ContadoresDeCitasFicha({
  clinicId,
  patientId,
  timezone,
}: {
  clinicId: string;
  patientId: string;
  timezone: string | undefined;
}) {
  const fetchContadores = useServerFn(getContadoresDeCitas);
  const { data, isLoading, isError } = useQuery({
    // Bajo "appointments": cambiar el estado de una cita (agenda, cierre en
    // lote) invalida esa raíz y los contadores se actualizan solos.
    queryKey: ["appointments", clinicId, "contadores", patientId],
    queryFn: () => fetchContadores({ data: { clinicId, patientId } }),
  });

  if (isError) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        No pudimos contar las citas de este paciente.
      </p>
    );
  }

  const items: { label: string; valor: string; nota?: string; alerta?: boolean }[] = data
    ? [
        { label: "Atendidas", valor: numero(data.atendidas) },
        {
          label: "Inasistencias",
          valor: numero(data.inasistencias),
          nota: notaInasistencia(data),
          alerta: (data.pctInasistencia ?? 0) >= 20,
        },
        { label: "Canceladas", valor: numero(data.anuladas) },
        { label: "Próximas", valor: numero(data.proximas) },
        {
          label: "Última visita",
          valor: data.ultimaVisita ? fecha(data.ultimaVisita, timezone) : "Sin visitas",
        },
        {
          label: "Próxima cita",
          valor: data.proximaCita ? fechaHora(data.proximaCita, timezone) : "Sin agendar",
        },
      ]
    : [];

  return (
    <section aria-labelledby={`citas-${patientId}`} className="mt-5 border-t border-hairline pt-4">
      <h3 id={`citas-${patientId}`} className="kicker">
        Citas
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {isLoading || !data
          ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="min-w-0">
                <span className="block h-3 w-16 animate-pulse rounded-sm bg-muted" />
                <span className="mt-2 block h-5 w-12 animate-pulse rounded-sm bg-muted" />
              </div>
            ))
          : items.map((k) => (
              <div key={k.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{k.label}</dt>
                <dd
                  className={cn(
                    "mt-0.5 truncate font-display text-lg font-semibold leading-tight tabular-nums",
                    k.alerta && "text-destructive",
                  )}
                >
                  {k.valor}
                </dd>
                {k.nota && (
                  <dd
                    className={cn(
                      "text-xs",
                      k.alerta ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {k.nota}
                  </dd>
                )}
              </div>
            ))}
      </dl>
      {data && data.sinCerrar > 0 && (
        <p className="mt-2 text-xs text-warning">
          {data.sinCerrar === 1
            ? "1 cita pasada sigue sin cerrar: ciérrala desde Hoy o la Agenda para que cuente."
            : `${data.sinCerrar} citas pasadas siguen sin cerrar: ciérralas desde Hoy o la Agenda para que cuenten.`}
        </p>
      )}
    </section>
  );
}
