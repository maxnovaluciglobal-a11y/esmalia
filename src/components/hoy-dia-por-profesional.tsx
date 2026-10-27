import { useEffect, useMemo, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Check, CheckCheck, Circle, Clock, X, type LucideIcon } from "lucide-react";

import { horaDeMinutos } from "@/components/agenda-hueco";
import { useMinutosAhora } from "@/hooks/use-minutos-ahora";
import type { Cita, Profesional } from "@/lib/clinic-operations/clinic-data";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import {
  estiloDeCita,
  textoEstadoCita,
  type IconoEstado,
} from "@/lib/clinic-operations/estado-cita-tono";
import { cn } from "@/lib/utils";

/**
 * "El día por profesional" de Hoy (prototipo A+, tarjeta "Hoy" que se abre
 * con el día por sillón): un carril por profesional con citas hoy, las citas
 * como bloques en el tiempo y la línea de ahora. Vive dentro de la tarjeta en
 * tinta (scope `.dark`), así que los tonos de estado son los del modo oscuro.
 *
 * Cada bloque abre esa cita en la agenda del día (`?cita=`). El estado se lee
 * por forma, ícono y texto (aria-label y title), no solo por color. El
 * cobalto es solo la línea de ahora (dato), como en la agenda.
 */

/** Ancho de la columna con el nombre del profesional (px). */
const ANCHO_ETIQUETA = 140;

const ICONO: Record<IconoEstado, LucideIcon> = {
  reloj: Clock,
  check: Check,
  punto: Circle,
  "doble-check": CheckCheck,
  cruz: X,
};

/** Forma del bloque sobre tinta, por estado (la misma lógica que la pastilla). */
function claseBloque(cita: Cita): string {
  const { forma, tono } = estiloDeCita(cita);
  if (forma === "solido") return "border-transparent bg-brand-on-night text-night"; // en sala: ocre lleno
  if (forma === "texto") return "border-night-line bg-night-2 text-on-night-2"; // atendida: apagada
  if (forma === "punteado") return "border-dashed border-warning bg-night text-on-night"; // sin respuesta
  if (tono === "danger") return "border-destructive bg-transparent text-destructive line-through"; // no vino
  return "border-night-line bg-night-3 text-on-night"; // confirmada
}

function nombreCorto(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  if (partes.length < 2) return nombre;
  return `${partes[0][0]}. ${partes[partes.length - 2] ?? partes[1]}`;
}

function rangoDelDia(citas: Cita[]): { desde: number; hasta: number } {
  if (citas.length === 0) return { desde: 0, hasta: 10 * 60 };
  let desde = Math.floor(Math.min(...citas.map((c) => c.inicio)) / 60) * 60;
  let hasta = Math.ceil(Math.max(...citas.map((c) => c.inicio + c.duracion)) / 60) * 60;
  if (hasta - desde < 6 * 60) {
    hasta = desde + 6 * 60;
  }
  if (desde < -8 * 60) desde = -8 * 60;
  return { desde, hasta };
}

export function DiaPorProfesional({
  citas,
  profesionales,
  hoy,
  zonaHoraria,
}: {
  /** Citas de hoy. */
  citas: Cita[];
  profesionales: Profesional[];
  hoy: string;
  zonaHoraria?: string;
}) {
  const carriles = useMemo(() => {
    const porProfesional = new Map<string, Cita[]>();
    for (const c of citas) {
      const lista = porProfesional.get(c.profesionalId) ?? [];
      lista.push(c);
      porProfesional.set(c.profesionalId, lista);
    }
    const conocidos = profesionales
      .filter((p) => porProfesional.has(p.id))
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        // "Sin box asignado" no dice nada en un carril: solo se nombra un box real.
        box: /^sin box/i.test(p.box) ? "" : p.box,
        color: p.color,
      }));
    // Una cita de alguien que ya no figura en el catálogo igual tiene carril.
    const sueltos = [...porProfesional.keys()]
      .filter((id) => !profesionales.some((p) => p.id === id))
      .map((id) => ({ id, nombre: "Sin asignar", box: "", color: "" }));
    return [...conocidos, ...sueltos].map((p) => ({
      ...p,
      citas: (porProfesional.get(p.id) ?? []).sort((a, b) => a.inicio - b.inicio),
    }));
  }, [citas, profesionales]);

  // El rango es el del día real (de la primera a la última cita, por horas
  // enteras y al menos 6 h), no la jornada entera: así una cita de 30 min
  // tiene ancho para leerse.
  const { desde, hasta } = rangoDelDia(citas);
  const total = Math.max(hasta - desde, 60);
  const horas = Array.from({ length: Math.round(total / 60) }, (_, i) => desde + i * 60);
  const ahora = useMinutosAhora(true, zonaHoraria);
  const ahoraVisible = ahora !== null && ahora >= desde && ahora <= hasta;
  const pct = (min: number) => ((min - desde) / total) * 100;

  // En el celular los carriles se deslizan de costado: arrancan en la
  // primera cita del día (o en ahora), no en las 08:00 vacías.
  const refDesplazable = useRef<HTMLDivElement>(null);
  const primera = citas.length ? Math.min(...citas.map((c) => c.inicio)) : null;
  const ancla = ahoraVisible && ahora !== null ? ahora : primera;
  useEffect(() => {
    const caja = refDesplazable.current;
    if (!caja || ancla === null || caja.scrollWidth <= caja.clientWidth) return;
    const pista = caja.scrollWidth - ANCHO_ETIQUETA;
    caja.scrollLeft = Math.max(0, ((ancla - desde) / total) * pista - 24);
  }, [ancla, desde, total]);

  if (carriles.length === 0) {
    return <p className="py-6 text-sm text-on-night-2">No hay citas para hoy.</p>;
  }

  return (
    <div
      ref={refDesplazable}
      className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-color:var(--color-night-3)_transparent]"
    >
      <div className="relative grid min-w-[880px] grid-cols-[140px_minmax(0,1fr)] gap-y-2">
        <div aria-hidden />
        <div
          aria-hidden
          className="grid text-[11px] text-on-night-2"
          style={{ gridTemplateColumns: `repeat(${horas.length}, minmax(0, 1fr))` }}
        >
          {horas.map((h) => (
            <span key={h} className="cifra border-l border-night-line pl-1.5">
              {horaDeMinutos(h).slice(0, 2)}
            </span>
          ))}
        </div>

        {carriles.map((carril) => (
          <div key={carril.id} className="contents">
            <div className="flex min-w-0 items-center gap-2 pr-3">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: carril.color ? colorProfesional(carril.color) : undefined }}
              />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{carril.nombre}</span>
                <span className="block truncate text-[11.5px] text-on-night-2">
                  {carril.citas.length} cita{carril.citas.length === 1 ? "" : "s"}
                  {carril.box ? ` · ${carril.box}` : ""}
                </span>
              </span>
            </div>
            <ul
              aria-label={`Citas de ${carril.nombre}`}
              className="relative h-[60px] rounded-md"
              style={{
                backgroundImage: `repeating-linear-gradient(90deg, var(--color-night-line) 0 1px, transparent 1px calc(100% / ${horas.length}))`,
              }}
            >
              {carril.citas.map((c) => {
                const Icono = ICONO[estiloDeCita(c).icono];
                const hora = horaDeMinutos(c.inicio);
                const estado = textoEstadoCita(c);
                // Menos de 45 min no da para nombre y hora: iniciales y el
                // resto en el aria-label y el title.
                const corta = c.duracion < 45;
                return (
                  <li
                    key={c.id}
                    className="absolute inset-y-1"
                    style={{
                      left: `${pct(c.inicio)}%`,
                      width: `calc(${(c.duracion / total) * 100}% - 3px)`,
                    }}
                  >
                    <Link
                      to="/agenda"
                      search={{
                        q: "",
                        fecha: hoy,
                        vista: "dia",
                        sucursal: "",
                        profesional: "",
                        estado: "",
                        page: 1,
                        cita: c.id,
                      }}
                      aria-label={`${hora}, ${c.paciente}, ${c.tratamiento}. ${estado}. Abrir en la agenda`}
                      title={`${hora} · ${c.paciente} · ${c.tratamiento} · ${estado}`}
                      className={cn(
                        "flex h-full min-w-0 flex-col justify-center gap-0.5 overflow-hidden rounded-[5px] border px-2 text-left leading-tight outline-none transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-on-night",
                        claseBloque(c),
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1 text-[12px] font-semibold">
                        <Icono
                          aria-hidden
                          strokeWidth={2.4}
                          className={cn(
                            "size-3 shrink-0",
                            estiloDeCita(c).icono === "punto" && "size-2 fill-current",
                          )}
                        />
                        <span className="truncate">{nombreCorto(c.paciente)}</span>
                      </span>
                      {!corta && (
                        <span className="cifra truncate text-[11px] opacity-80">{hora}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {ahoraVisible && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-5 bottom-0 w-0.5 rounded-full bg-cobalt-on-night"
            style={{
              left: `calc(140px + (100% - 140px) * ${pct(ahora) / 100})`,
            }}
          />
        )}
      </div>
    </div>
  );
}
