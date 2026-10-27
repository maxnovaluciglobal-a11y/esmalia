import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { DiaPorProfesional } from "@/components/hoy-dia-por-profesional";
import { PattyCara } from "@/components/patty-cara";
import type { Cita, Profesional } from "@/lib/clinic-operations/clinic-data";
import { claseTexto, type TonoEstado } from "@/lib/clinic-operations/estado-cita-tono";
import { cn } from "@/lib/utils";

/**
 * Tarjeta protagonista de Hoy (pase A+ del 27-oct-2026): la tarjeta "Hoy" del
 * prototipo, en tinta como la de la caja. Arriba la cifra del día (lo cobrado
 * para quien ve finanzas; las citas para el resto) con su desglose mínimo y
 * cuatro cifras chicas; abajo el día por profesional y una franja con lo que
 * queda por despachar y Patty en habilitación.
 *
 * Lleva `.dark tinta-de-pagina` como el sidebar: adentro los tonos de estado
 * son los del modo oscuro (se leen sobre tinta) y la tinta es la de la página.
 * Es solo presentación: los permisos (finance:view, agenda:manage) los decide
 * Hoy, que tampoco pide los datos que el rol no puede ver.
 */

export interface CifraChica {
  label: string;
  valor: string;
  nota: string;
  tonoNota?: TonoEstado;
}

export interface CifraProtagonista {
  label: string;
  /** Texto ya formateado ("$1.284.000", "12"). */
  valor: string;
  /** Parte en ocre: el símbolo de la moneda o la unidad ("citas"). */
  acento?: { texto: string; lado: "antes" | "despues" };
  desglose: ReactNode;
}

export function TarjetaDelDia({
  protagonista,
  cifras,
  citasHoy,
  profesionales,
  hoy,
  zonaHoraria,
  cargando,
  conError,
  enlaceAgenda,
  avisosPorDespachar,
  pattyEnHabilitacion,
}: {
  protagonista: CifraProtagonista;
  cifras: CifraChica[];
  citasHoy: Cita[];
  profesionales: Profesional[];
  hoy: string;
  zonaHoraria?: string;
  cargando: boolean;
  /** La agenda no cargó: los carriles dicen eso en vez de "día libre" (regla 11). */
  conError: boolean;
  enlaceAgenda: ReactNode;
  /** null = el rol no despacha avisos (sin agenda:manage). */
  avisosPorDespachar: number | null;
  pattyEnHabilitacion: boolean;
}) {
  const { acento } = protagonista;
  return (
    <section
      aria-labelledby="hoy-tinta-titulo"
      className="dark tinta-de-pagina overflow-hidden rounded-[14px] border border-night-line bg-night p-[clamp(20px,2.6vw,36px)] text-on-night"
    >
      <h2 id="hoy-tinta-titulo" className="sr-only">
        Resumen de hoy
      </h2>
      <div className="grid gap-7 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-end">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold tracking-[0.01em] text-on-night-2">
            {protagonista.label}
          </p>
          <p className="mt-2.5 whitespace-nowrap font-display text-[clamp(3rem,13vw,4.25rem)] font-medium leading-[0.88] tracking-[-0.035em] [font-variant-numeric:lining-nums] md:text-[clamp(3.5rem,5.4vw,5.5rem)]">
            {cargando ? (
              <span className="text-on-night-2">—</span>
            ) : (
              <>
                {acento?.lado === "antes" && (
                  <span className="text-brand-on-night">{acento.texto}</span>
                )}
                {protagonista.valor}
                {acento?.lado === "despues" && (
                  <em className="ml-3 text-[0.5em] tracking-[-0.01em] text-brand-on-night">
                    {acento.texto}
                  </em>
                )}
              </>
            )}
          </p>
          <p className="mt-3.5 text-sm font-medium text-on-night-2 [&_b]:font-semibold [&_b]:text-on-night">
            {protagonista.desglose}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 border-t border-night-line pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-7">
          {cifras.map((k) => (
            <div key={k.label} className="min-w-0">
              <dt className="truncate text-[12.5px] font-semibold text-on-night-2">{k.label}</dt>
              <dd className="mt-1 whitespace-nowrap font-display text-[clamp(1.75rem,6vw,2.25rem)] font-medium leading-none [font-variant-numeric:lining-nums]">
                {cargando ? "—" : k.valor}
              </dd>
              <dd
                className={cn(
                  "mt-1 truncate text-[12.5px]",
                  !cargando && k.tonoNota ? claseTexto[k.tonoNota] : "text-on-night-2",
                )}
              >
                {cargando ? " " : k.nota}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-7 border-t border-night-line pt-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-display text-[26px] font-medium leading-none">
            El día <em className="text-brand-on-night">por profesional</em>
          </h3>
          {enlaceAgenda}
        </div>
        {conError ? (
          <p className="py-6 text-sm text-on-night-2">
            No pudimos cargar la agenda de hoy: los carriles vuelven cuando cargue.
          </p>
        ) : cargando ? (
          <p className="py-6 text-sm text-on-night-2">Cargando el día…</p>
        ) : (
          <DiaPorProfesional
            citas={citasHoy}
            profesionales={profesionales}
            hoy={hoy}
            zonaHoraria={zonaHoraria}
          />
        )}
      </div>

      {(avisosPorDespachar !== null || pattyEnHabilitacion) && (
        <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-night-line pt-4 text-[13.5px] font-medium text-on-night-2">
          {avisosPorDespachar !== null && (
            <p className="min-w-0">
              {avisosPorDespachar > 0 ? (
                <>
                  <b className="font-semibold text-on-night">
                    {avisosPorDespachar} aviso{avisosPorDespachar === 1 ? "" : "s"}
                  </b>{" "}
                  listo{avisosPorDespachar === 1 ? "" : "s"} para despachar. Nada sale solo: los
                  envía recepción, con un toque.{" "}
                  <Link
                    to="/recordatorios"
                    className="rounded-sm font-semibold text-brand-on-night underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-on-night"
                  >
                    Revisar
                  </Link>
                </>
              ) : (
                "Sin avisos por despachar. Los recordatorios aparecen solos y los envía recepción."
              )}
            </p>
          )}
          {pattyEnHabilitacion && (
            <span className="inline-flex items-center gap-2 text-ai">
              <PattyCara px={18} decorativa />
              Patty, en habilitación
            </span>
          )}
        </div>
      )}
    </section>
  );
}
