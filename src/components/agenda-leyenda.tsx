import { AlertTriangle, CalendarX2, Info } from "lucide-react";

import { iniciales } from "@/components/agenda-hueco";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import type { Profesional } from "@/lib/clinic-operations/clinic-data";

/**
 * Leyenda compacta de la agenda (Ola 0): qué significa cada marca. Es un
 * botón con un popover para no comerse alto de la grilla; adentro todo va
 * con texto, no solo con color.
 */
export function LeyendaAgenda({
  vista,
  profesionales,
  hayChoques,
}: {
  vista: "dia" | "semana";
  /** Profesionales visibles: en la semana se explican sus iniciales. */
  profesionales: Pick<Profesional, "id" | "nombre" | "color">[];
  hayChoques: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
        >
          <Info className="size-3.5" aria-hidden />
          Leyenda
          {hayChoques && (
            <span className="inline-flex items-center gap-0.5 rounded bg-warning-soft px-1 text-[11px] font-semibold text-warning">
              <CalendarX2 className="size-3" aria-hidden />
              Hay choques
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={16} className="w-80 space-y-3 text-xs">
        <p className="font-display text-base font-semibold">Qué significa cada marca</p>
        <dl className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-2 gap-y-2.5">
          <dt className="flex justify-center pt-0.5 text-destructive">
            <AlertTriangle className="size-3.5" role="img" aria-label="Triángulo rojo" />
          </dt>
          <dd>
            <span className="font-semibold">Alergia registrada.</span> El paciente tiene alergias en
            su historia clínica; pasa el puntero o abre la ficha para verlas.
          </dd>

          <dt className="flex justify-center pt-0.5">
            <span className="inline-flex items-center rounded border-2 border-dashed border-warning-border bg-warning-soft p-0.5 text-warning">
              <CalendarX2 className="size-3" role="img" aria-label="Calendario tachado" />
            </span>
          </dt>
          <dd>
            <span className="font-semibold">Choque de horario.</span> La cita se cruza con otra del
            mismo paciente, del mismo profesional o en el mismo box. Abre la cita para ver con cuál.
          </dd>

          <dt className="pt-0.5">
            <span aria-hidden="true" className="block h-4 rounded bg-secondary" />
          </dt>
          <dd>
            <span className="font-semibold">Fuera de horario.</span> Horas en que el profesional no
            atiende según su horario declarado.
          </dd>

          <dt className="pt-0.5">
            <span
              aria-hidden="true"
              className="block h-4 rounded bg-[repeating-linear-gradient(135deg,var(--color-border)_0_1px,transparent_1px_9px)] ring-1 ring-border"
            />
          </dt>
          <dd>
            <span className="font-semibold">Colación.</span> Pausa entre dos tramos del día.
          </dd>

          <dt className="pt-0.5">
            <span className="block rounded bg-destructive/10 px-0.5 text-center text-[10px] font-medium text-destructive">
              alta
            </span>
          </dt>
          <dd>
            <span className="font-semibold">Urgencia de la solicitud del portal</span>, la que
            eligió el paciente: <span className="text-destructive">alta</span> (dolor o urgencia),{" "}
            <span className="text-warning">media</span> (esta semana) o baja (puede esperar).
          </dd>
        </dl>

        {vista === "semana" && profesionales.length > 0 && (
          <div className="space-y-1.5 border-t border-hairline pt-3">
            <p className="font-semibold">Iniciales de la semana</p>
            <p className="text-muted-foreground">
              Cada día tiene un carril por profesional, con sus iniciales y su color:
            </p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
              {profesionales.map((p) => (
                <li key={p.id} className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="w-7 shrink-0 border-t-2 pt-0.5 text-center text-[11px] font-semibold text-muted-foreground"
                    style={{ borderTopColor: colorProfesional(p.color) }}
                  >
                    {iniciales(p.nombre)}
                  </span>
                  <span className="truncate">{p.nombre}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              La barra azul es la ocupación del día según el horario de atención.
            </p>
          </div>
        )}

        {vista === "dia" && profesionales.length > 0 && (
          <div className="space-y-1.5 border-t border-hairline pt-3">
            <p className="font-semibold">Color de cada profesional</p>
            <p className="text-muted-foreground">
              El punto de cada cita es el color de su profesional (se cambia en Profesionales):
            </p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
              {profesionales.map((p) => (
                <li key={p.id} className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorProfesional(p.color) }}
                  />
                  <span className="truncate">{p.nombre}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
