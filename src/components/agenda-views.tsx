import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

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
import {
  horaDeMinutos,
  HUECO_SEMANA_MIN,
  huecosSignificativos,
  iniciales,
  rangoDeGrilla,
  semillaDeHueco,
  type SemillaCita,
} from "@/components/agenda-hueco";
import { claseBloque, tonoDeEstadoCita } from "@/lib/clinic-operations/estado-cita-tono";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import { cn } from "@/lib/utils";
import {
  destinoPorTeclado,
  esMovible,
  horarioDelDia,
  type BloqueHorario,
  type Carril,
  type Destino,
  type HorarioDelDia,
} from "@/components/agenda-movimiento";
import { FantasmaCita, FranjasDeHorario, type ArrastreGrilla } from "@/components/agenda-grid";
import { useMinutosAhora } from "@/hooks/use-minutos-ahora";
import {
  etiquetaOcupacion,
  ocupacionDeLaSemana,
  type OcupacionDia,
} from "@/components/agenda-ocupacion";
import { PanelCita } from "@/components/agenda-panel-cita";
import { etiquetaBloqueCita } from "@/components/cita-acciones";
import { enfocarCita, ID_AYUDA_ARRASTRE, useArrastreCita } from "@/hooks/use-arrastre-cita";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { resumenConflictos, type Conflicto } from "@/components/agenda-conflictos";
import {
  ContenidoBloque,
  claseCajaBloque,
  estiloCajaBloque,
  fondoDeHoras,
} from "@/components/agenda-bloque";
import { HuecosDelCarril } from "@/components/agenda-huecos";
import { CapaDisponibilidad } from "@/components/agenda-disponibilidad";
import type { DisponibilidadGrilla } from "@/hooks/use-disponibilidad-agenda";
import {
  tramosDeApertura,
  tramosNoAgendables,
  type FranjaDisponibilidad,
} from "@/lib/clinic-operations/disponibilidad";

// Vista mes: fondo + texto según el estado (el borde es del profesional).
const estadoClases = Object.fromEntries(
  Object.entries(tonoDeEstadoCita).map(([estado, tono]) => [estado, claseBloque[tono]]),
) as Record<Cita["estado"], string>;

const DOW_CORTO = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** id → color de profesional, para pintar el borde de cada cita. */
type ColorPorProfesional = Map<string, string>;

function colorPorProfesional(
  profesionales: Pick<Profesional, "id" | "color">[],
): ColorPorProfesional {
  return new Map(profesionales.map((p) => [p.id, colorProfesional(p.color)]));
}

/** Lo que la semana necesita de la disponibilidad de la agenda (Ola 2). */
export interface DisponibilidadSemana {
  grilla: (fecha: string) => DisponibilidadGrilla;
  conAperturasDe: (horario: HorarioDelDia, fecha: string, profesionalId: string) => HorarioDelDia;
}

// ── Vista semana por carriles (PR 10b del plan A+) ───────────────────────

function BarraOcupacion({ ocupacion }: { ocupacion: OcupacionDia | undefined }) {
  if (!ocupacion || ocupacion.porcentaje === null) {
    return (
      <p className="mt-2.5 text-[11px] text-muted-foreground">
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
      className="mt-2.5 flex items-center gap-2"
    >
      <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-cobalt-soft">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-cobalt"
          style={{ width: `${ocupacion.porcentaje}%` }}
        />
      </span>
      <span className="cifra text-[11.5px] font-medium text-cobalt-ink">
        {ocupacion.porcentaje}%
      </span>
    </div>
  );
}

/**
 * Semana con un carril por profesional dentro de cada día, la ocupación del
 * día en cobalto (dato, no estado) y el panel lateral de la cita elegida.
 * La ocupación se calcula en el cliente sobre las citas ya cargadas y el
 * horario declarado (`agenda-ocupacion.ts`): no hay consulta nueva.
 *
 * A+ (fidelidad al prototipo del 19-oct): 76 px por hora, encabezado fijo
 * con el número del día en serif, huecos significativos rayados en ocre,
 * colación rayada, bloqueos de la Ola 2 y la grilla con su propio scroll
 * para que los días no se pierdan al bajar.
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
  conflictos,
  nombreProfesional,
  arrastre,
  disponibilidad,
  onAgendarHueco,
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
  /** Choques de horario por id de cita (`detectarConflictos`). */
  conflictos?: Map<string, Conflicto[]>;
  nombreProfesional?: (id: string) => string;
  /**
   * Arrastrar en la semana (AGE-02): cambia día, hora y profesional. Mismas
   * reglas que la vista de día (`validarDestino` + servidor). Sin esto, la
   * semana se ve pero no se mueve.
   */
  arrastre?: ArrastreGrilla;
  /** Bloqueos, aperturas y sucursal cerrada (Ola 2): sin esto no se dibujan. */
  disponibilidad?: DisponibilidadSemana;
  /** Clic en un hueco: abre "Nueva cita" ahí. Quien llama decide el permiso. */
  onAgendarHueco?: (semilla: SemillaCita, origen: HTMLElement) => void;
}) {
  const ids = useMemo(() => profesionales.map((p) => p.id), [profesionales]);
  const porId = useMemo(() => new Map(profesionales.map((p) => [p.id, p])), [profesionales]);
  const ppm = PIXELES_POR_MINUTO;

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

  // Franjas de disponibilidad (bloqueos, aperturas, sucursal cerrada) por
  // día y profesional, calculadas una vez.
  const franjas = useMemo(() => {
    const map = new Map<string, FranjaDisponibilidad[]>();
    if (!disponibilidad) return map;
    for (const d of dias) {
      const g = disponibilidad.grilla(d);
      for (const p of profesionales) map.set(`${d}|${p.id}`, g.franjasDe(p));
    }
    return map;
  }, [disponibilidad, dias, profesionales]);
  const paso = disponibilidad && dias[0] ? disponibilidad.grilla(dias[0]).pasoMin : undefined;

  const { desde, hasta } = rangoDeGrilla(delaSemana);
  const horas = (hasta - desde) / 60;
  const alto = (hasta - desde) * ppm;

  const [diaElegido, setDiaElegido] = useState<string | null>(null);
  const diaMovil =
    diaElegido && dias.includes(diaElegido) ? diaElegido : dias.includes(hoy) ? hoy : dias[0];

  const minutosAhora = useMinutosAhora(dias.includes(hoy), zonaHoraria);
  const ahoraVisible = minutosAhora !== null && minutosAhora >= desde && minutosAhora <= hasta;

  // Huecos significativos por carril: con las citas SIN filtros de búsqueda
  // ni estado (un filtro no libera horario). Los días pasados no tienen
  // huecos que ofrecer y hoy se recorta lo que ya pasó.
  const huecos = useMemo(() => {
    const map = new Map<string, { inicio: number; fin: number }[]>();
    for (const d of dias) {
      if (d < hoy) continue;
      for (const p of profesionales) {
        const base = horarioDelDia(horarios?.[p.id], d);
        const horario = disponibilidad ? disponibilidad.conAperturasDe(base, d, p.id) : base;
        if (!horario.declarado) continue;
        map.set(
          `${d}|${p.id}`,
          huecosSignificativos({
            atendido: horario.tramos,
            citas: citasOcupacion.filter((c) => c.fecha === d && c.profesionalId === p.id),
            noAgendables: tramosNoAgendables(franjas.get(`${d}|${p.id}`) ?? []),
            desdeMin: d === hoy ? minutosAhora : null,
            minimo: HUECO_SEMANA_MIN,
          }),
        );
      }
    }
    return map;
  }, [dias, hoy, profesionales, horarios, disponibilidad, citasOcupacion, franjas, minutosAhora]);

  // La grilla tiene su propio scroll (encabezado fijo): arranca una hora
  // antes de la primera cita, o de "ahora" si la semana es la actual.
  const refScroll = useRef<HTMLDivElement>(null);
  const primerInicio = delaSemana.length ? Math.min(...delaSemana.map((c) => c.inicio)) : null;
  useEffect(() => {
    const caja = refScroll.current;
    if (!caja) return;
    const ancla = minutosAhora !== null ? minutosAhora - 90 : primerInicio;
    if (ancla === null) return;
    caja.scrollTop = Math.max(0, (ancla - desde) * ppm - 30);
    // Solo al cambiar de semana o cuando terminan de llegar las citas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, primerInicio !== null, minutosAhora !== null]);

  // ── Arrastre (AGE-02) ──
  // Un carril por día y profesional, en orden de lectura: Alt + ←/→ pasa al
  // profesional vecino y, en el borde, al día vecino.
  const refsCarril = useRef(new Map<string, HTMLDivElement>());
  const claveCarril = (fecha: string, profesionalId: string) => `${fecha}|${profesionalId}`;
  const carrilesArrastre = useMemo<Carril[]>(
    () => dias.flatMap((d) => profesionales.map((p) => ({ fecha: d, profesionalId: p.id }))),
    [dias, profesionales],
  );
  // Solo lectura (#85): la semana vive dentro del AppShell, igual que la
  // grilla de día. El servidor repite el chequeo (`requireEscritura`).
  const soloLectura = useSoloLectura();
  const puedeArrastrar = Boolean(arrastre?.habilitado && !soloLectura);
  const soltar = (c: Cita, d: Destino) => {
    arrastre?.onMover(c, d);
    enfocarCita(c.id);
  };
  const { fantasma, alPresionar, clicDeArrastre } = useArrastreCita({
    habilitado: puedeArrastrar,
    carriles: carrilesArrastre,
    elementoDeCarril: (c) => refsCarril.current.get(claveCarril(c.fecha, c.profesionalId)),
    rango: { desde, hasta },
    validar: (c, d) =>
      arrastre?.validar(c, d) ?? { ok: false, motivo: "estado", mensaje: "No se puede mover." },
    onSoltar: soltar,
    onRechazo: (m) => arrastre?.onRechazo(m),
    pxPorMinuto: ppm,
  });

  function moverConTeclado(e: KeyboardEvent<HTMLButtonElement>, c: Cita) {
    if (!arrastre || !puedeArrastrar || !e.altKey || !esMovible(c)) return;
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    const destino = destinoPorTeclado(c, e.key, carrilesArrastre, { desde, hasta });
    if (!destino) return;
    const veredicto = arrastre.validar(c, destino);
    if (veredicto.ok) soltar(c, destino);
    else if (veredicto.motivo !== "sin-cambio") arrastre.onRechazo(veredicto.mensaje);
  }

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
    // 36 px por carril: a 1440 px la semana de 5 días con 4 profesionales
    // entra sin desplazarse. Si no entra, se desplaza adentro de la tarjeta.
    "--ancho-min": `${52 + dias.length * carriles * 36}px`,
  } as CSSProperties;
  const plantilla =
    "grid grid-cols-[52px_minmax(0,1fr)] md:grid-cols-[52px_repeat(var(--dias),minmax(0,1fr))]";
  const plantillaCarriles = "grid grid-cols-[repeat(var(--carriles),minmax(0,1fr))] gap-[3px]";

  return (
    <>
      <div role="group" aria-label="Día" className="flex gap-1.5 overflow-x-auto md:hidden">
        {dias.map((d) => {
          const i = weekDaysISO(fecha).indexOf(d);
          const elegido = d === diaMovil;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={elegido}
              onClick={() => setDiaElegido(d)}
              className={cn(
                "flex h-[54px] min-w-[58px] flex-1 flex-col items-center justify-center rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                elegido && "border-foreground bg-foreground text-background",
              )}
            >
              <span
                className={cn(
                  "font-display text-[22px] font-medium leading-none text-foreground",
                  elegido && "text-brand-on-night",
                )}
              >
                {nroDiaISO(d)}
              </span>
              {DOW_CORTO[i]}
            </button>
          );
        })}
      </div>

      {/* `relative`: sin un ancestro posicionado adentro de la caja que se
          desplaza, los `sr-only` (absolutos) de las iniciales agrandaban la
          página entera a 1549px (UX-01). `isolate`: los z-* de adentro no
          se cuelan sobre la barra fija del celular. En escritorio la grilla
          se desplaza en su caja y el encabezado de los días queda fijo. */}
      <div
        ref={refScroll}
        className="card-clinical relative isolate overflow-x-auto bg-card md:max-h-[calc(100dvh-15rem)] md:min-h-[520px] md:overflow-y-auto md:overscroll-contain"
        style={columnas}
      >
        {puedeArrastrar && (
          <p id={ID_AYUDA_ARRASTRE} className="sr-only">
            Para mover la cita: arrástrala a otro día, hora o profesional, o usa Alt más flechas
            arriba y abajo para cambiar la hora y Alt más flechas a los lados para pasar al
            profesional o al día vecino.
          </p>
        )}
        <div className="md:min-w-[var(--ancho-min)] [.agenda-arrastrando_&]:cursor-grabbing [.agenda-arrastrando_&]:select-none">
          <div className={cn(plantilla, "sticky top-0 z-30 border-b border-border bg-card")}>
            <div />
            {dias.map((d) => {
              const i = weekDaysISO(fecha).indexOf(d);
              const esHoy = d === hoy;
              return (
                <div
                  key={d}
                  className={cn(
                    "relative border-l border-border px-3 pb-2.5 pt-3.5",
                    d !== diaMovil && "hidden md:block",
                  )}
                >
                  <p className="flex items-baseline gap-2 pr-10">
                    <span
                      className={cn(
                        "font-display text-[32px] font-medium leading-none",
                        esHoy && "text-brand-600",
                      )}
                    >
                      {nroDiaISO(d)}
                    </span>
                    <span className="text-[13px] font-semibold text-muted-foreground">
                      {DOW_CORTO[i]}
                    </span>
                  </p>
                  {esHoy && (
                    <span className="absolute right-3 top-3.5 rounded-full bg-brand px-[7px] py-0.5 text-[11px] font-semibold leading-tight text-brand-foreground">
                      Hoy
                    </span>
                  )}
                  <BarraOcupacion ocupacion={ocupacion.get(d)} />
                  <div className={cn(plantillaCarriles, "mt-2.5")}>
                    {profesionales.map((p) => (
                      <span
                        key={p.id}
                        title={p.nombre}
                        className="truncate border-t-2 pt-[3px] text-center text-[10.5px] font-semibold text-muted-foreground"
                        style={{ borderTopColor: colorProfesional(p.color) }}
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
            <div className="relative cifra text-[11px] text-muted-foreground">
              {Array.from({ length: horas }).map((_, i) =>
                i === 0 ? null : (
                  <span
                    key={i}
                    className="absolute right-2 -translate-y-1/2"
                    style={{ top: i * 60 * ppm }}
                  >
                    {horaDeMinutos(desde + i * 60)}
                  </span>
                ),
              )}
              {ahoraVisible && (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 z-20 -translate-y-1/2 bg-card px-[3px] font-medium text-cobalt-ink"
                  style={{ top: (minutosAhora - desde) * ppm }}
                >
                  {horaDeMinutos(minutosAhora)}
                </span>
              )}
            </div>

            {dias.map((d) => (
              <div
                key={d}
                className={cn(
                  "relative border-l border-border",
                  d === hoy && "bg-brand-soft/40",
                  d !== diaMovil && "hidden md:block",
                )}
                style={fondoDeHoras(ppm)}
              >
                <div className={cn(plantillaCarriles, "absolute inset-0")}>
                  {profesionales.map((p) => {
                    const clave = claveCarril(d, p.id);
                    const franjasCarril = franjas.get(clave) ?? [];
                    return (
                      <div
                        key={p.id}
                        ref={(el) => {
                          if (el) refsCarril.current.set(clave, el);
                          else refsCarril.current.delete(clave);
                        }}
                        className="relative"
                      >
                        <FranjasDeHorario
                          bloques={horarios?.[p.id]}
                          fecha={d}
                          desde={desde}
                          hasta={hasta}
                          pxPorMinuto={ppm}
                          aperturas={tramosDeApertura(franjasCarril)}
                        />
                        <CapaDisponibilidad
                          franjas={franjasCarril}
                          desde={desde}
                          hasta={hasta}
                          pxPorMinuto={ppm}
                        />
                        <HuecosDelCarril
                          huecos={huecos.get(clave) ?? []}
                          desde={desde}
                          pxPorMinuto={ppm}
                          nombreProfesional={p.nombre}
                          onAgendar={
                            onAgendarHueco && !soloLectura
                              ? (inicio, origen) =>
                                  onAgendarHueco(
                                    semillaDeHueco({
                                      fecha: d,
                                      minutos: inicio,
                                      profesional: p,
                                      paso,
                                    }),
                                    origen,
                                  )
                              : undefined
                          }
                        />
                        {delaSemana
                          .filter((c) => c.fecha === d && c.profesionalId === p.id)
                          .map((c) => {
                            const choque = resumenConflictos(conflictos?.get(c.id));
                            const arrastrable = puedeArrastrar && esMovible(c);
                            const enCola = arrastre?.enCola.has(c.id) ?? false;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                data-cita-id={c.id}
                                aria-label={[
                                  `${etiquetaBloqueCita(c)}, ${c.tratamiento}, ${p.nombre}`,
                                  choque,
                                  enCola ? "Cambio en cola" : "",
                                ]
                                  .filter(Boolean)
                                  .join(". ")}
                                aria-describedby={arrastrable ? ID_AYUDA_ARRASTRE : undefined}
                                title={choque || undefined}
                                aria-expanded={c.id === seleccionId}
                                aria-controls={
                                  c.id === seleccionId ? "agenda-panel-cita" : undefined
                                }
                                onPointerDown={arrastrable ? (e) => alPresionar(e, c) : undefined}
                                onKeyDown={(e) => moverConTeclado(e, c)}
                                onClick={() => {
                                  // Soltar un arrastre no abre el panel.
                                  if (clicDeArrastre()) return;
                                  setSeleccionId(c.id === seleccionId ? null : c.id);
                                }}
                                className={claseCajaBloque(
                                  c,
                                  cn(
                                    "inset-x-0",
                                    c.id === seleccionId &&
                                      "z-10 outline-2 outline-offset-1 outline-foreground",
                                    choque && "border-2 border-dashed border-warning-border",
                                    arrastrable && "cursor-grab touch-manipulation",
                                    fantasma?.citaId === c.id && "opacity-40 shadow-none",
                                    enCola && "border-dashed",
                                  ),
                                )}
                                style={{
                                  top: (c.inicio - desde) * ppm + 1,
                                  height: Math.max(c.duracion * ppm - 3, 16),
                                  ...estiloCajaBloque(p.color),
                                }}
                              >
                                <ContenidoBloque
                                  cita={c}
                                  allergies={allergyAlerts?.[c.pacienteId]}
                                  choque={Boolean(choque)}
                                  enCola={enCola}
                                />
                              </button>
                            );
                          })}
                        {fantasma &&
                          fantasma.destino.fecha === d &&
                          fantasma.destino.profesionalId === p.id && (
                            <FantasmaCita
                              fantasma={fantasma}
                              desde={desde}
                              pxPorMinuto={ppm}
                              compacto
                            />
                          )}
                      </div>
                    );
                  })}
                </div>
                {ahoraVisible && d === hoy && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5 -translate-y-px bg-cobalt"
                    style={{ top: (minutosAhora - desde) * ppm }}
                  >
                    <span className="absolute -left-[5px] -top-1 size-2.5 rounded-full bg-cobalt" />
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
          conflictos={conflictos?.get(seleccionada.id)}
          nombreProfesional={nombreProfesional}
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
