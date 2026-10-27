import type { ReactNode } from "react";
import { CircleSlash, Clock, TriangleAlert } from "lucide-react";

import {
  NOMBRE_SEXTANTE,
  SEXTANTES_EN_BOCA,
  rangoDelSextante,
  type ResumenSextante,
  type Sextante,
} from "@/lib/clinical/odontograma-sextantes";
import { cn } from "@/lib/utils";

/**
 * Resumen por sextante del odontograma (Ola 9, ODO-04): seis tarjetas en la
 * disposición de la boca (S1 S2 S3 arriba, S6 S5 S4 abajo). Cada tarjeta dice
 * cuántas piezas tienen algo, y con forma + ícono + texto (nunca solo color)
 * cuántas están patológicas, por realizar o ausentes. Tocarla selecciona las
 * piezas del sextante para marcarlas de una vez.
 */
export function ResumenSextantes({
  resumen,
  visibles,
  seleccionables,
  onElegir,
}: {
  resumen: ResumenSextante[];
  /** Piezas de la dentición en pantalla, en el orden del diagrama. */
  visibles: readonly number[];
  /** Con permiso de escritura, tocar un sextante selecciona sus piezas. */
  seleccionables: boolean;
  onElegir: (sextante: Sextante) => void;
}) {
  const porId = new Map(resumen.map((r) => [r.sextante, r]));
  return (
    <section
      aria-labelledby="odontograma-sextantes-titulo"
      className="mt-5 border-t border-border pt-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4
          id="odontograma-sextantes-titulo"
          className="font-display text-[22px] leading-none font-medium tracking-[-0.01em]"
        >
          Resumen <em className="text-brand-600">por sextante</em>
        </h4>
        {seleccionables && (
          <p className="text-xs text-muted-foreground">
            Toca un sextante para seleccionar sus piezas y marcarlas juntas.
          </p>
        )}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Sextantes">
        {SEXTANTES_EN_BOCA.map((s) => {
          const r = porId.get(s);
          if (!r || r.piezas === 0) return null;
          const contenido = (
            <>
              <span className="flex items-baseline justify-between gap-2">
                <span className="cifra text-[12.5px] font-semibold text-foreground">S{s}</span>
                <span className="cifra text-[11.5px] text-muted-foreground">
                  {rangoDelSextante(s, visibles)}
                </span>
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
                {NOMBRE_SEXTANTE[s]}
              </span>
              <span className="mt-2 block text-[15px] font-semibold">
                <span className="cifra text-foreground">{r.conHallazgos}</span>
                <span className="font-normal text-muted-foreground">
                  {" "}
                  de {r.piezas} con hallazgos
                </span>
              </span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {r.patologicas > 0 && (
                  <Etiqueta icono={TriangleAlert} tono="rojo">
                    {r.patologicas} patológica{r.patologicas === 1 ? "" : "s"}
                  </Etiqueta>
                )}
                {r.porRealizar > 0 && (
                  <Etiqueta icono={Clock} tono="plan">
                    {r.porRealizar} por realizar
                  </Etiqueta>
                )}
                {r.ausentes > 0 && (
                  <Etiqueta icono={CircleSlash} tono="neutro">
                    {r.ausentes} ausente{r.ausentes === 1 ? "" : "s"}
                  </Etiqueta>
                )}
                {r.conHallazgos === 0 && (
                  <span className="text-xs text-muted-foreground">Sin hallazgos</span>
                )}
              </span>
            </>
          );
          const clase =
            "block h-full w-full rounded-xl border border-border bg-background p-3 text-left";
          return (
            <li key={s}>
              {seleccionables ? (
                <button
                  type="button"
                  onClick={() => onElegir(s)}
                  aria-label={`Seleccionar las piezas del sextante ${s}, ${NOMBRE_SEXTANTE[s].toLowerCase()}`}
                  className={cn(
                    clase,
                    "transition-colors hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  )}
                >
                  {contenido}
                </button>
              ) : (
                <div className={clase}>{contenido}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Etiqueta({
  icono: Icono,
  tono,
  children,
}: {
  icono: typeof Clock;
  tono: "rojo" | "plan" | "neutro";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] font-semibold",
        tono === "rojo" && "border-destructive-border bg-destructive-soft text-destructive",
        tono === "plan" && "border-dashed border-destructive-border text-destructive",
        tono === "neutro" && "border-border bg-muted text-muted-foreground",
      )}
    >
      <Icono aria-hidden className="size-3" />
      {children}
    </span>
  );
}
