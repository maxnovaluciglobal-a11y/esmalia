import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { diaSemana } from "@/lib/formato-fecha";
import type { DiaDisponible, HoraDisponible } from "@/lib/reserva/disponibilidad-reserva";
import { horaCorta } from "@/lib/reserva/hora-local";

/**
 * Piezas visuales compartidas por la reserva en línea y la gestión de la
 * cita (lenguaje A+: encabezado editorial, chips redondos, tarjeta en tinta).
 */

/** Encabezado editorial: contexto chico y título Cormorant con itálica ocre. */
export function EncabezadoReserva({
  contexto,
  antes,
  enfasis,
  despues,
}: {
  contexto: ReactNode;
  antes: string;
  enfasis: string;
  despues?: string;
}) {
  return (
    <header className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{contexto}</p>
      <h1 className="font-display text-[clamp(2.25rem,8vw,3.5rem)] font-medium leading-[0.95] tracking-[-0.02em] text-balance">
        {antes} <em className="text-brand-600">{enfasis}</em>
        {despues ? ` ${despues}` : null}
      </h1>
    </header>
  );
}

/** Chip seleccionable (pastilla redonda, 44 px de alto para el dedo). */
export function ChipOpcion({
  activo,
  onClick,
  children,
  detalle,
  disabled,
  className,
}: {
  activo: boolean;
  onClick: () => void;
  children: ReactNode;
  detalle?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={activo}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-base font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        activo
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground hover:border-foreground/40",
        disabled && "cursor-not-allowed opacity-45 hover:border-border",
        className,
      )}
    >
      <span>{children}</span>
      {detalle ? (
        <span className={cn("text-sm", activo ? "text-background/75" : "text-muted-foreground")}>
          {detalle}
        </span>
      ) : null}
    </button>
  );
}

/** Indicador de pasos: "Paso 2 de 5 · Profesional" y una barra fina. */
export function IndicadorPasos({
  actual,
  total,
  nombre,
}: {
  actual: number;
  total: number;
  nombre: string;
}) {
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="kicker">
        Paso {actual} de {total} · {nombre}
      </p>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn("h-1 flex-1 rounded-full", i < actual ? "bg-brand-600" : "bg-hairline")}
          />
        ))}
      </div>
    </div>
  );
}

/** Resumen de lo elegido, en tinta (como la tarjeta de la caja). */
export function ResumenEnTintaReserva({
  filas,
  titulo,
}: {
  filas: { etiqueta: string; valor: ReactNode }[];
  titulo?: ReactNode;
}) {
  if (filas.length === 0 && !titulo) return null;
  return (
    <section
      aria-label="Tu reserva"
      className="rounded-[14px] border border-night-line bg-night p-5 text-on-night"
    >
      {titulo ? <p className="font-display text-2xl font-medium leading-tight">{titulo}</p> : null}
      {filas.length > 0 ? (
        <dl className={cn("grid gap-x-4 gap-y-2 text-sm", titulo && "mt-3")}>
          {filas.map((f) => (
            <div key={f.etiqueta} className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-on-night-2">{f.etiqueta}</dt>
              <dd className="text-right font-semibold">{f.valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

/** Tira de días + horas del día elegido (reserva y reagendar). */
export function SelectorDeHora({
  dias,
  fecha,
  onFecha,
  hora,
  onHora,
  cargando,
  onMasDias,
  hayMas,
}: {
  dias: DiaDisponible[];
  fecha: string | null;
  onFecha: (f: string) => void;
  hora: HoraDisponible | null;
  onHora: (h: HoraDisponible) => void;
  cargando: boolean;
  onMasDias?: () => void;
  hayMas?: boolean;
}) {
  const delDia = dias.find((d) => d.fecha === fecha) ?? null;
  const conHoras = dias.filter((d) => d.horas.length > 0);
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-semibold">Día</p>
        <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1" role="list">
          {dias.map((d) => {
            const libre = d.horas.length > 0;
            const activo = d.fecha === fecha;
            const [dsem, num, mes] = diaSemana(d.fecha).split(" ");
            return (
              <button
                key={d.fecha}
                type="button"
                role="listitem"
                disabled={!libre}
                aria-pressed={activo}
                aria-label={`${diaSemana(d.fecha)}${libre ? `, ${d.horas.length} horas libres` : ", sin horas"}`}
                onClick={() => onFecha(d.fecha)}
                className={cn(
                  "flex w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-[12px] border py-2 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  activo
                    ? "border-foreground bg-foreground text-background"
                    : libre
                      ? "border-border bg-card hover:border-foreground/40"
                      : "border-hairline bg-transparent text-muted-foreground/60",
                )}
              >
                <span className="text-xs font-medium">{dsem}</span>
                <span className="font-display text-2xl font-medium leading-none">{num}</span>
                <span className="text-xs">{mes}</span>
              </button>
            );
          })}
          {hayMas && onMasDias ? (
            <button
              type="button"
              onClick={onMasDias}
              className="flex w-[4.25rem] shrink-0 snap-start items-center justify-center rounded-[12px] border border-dashed border-border text-center text-xs font-semibold text-muted-foreground hover:border-foreground/40"
            >
              Más días
            </button>
          ) : null}
        </div>
      </div>

      {cargando ? (
        <p className="text-sm text-muted-foreground">Buscando horas libres…</p>
      ) : conHoras.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border p-4 text-sm text-muted-foreground">
          No quedan horas libres en estos días.
          {hayMas ? " Mira los días siguientes." : " Llama a la clínica para coordinar."}
        </p>
      ) : !delDia ? (
        <p className="text-sm text-muted-foreground">Elige un día para ver las horas.</p>
      ) : (
        <div>
          <p className="mb-2 text-sm font-semibold">Hora</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {delDia.horas.map((h) => {
              const activo = hora?.inicio === h.inicio && fecha === delDia.fecha;
              return (
                <button
                  key={h.inicio}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => onHora(h)}
                  className={cn(
                    "cifra min-h-11 rounded-full border text-base font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activo
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card hover:border-foreground/40",
                  )}
                >
                  {horaCorta(h.inicio)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
