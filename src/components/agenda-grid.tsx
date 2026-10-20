import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Flag } from "lucide-react";

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
  minutosAhoraEnZona,
  PASO_HUECO_MIN,
  semillaDeHueco,
  type SemillaCita,
} from "@/components/agenda-hueco";
import { claseBloque, tonoDeEstadoCita } from "@/lib/clinic-operations/estado-cita-tono";
import { claseEstadoBadge, etiquetaBloqueCita, rangoHorarioCita } from "@/components/cita-acciones";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EstadoCitaPastilla } from "@/components/estado-cita-pastilla";
import { cn } from "@/lib/utils";

// El borde izquierdo identifica al profesional (color guardado en
// /profesionales, ver AgendaGrid más abajo); acá solo queda fondo + texto
// según el estado de la cita.
const estadoClases = Object.fromEntries(
  Object.entries(tonoDeEstadoCita).map(([estado, tono]) => [estado, claseBloque[tono]]),
) as Record<Cita["estado"], string>;

const ALTO_HUECO = PASO_HUECO_MIN * PIXELES_POR_MINUTO;

/**
 * Minutos desde HORA_INICIO de "ahora" en el huso de la clínica, o null si la
 * vista no es hoy. Arranca en null y se calcula en el efecto: en SSR el reloj
 * del servidor no tiene por qué coincidir con el del navegador (hydration).
 */
function useMinutosAhora(activo: boolean, timeZone: string | undefined): number | null {
  const [minutos, setMinutos] = useState<number | null>(null);
  useEffect(() => {
    if (!activo) {
      setMinutos(null);
      return;
    }
    const actualizar = () => setMinutos(minutosAhoraEnZona(timeZone, new Date()));
    actualizar();
    const id = window.setInterval(actualizar, 60_000);
    return () => window.clearInterval(id);
  }, [activo, timeZone]);
  return minutos;
}

const claveHueco = (profesionalId: string, minutos: number) => `${profesionalId}:${minutos}`;

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
}) {
  const { desde, hasta } = rangoDeGrilla(citas);
  const horas = (hasta - desde) / 60;
  const alto = (hasta - desde) * PIXELES_POR_MINUTO;
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

  const minutosAhora = useMinutosAhora(esHoy, zonaHoraria);
  const ahoraVisible = minutosAhora !== null && minutosAhora >= desde && minutosAhora <= hasta;

  if (profesionales.length === 0) {
    return (
      <div className="card-clinical grid place-items-center px-5 py-16 text-center text-sm text-muted-foreground">
        No hay profesionales que coincidan con los filtros seleccionados.
      </div>
    );
  }

  return (
    // Columnas de al menos 9rem con desplazamiento horizontal propio: en el
    // celular cuatro profesionales en 390px dejaban columnas de ~70px, con el
    // nombre partido en cinco líneas (revisión en producción, 07-oct-2026).
    // La columna de horas queda fija a la izquierda.
    <div className="card-clinical overflow-hidden">
      <div className="overflow-x-auto">
        <div
          className="grid border-b border-hairline bg-secondary/40"
          style={{ gridTemplateColumns: `72px repeat(${profesionales.length}, minmax(9rem, 1fr))` }}
        >
          <div className="sticky left-0 z-20 bg-secondary p-3" />
          {profesionales.map((p) => (
            <div key={p.id} className="border-l border-hairline p-3 text-center">
              <p className="text-xs font-semibold">
                {p.nombre}{" "}
                <span className="hidden font-normal text-muted-foreground sm:inline">
                  ({p.box})
                </span>
              </p>
              {!compacta && <p className="text-[11px] text-muted-foreground">{p.especialidad}</p>}
            </div>
          ))}
        </div>

        <div
          className="relative grid"
          style={{
            height: alto,
            gridTemplateColumns: `72px repeat(${profesionales.length}, minmax(9rem, 1fr))`,
          }}
        >
          <div className="sticky left-0 z-20 flex flex-col bg-card pr-2 pt-1 cifra text-right text-[11px] text-muted-foreground">
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

          {profesionales.map((p, colIdx) => (
            <div key={p.id} className="relative border-l border-hairline">
              {Array.from({ length: horas }).map((_, i) => (
                <div
                  key={i}
                  style={{ height: 60 * PIXELES_POR_MINUTO }}
                  className="border-b border-hairline"
                />
              ))}

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
                    style={{ top: (m - desde) * PIXELES_POR_MINUTO, height: ALTO_HUECO }}
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
                  allergies={allergyAlerts?.[c.pacienteId]}
                  renderAcciones={renderAcciones}
                />
              ))}
            </div>
          ))}

          {ahoraVisible && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
              style={{ top: (minutosAhora - desde) * PIXELES_POR_MINUTO }}
            >
              <span className="w-[72px] -translate-y-px pr-1 text-right text-[11px] font-semibold cifra text-destructive">
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
  allergies,
  renderAcciones,
}: {
  cita: Cita;
  profesional: Profesional;
  /** Inicio de la grilla (minutos desde HORA_INICIO, ver `rangoDeGrilla`). */
  desde: number;
  allergies: string[] | undefined;
  renderAcciones?: (cita: Cita, profesional: Profesional) => ReactNode;
}) {
  const corta = c.duracion < 30;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={etiquetaBloqueCita(c)}
          className={cn(
            "@container absolute left-1.5 right-1.5 block overflow-hidden rounded-md border px-2 text-left leading-[1.15] transition-shadow hover:shadow-md focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:z-10 data-[state=open]:shadow-md",
            corta ? "py-0" : "py-[3px]",
            estadoClases[c.estado],
            c.estado === "ausente" && "opacity-70",
          )}
          style={{
            top: (c.inicio - desde) * PIXELES_POR_MINUTO + 1,
            height: c.duracion * PIXELES_POR_MINUTO - 3,
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
              <span
                className={corta ? "truncate" : "line-clamp-1 break-words @[11rem]:line-clamp-2"}
              >
                {c.paciente}
              </span>
              <AllergyAlertIcon allergies={allergies} />
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {/* Prioridad es una marca manual del equipo (is_priority), no
                  de la IA: va en siena con bandera, nunca en el violeta de Patty. */}
              {c.prioridad && c.duracion < 60 && (
                <span className="rounded bg-card/70 p-0.5 text-warning">
                  <Flag className="size-3" role="img" aria-label="Prioridad" />
                </span>
              )}
              {c.pacienteConfirmo && <PatientConfirmedBadge soloIcono />}
              <span className="rounded bg-card/70 px-1 py-px text-[11px] font-medium">
                {etiquetaEstado[c.estado]}
              </span>
            </span>
          </span>
          {c.duracion >= 45 && (
            <span className="mt-0.5 block truncate text-[11px] opacity-80">{c.tratamiento}</span>
          )}
          {c.prioridad && c.duracion >= 60 && (
            <span className="mt-1 inline-flex items-center gap-1 rounded bg-card/70 px-1.5 py-px text-[11px] font-medium text-warning">
              <Flag className="size-3" aria-hidden="true" /> Prioridad
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" collisionPadding={16} className="w-72 space-y-4">
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
      </PopoverContent>
    </Popover>
  );
}
