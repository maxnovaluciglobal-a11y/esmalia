import { Link } from "@tanstack/react-router";

import type { Paciente } from "@/lib/clinic-operations/clinic-data";
import { cn } from "@/lib/utils";
import { useZonaClinica } from "@/hooks/use-zona-clinica";
import { fecha } from "@/lib/formato-fecha";

export function PacienteTimeline({
  paciente,
  conEncabezado = true,
}: {
  paciente: Paciente;
  conEncabezado?: boolean;
}) {
  const zona = useZonaClinica();
  return (
    <div className="space-y-6">
      {conEncabezado && (
        <div className="flex gap-4">
          {paciente.foto ? (
            <img
              src={paciente.foto}
              alt={paciente.nombre}
              width={512}
              height={512}
              loading="lazy"
              className="size-12 rounded-xl object-cover"
            />
          ) : (
            <span className="grid size-12 place-items-center rounded-xl bg-secondary font-display text-sm font-semibold text-muted-foreground">
              {paciente.nombre
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
          )}
          <div>
            <Link
              to="/pacientes/$pacienteId"
              params={{ pacienteId: paciente.id }}
              className="text-sm font-semibold hover:underline"
            >
              {paciente.nombre}
            </Link>
            <p className="text-xs text-muted-foreground">
              ID: {paciente.documento} • {paciente.edad} años
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {paciente.timeline.map((e) => (
          <div key={e.fecha + e.titulo} className="relative border-l-2 border-hairline pl-6">
            <span
              className={cn(
                "absolute -left-[9px] top-0 size-4 rounded-full border-4 border-card",
                e.actual ? "bg-brand" : "bg-border",
              )}
            />
            <p className="text-xs font-medium text-muted-foreground">
              <time dateTime={e.instante ?? e.fecha}>{fecha(e.instante ?? e.fecha, zona)}</time>
            </p>
            <p className="text-sm font-medium">{e.titulo}</p>
            {e.detalle && <p className="mt-1 text-xs text-muted-foreground">{e.detalle}</p>}
            {e.tipo === "imagen" && (
              <div className="mt-2 grid size-16 place-items-center rounded-md bg-secondary">
                <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  RX
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
