import { useMemo, useState, type ReactNode } from "react";

import { BloqueCita, PIXELES_POR_MINUTO_TACTIL } from "@/components/agenda-grid";
import { horaDeMinutos, rangoDeGrilla } from "@/components/agenda-hueco";
import type { Conflicto } from "@/components/agenda-conflictos";
import { PanelCita } from "@/components/agenda-panel-cita";
import { enfocarCita } from "@/hooks/use-arrastre-cita";
import { QUERY_MOVIL, QUERY_TACTIL, useMediaQuery } from "@/hooks/use-media-query";
import { useMinutosAhora } from "@/hooks/use-minutos-ahora";
import { carrilesPorBox, type BoxDeAgenda } from "@/lib/clinic-operations/boxes";
import {
  PIXELES_POR_MINUTO,
  type Cita,
  type Profesional,
} from "@/lib/clinic-operations/clinic-data";
import { cn } from "@/lib/utils";

/**
 * Agenda del día por box (AGE-04, Ola 2): un carril por box de la sucursal,
 * en el orden de Sucursales, más "Sin box" si hace falta. Cada cita va al
 * box que tiene y, si no tiene, al de su profesional (`carrilesPorBox`).
 *
 * Reusa el bloque de la grilla por profesional (mismo popover, mismas
 * acciones, mismo aviso de choque) pero no arrastra: mover de box es cambiar
 * la cita, y eso va por "Editar" o "Mover a…", que validan el box en el
 * servidor. La vista por profesional sigue siendo la que arrastra.
 */
export function AgendaPorBox({
  citas,
  boxes,
  profesionales,
  conSucursal,
  nombreSucursal,
  allergyAlerts,
  renderAcciones,
  conflictos,
  nombreProfesional,
  esHoy = false,
  zonaHoraria,
}: {
  /** Citas del día visibles (con los filtros aplicados). */
  citas: Cita[];
  /** Boxes activos de la(s) sucursal(es) visibles, en orden. */
  boxes: BoxDeAgenda[];
  profesionales: Profesional[];
  /** Hay más de una sucursal a la vista: el carril dice de cuál es. */
  conSucursal: boolean;
  nombreSucursal: (id: string) => string;
  allergyAlerts?: Record<string, string[]>;
  renderAcciones?: (cita: Cita, profesional: Profesional) => ReactNode;
  conflictos?: Map<string, Conflicto[]>;
  nombreProfesional: (id: string) => string;
  esHoy?: boolean;
  zonaHoraria?: string;
}) {
  const movil = useMediaQuery(QUERY_MOVIL);
  const tactil = useMediaQuery(QUERY_TACTIL);
  const ppm = tactil ? PIXELES_POR_MINUTO_TACTIL : PIXELES_POR_MINUTO;
  const porId = useMemo(() => new Map(profesionales.map((p) => [p.id, p])), [profesionales]);
  const carriles = useMemo(
    () => carrilesPorBox({ boxes, citas, profesionales }),
    [boxes, citas, profesionales],
  );
  const { desde, hasta } = rangoDeGrilla(citas);
  const horas = (hasta - desde) / 60;
  const alto = (hasta - desde) * ppm;
  const minutosAhora = useMinutosAhora(esHoy, zonaHoraria);
  const ahoraVisible = minutosAhora !== null && minutosAhora >= desde && minutosAhora <= hasta;

  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const seleccionada = movil && seleccionId ? citas.find((c) => c.id === seleccionId) : undefined;
  const profesionalSeleccionado = seleccionada ? porId.get(seleccionada.profesionalId) : undefined;

  if (carriles.length === 0) {
    return (
      <div className="card-clinical grid place-items-center px-5 py-16 text-center text-sm text-muted-foreground">
        Esta sucursal no tiene boxes activos. Créalos en Sucursales → Boxes.
      </div>
    );
  }

  const plantilla = `var(--col-horas) repeat(${carriles.length}, minmax(9rem, 1fr))`;

  return (
    <>
      <div className="card-clinical relative isolate overflow-hidden [--col-horas:52px] md:[--col-horas:72px]">
        {carriles.length > 1 && (
          <p className="border-b border-hairline bg-secondary/40 px-3 py-1.5 text-[11px] text-muted-foreground md:hidden">
            Desliza la grilla hacia el lado para ver los {carriles.length} boxes.
          </p>
        )}
        <div className="relative overflow-x-auto max-md:max-h-[calc(100dvh-13rem)] max-md:overflow-y-auto max-md:overscroll-contain">
          <div
            className="grid border-b border-hairline bg-secondary max-md:sticky max-md:top-0 max-md:z-30"
            style={{ gridTemplateColumns: plantilla }}
          >
            <div className="sticky left-0 z-20 bg-secondary p-3" />
            {carriles.map((carril) => (
              <div
                key={carril.id ?? "sin-box"}
                className="border-l border-hairline p-2 text-center md:p-3"
              >
                <p
                  className={cn(
                    "text-xs font-semibold",
                    carril.id === null && "text-muted-foreground",
                  )}
                >
                  {carril.titulo}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {carril.citas.length} cita{carril.citas.length === 1 ? "" : "s"}
                  {conSucursal && carril.sucursalId
                    ? ` · ${nombreSucursal(carril.sucursalId)}`
                    : ""}
                </p>
              </div>
            ))}
          </div>

          <div className="relative grid" style={{ height: alto, gridTemplateColumns: plantilla }}>
            <div className="sticky left-0 z-20 flex flex-col bg-card pr-2 pt-1 cifra text-right text-[11px] text-muted-foreground">
              {Array.from({ length: horas }).map((_, i) => (
                <div key={i} style={{ height: 60 * ppm }} className="border-b border-hairline">
                  {horaDeMinutos(desde + i * 60)}
                </div>
              ))}
            </div>

            {carriles.map((carril) => (
              <div
                key={carril.id ?? "sin-box"}
                role="group"
                aria-label={`${carril.titulo}: ${carril.citas.length} cita${carril.citas.length === 1 ? "" : "s"}`}
                className={cn(
                  "relative border-l border-hairline",
                  carril.id === null && "bg-secondary/30",
                )}
              >
                {Array.from({ length: horas }).map((_, i) => (
                  <div key={i} style={{ height: 60 * ppm }} className="border-b border-hairline" />
                ))}
                {carril.citas.map((c) => {
                  const p = porId.get(c.profesionalId);
                  if (!p) return null;
                  return (
                    <BloqueCita
                      key={c.id}
                      cita={c}
                      profesional={p}
                      desde={desde}
                      pxPorMinuto={ppm}
                      allergies={allergyAlerts?.[c.pacienteId]}
                      renderAcciones={renderAcciones}
                      conflictos={conflictos?.get(c.id)}
                      nombreProfesional={nombreProfesional}
                      comoHoja={movil}
                      onAbrirHoja={() => setSeleccionId(c.id)}
                      conProfesional
                    />
                  );
                })}
              </div>
            ))}

            {ahoraVisible && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                style={{ top: (minutosAhora - desde) * ppm }}
              >
                <span className="w-[var(--col-horas)] -translate-y-px pr-1 text-right text-[11px] font-semibold cifra text-destructive">
                  {horaDeMinutos(minutosAhora)}
                </span>
                <span className="relative h-px flex-1 bg-destructive">
                  <span className="absolute -left-1 -top-[3px] size-[7px] rounded-full bg-destructive" />
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      {seleccionada && profesionalSeleccionado && (
        <PanelCita
          cita={seleccionada}
          profesional={profesionalSeleccionado}
          allergies={allergyAlerts?.[seleccionada.pacienteId]}
          renderAcciones={renderAcciones}
          conflictos={conflictos?.get(seleccionada.id)}
          nombreProfesional={nombreProfesional}
          onCerrar={() => {
            if (seleccionId) enfocarCita(seleccionId);
            setSeleccionId(null);
          }}
        />
      )}
    </>
  );
}
