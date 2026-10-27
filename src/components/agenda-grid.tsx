import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CalendarX2 } from "lucide-react";

import { AllergyAlertIcon } from "@/components/medical-history-card";
import {
  PIXELES_POR_MINUTO,
  type Cita,
  type Profesional,
} from "@/lib/clinic-operations/clinic-data";
import { PatientConfirmedBadge } from "@/components/patient-confirmed-badge";
import {
  etiquetaHueco,
  horaDeMinutos,
  huecosSignificativos,
  iniciales,
  rangoDeGrilla,
  huecosLibres,
  PASO_HUECO_MIN,
  semillaDeHueco,
  type SemillaCita,
} from "@/components/agenda-hueco";
import { useMinutosAhora } from "@/hooks/use-minutos-ahora";
import { etiquetaBloqueCita, rangoHorarioCita } from "@/components/cita-acciones";
import { buttonVariants } from "@/components/ui/button";
import {
  ContenidoBloque,
  claseCajaBloque,
  estiloCajaBloque,
  fondoDeHoras,
} from "@/components/agenda-bloque";
import { HuecosDelCarril, RAYADO_COLACION } from "@/components/agenda-huecos";
import { EstadoCitaPastilla } from "@/components/estado-cita-pastilla";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import { cn } from "@/lib/utils";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { QUERY_MOVIL, QUERY_TACTIL, useMediaQuery } from "@/hooks/use-media-query";
import {
  boxDe,
  boxEfectivo,
  describirConflicto,
  nombreBoxDe,
  resumenConflictos,
  type Conflicto,
} from "@/components/agenda-conflictos";
import { PanelCita } from "@/components/agenda-panel-cita";
import { CapaDisponibilidad } from "@/components/agenda-disponibilidad";
import type { DisponibilidadGrilla } from "@/hooks/use-disponibilidad-agenda";
import {
  aperturasComoRango,
  conAperturas,
  filtrarHuecosAgendables,
  restarTramos,
  tramosDeApertura,
  tramosNoAgendables,
  type FranjaDisponibilidad,
  type Tramo,
} from "@/lib/clinic-operations/disponibilidad";
import {
  colaciones,
  destinoPorTeclado,
  esMovible,
  horarioDelDia,
  type BloqueHorario,
  type Carril,
  type Destino,
  type Veredicto,
} from "@/components/agenda-movimiento";
import {
  enfocarCita,
  ID_AYUDA_ARRASTRE,
  useArrastreCita,
  type Fantasma,
} from "@/hooks/use-arrastre-cita";

/**
 * Escala de la grilla de día con el dedo: 15 minutos = 44px, el mínimo de
 * área táctil (WCAG 2.5.5). Con mouse se queda la escala de siempre.
 */
export const PIXELES_POR_MINUTO_TACTIL = 44 / PASO_HUECO_MIN;

const claveHueco = (profesionalId: string, minutos: number) => `${profesionalId}:${minutos}`;

/**
 * Reprogramar desde la grilla (PR 10 del rediseño A+): arrastre, Alt +
 * flechas y la colación dibujada.
 */
export interface ArrastreGrilla {
  /** false sin `agenda:manage` (en solo lectura la grilla lo apaga sola): se ve, pero no se mueve. */
  habilitado: boolean;
  validar: (cita: Cita, destino: Destino) => Veredicto;
  onMover: (cita: Cita, destino: Destino) => void;
  onRechazo: (mensaje: string) => void;
  /** Citas con un movimiento esperando conexión. */
  enCola: ReadonlySet<string>;
  /** Horario declarado por profesional (colación y fuera de horario). */
  horarios?: Record<string, BloqueHorario[]>;
}

export function AgendaGrid({
  compacta = false,
  citas,
  profesionales,
  allergyAlerts,
  fecha,
  esHoy = false,
  esPasado = false,
  zonaHoraria,
  onAgendarHueco,
  renderAcciones,
  arrastre,
  conflictos,
  nombreProfesional,
  disponibilidad,
  citaInicial,
}: {
  compacta?: boolean;
  citas: Cita[];
  profesionales: Profesional[];
  /** patientId -> alergias. Ausente/vacío = sin aviso (ver
   * listAllergyAlerts en medical-history.functions.ts). */
  allergyAlerts?: Record<string, string[]>;
  /** ISO yyyy-mm-dd que muestra la grilla (para la semilla de Nueva cita). */
  fecha?: string;
  /** La fecha de la vista es hoy en el huso de la clínica: dibuja la línea "ahora". */
  esHoy?: boolean;
  /** La fecha ya pasó: no se marcan huecos (no hay nada que ofrecer). */
  esPasado?: boolean;
  /** Huso de la clínica (`access.clinic?.timezone`). */
  zonaHoraria?: string;
  /** Si viene, los huecos libres son botones que abren "Nueva cita"
   * precargada. Quien llama decide el permiso (`agenda:manage`). */
  onAgendarHueco?: (semilla: SemillaCita, origen: HTMLElement) => void;
  /** Acciones extra del popover de cada cita (cambiar estado, cobrar,
   * WhatsApp). Quien llama decide qué ofrece según los permisos del rol; la
   * grilla siempre agrega "Ver ficha". */
  renderAcciones?: (cita: Cita, profesional: Profesional) => ReactNode;
  arrastre: ArrastreGrilla;
  /** Choques de horario por id de cita (`detectarConflictos`). */
  conflictos?: Map<string, Conflicto[]>;
  /** id → nombre, para describir el choque (la otra cita puede ser de otro profesional). */
  nombreProfesional?: (id: string) => string;
  /** Bloqueos, aperturas, sucursal cerrada e intervalo de la grilla (Ola 2). */
  disponibilidad?: DisponibilidadGrilla;
  /** Cita que arranca abierta en el cajón (`?cita=`, desde los carriles de Hoy). */
  citaInicial?: string;
}) {
  // Capa de disponibilidad (Ola 2): franjas por columna, calculadas una vez.
  const franjasPorProfesional = useMemo(() => {
    const map = new Map<string, FranjaDisponibilidad[]>();
    if (!disponibilidad) return map;
    for (const p of profesionales) map.set(p.id, disponibilidad.franjasDe(p));
    return map;
  }, [disponibilidad, profesionales]);
  const paso = disponibilidad?.pasoMin ?? PASO_HUECO_MIN;
  // Una apertura excepcional fuera de la jornada base estira la grilla.
  const { desde, hasta } = rangoDeGrilla([
    ...citas,
    ...[...franjasPorProfesional.values()].flatMap(aperturasComoRango),
  ]);
  const horas = (hasta - desde) / 60;
  // Celular: la cita se abre en una hoja desde abajo (el popover lateral
  // quedaba fuera de la pantalla) y la grilla se desplaza adentro de su
  // propia caja, con los nombres fijos arriba. Con el dedo, cada hueco de
  // 15 minutos mide 44px.
  const movil = useMediaQuery(QUERY_MOVIL);
  const tactil = useMediaQuery(QUERY_TACTIL);
  const ppm = tactil ? PIXELES_POR_MINUTO_TACTIL : PIXELES_POR_MINUTO;
  const altoHueco = paso * ppm;
  const alto = (hasta - desde) * ppm;
  const [seleccionId, setSeleccionId] = useState<string | null>(citaInicial ?? null);
  // La cita elegida se abre en el cajón lateral (abajo en el celular), igual
  // que en la semana: el mismo panel con recordatorios, plan y acciones.
  const seleccionada = seleccionId ? citas.find((c) => c.id === seleccionId) : undefined;
  const profesionalSeleccionado = seleccionada
    ? profesionales.find((p) => p.id === seleccionada.profesionalId)
    : undefined;
  const cerrarHoja = () => {
    if (seleccionId) enfocarCita(seleccionId);
    setSeleccionId(null);
  };
  const nombreDe = (id: string) =>
    nombreProfesional?.(id) ?? profesionales.find((p) => p.id === id)?.nombre ?? "otro profesional";

  // En el celular, al cambiar de día, la grilla arranca en la primera cita
  // (no en las 08:00 vacías).
  const refDesplazable = useRef<HTMLDivElement>(null);
  const primerInicio = citas.length ? Math.min(...citas.map((c) => c.inicio)) : null;
  // Listo cuando hay citas y columnas: las dos llegan en consultas distintas.
  const listo = primerInicio !== null && profesionales.length > 0;
  useEffect(() => {
    const caja = refDesplazable.current;
    if (!caja || primerInicio === null) return;
    caja.scrollTop = Math.max(0, (primerInicio - desde) * ppm - 30);
    // Solo al cambiar de día, de escala o cuando termina de cargar: no
    // pelear con el scroll del usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movil, fecha, ppm, listo]);
  // rendimiento 01-sep: antes .filter() por profesional adentro del .map()
  // de profesionales — O(profesionales × citas) en vez de agrupar una sola
  // vez. Se combina con que `citas` hoy llega sin acotar por fecha (ver
  // listAppointments), así que este loop corre sobre el historial completo.
  const citasPorProfesional = useMemo(() => {
    const map = new Map<string, Cita[]>();
    for (const c of citas) {
      const grupo = map.get(c.profesionalId);
      if (grupo) grupo.push(c);
      else map.set(c.profesionalId, [c]);
    }
    return map;
  }, [citas]);

  const huecosHabilitados = Boolean(onAgendarHueco && fecha);
  const huecosPorProfesional = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!huecosHabilitados) return map;
    for (const p of profesionales) {
      const libres = huecosLibres(citasPorProfesional.get(p.id) ?? [], hasta, desde, paso);
      // Sin huecos clicables en un bloqueo ni con la sucursal cerrada.
      const noAgendables = tramosNoAgendables(franjasPorProfesional.get(p.id) ?? []);
      map.set(p.id, filtrarHuecosAgendables(libres, paso, noAgendables));
    }
    return map;
  }, [
    huecosHabilitados,
    profesionales,
    citasPorProfesional,
    desde,
    hasta,
    paso,
    franjasPorProfesional,
  ]);

  // Roving tabindex: toda la capa de huecos es UNA parada de Tab (si no,
  // serían ~28 por profesional antes de llegar al listado). Adentro se navega
  // con flechas, Inicio y Fin.
  const [huecoActivo, setHuecoActivo] = useState<string | null>(null);
  const refsHuecos = useRef(new Map<string, HTMLButtonElement>());
  const claveTabulable = useMemo(() => {
    if (huecoActivo) {
      const [pid, min] = huecoActivo.split(":");
      if (huecosPorProfesional.get(pid)?.includes(Number(min))) return huecoActivo;
    }
    for (const p of profesionales) {
      const primero = huecosPorProfesional.get(p.id)?.[0];
      if (primero !== undefined) return claveHueco(p.id, primero);
    }
    return null;
  }, [huecoActivo, huecosPorProfesional, profesionales]);

  function moverFoco(e: KeyboardEvent<HTMLButtonElement>, colIdx: number, minutos: number) {
    const libres = huecosPorProfesional.get(profesionales[colIdx].id) ?? [];
    const i = libres.indexOf(minutos);
    let destino: string | null = null;
    if (e.key === "ArrowDown" && i < libres.length - 1) {
      destino = claveHueco(profesionales[colIdx].id, libres[i + 1]);
    } else if (e.key === "ArrowUp" && i > 0) {
      destino = claveHueco(profesionales[colIdx].id, libres[i - 1]);
    } else if (e.key === "Home") {
      destino = claveHueco(profesionales[colIdx].id, libres[0]);
    } else if (e.key === "End") {
      destino = claveHueco(profesionales[colIdx].id, libres[libres.length - 1]);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const paso = e.key === "ArrowRight" ? 1 : -1;
      for (let c = colIdx + paso; c >= 0 && c < profesionales.length; c += paso) {
        const otros = huecosPorProfesional.get(profesionales[c].id) ?? [];
        if (otros.length === 0) continue;
        // El hueco más cercano a la misma hora en la columna vecina.
        const cercano = otros.reduce((a, b) =>
          Math.abs(b - minutos) < Math.abs(a - minutos) ? b : a,
        );
        destino = claveHueco(profesionales[c].id, cercano);
        break;
      }
    } else {
      return;
    }
    e.preventDefault();
    if (!destino) return;
    setHuecoActivo(destino);
    refsHuecos.current.get(destino)?.focus();
  }

  function agendarEnHueco(e: MouseEvent<HTMLButtonElement>, p: Profesional, minutos: number) {
    if (!onAgendarHueco || !fecha) return;
    onAgendarHueco(semillaDeHueco({ fecha, minutos, profesional: p, paso }), e.currentTarget);
  }

  // ── Arrastre ──
  const refsCarril = useRef(new Map<string, HTMLDivElement>());
  const carriles = useMemo<Carril[]>(
    () => (fecha ? profesionales.map((p) => ({ fecha, profesionalId: p.id })) : []),
    [fecha, profesionales],
  );
  // El modo solo lectura (#85) se lee acá adentro: la grilla vive dentro
  // del AppShell, que es quien provee el contexto. El servidor repite el
  // chequeo en `moveAppointment` (requireEscritura).
  const soloLectura = useSoloLectura();
  const puedeArrastrar = Boolean(arrastre.habilitado && fecha && !soloLectura);
  const soltar = (c: Cita, d: Destino) => {
    arrastre.onMover(c, d);
    enfocarCita(c.id);
  };
  const { fantasma, alPresionar, clicDeArrastre } = useArrastreCita({
    habilitado: puedeArrastrar,
    carriles,
    elementoDeCarril: (c) => refsCarril.current.get(c.profesionalId),
    rango: { desde, hasta },
    validar: (c, d) => arrastre.validar(c, d),
    onSoltar: soltar,
    onRechazo: (m) => arrastre.onRechazo(m),
    pxPorMinuto: ppm,
  });

  function moverConTeclado(e: KeyboardEvent<HTMLButtonElement>, c: Cita) {
    if (!puedeArrastrar || !e.altKey || !esMovible(c)) return;
    const destino = destinoPorTeclado(c, e.key, carriles, { desde, hasta });
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    if (!destino) return;
    const veredicto = arrastre.validar(c, destino);
    if (veredicto.ok) soltar(c, destino);
    else if (veredicto.motivo !== "sin-cambio") arrastre.onRechazo(veredicto.mensaje);
  }

  const minutosAhora = useMinutosAhora(esHoy, zonaHoraria);
  const ahoraVisible = minutosAhora !== null && minutosAhora >= desde && minutosAhora <= hasta;

  // Huecos significativos (A+): dentro del horario declarado + aperturas, sin
  // citas, bloqueos ni lo que ya pasó. Son la marca rayada en ocre; el clic
  // lo siguen tomando las franjas de 15 minutos de arriba.
  const huecosMarcados = useMemo(() => {
    const map = new Map<string, { inicio: number; fin: number }[]>();
    if (!fecha || esPasado) return map;
    for (const p of profesionales) {
      const franjas = franjasPorProfesional.get(p.id) ?? [];
      const horario = conAperturas(
        horarioDelDia(arrastre.horarios?.[p.id], fecha),
        tramosDeApertura(franjas),
      );
      if (!horario.declarado) continue;
      map.set(
        p.id,
        huecosSignificativos({
          atendido: horario.tramos,
          citas: citasPorProfesional.get(p.id) ?? [],
          noAgendables: tramosNoAgendables(franjas),
          desdeMin: esHoy ? minutosAhora : null,
        }),
      );
    }
    return map;
  }, [
    fecha,
    esPasado,
    esHoy,
    profesionales,
    franjasPorProfesional,
    arrastre.horarios,
    citasPorProfesional,
    minutosAhora,
  ]);

  if (profesionales.length === 0) {
    return (
      <div className="card-clinical grid place-items-center px-5 py-16 text-center text-sm text-muted-foreground">
        No hay profesionales que coincidan con los filtros seleccionados.
      </div>
    );
  }

  const plantilla = `var(--col-horas) repeat(${profesionales.length}, minmax(9rem, 1fr))`;

  return (
    // Columnas de al menos 9rem con desplazamiento horizontal propio: en el
    // celular cuatro profesionales en 390px dejaban columnas de ~70px, con el
    // nombre partido en cinco líneas (revisión en producción, 07-oct-2026).
    // La columna de horas queda fija a la izquierda y la fila de
    // profesionales queda fija arriba (la grilla se desplaza en su caja, no
    // la página). `relative` + `isolate`: lo absoluto de adentro no agranda
    // la página y los `z-*` no se cuelan sobre la barra fija.
    <>
      <div className="card-clinical relative isolate overflow-hidden bg-card [--col-horas:52px] md:[--col-horas:64px] [.agenda-arrastrando_&]:cursor-grabbing [.agenda-arrastrando_&]:select-none">
        {puedeArrastrar && (
          <p id={ID_AYUDA_ARRASTRE} className="sr-only">
            Para mover la cita: arrástrala, o usa Alt más flechas arriba y abajo para cambiar la
            hora y Alt más flechas a los lados para cambiar de profesional.
          </p>
        )}
        {profesionales.length > 1 && (
          <p className="border-b border-hairline px-3 py-1.5 text-xs text-muted-foreground md:hidden">
            Desliza la grilla hacia el lado para ver a los {profesionales.length} profesionales.
          </p>
        )}
        <div
          ref={refDesplazable}
          data-agenda-desplazable=""
          className="relative overflow-auto overscroll-contain max-md:max-h-[calc(100dvh-13rem)] md:max-h-[calc(100dvh-15rem)] md:min-h-[520px]"
        >
          <div
            className="sticky top-0 z-30 grid border-b border-border bg-card"
            style={{ gridTemplateColumns: plantilla }}
          >
            <div className="sticky left-0 z-20 bg-card" />
            {profesionales.map((p) => {
              const box = boxDe(p);
              return (
                <div
                  key={p.id}
                  className="flex min-w-0 items-center gap-2.5 border-l border-border px-3 py-3"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-background"
                    style={{ backgroundColor: colorProfesional(p.color) }}
                  >
                    {iniciales(p.nombre)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.nombre}</span>
                    {!compacta && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[p.especialidad, box].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="relative grid" style={{ height: alto, gridTemplateColumns: plantilla }}>
            <div className="sticky left-0 z-20 bg-card cifra text-[11px] text-muted-foreground">
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
            </div>

            {profesionales.map((p, colIdx) => (
              <div
                key={p.id}
                ref={(el) => {
                  if (el) refsCarril.current.set(p.id, el);
                  else refsCarril.current.delete(p.id);
                }}
                className={cn("relative border-l border-border", esHoy && "bg-brand-soft/40")}
                style={fondoDeHoras(ppm)}
              >
                {fecha && (
                  <FranjasDeHorario
                    bloques={arrastre.horarios?.[p.id]}
                    fecha={fecha}
                    desde={desde}
                    hasta={hasta}
                    pxPorMinuto={ppm}
                    aperturas={tramosDeApertura(franjasPorProfesional.get(p.id) ?? [])}
                  />
                )}

                <CapaDisponibilidad
                  franjas={franjasPorProfesional.get(p.id) ?? []}
                  desde={desde}
                  hasta={hasta}
                  pxPorMinuto={ppm}
                />

                <div aria-hidden="true">
                  <HuecosDelCarril
                    huecos={huecosMarcados.get(p.id) ?? []}
                    desde={desde}
                    pxPorMinuto={ppm}
                    nombreProfesional={p.nombre}
                  />
                </div>

                {(huecosPorProfesional.get(p.id) ?? []).map((m) => {
                  const clave = claveHueco(p.id, m);
                  return (
                    <button
                      key={clave}
                      ref={(el) => {
                        if (el) refsHuecos.current.set(clave, el);
                        else refsHuecos.current.delete(clave);
                      }}
                      type="button"
                      tabIndex={clave === claveTabulable ? 0 : -1}
                      aria-label={etiquetaHueco(p.nombre, m)}
                      onFocus={() => setHuecoActivo(clave)}
                      onKeyDown={(e) => moverFoco(e, colIdx, m)}
                      onClick={(e) => agendarEnHueco(e, p, m)}
                      className="group absolute inset-x-0 flex cursor-pointer items-center px-2 text-left text-[11px] leading-none text-brand-700 transition-colors hover:bg-brand/10 focus-visible:z-10 focus-visible:bg-brand/10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                      style={{ top: (m - desde) * ppm, height: altoHueco }}
                    >
                      <span
                        aria-hidden="true"
                        className="ml-auto rounded bg-card px-1 cifra opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      >
                        + {horaDeMinutos(m)}
                      </span>
                    </button>
                  );
                })}

                {(citasPorProfesional.get(p.id) ?? []).map((c) => (
                  <BloqueCita
                    key={c.id}
                    cita={c}
                    profesional={p}
                    desde={desde}
                    pxPorMinuto={ppm}
                    allergies={allergyAlerts?.[c.pacienteId]}
                    conflictos={conflictos?.get(c.id)}
                    nombreProfesional={nombreDe}
                    seleccionada={c.id === seleccionId}
                    onAbrir={() => setSeleccionId(c.id === seleccionId ? null : c.id)}
                    arrastrable={puedeArrastrar && esMovible(c)}
                    arrastrando={fantasma?.citaId === c.id}
                    enCola={arrastre.enCola.has(c.id)}
                    onPointerDown={(e) => alPresionar(e, c)}
                    clicDeArrastre={clicDeArrastre}
                    onKeyDown={(e) => moverConTeclado(e, c)}
                  />
                ))}

                {fantasma && fantasma.destino.profesionalId === p.id && (
                  <FantasmaCita fantasma={fantasma} desde={desde} pxPorMinuto={ppm} />
                )}
              </div>
            ))}

            {ahoraVisible && <LineaAhora minutos={minutosAhora} desde={desde} pxPorMinuto={ppm} />}
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
          nombreProfesional={nombreDe}
          onCerrar={cerrarHoja}
        />
      )}
    </>
  );
}

/**
 * Línea de "ahora" en cobalto (dato, no estado), con la hora en la columna
 * de horas. La comparten la vista de día y la de box.
 */
export function LineaAhora({
  minutos,
  desde,
  pxPorMinuto,
}: {
  minutos: number;
  desde: number;
  pxPorMinuto: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
      style={{ top: (minutos - desde) * pxPorMinuto }}
    >
      <span className="sticky left-0 w-[var(--col-horas)] -translate-y-px bg-card pr-1.5 text-right text-[11px] font-medium cifra text-cobalt-ink">
        {horaDeMinutos(minutos)}
      </span>
      <span className="relative h-0.5 flex-1 bg-cobalt">
        <span className="absolute -left-[5px] -top-1 size-2.5 rounded-full bg-cobalt" />
      </span>
    </div>
  );
}

/**
 * Bloque de una cita en la grilla de día y en la de box. Es un botón que
 * abre el cajón lateral de la cita (abajo en el celular) con su resumen y sus
 * acciones, sin salir de la agenda. Antes abría un popover; el cajón A+ es el
 * mismo de la semana.
 *
 * Adentro del botón solo va contenido de frase (`<span>`): un `<div>` o un
 * `<p>` dentro de `<button>` es HTML inválido.
 */
export function BloqueCita({
  cita: c,
  profesional: p,
  desde,
  pxPorMinuto = PIXELES_POR_MINUTO,
  allergies,
  conflictos,
  nombreProfesional,
  seleccionada = false,
  onAbrir,
  arrastrable = false,
  arrastrando = false,
  enCola = false,
  onPointerDown,
  clicDeArrastre,
  onKeyDown,
  conProfesional = false,
}: {
  cita: Cita;
  profesional: Profesional;
  /** Inicio de la grilla (minutos desde HORA_INICIO, ver `rangoDeGrilla`). */
  desde: number;
  pxPorMinuto?: number;
  allergies: string[] | undefined;
  conflictos?: Conflicto[];
  nombreProfesional: (id: string) => string;
  /** Es la cita abierta en el cajón. */
  seleccionada?: boolean;
  onAbrir?: () => void;
  arrastrable?: boolean;
  arrastrando?: boolean;
  /** Tiene un movimiento esperando conexión. */
  enCola?: boolean;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
  clicDeArrastre?: () => boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  /** Vista por box: el carril no dice el profesional, lo dice el bloque. */
  conProfesional?: boolean;
}) {
  const choque = resumenConflictos(conflictos);
  const etiqueta = [
    `${etiquetaBloqueCita(c)}, ${c.tratamiento}`,
    conProfesional ? p.nombre : "",
    choque,
    enCola ? "Cambio en cola" : "",
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <button
      type="button"
      data-cita-id={c.id}
      aria-label={etiqueta}
      aria-describedby={arrastrable ? ID_AYUDA_ARRASTRE : undefined}
      aria-expanded={seleccionada}
      aria-controls={seleccionada ? "agenda-panel-cita" : undefined}
      title={
        conflictos?.length
          ? conflictos
              .map((x) => describirConflicto(x, nombreProfesional, nombreBoxDe(c, p)))
              .join("\n")
          : undefined
      }
      onPointerDown={arrastrable ? onPointerDown : undefined}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // Soltar un arrastre no abre el cajón.
        if (clicDeArrastre?.()) {
          e.preventDefault();
          return;
        }
        onAbrir?.();
      }}
      className={claseCajaBloque(
        c,
        cn(
          "left-1 right-1 px-2",
          seleccionada && "z-10 outline-2 outline-offset-1 outline-foreground",
          arrastrable && "cursor-grab touch-manipulation",
          arrastrando && "opacity-40 shadow-none",
          enCola && "border-dashed",
          // Choque: borde punteado en el tono de advertencia + ícono y texto
          // (no solo color).
          choque && "border-2 border-dashed border-warning-border",
        ),
      )}
      style={{
        top: (c.inicio - desde) * pxPorMinuto + 1,
        height: Math.max(c.duracion * pxPorMinuto - 3, 16),
        ...estiloCajaBloque(p.color),
      }}
    >
      <ContenidoBloque
        cita={c}
        allergies={allergies}
        choque={Boolean(choque)}
        enCola={enCola}
        profesional={conProfesional ? p.nombre : undefined}
      />
    </button>
  );
}

/**
 * Resumen de la cita con sus acciones: lo usa el popover de la grilla de día
 * y el panel lateral de la semana.
 */
export function DetalleCita({
  cita: c,
  profesional: p,
  allergies,
  renderAcciones,
  conflictos,
  nombreProfesional,
}: {
  cita: Cita;
  profesional: Profesional;
  allergies: string[] | undefined;
  renderAcciones?: (cita: Cita, profesional: Profesional) => ReactNode;
  /** Choques de horario de esta cita (`detectarConflictos`). */
  conflictos?: Conflicto[];
  nombreProfesional?: (id: string) => string;
}) {
  return (
    <>
      <div className="space-y-1">
        <p className="flex items-start gap-1.5 font-display text-base font-semibold leading-tight">
          <span className="min-w-0 break-words">{c.paciente}</span>
          <AllergyAlertIcon allergies={allergies} />
        </p>
        <p className="text-sm cifra text-muted-foreground">
          {rangoHorarioCita(c)} · {c.duracion} min
        </p>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Tratamiento</dt>
        <dd className="break-words">{c.tratamiento || "Sin tratamiento"}</dd>
        <dt className="text-muted-foreground">Profesional</dt>
        <dd className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: colorProfesional(p.color) }}
          />
          <span className="truncate">{p.nombre}</span>
        </dd>
        <dt className="text-muted-foreground">Box</dt>
        <dd className="break-words">{textoBox(c, p)}</dd>
        <dt className="text-muted-foreground">Estado</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          <EstadoCitaPastilla cita={{ estado: c.estado }} />
          {c.pacienteConfirmo && <PatientConfirmedBadge compacto />}
        </dd>
      </dl>
      {conflictos && conflictos.length > 0 && (
        <AvisoDeChoques
          conflictos={conflictos}
          nombreProfesional={nombreProfesional ?? (() => "otro profesional")}
          box={nombreBoxDe(c, p)}
          titulo="Choque de horario"
        />
      )}
      <div className="flex flex-col gap-2">
        {renderAcciones?.(c, p)}
        <Link
          to="/pacientes/$pacienteId"
          params={{ pacienteId: c.pacienteId }}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "justify-between")}
        >
          Ver ficha
          <ArrowUpRight aria-hidden />
        </Link>
      </div>
    </>
  );
}

/** "Box 2", "Box 1 (del profesional)" o "Sin box". */
function textoBox(c: Cita, p: Profesional): string {
  const box = boxEfectivo(c, p);
  if (!box) return "Sin box";
  return box.propio ? box.nombre : `${box.nombre} (del profesional)`;
}

/**
 * Lista de choques con texto (no solo color): la usan el detalle de la cita
 * y los formularios de Nueva cita, Editar y Agendar solicitud.
 */
export function AvisoDeChoques({
  conflictos,
  nombreProfesional,
  box,
  titulo,
  pie,
}: {
  conflictos: Conflicto[];
  nombreProfesional: (id: string) => string;
  /** Box del profesional de esta cita, para nombrarlo en el choque de box. */
  box?: string | null;
  titulo: string;
  pie?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="rounded-lg border border-warning-border/60 bg-warning-soft px-3 py-2 text-xs text-warning"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <CalendarX2 className="size-3.5 shrink-0" aria-hidden />
        {titulo}
      </p>
      <ul className="mt-1 space-y-0.5">
        {conflictos.map((x) => (
          <li key={`${x.tipo}-${x.cita.id}`} className="break-words">
            {describirConflicto(x, nombreProfesional, box)}
          </li>
        ))}
      </ul>
      {pie && <p className="mt-1.5 text-foreground/80">{pie}</p>}
    </div>
  );
}

/**
 * Dónde caería la cita mientras se arrastra, con la hora destino visible
 * antes de soltar. Si no se puede soltar ahí, lo dice (y en rojo, con
 * borde punteado y texto: no solo color).
 */
export function FantasmaCita({
  fantasma: f,
  desde,
  pxPorMinuto = PIXELES_POR_MINUTO,
  compacto = false,
}: {
  fantasma: Fantasma;
  desde: number;
  pxPorMinuto?: number;
  /** Carril angosto (semana): sin márgenes y con el motivo en un globo encima. */
  compacto?: boolean;
}) {
  const ok = f.veredicto.ok || f.veredicto.motivo === "sin-cambio";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-30 rounded-md border-2 border-dashed text-[11px] leading-tight shadow-lg",
        compacto ? "inset-x-0 px-0.5" : "left-1.5 right-1.5 overflow-hidden px-2 py-1",
        ok
          ? "border-brand-700 bg-brand/10 text-foreground"
          : "border-destructive bg-destructive/10 text-destructive",
      )}
      style={{
        top: (f.destino.inicio - desde) * pxPorMinuto + 1,
        height: Math.max(f.duracion * pxPorMinuto - 3, 18),
      }}
    >
      <span className="block font-semibold tabular-nums">
        {horaDeMinutos(f.destino.inicio)}–{horaDeMinutos(f.destino.inicio + f.duracion)}
      </span>
      {!f.veredicto.ok && f.veredicto.motivo !== "sin-cambio" && (
        <span
          className={
            compacto
              ? "absolute left-0 top-full mt-1 w-48 rounded-md border border-destructive bg-card px-2 py-1 text-destructive shadow-md"
              : "line-clamp-2"
          }
        >
          {f.veredicto.mensaje}
        </span>
      )}
    </div>
  );
}

/**
 * Colación (entre dos tramos del día) y fuera de horario, dibujados en la
 * columna del profesional: así se ve antes de soltar por qué un destino no
 * se puede.
 */
export function FranjasDeHorario({
  bloques,
  fecha,
  desde,
  hasta,
  pxPorMinuto = PIXELES_POR_MINUTO,
  aperturas = [],
}: {
  bloques: BloqueHorario[] | undefined;
  fecha: string;
  desde: number;
  hasta: number;
  pxPorMinuto?: number;
  /** Aperturas excepcionales (AGE-08): ahí no se dibuja "fuera de horario". */
  aperturas?: Tramo[];
}) {
  const horario = horarioDelDia(bloques, fecha);
  if (!horario.declarado) return null;
  const crudas: { inicio: number; fin: number; tipo: "fuera" | "colacion" }[] = [];
  if (horario.tramos.length === 0) {
    crudas.push({ inicio: desde, fin: hasta, tipo: "fuera" });
  } else {
    const primero = horario.tramos[0];
    const ultimo = horario.tramos[horario.tramos.length - 1];
    if (primero.inicio > desde) crudas.push({ inicio: desde, fin: primero.inicio, tipo: "fuera" });
    for (const c of colaciones(horario)) crudas.push({ ...c, tipo: "colacion" });
    if (ultimo.fin < hasta) crudas.push({ inicio: ultimo.fin, fin: hasta, tipo: "fuera" });
  }
  const franjas = crudas.flatMap((f) =>
    restarTramos([f], aperturas).map((t) => ({ ...t, tipo: f.tipo })),
  );
  return (
    <>
      {franjas.map((f) => {
        const top = (Math.max(f.inicio, desde) - desde) * pxPorMinuto;
        const alto = (Math.min(f.fin, hasta) - Math.max(f.inicio, desde)) * pxPorMinuto;
        if (alto <= 0) return null;
        return (
          <div
            key={`${f.tipo}-${f.inicio}`}
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 grid place-items-center text-[11px] text-muted-foreground",
              f.tipo === "colacion" ? RAYADO_COLACION : "bg-secondary/50",
            )}
            style={{ top, height: alto }}
          >
            {f.tipo === "colacion" && alto >= 18 ? "Colación" : null}
          </div>
        );
      })}
    </>
  );
}
