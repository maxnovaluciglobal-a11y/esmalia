import { Link } from "@tanstack/react-router";

import type { AlertaVisible, Gravedad } from "@/lib/panel/panel-por-rol";
import { cn } from "@/lib/utils";

/**
 * "Lo que requiere acción" de Hoy (Ola 11 · PAN-03): las alertas accionables
 * del rol, cada una con su enlace. Va arriba de la tarjeta del día. Mismo
 * lenguaje que la cola "Para resolver hoy" a la que reemplaza: número en
 * Cormorant ocre, título, detalle y la acción. La gravedad se marca con un
 * punto de color y con texto (no solo color).
 */

const MARCA: Record<Gravedad, { clase: string; texto: string }> = {
  urgente: { clase: "bg-destructive", texto: "Urgente" },
  atencion: { clase: "bg-warning", texto: "Atención" },
  aviso: { clase: "bg-muted-foreground/50", texto: "Aviso" },
};

const FILA =
  "flex min-h-14 items-center gap-3.5 px-5 py-3 outline-none hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

function Contenido({ a }: { a: AlertaVisible }) {
  const marca = MARCA[a.gravedad];
  return (
    <>
      <span className="w-10 shrink-0 font-display text-[28px] font-medium leading-none text-brand-600 [font-variant-numeric:lining-nums]">
        {a.n > 99 ? "99+" : a.n}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", marca.clase)} />
          <span className="sr-only">{marca.texto}: </span>
          <span className="truncate text-[15px] font-medium">{a.titulo}</span>
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">{a.detalle}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-brand-700">{a.cta} →</span>
    </>
  );
}

export function AlertasDeHoy({
  alertas,
  cargando,
  conError,
}: {
  alertas: AlertaVisible[];
  cargando: boolean;
  conError: boolean;
}) {
  return (
    <section
      aria-labelledby="requiere-accion"
      className="overflow-hidden rounded-[14px] border border-hairline bg-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-[18px] pb-3">
        <h2 id="requiere-accion" className="font-display text-[26px] font-medium leading-none">
          Lo que requiere <em className="text-brand-600">acción</em>
        </h2>
        {!cargando && alertas.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {alertas.length} {alertas.length === 1 ? "tema" : "temas"}, lo urgente primero
          </p>
        )}
      </div>
      {alertas.length === 0 ? (
        <p className="border-t border-hairline px-5 py-4 text-sm text-muted-foreground">
          {cargando
            ? "Revisando lo pendiente…"
            : conError
              ? "No pudimos revisar todo lo pendiente. Vuelve a cargar en un momento."
              : "Nada que requiera acción por ahora. Lo que necesite tu atención aparece acá."}
        </p>
      ) : (
        <ul className="-mb-px grid border-t border-hairline lg:grid-cols-2 [&>li]:border-b [&>li]:border-hairline lg:[&>li:nth-child(odd)]:border-r">
          {alertas.map((a) => (
            <li key={a.tipo} data-alerta={a.tipo} className="min-w-0">
              {a.enlace.startsWith("#") ? (
                <a href={a.enlace} className={FILA}>
                  <Contenido a={a} />
                </a>
              ) : (
                <Link to={a.enlace} className={FILA}>
                  <Contenido a={a} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
