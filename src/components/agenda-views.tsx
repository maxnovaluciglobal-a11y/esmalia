import { Link } from "@tanstack/react-router";

import {
  PIXELES_POR_MINUTO,
  etiquetaEstado,
  type Cita,
  type Profesional,
} from "@/lib/clinic-operations/clinic-data";
import {
  esMismoMesISO,
  monthGridISO,
  nroDiaISO,
  weekDaysISO,
} from "@/lib/clinic-operations/agenda-fechas";
import { horaDeMinutos, rangoDeGrilla } from "@/components/agenda-hueco";
import { claseBloque, tonoDeEstadoCita } from "@/lib/clinic-operations/estado-cita-tono";
import { cn } from "@/lib/utils";

// El borde izquierdo identifica al profesional (color guardado en
// /profesionales); acá solo queda fondo + texto según el estado de la cita.
const estadoClases = Object.fromEntries(
  Object.entries(tonoDeEstadoCita).map(([estado, tono]) => [estado, claseBloque[tono]]),
) as Record<Cita["estado"], string>;

const DOW_CORTO = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** id → color de profesional, para pintar el borde de cada cita. */
type ColorPorProfesional = Map<string, string>;

function colorPorProfesional(
  profesionales: Pick<Profesional, "id" | "color">[],
): ColorPorProfesional {
  return new Map(profesionales.map((p) => [p.id, p.color]));
}

// ── Vista semana: horas × 7 días ─────────────────────────────────────────
export function AgendaWeek({
  citas,
  fecha,
  hoy,
  profesionales,
}: {
  citas: Cita[];
  fecha: string;
  hoy: string;
  profesionales: Pick<Profesional, "id" | "color">[];
}) {
  const dias = weekDaysISO(fecha);
  const { desde, hasta } = rangoDeGrilla(citas);
  const horas = (hasta - desde) / 60;
  const alto = (hasta - desde) * PIXELES_POR_MINUTO;
  const colores = colorPorProfesional(profesionales);

  return (
    <div className="card-clinical overflow-x-auto">
      <div className="min-w-[720px]">
        <div
          className="grid border-b border-hairline bg-secondary/40"
          style={{ gridTemplateColumns: `56px repeat(7, minmax(0, 1fr))` }}
        >
          <div className="p-2" />
          {dias.map((d, i) => (
            <div
              key={d}
              className={cn("border-l border-hairline p-2 text-center", d === hoy && "bg-brand/5")}
            >
              <p className="text-[11px] font-semibold capitalize">{DOW_CORTO[i]}</p>
              <p className={cn("text-[11px] text-muted-foreground", d === hoy && "text-brand-700")}>
                {nroDiaISO(d)}
              </p>
            </div>
          ))}
        </div>

        <div
          className="relative grid"
          style={{ height: alto, gridTemplateColumns: `56px repeat(7, minmax(0, 1fr))` }}
        >
          <div className="flex flex-col pr-1 pt-1 cifra text-right text-[11px] text-muted-foreground">
            {Array.from({ length: horas }).map((_, i) => (
              <div
                key={i}
                style={{ height: 60 * PIXELES_POR_MINUTO }}
                className="border-b border-hairline"
              >
                {horaDeMinutos(desde + i * 60)}
              </div>
            ))}
          </div>

          {dias.map((d) => {
            const delDia = citas.filter((c) => c.fecha === d);
            return (
              <div
                key={d}
                className={cn("relative border-l border-hairline", d === hoy && "bg-brand/5")}
              >
                {Array.from({ length: horas }).map((_, i) => (
                  <div
                    key={i}
                    style={{ height: 60 * PIXELES_POR_MINUTO }}
                    className="border-b border-hairline"
                  />
                ))}
                {delDia.map((c) => (
                  <Link
                    key={c.id}
                    to="/pacientes/$pacienteId"
                    params={{ pacienteId: c.pacienteId }}
                    title={`${c.paciente} · ${c.tratamiento}`}
                    className={cn(
                      "absolute left-0.5 right-0.5 overflow-hidden rounded border-l-2 px-1 text-[11px] leading-[1.15] transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      estadoClases[c.estado],
                      c.estado === "ausente" && "opacity-70",
                    )}
                    style={{
                      top: (c.inicio - desde) * PIXELES_POR_MINUTO,
                      // 11px × 1.15 ≈ 13px: el piso deja ver al menos una línea entera.
                      height: Math.max(c.duracion * PIXELES_POR_MINUTO - 2, 14),
                      borderLeftColor: colores.get(c.profesionalId),
                    }}
                  >
                    <span className="block truncate font-semibold">{c.paciente}</span>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Vista mes: calendario 6×7 ────────────────────────────────────────────
export function AgendaMonth({
  citas,
  fecha,
  hoy,
  onSelectDay,
  profesionales,
}: {
  citas: Cita[];
  fecha: string;
  hoy: string;
  onSelectDay: (dia: string) => void;
  profesionales: Pick<Profesional, "id" | "color">[];
}) {
  const celdas = monthGridISO(fecha);
  const porDia = new Map<string, Cita[]>();
  for (const c of citas) {
    const lista = porDia.get(c.fecha) ?? [];
    lista.push(c);
    porDia.set(c.fecha, lista);
  }
  const colores = colorPorProfesional(profesionales);

  return (
    <div className="card-clinical overflow-hidden">
      <div className="grid grid-cols-7 border-b border-hairline bg-secondary/40 text-center">
        {DOW_CORTO.map((d) => (
          <div key={d} className="p-2 text-[11px] font-semibold uppercase text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {celdas.map((d) => {
          const delDia = (porDia.get(d) ?? []).sort((a, b) => a.inicio - b.inicio);
          const fueraDeMes = !esMismoMesISO(d, fecha);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelectDay(d)}
              className={cn(
                "flex min-h-[92px] flex-col gap-0.5 border-b border-l border-hairline p-1.5 text-left transition-colors hover:bg-secondary/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                fueraDeMes && "bg-secondary/20 text-muted-foreground/60",
              )}
            >
              <span
                className={cn(
                  "text-[11px] font-semibold",
                  d === hoy &&
                    "inline-grid size-5 place-items-center rounded-full bg-brand text-brand-foreground",
                )}
              >
                {nroDiaISO(d)}
              </span>
              {delDia.slice(0, 3).map((c) => (
                <span
                  key={c.id}
                  className={cn(
                    "truncate rounded border-l-2 px-1 text-[11px] leading-[1.2]",
                    estadoClases[c.estado],
                  )}
                  style={{ borderLeftColor: colores.get(c.profesionalId) }}
                  title={`${c.paciente} · ${etiquetaEstado[c.estado]}`}
                >
                  {c.paciente}
                </span>
              ))}
              {delDia.length > 3 && (
                <span className="text-[11px] leading-[1.2] text-muted-foreground">
                  +{delDia.length - 3} más
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
