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
import { ArrowUpRight, CalendarX2, CloudOff, Flag } from "lucide-react";

import { AllergyAlertIcon } from "@/components/medical-history-card";
import {
  etiquetaEstado,
  PIXELES_POR_MINUTO,
  type Cita,
  type Profesional,
} from "@/lib/clinic-operations/clinic-data";
import { PatientConfirmedBadge } from "@/components/patient-confirmed-badge";
import {
  etiquetaHueco,
  horaDeMinutos,
  rangoDeGrilla,
  huecosLibres,
  PASO_HUECO_MIN,
  semillaDeHueco,
  type SemillaCita,
} from "@/components/agenda-hueco";
import { useMinutosAhora } from "@/hooks/use-minutos-ahora";
import { claseBloque, tonoDeEstadoCita } from "@/lib/clinic-operations/estado-cita-tono";
import { claseEstadoBadge, etiquetaBloqueCita, rangoHorarioCita } from "@/components/cita-acciones";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EstadoCitaPastilla } from "@/components/estado-cita-pastilla";
import { cn } from "@/lib/utils";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { QUERY_MOVIL, QUERY_TACTIL, useMediaQuery } from "@/hooks/use-media-query";
import {
  boxDe,
  describirConflicto,
  resumenConflictos,
  type Conflicto,
} from "@/components/agenda-conflictos";
import { PanelCita } from "@/components/agenda-panel-cita";
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

// El borde izquierdo identifica al profesional (color guardado en
// /profesionales, ver AgendaGrid más abajo); acá solo queda fondo + texto
// según el estado de la cita.
const estadoClases = Object.fromEntries(
  Object.entries(tonoDeEstadoCita).map(([estado, tono]) => [estado, claseBloque[tono]]),
) as Record<Cita["estado"], string>;

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
  zonaHoraria,
  onAgendarHueco,
  renderAcciones,
  arrastre,
  conflictos,
  nombreProfesional,
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
}) {
  const { desde, hasta } = rangoDeGrilla(citas);
  const horas = (hasta - desde) / 60;
  // Celular: la cita se abre en una hoja desde abajo (el popover lateral
  // quedaba fuera de la pantalla) y la grilla se desplaza adentro de su
  // propia caja, con los nombres fijos arriba. Con el dedo, cada hueco de
  // 15 minutos mide 44px.
  const movil = useMediaQuery(QUERY_MOVIL);
  const tactil = useMediaQuery(QUERY_TACTIL);
  const ppm = tactil ? PIXELES_POR_MINUTO_TACTIL : PIXELES_POR_MINUTO;
  const altoHueco = PASO_HUECO_MIN * ppm;
  const alto = (hasta - desde) * ppm;
  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const seleccionada = movil && seleccionId ? citas.find((c) => c.id === seleccionId) : undefined;
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
    if (!movil || !caja || primerInicio === null) return;
    caja.scrollTop = Math.max(0, (primerInicio - desde) * ppm - 8);
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
      map.set(p.id, huecosLibres(citasPorProfesional.get(p.id) ?? [], hasta, desde));
    }
    return map;
  }, [huecosHabilitados, profesionales, citasPorProfesional, desde, hasta]);

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
    onAgendarHueco(semillaDeHueco({ fecha, minutos, profesional: p }), e.currentTarget);
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
    // La columna de horas queda fija a la izquierda y, en el celular, la fila
    // de profesionales queda fija arriba (la grilla se desplaza en su caja,
    // no la página). `relative` + `isolate`: lo absoluto de adentro no
    // agranda la página y los `z-*` no se cuelan sobre la barra fija.
    <>
      <div className="card-clinical relative isolate overflow-hidden [--col-horas:52px] md:[--col-horas:72px] [.agenda-arrastrando_&]:cursor-grabbing [.agenda-arrastrando_&]:select-none">
        {puedeArrastrar && (
          <p id={ID_AYUDA_ARRASTRE} className="sr-only">
            Para mover la cita: arrástrala, o usa Alt más flechas arriba y abajo para cambiar la
            hora y Alt más flechas a los lados para cambiar de profesional.
          </p>
        )}
        {profesionales.length > 1 && (
          <p className="border-b border-hairline bg-secondary/40 px-3 py-1.5 text-[11px] text-muted-foreground md:hidden">
            Desliza la grilla hacia el lado para ver a los {profesionales.length} profesionales.
          </p>
        )}
        <div
          ref={refDesplazable}
          data-agenda-desplazable=""
          className="relative overflow-x-auto max-md:max-h-[calc(100dvh-13rem)] max-md:overflow-y-auto max-md:overscroll-contain"
        >
          <div
            className="grid border-b border-hairline bg-secondary max-md:sticky max-md:top-0 max-md:z-30"
            style={{ gridTemplateColumns: plantilla }}
          >
            <div className="sticky left-0 z-20 bg-secondary p-3" />
            {profesionales.map((p) => {
              const box = boxDe(p);
              return (
                <div key={p.id} className="border-l border-hairline p-2 text-center md:p-3">
                  <p className="text-xs font-semibold">
                    {p.nombre}
                    {box && (
                      <span className="hidden font-normal text-muted-foreground sm:inline">
                        {" "}
                        ({box})
                      </span>
                    )}
                  </p>
                  {!compacta && (
                    <p className="text-[11px] text-muted-foreground">{p.especialidad}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="relative grid" style={{ height: alto, gridTemplateColumns: plantilla }}>
            <div className="sticky left-0 z-20 flex flex-col bg-card pr-2 pt-1 cifra text-right text-[11px] text-muted-foreground">
              {Array.from({ length: horas }).map((_, i) => (
                <div key={i} style={{ height: 60 * ppm }} className="border-b border-hairline">
                  {horaDeMinutos(desde + i * 60)}
                </div>
              ))}
            </div>

            {profesionales.map((p, colIdx) => (
              <div
                key={p.id}
                ref={(el) => {
                  if (el) refsCarril.current.set(p.id, el);
                  else refsCarril.current.delete(p.id);
                }}
                className="relative border-l border-hairline"
              >
                {Array.from({ length: horas }).map((_, i) => (
                  <div key={i} style={{ height: 60 * ppm }} className="border-b border-hairline" />
                ))}

                {fecha && (
                  <FranjasDeHorario
                    bloques={arrastre.horarios?.[p.id]}
                    fecha={fecha}
                    desde={desde}
                    hasta={hasta}
                    pxPorMinuto={ppm}
                  />
                )}

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
                      className="group absolute inset-x-0 flex cursor-pointer items-center px-2 text-left text-[11px] leading-none text-brand-700 transition-colors hover:bg-brand/5 focus-visible:z-10 focus-visible:bg-brand/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                      style={{ top: (m - desde) * ppm, height: altoHueco }}
                    >
                      <span
                        aria-hidden="true"
                        className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
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
                    renderAcciones={renderAcciones}
                    conflictos={conflictos?.get(c.id)}
                    nombreProfesional={nombreDe}
                    comoHoja={movil}
                    onAbrirHoja={() => setSeleccionId(c.id)}
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
          nombreProfesional={nombreDe}
          onCerrar={cerrarHoja}
        />
      )}
    </>
  );
}

/**
 * Bloque de una cita en la grilla de día. Antes era un `<Link>` a la ficha;
 * ahora es un botón que abre un popover con el resumen de la cita y sus
 * acciones (cambiar estado, cobrar, WhatsApp, ver ficha) sin salir de la
 * agenda. Radix devuelve el foco al bloque al cerrar el popover.
 *
 * Adentro del botón solo va contenido de frase (`<span>`): un `<div>` o un
 * `<p>` dentro de `<button>` es HTML inválido.
 */
function BloqueCita({
  cita: c,
  profesional: p,
  desde,
  pxPorMinuto = PIXELES_POR_MINUTO,
  allergies,
  renderAcciones,
  conflictos,
  nombreProfesional,
  comoHoja = false,
  onAbrirHoja,
  arrastrable = false,
  arrastrando = false,
  enCola = false,
  onPointerDown,
  clicDeArrastre,
  onKeyDown,
}: {
  cita: Cita;
  profesional: Profesional;
  /** Inicio de la grilla (minutos desde HORA_INICIO, ver `rangoDeGrilla`). */
  desde: number;
  pxPorMinuto?: number;
  allergies: string[] | undefined;
  renderAcciones?: (cita: Cita, profesional: Profesional) => ReactNode;
  conflictos?: Conflicto[];
  nombreProfesional: (id: string) => string;
  /** Celular: en vez del popover lateral, abre la hoja de abajo. */
  comoHoja?: boolean;
  onAbrirHoja?: () => void;
  arrastrable?: boolean;
  arrastrando?: boolean;
  /** Tiene un movimiento esperando conexión. */
  enCola?: boolean;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
  clicDeArrastre?: () => boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const corta = c.duracion < 30;
  const choque = resumenConflictos(conflictos);
  const etiqueta = [etiquetaBloqueCita(c), choque, enCola ? "Cambio en cola" : ""]
    .filter(Boolean)
    .join(". ");
  const boton = (
    <button
      type="button"
      data-cita-id={c.id}
      aria-label={etiqueta}
      aria-describedby={arrastrable ? ID_AYUDA_ARRASTRE : undefined}
      title={
        conflictos?.length
          ? conflictos.map((x) => describirConflicto(x, nombreProfesional, boxDe(p))).join("\n")
          : undefined
      }
      onPointerDown={arrastrable ? onPointerDown : undefined}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // Soltar un arrastre no abre el popover (Radix respeta defaultPrevented).
        if (clicDeArrastre?.()) {
          e.preventDefault();
          return;
        }
        if (comoHoja) onAbrirHoja?.();
      }}
      className={cn(
        "@container absolute left-1.5 right-1.5 block overflow-hidden rounded-md border px-2 text-left leading-[1.15] transition-shadow hover:shadow-md focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:z-10 data-[state=open]:shadow-md",
        corta ? "py-0" : "py-[3px]",
        estadoClases[c.estado],
        c.estado === "ausente" && "opacity-70",
        arrastrable && "cursor-grab touch-manipulation",
        arrastrando && "opacity-40 shadow-none",
        enCola && "border-dashed",
        // Choque: borde punteado en el tono de advertencia + ícono y texto
        // (no solo color).
        choque && "border-2 border-dashed border-warning-border",
      )}
      style={{
        top: (c.inicio - desde) * pxPorMinuto + 1,
        height: c.duracion * pxPorMinuto - 3,
      }}
    >
      {/* En columnas angostas (celular) el estado baja a su propia
          línea: en la misma fila le comía el nombre al paciente ("Isi d.."). */}
      <span className="flex flex-col gap-px @[11rem]:flex-row @[11rem]:items-start @[11rem]:justify-between @[11rem]:gap-1.5">
        <span className="flex min-w-0 items-start gap-1.5 text-xs font-semibold">
          <span
            aria-hidden="true"
            className="mt-[5px] size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          {/* ≥30 min hay alto para dos líneas: el apellido no se pierde
              en columnas angostas. */}
          <span className={corta ? "truncate" : "line-clamp-1 break-words @[11rem]:line-clamp-2"}>
            {c.paciente}
          </span>
          <AllergyAlertIcon allergies={allergies} />
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {choque && (
            <span
              aria-hidden="true"
              className="inline-flex items-center gap-0.5 rounded bg-warning-soft px-1 py-px text-[11px] font-semibold text-warning"
            >
              <CalendarX2 className="size-3" />
              <span className="hidden @[11rem]:inline">Choque</span>
            </span>
          )}
          {/* Prioridad es una marca manual del equipo (is_priority), no
              de la IA: va en siena con bandera, nunca en el violeta de Patty. */}
          {c.prioridad && c.duracion < 60 && (
            <span className="rounded bg-card/70 p-0.5 text-warning">
              <Flag className="size-3" role="img" aria-label="Prioridad" />
            </span>
          )}
          {enCola && (
            <span className="rounded bg-card/70 p-0.5">
              <CloudOff className="size-3" aria-hidden />
            </span>
          )}
          {c.pacienteConfirmo && <PatientConfirmedBadge soloIcono />}
          <span className="rounded bg-card/70 px-1 py-px text-[11px] font-medium">
            {etiquetaEstado[c.estado]}
          </span>
        </span>
      </span>
      {c.duracion >= 45 && (
        <span className="mt-0.5 block truncate text-[11px]">{c.tratamiento}</span>
      )}
      {c.prioridad && c.duracion >= 60 && (
        <span className="mt-1 inline-flex items-center gap-1 rounded bg-card/70 px-1.5 py-px text-[11px] font-medium text-warning">
          <Flag className="size-3" aria-hidden="true" /> Prioridad
        </span>
      )}
    </button>
  );

  if (comoHoja) return boton;
  return (
    <Popover>
      <PopoverTrigger asChild>{boton}</PopoverTrigger>
      <PopoverContent align="start" side="right" collisionPadding={16} className="w-72 space-y-4">
        <DetalleCita
          cita={c}
          profesional={p}
          allergies={allergies}
          renderAcciones={renderAcciones}
          conflictos={conflictos}
          nombreProfesional={nombreProfesional}
        />
      </PopoverContent>
    </Popover>
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
            style={{ backgroundColor: p.color }}
          />
          <span className="truncate">{p.nombre}</span>
        </dd>
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
          box={boxDe(p)}
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
function FantasmaCita({
  fantasma: f,
  desde,
  pxPorMinuto = PIXELES_POR_MINUTO,
}: {
  fantasma: Fantasma;
  desde: number;
  pxPorMinuto?: number;
}) {
  const ok = f.veredicto.ok || f.veredicto.motivo === "sin-cambio";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-1.5 right-1.5 z-30 overflow-hidden rounded-md border-2 border-dashed px-2 py-1 text-[11px] leading-tight shadow-lg",
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
        <span className="line-clamp-2">{f.veredicto.mensaje}</span>
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
}: {
  bloques: BloqueHorario[] | undefined;
  fecha: string;
  desde: number;
  hasta: number;
  pxPorMinuto?: number;
}) {
  const horario = horarioDelDia(bloques, fecha);
  if (!horario.declarado) return null;
  const franjas: { inicio: number; fin: number; tipo: "fuera" | "colacion" }[] = [];
  if (horario.tramos.length === 0) {
    franjas.push({ inicio: desde, fin: hasta, tipo: "fuera" });
  } else {
    const primero = horario.tramos[0];
    const ultimo = horario.tramos[horario.tramos.length - 1];
    if (primero.inicio > desde) franjas.push({ inicio: desde, fin: primero.inicio, tipo: "fuera" });
    for (const c of colaciones(horario)) franjas.push({ ...c, tipo: "colacion" });
    if (ultimo.fin < hasta) franjas.push({ inicio: ultimo.fin, fin: hasta, tipo: "fuera" });
  }
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
              f.tipo === "colacion"
                ? "bg-[repeating-linear-gradient(135deg,var(--color-border)_0_1px,transparent_1px_9px)]"
                : "bg-secondary/50",
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
