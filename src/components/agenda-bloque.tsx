import type { CSSProperties } from "react";
import { CalendarX2, CloudOff, Flag, UserCheck } from "lucide-react";

import { ASPECTO_ESTADO } from "@/components/agenda-estado";
import { horaDeMinutos } from "@/components/agenda-hueco";
import { AllergyAlertIcon } from "@/components/medical-history-card";
import type { Cita } from "@/lib/clinic-operations/clinic-data";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import { cn } from "@/lib/utils";

/** "Valentina Muñoz Soto" → "Muñoz": en un carril angosto entra el apellido. */
export function apellidoDe(paciente: string): string {
  const partes = paciente.trim().split(/\s+/);
  if (partes.length >= 3) return partes[partes.length - 2];
  return partes.length > 1 ? partes[partes.length - 1] : paciente;
}

/**
 * Caja de una cita en la grilla A+: tarjeta de 8 px de radio, línea superior
 * de 2 px con el color del profesional y el estado en fondo, borde e ícono.
 * Es `@container`: en un carril angosto (semana con varios profesionales) se
 * queda con el apellido y el ícono; con ancho aparecen la hora y el nombre
 * completo.
 */
export function claseCajaBloque(cita: Pick<Cita, "estado" | "duracion">, extra?: string) {
  return cn(
    "@container absolute overflow-hidden rounded-lg border px-1 pb-1 pt-1.5 text-left text-xs leading-tight transition-shadow",
    "hover:z-10 hover:shadow-md focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    ASPECTO_ESTADO[cita.estado].bloque,
    // 30 minutos miden 38 px: hora y nombre entran si se aprieta el aire.
    cita.duracion < 45 && "pb-0 pt-[5px] leading-[1.15]",
    extra,
  );
}

export function estiloCajaBloque(color: string | null | undefined): CSSProperties {
  return { boxShadow: `inset 0 2px 0 ${colorProfesional(color)}` };
}

/** Líneas de hora y de media hora del fondo de cada día (76 px por hora). */
export function fondoDeHoras(pxPorMinuto: number): CSSProperties {
  const hora = 60 * pxPorMinuto;
  return {
    backgroundImage:
      "linear-gradient(var(--color-hairline) 1px, transparent 1px), linear-gradient(color-mix(in srgb, var(--color-hairline) 55%, transparent) 1px, transparent 1px)",
    backgroundSize: `100% ${hora}px, 100% ${hora / 2}px`,
    backgroundPosition: `0 0, 0 ${hora / 2}px`,
  };
}

/**
 * Contenido de la caja (solo `<span>`: va adentro de un `<button>`).
 */
export function ContenidoBloque({
  cita: c,
  allergies,
  choque,
  enCola = false,
  profesional,
}: {
  cita: Cita;
  allergies?: string[];
  choque?: boolean;
  enCola?: boolean;
  /** Vista por box: el bloque nombra al profesional. */
  profesional?: string;
}) {
  const a = ASPECTO_ESTADO[c.estado];
  const corta = c.duracion < 45;
  const marcas = (
    <>
      {choque && <CalendarX2 aria-hidden className="size-3 shrink-0 text-warning" />}
      {enCola && <CloudOff aria-hidden className="size-3 shrink-0" />}
      {c.prioridad && <Flag aria-hidden className="size-3 shrink-0 text-warning" />}
      {c.pacienteConfirmo && (
        <UserCheck aria-hidden className="size-3 shrink-0 text-success" strokeWidth={2.4} />
      )}
    </>
  );
  return (
    <>
      <span
        className={cn(
          "hidden items-center gap-1 cifra text-xs font-medium @[5.5rem]:flex",
          corta && "leading-none",
          a.acento,
        )}
      >
        <a.Icono
          aria-hidden
          strokeWidth={2.4}
          className={cn("size-3 shrink-0", c.estado === "en-sala" && "size-2.5 fill-current")}
        />
        {horaDeMinutos(c.inicio)}
        <span className="ml-auto flex items-center gap-0.5">{marcas}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1 font-semibold @[5.5rem]:mt-px @[5.5rem]:text-[13px]">
        <span className={cn("truncate", a.tachado && "line-through")}>
          <span className="@[5.5rem]:hidden">{apellidoDe(c.paciente)}</span>
          <span className="hidden @[5.5rem]:inline">{c.paciente}</span>
        </span>
        <span className="hidden @[5.5rem]:inline-flex">
          <AllergyAlertIcon allergies={allergies} />
        </span>
      </span>
      {profesional && c.duracion >= 45 && (
        <span className="block truncate text-xs opacity-80">{profesional}</span>
      )}
      <span
        className={cn(
          "flex min-w-0 items-center gap-1 text-xs font-medium",
          c.estado === "en-sala" ? "text-brand-foreground/80" : "text-muted-foreground",
          corta && "@[5.5rem]:hidden",
        )}
      >
        <a.Icono
          aria-hidden
          strokeWidth={2.4}
          className={cn(
            "size-2.5 shrink-0 @[5.5rem]:hidden",
            a.acento,
            c.estado === "en-sala" && "size-2 fill-current",
          )}
        />
        <span className="truncate">{c.tratamiento}</span>
      </span>
      <span className="mt-0.5 flex gap-0.5 @[5.5rem]:hidden">
        <AllergyAlertIcon allergies={allergies} />
        {marcas}
      </span>
    </>
  );
}
