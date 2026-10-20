import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
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
import { horarioDelDia, type BloqueHorario } from "@/components/agenda-movimiento";
import { FranjasDeHorario, useMinutosAhora } from "@/components/agenda-grid";
import {
  etiquetaOcupacion,
  ocupacionDeLaSemana,
  type OcupacionDia,
} from "@/components/agenda-ocupacion";
import { PanelCita } from "@/components/agenda-panel-cita";
import { etiquetaBloqueCita } from "@/components/cita-acciones";
import { enfocarCita } from "@/hooks/use-arrastre-cita";

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

// ── Vista semana por carriles (PR 10b del plan A+) ───────────────────────

/** "Dra. Paz Rojas" → "PR". Sin títulos (Dr., Dra.). */
function iniciales(nombre: string): string {
  const palabras = nombre.split(/\s+/).filter((w) => w && !/^(dr|dra|od|lic)\.?$/i.test(w));
  const letras = palabras.length > 1 ? [palabras[0], palabras[palabras.length - 1]] : palabras;
  return letras.map((w) => w[0]?.toUpperCase() ?? "").join("") || "·";
}

function apellido(paciente: string): string {
  const partes = paciente.trim().split(/\s+/);
  return partes.length > 1 ? partes[partes.length - 1] : paciente;
}

function BarraOcupacion({ ocupacion }: { ocupacion: OcupacionDia | undefined }) {
  if (!ocupacion || ocupacion.porcentaje === null) {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground">
        {ocupacion?.motivo === "sin-datos" ? "Sin datos" : "Sin horario"}
      </p>
    );
  }
  return (
    <div
      role="meter"
      aria-label="Ocupación del día"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ocupacion.porcentaje}
      aria-valuetext={etiquetaOcupacion(ocupacion)}
      title={etiquetaOcupacion(ocupacion)}
      className="mt-2 flex items-center gap-2"
    >
      <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-cobalt-soft">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-cobalt"
          style={{ width: `${ocupacion.porcentaje}%` }}
        />
      </span>
      <span className="cifra text-[11px] font-medium text-cobalt-ink">
        {ocupacion.porcentaje} %
      </span>
    </div>
  );
}

/**
 * Semana con un carril por profesional dentro de cada día, la ocupación del
 * día en cobalto (dato, no estado) y el panel lateral de la cita elegida.
 * La ocupación se calcula en el cliente sobre las citas ya cargadas y el
 * horario declarado (`agenda-ocupacion.ts`): no hay consulta nueva.
 */
export function AgendaSemanaCarriles({
  citas,
  citasOcupacion,
  fecha,
  hoy,
  profesionales,
  horarios,
  zonaHoraria,
  datosDesde,
  allergyAlerts,
  renderAcciones,
}: {
  /** Citas que se dibujan (con los filtros de búsqueda y estado aplicados). */
  citas: Cita[];
  /** Citas para la ocupación: sin filtros de búsqueda ni de estado, que no cambian lo ocupado. */
  citasOcupacion: Cita[];
  fecha: string;
  /** Hoy en el huso de la clínica (`hoyISO(timezone)`). */
  hoy: string;
  /** Carriles: los profesionales visibles con los filtros de sucursal y profesional. */
  profesionales: Profesional[];
  horarios: Record<string, BloqueHorario[]> | undefined;
  /** Huso de la clínica, para la línea de "ahora". */
  zonaHoraria: string | undefined;
  /** Si la lista vino cortada: fecha de la cita más vieja que llegó. */
  datosDesde: string | null;
  allergyAlerts?: Record<string, string[]>;
  renderAcciones?: (cita: Cita, profesional: Profesional) => ReactNode;
}) {
  const ids = useMemo(() => profesionales.map((p) => p.id), [profesionales]);
  const porId = useMemo(() => new Map(profesionales.map((p) => [p.id, p])), [profesionales]);

  // Lunes a viernes siempre; sábado y domingo solo si alguien atiende o hay citas.
  const dias = useMemo(() => {
    const semana = weekDaysISO(fecha);
    return semana.filter(
      (d, i) =>
        i < 5 ||
        citasOcupacion.some((c) => c.fecha === d && porId.has(c.profesionalId)) ||
        ids.some((id) => horarioDelDia(horarios?.[id], d).tramos.length > 0),
    );
  }, [fecha, citasOcupacion, porId, ids, horarios]);

  const ocupacion = useMemo(
    () =>
      ocupacionDeLaSemana({
        dias,
        citas: citasOcupacion,
        profesionalIds: ids,
        horarios,
        datosDesde,
      }),
    [dias, citasOcupacion, ids, horarios, datosDesde],
  );

  const delaSemana = useMemo(
    () => citas.filter((c) => dias.includes(c.fecha) && porId.has(c.profesionalId)),
    [citas, dias, porId],
  );
  const { desde, hasta } = rangoDeGrilla(delaSemana);
  const horas = (hasta - desde) / 60;
  const alto = (hasta - desde) * PIXELES_POR_MINUTO;

  const [diaElegido, setDiaElegido] = useState<string | null>(null);
  const diaMovil =
    diaElegido && dias.includes(diaElegido) ? diaElegido : dias.includes(hoy) ? hoy : dias[0];

  const minutosAhora = useMinutosAhora(dias.includes(hoy), zonaHoraria);
  const ahoraVisible = minutosAhora !== null && minutosAhora >= desde && minutosAhora <= hasta;

  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const seleccionada = seleccionId ? delaSemana.find((c) => c.id === seleccionId) : undefined;
  const profesionalElegido = seleccionada ? porId.get(seleccionada.profesionalId) : undefined;
  const cerrarPanel = () => {
    if (seleccionId) enfocarCita(seleccionId);
    setSeleccionId(null);
  };

  if (profesionales.length === 0) {
    return (
      <div className="card-clinical grid place-items-center px-5 py-16 text-center text-sm text-muted-foreground">
        No hay profesionales que coincidan con los filtros seleccionados.
      </div>
    );
  }

  const carriles = profesionales.length;
  const columnas = {
    "--dias": dias.length,
    "--carriles": carriles,
    "--ancho-min": `${52 + dias.length * carriles * 52}px`,
  } as CSSProperties;
  const plantilla =
    "grid grid-cols-[52px_minmax(0,1fr)] md:grid-cols-[52px_repeat(var(--dias),minmax(0,1fr))]";
  const plantillaCarriles = "grid grid-cols-[repeat(var(--carriles),minmax(0,1fr))] gap-0.5";

  return (
    <>
      <div role="group" aria-label="Día" className="flex gap-1.5 overflow-x-auto md:hidden">
        {dias.map((d) => {
          const i = weekDaysISO(fecha).indexOf(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={d === diaMovil}
              onClick={() => setDiaElegido(d)}
              className={cn(
                "flex h-14 min-w-14 flex-1 flex-col items-center justify-center rounded-xl border border-hairline bg-card text-xs font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                d === diaMovil && "border-foreground bg-foreground text-background",
              )}
            >
              <span className="font-display text-xl leading-none">{nroDiaISO(d)}</span>
              {DOW_CORTO[i]}
            </button>
          );
        })}
      </div>

      <div className="card-clinical overflow-x-auto" style={columnas}>
        <div className="md:min-w-[var(--ancho-min)]">
          <div className={cn(plantilla, "border-b border-hairline")}>
            <div />
            {dias.map((d) => {
              const i = weekDaysISO(fecha).indexOf(d);
              return (
                <div
                  key={d}
                  className={cn(
                    "border-l border-hairline px-2 pb-2 pt-3",
                    d === hoy && "bg-brand/5",
                    d !== diaMovil && "hidden md:block",
                  )}
                >
                  <p className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        "font-display text-2xl font-medium leading-none",
                        d === hoy && "text-brand-700",
                      )}
                    >
                      {nroDiaISO(d)}
                    </span>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {DOW_CORTO[i]}
                    </span>
                    {d === hoy && (
                      <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-foreground">
                        Hoy
                      </span>
                    )}
                  </p>
                  <BarraOcupacion ocupacion={ocupacion.get(d)} />
                  <div className={cn(plantillaCarriles, "mt-2")}>
                    {profesionales.map((p) => (
                      <span
                        key={p.id}
                        title={p.nombre}
                        className="truncate border-t-2 pt-0.5 text-center text-[11px] font-semibold text-muted-foreground"
                        style={{ borderTopColor: p.color }}
                      >
                        <span aria-hidden="true">{iniciales(p.nombre)}</span>
                        <span className="sr-only">{p.nombre}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={cn(plantilla, "relative")} style={{ height: alto }}>
            <div className="relative cifra text-right text-[11px] text-muted-foreground">
              {Array.from({ length: horas }).map((_, i) => (
                <div
                  key={i}
                  style={{ height: 60 * PIXELES_POR_MINUTO }}
                  className="border-b border-hairline pr-1.5 pt-1"
                >
                  {horaDeMinutos(desde + i * 60)}
                </div>
              ))}
              {ahoraVisible && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 z-20 -translate-y-1/2 bg-card px-0.5 font-medium text-cobalt-ink"
                  style={{ top: (minutosAhora - desde) * PIXELES_POR_MINUTO }}
                >
                  {horaDeMinutos(minutosAhora)}
                </span>
              )}
            </div>

            {dias.map((d) => (
              <div
                key={d}
                className={cn(
                  "relative border-l border-hairline",
                  d === hoy && "bg-brand/5",
                  d !== diaMovil && "hidden md:block",
                )}
              >
                {Array.from({ length: horas }).map((_, i) => (
                  <div
                    key={i}
                    style={{ height: 60 * PIXELES_POR_MINUTO }}
                    className="border-b border-hairline"
                  />
                ))}
                <div className={cn(plantillaCarriles, "absolute inset-0 px-0.5")}>
                  {profesionales.map((p) => (
                    <div key={p.id} className="relative">
                      <FranjasDeHorario
                        bloques={horarios?.[p.id]}
                        fecha={d}
                        desde={desde}
                        hasta={hasta}
                      />
                      {delaSemana
                        .filter((c) => c.fecha === d && c.profesionalId === p.id)
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            data-cita-id={c.id}
                            aria-label={`${etiquetaBloqueCita(c)}, ${p.nombre}`}
                            aria-expanded={c.id === seleccionId}
                            aria-controls={c.id === seleccionId ? "agenda-panel-cita" : undefined}
                            onClick={() => setSeleccionId(c.id === seleccionId ? null : c.id)}
                            className={cn(
                              "absolute inset-x-0 overflow-hidden rounded border-l-2 px-1 text-left text-[11px] leading-[1.15] transition-shadow hover:z-10 hover:shadow-md focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                              estadoClases[c.estado],
                              c.estado === "ausente" && "opacity-70",
                              c.id === seleccionId &&
                                "z-10 outline-2 outline-offset-1 outline-foreground",
                            )}
                            style={{
                              top: (c.inicio - desde) * PIXELES_POR_MINUTO + 1,
                              height: Math.max(c.duracion * PIXELES_POR_MINUTO - 2, 14),
                              borderLeftColor: p.color,
                            }}
                          >
                            {c.duracion >= 30 && (
                              <span className="block cifra text-[10px] opacity-80">
                                {horaDeMinutos(c.inicio)}
                              </span>
                            )}
                            <span className="block truncate font-semibold">
                              {apellido(c.paciente)}
                            </span>
                          </button>
                        ))}
                    </div>
                  ))}
                </div>
                {ahoraVisible && d === hoy && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5 -translate-y-px bg-cobalt"
                    style={{ top: (minutosAhora - desde) * PIXELES_POR_MINUTO }}
                  >
                    <span className="absolute -left-1 -top-1 size-2.5 rounded-full bg-cobalt" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {seleccionada && profesionalElegido && (
        <PanelCita
          cita={seleccionada}
          profesional={profesionalElegido}
          allergies={allergyAlerts?.[seleccionada.pacienteId]}
          renderAcciones={renderAcciones}
          onCerrar={cerrarPanel}
        />
      )}
    </>
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
