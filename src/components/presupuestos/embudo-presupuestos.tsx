import { formatMoney } from "@/lib/finance/finance";
import { numero } from "@/lib/formato-fecha";
import type { embudo } from "@/lib/finance/presupuestos";

/** "$1.780.000" → ["$", "1.780.000"]: el símbolo va en ocre, como en la caja. */
function partirMonto(texto: string): [string, string] {
  const m = /^(-?[^\d-]*)(.*)$/.exec(texto);
  return m && m[1] ? [m[1], m[2]] : ["", texto];
}

/**
 * Embudo de presupuestos como tarjeta protagonista en tinta (A+): a la
 * izquierda lo aceptado, en grande, con la tasa de aceptación; a la derecha
 * creados → emitidos → aceptados con cantidad y monto. El cobalto es solo
 * para las barras (color de datos, `tests/sistema-color.test.ts`); el texto
 * siempre acompaña, el color no informa solo.
 */
export function EmbudoPresupuestos({
  f,
  moneda,
}: {
  f: ReturnType<typeof embudo>;
  moneda: string;
}) {
  const pasos = [
    { etiqueta: "Creados", ...f.creados },
    { etiqueta: "Emitidos", ...f.emitidos },
    { etiqueta: "Aceptados", ...f.aceptados },
  ];
  const max = Math.max(1, f.creados.montoCents);
  const [simbolo, cifra] = partirMonto(formatMoney(f.aceptados.montoCents, moneda));
  return (
    <section
      aria-label="Embudo de presupuestos"
      className="dark tinta-de-pagina grid gap-7 overflow-hidden rounded-[14px] border border-night-line bg-night p-[clamp(22px,2.6vw,36px)] text-on-night md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold tracking-[0.01em] text-on-night-2">Aceptado</p>
        <p className="mt-2.5 whitespace-nowrap font-display text-[clamp(2.75rem,11vw,3.75rem)] font-medium leading-[0.88] tracking-[-0.035em] [font-variant-numeric:lining-nums] md:text-[clamp(3rem,4.6vw,4.75rem)]">
          <span className="text-brand-on-night">{simbolo}</span>
          {cifra}
        </p>
        <p className="mt-3.5 text-sm font-medium text-on-night-2">
          {f.tasaAceptacion === null ? (
            "Sin presupuestos emitidos todavía."
          ) : (
            <>
              <b className="font-semibold text-on-night">{f.tasaAceptacion}%</b> de los emitidos se
              aceptó
            </>
          )}
        </p>
      </div>

      <ol className="grid content-center gap-4">
        {pasos.map((p) => {
          const ancho = p.montoCents > 0 ? Math.max(2, Math.round((p.montoCents * 100) / max)) : 0;
          return (
            <li key={p.etiqueta} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-[13px] font-semibold text-on-night">
                  {p.etiqueta}{" "}
                  <span className="cifra font-normal text-on-night-2">{numero(p.cantidad)}</span>
                </span>
                <span className="cifra text-[13px] text-on-night">
                  {formatMoney(p.montoCents, moneda)}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-night-3" aria-hidden>
                <div
                  className="h-full rounded-full bg-cobalt-on-night"
                  style={{ width: `${ancho}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
