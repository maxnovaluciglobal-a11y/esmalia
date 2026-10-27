import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";

import { listarPacientesGes } from "@/lib/patients/datos-ficha.functions";
import { ETIQUETA_MOTIVO_GES, URL_GES_SALUD_BUCAL } from "@/lib/patients/ges";

/**
 * MKT-01: "Pacientes GES" en Hoy. Pacientes activos que hoy tienen una
 * garantía GES dental (6 o 60 años, o embarazo en la anamnesis), para que
 * recepción y el equipo clínico los orienten. Solo clínicas de Chile; sin
 * pacientes en ese grupo, la sección no aparece.
 */
export function PacientesGes({ clinicId }: { clinicId: string }) {
  const fetchGes = useServerFn(listarPacientesGes);
  const { data = [], isError } = useQuery({
    queryKey: ["pacientes-ges", clinicId],
    queryFn: () => fetchGes({ data: { clinicId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (isError || data.length === 0) return null;

  const visibles = data.slice(0, 8);
  return (
    <section
      aria-labelledby="pacientes-ges"
      className="rounded-[14px] border border-hairline bg-card p-5"
    >
      <h2 id="pacientes-ges" className="font-display text-[26px] font-medium leading-none">
        Pacientes GES
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Tienen hoy una garantía GES de salud oral: embarazadas, niños de 6 años y personas de 60
        años. Cuéntales que pueden atenderse con cobertura.
      </p>
      <ul className="mt-3 divide-y divide-hairline">
        {visibles.map((p) => (
          <li key={p.id}>
            <Link
              to="/pacientes/$pacienteId"
              params={{ pacienteId: p.id }}
              className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-brand-700"
            >
              <span className="min-w-0 truncate font-medium">{p.nombre}</span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {p.motivos.map((m) => (
                  <span
                    key={m}
                    className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-medium text-info"
                  >
                    {ETIQUETA_MOTIVO_GES[m]}
                  </span>
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {data.length > visibles.length && (
        <p className="mt-2 text-xs text-muted-foreground">Y {data.length - visibles.length} más.</p>
      )}
      <a
        href={URL_GES_SALUD_BUCAL}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-3 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-brand-700 underline underline-offset-2"
      >
        Qué cubre el GES de salud bucal (minsal.cl) <ExternalLink className="size-3" aria-hidden />
      </a>
    </section>
  );
}
