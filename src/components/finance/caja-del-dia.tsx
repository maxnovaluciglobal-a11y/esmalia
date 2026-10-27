/**
 * Piezas de la caja del día del rediseño A+ (pase de fidelidad, 26-oct-2026):
 * la tarjeta en tinta con lo cobrado, los movimientos con filtro por medio,
 * las atendidas sin cobro y las comisiones del día.
 *
 * El cobalto acá es solo de datos (barras por hora y mezcla por medio), como
 * pide el LEEME del prototipo; la lista blanca vive en tests/sistema-color.
 */
import { useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Wallet } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import {
  filtrarPorMedio,
  nombreCorto,
  type AtendidaSinCobro,
  type ComisionDelDia,
  type MedioDelDia,
  type MovimientoDelDia,
  type ResumenCajaDelDia,
} from "@/lib/finance/caja-del-dia";
import { formatMoney } from "@/lib/finance/finance";
import { fecha } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

/** Panel del prototipo: tarjeta con radio 14 px y borde fino. */
export const PANEL = "rounded-[14px] border border-hairline bg-card";

/**
 * Colores de la mezcla por medio, en orden (efectivo primero). Sobre tinta
 * van del cobalto claro al casi papel; sobre la tarjeta, del cobalto lleno
 * al suave. El texto del medio siempre acompaña: el color no informa solo.
 */
const COLOR_MEDIO_TINTA = [
  "var(--color-cobalt-on-night)",
  "color-mix(in srgb, var(--color-cobalt-on-night) 62%, var(--color-on-night))",
  "color-mix(in srgb, var(--color-cobalt-on-night) 34%, var(--color-on-night))",
  "var(--color-on-night)",
  "var(--color-on-night-2)",
];
const COLOR_MEDIO_PAPEL = [
  "var(--color-cobalt)",
  "color-mix(in srgb, var(--color-cobalt) 68%, var(--color-card))",
  "color-mix(in srgb, var(--color-cobalt) 44%, var(--color-card))",
  "color-mix(in srgb, var(--color-cobalt) 24%, var(--color-card))",
  "var(--color-muted-foreground)",
];

function colorDeMedio(indice: number, sobre: "tinta" | "papel"): string {
  const paleta = sobre === "tinta" ? COLOR_MEDIO_TINTA : COLOR_MEDIO_PAPEL;
  return paleta[Math.min(indice, paleta.length - 1)];
}

/** "$1.284.000" → ["$", "1.284.000"]: el símbolo va en ocre. */
function partirMonto(texto: string): [string, string] {
  const m = /^(-?[^\d-]*)(.*)$/.exec(texto);
  return m && m[1] ? [m[1], m[2]] : ["", texto];
}

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}

// ─── Tarjeta en tinta ────────────────────────────────────────────────────

export function ResumenEnTinta({
  resumen,
  currency,
  onVerDesglose,
}: {
  resumen: ResumenCajaDelDia;
  currency: string;
  /** Desglose del turno abierto (efectivo contra banco); sin caja abierta no hay. */
  onVerDesglose?: () => void;
}) {
  const [simbolo, cifra] = partirMonto(formatMoney(resumen.cobradoCents, currency));
  const maxHora = Math.max(...resumen.porHora.map((h) => h.cents), 0);
  const sinCobros = resumen.cantidadCobros === 0;

  return (
    <section
      aria-label="Resumen del día"
      className="grid gap-7 overflow-hidden rounded-[14px] border border-night-line bg-night p-[clamp(22px,2.6vw,36px)] text-on-night md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold tracking-[0.01em] text-on-night-2">Cobrado hoy</p>
        <p className="mt-2.5 whitespace-nowrap font-display text-[clamp(3rem,13vw,4.25rem)] font-medium leading-[0.88] tracking-[-0.035em] [font-variant-numeric:lining-nums] md:text-[clamp(3.5rem,5.4vw,5.75rem)]">
          <span className="text-brand-on-night">{simbolo}</span>
          {cifra}
        </p>
        <p className="mt-3.5 text-sm font-medium text-on-night-2">
          {sinCobros ? (
            "Todavía no hay cobros hoy."
          ) : (
            <>
              <b className="font-semibold text-on-night">
                {plural(resumen.cantidadCobros, "cobro", "cobros")}
              </b>
              {resumen.cantidadProfesionales > 0 &&
                ` de ${plural(resumen.cantidadProfesionales, "profesional", "profesionales")}`}
            </>
          )}
          {resumen.porCobrarCents !== null && resumen.porCobrarCents > 0 && (
            <>
              {" · por cobrar "}
              <b className="font-semibold text-on-night">
                {formatMoney(resumen.porCobrarCents, currency)}
              </b>
            </>
          )}
        </p>

        <figure className="mt-6">
          <figcaption className="sr-only">Cobrado por hora</figcaption>
          <ol
            className="grid h-[120px] items-end gap-[5px]"
            style={{ gridTemplateColumns: `repeat(${resumen.porHora.length}, minmax(0, 1fr))` }}
          >
            {resumen.porHora.map((h) => {
              const alto = maxHora > 0 ? Math.max(2, Math.round((h.cents / maxHora) * 100)) : 0;
              return (
                <li
                  key={h.hora}
                  className="flex h-full flex-col items-center justify-end gap-1.5"
                  title={
                    h.cantidad > 0
                      ? `${h.hora}:00 · ${formatMoney(h.cents, currency)} en ${plural(h.cantidad, "cobro", "cobros")}`
                      : undefined
                  }
                >
                  <span
                    aria-hidden
                    className={cn(
                      "block w-full rounded-t-[3px]",
                      h.cents > 0 ? "bg-cobalt-on-night" : "bg-night-3",
                    )}
                    style={{ height: h.cents > 0 ? `${alto}%` : "2px" }}
                  />
                  <span aria-hidden className="cifra text-[10.5px] text-on-night-2">
                    {h.hora}
                  </span>
                  <span className="sr-only">
                    {h.hora}:00, {h.cantidad > 0 ? formatMoney(h.cents, currency) : "sin cobros"}
                  </span>
                </li>
              );
            })}
          </ol>
        </figure>
      </div>

      <div className="min-w-0">
        <p className="text-[13px] font-semibold tracking-[0.01em] text-on-night-2">
          Por medio de pago
        </p>
        {resumen.porMedio.length === 0 ? (
          <p className="mt-3 text-sm text-on-night-2">Sin cobros todavía.</p>
        ) : (
          <>
            <div aria-hidden className="mt-3 flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
              {resumen.porMedio.map((m, i) => (
                <span
                  key={`${m.enEfectivo}|${m.medio}`}
                  className="h-full"
                  style={{
                    width: `${Math.max(m.porcentaje, 1)}%`,
                    background: colorDeMedio(i, "tinta"),
                  }}
                />
              ))}
            </div>
            <ul className="mt-4 grid gap-2.5">
              {resumen.porMedio.map((m, i) => (
                <li
                  key={`${m.enEfectivo}|${m.medio}`}
                  className="grid grid-cols-[12px_minmax(0,1fr)_auto_auto] items-baseline gap-2.5 border-b border-night-line pb-2.5 text-sm"
                >
                  <span
                    aria-hidden
                    className="size-2.5 rounded-[2px]"
                    style={{ background: colorDeMedio(i, "tinta") }}
                  />
                  <span className="min-w-0 truncate">{m.medio}</span>
                  <span className="cifra text-sm">{formatMoney(m.cents, currency)}</span>
                  <span className="cifra min-w-9 text-right text-xs text-on-night-2">
                    {m.porcentaje}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-on-night-2">
          <div>
            <dt>En el cajón</dt>
            <dd className="cifra mt-0.5 text-sm text-on-night">
              {formatMoney(resumen.enEfectivoCents, currency)}
            </dd>
          </div>
          <div>
            <dt>A conciliar con el banco</dt>
            <dd className="cifra mt-0.5 text-sm text-on-night">
              {formatMoney(resumen.aConciliarCents, currency)}
            </dd>
          </div>
        </dl>
        {onVerDesglose && (
          <button
            type="button"
            onClick={onVerDesglose}
            className="mt-3 rounded-sm text-sm font-medium text-brand-on-night underline-offset-4 outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-on-night"
          >
            Ver desglose del turno
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Movimientos ─────────────────────────────────────────────────────────

export function MovimientosDelDia({
  movimientos,
  porMedio,
  currency,
}: {
  movimientos: MovimientoDelDia[];
  porMedio: MedioDelDia[];
  currency: string;
}) {
  const uid = useId();
  const [medio, setMedio] = useState<string | null>(null);
  // Si el medio filtrado desaparece (se reversó su único cobro), vuelve a Todos.
  const medioVigente = medio !== null && porMedio.some((m) => m.medio === medio) ? medio : null;
  const { filas, totalCents } = useMemo(
    () => filtrarPorMedio(movimientos, medioVigente),
    [movimientos, medioVigente],
  );
  const indiceDeMedio = useMemo(
    () => new Map(porMedio.map((m, i) => [m.medio, i] as const)),
    [porMedio],
  );
  const opciones: (string | null)[] = [null, ...new Set(porMedio.map((m) => m.medio))];

  return (
    <section aria-labelledby={`${uid}-titulo`} className={cn(PANEL, "overflow-hidden")}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px] pb-3">
        <h2 id={`${uid}-titulo`} className="font-display text-[30px] font-medium leading-none">
          Movimientos del día
        </h2>
        {porMedio.length > 0 && (
          <div role="group" aria-label="Filtrar por medio" className="flex flex-wrap gap-1">
            {opciones.map((op) => {
              const activo = op === medioVigente;
              return (
                <button
                  key={op ?? "todos"}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setMedio(op)}
                  className={cn(
                    "h-[30px] rounded-full border px-[11px] text-[12.5px] font-semibold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11",
                    activo
                      ? "border-foreground bg-foreground text-background"
                      : "border-control text-foreground/80 hover:border-foreground",
                  )}
                >
                  {op ?? "Todos"}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {movimientos.length === 0 ? (
        <div className="border-t border-hairline px-5 py-6">
          <p className="text-sm font-medium">Todavía no hay cobros hoy.</p>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Los pagos que registres desde la ficha del paciente aparecen acá con su hora, el medio y
            quién atendió.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm sm:text-[15px]">
            <thead>
              <tr className="border-b border-control/50 text-left text-xs font-semibold text-muted-foreground">
                <th scope="col" className="py-2 pr-2 pl-3.5 sm:pl-5 font-semibold sm:pr-3">
                  Hora
                </th>
                <th scope="col" className="px-2 py-2 font-semibold sm:px-3">
                  Paciente
                </th>
                <th scope="col" className="hidden 2xl:table-cell px-3 py-2 font-semibold">
                  Concepto
                </th>
                <th
                  scope="col"
                  className="hidden md:table-cell lg:hidden xl:table-cell px-3 py-2 font-semibold"
                >
                  Profesional
                </th>
                <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">
                  Medio
                </th>
                <th
                  scope="col"
                  className="py-2 pr-3.5 sm:pr-5 pl-2 text-right font-semibold sm:pl-3"
                >
                  Monto
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((m) => (
                <tr key={m.id} className="border-b border-hairline align-top hover:bg-muted/40">
                  <td className="cifra py-[13px] pr-2 pl-3.5 sm:pl-5 whitespace-nowrap sm:pr-3">
                    {m.hora}
                  </td>
                  <td className="px-2 py-[13px] sm:px-3 sm:whitespace-nowrap">
                    <Link
                      to="/pacientes/$pacienteId"
                      params={{ pacienteId: m.patientId }}
                      aria-label={`${m.paciente}, ver ficha`}
                      className="rounded-sm outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {nombreCorto(m.paciente)}
                    </Link>
                    {/* Sin ancho para su columna, el concepto va debajo del nombre. */}
                    <span className="mt-0.5 block max-w-[7.5rem] truncate sm:max-w-[14rem] text-[12.5px] text-muted-foreground 2xl:hidden">
                      {m.concepto}
                    </span>
                  </td>
                  <td className="hidden 2xl:table-cell px-3 py-[13px] text-[13px] text-muted-foreground">
                    {m.concepto}
                  </td>
                  <td className="hidden md:table-cell lg:hidden xl:table-cell px-3 py-[13px] whitespace-nowrap">
                    {m.profesional ?? <span className="text-muted-foreground">Sin asignar</span>}
                  </td>
                  <td className="hidden px-3 py-[13px] sm:table-cell">
                    <ul className="grid gap-1">
                      {m.partes.map((p) => (
                        <li
                          key={`${p.enEfectivo}|${p.medio}`}
                          className={cn(
                            "flex items-start gap-1.5 text-[12.5px] leading-tight font-medium text-foreground/80",
                            medioVigente !== null && p.medio !== medioVigente && "opacity-60",
                          )}
                        >
                          <span
                            aria-hidden
                            className="mt-[3px] size-2 shrink-0 rounded-[2px]"
                            style={{
                              background: colorDeMedio(indiceDeMedio.get(p.medio) ?? 9, "papel"),
                            }}
                          />
                          <span>
                            {p.medio}
                            {m.partes.length > 1 && (
                              <span className="cifra ml-1 hidden text-muted-foreground sm:inline">
                                {formatMoney(p.cents, currency)}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="cifra py-[13px] pr-3.5 sm:pr-5 pl-2 text-right whitespace-nowrap sm:pl-3">
                    {formatMoney(m.montoVisibleCents, currency)}
                    {/* En celular el medio va debajo del monto: no hay ancho para su columna. */}
                    <span className="mt-0.5 block font-sans text-xs text-muted-foreground sm:hidden">
                      {m.partes.map((p) => p.medio).join(" + ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-foreground font-semibold">
                {/* Las celdas vacías siguen a las columnas que se ocultan en celular. */}
                <td colSpan={2} className="py-3 pl-3.5 sm:pl-5">
                  Total · {plural(filas.length, "cobro", "cobros")}
                  {medioVigente && (
                    <span className="font-normal text-muted-foreground"> en {medioVigente}</span>
                  )}
                </td>
                <td className="hidden 2xl:table-cell" />
                <td className="hidden md:table-cell lg:hidden xl:table-cell" />
                <td className="hidden sm:table-cell" />
                <td className="cifra py-3 pr-3.5 sm:pr-5 pl-2 text-right whitespace-nowrap">
                  {formatMoney(totalCents, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Atendidas sin cobro ─────────────────────────────────────────────────

export function AtendidasSinCobroPanel({
  atendidas,
  currency,
  puedeCobrar,
}: {
  atendidas: AtendidaSinCobro[];
  currency: string;
  /** `patients:manage`: el cobro se registra en la ficha (mismo gate que la agenda). */
  puedeCobrar: boolean;
}) {
  const uid = useId();
  if (atendidas.length === 0) {
    return (
      <section aria-labelledby={`${uid}-titulo`} className={cn(PANEL, "p-5")}>
        <h2 id={`${uid}-titulo`} className="font-display text-[30px] font-medium leading-none">
          Atendidas sin cobro
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ninguna: cada cita atendida hoy tiene su cobro registrado.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby={`${uid}-titulo`}
      className="rounded-[14px] border border-dashed border-warning-border bg-warning-soft p-5"
    >
      <h2 id={`${uid}-titulo`} className="font-display text-[30px] font-medium leading-none">
        Atendidas sin cobro
      </h2>
      <p className="mt-2 text-sm text-foreground/80">
        {atendidas.length === 1
          ? "Una cita quedó atendida sin pago registrado. Resuélvela antes de cerrar o quedará como saldo del paciente."
          : `${atendidas.length} citas quedaron atendidas sin pago registrado. Resuélvelas antes de cerrar o quedarán como saldo del paciente.`}
      </p>
      <ul className="mt-3 grid gap-2">
        {atendidas.map((a) => (
          <li
            key={a.citaId}
            className="flex items-center justify-between gap-3 rounded-[10px] bg-card px-3 py-2.5 text-sm"
          >
            <span className="min-w-0">
              {nombreCorto(a.paciente)} · {a.concepto}
              {a.profesional && <span className="text-muted-foreground"> · {a.profesional}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2.5">
              {a.saldoCents !== null && a.saldoCents > 0 && (
                <b className="cifra font-medium">{formatMoney(a.saldoCents, currency)}</b>
              )}
              <Link
                to="/pacientes/$pacienteId"
                params={{ pacienteId: a.patientId }}
                search={puedeCobrar ? { cobrar: 1 } : undefined}
                aria-label={`${puedeCobrar ? "Cobrar a" : "Ver ficha de"} ${a.paciente}`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "rounded-full bg-card px-4",
                )}
              >
                {puedeCobrar && <Wallet aria-hidden />}
                {puedeCobrar ? "Cobrar" : "Ver ficha"}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Comisiones ──────────────────────────────────────────────────────────

export function ComisionesDelDiaPanel({
  comisiones,
  sinProfesionalCents,
  currency,
}: {
  comisiones: ComisionDelDia[];
  /** Cobros de hoy que no son de ningún profesional (no generan comisión). */
  sinProfesionalCents: number | null;
  currency: string;
}) {
  const uid = useId();
  const conRegla = comisiones.some((c) => c.comisionCents !== null);
  const valor = (c: ComisionDelDia) => (conRegla ? (c.comisionCents ?? 0) : c.cobradoCents);
  const max = Math.max(0, ...comisiones.map(valor));
  const total = comisiones.reduce((s, c) => s + (c.comisionCents ?? 0), 0);
  return (
    <section aria-labelledby={`${uid}-titulo`} className={cn(PANEL, "p-5")}>
      <h2 id={`${uid}-titulo`} className="font-display text-[30px] font-medium leading-none">
        Comisiones del día
      </h2>
      {comisiones.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Sin datos: hoy nadie tiene cobros ni prestaciones realizadas.
        </p>
      ) : (
        <>
          {conRegla && (
            <p className="mt-2 text-sm text-muted-foreground">
              Se les debe hoy{" "}
              <span className="cifra font-medium">{formatMoney(total, currency)}</span> en total.
            </p>
          )}
          <ul className="mt-3.5 grid gap-3.5">
            {comisiones.map((c) => {
              const ancho = max > 0 ? Math.round((valor(c) / max) * 100) : 0;
              return (
                <li key={c.professionalId}>
                  <div className="flex justify-between gap-2.5 text-sm font-semibold">
                    <span className="min-w-0 truncate">{c.nombre}</span>
                    <span className="cifra font-medium">
                      {c.comisionCents === null ? "—" : formatMoney(c.comisionCents, currency)}
                    </span>
                  </div>
                  <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-[4px] bg-muted">
                    <span
                      className="block h-full"
                      style={{ width: `${ancho}%`, background: colorProfesional(c.color) }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between gap-2.5 text-[12.5px] text-muted-foreground">
                    <span>
                      Cobrado {formatMoney(c.cobradoCents, currency)} · Realizado{" "}
                      {formatMoney(c.produccionCents, currency)}
                    </span>
                    <span className="text-right">{c.regla}</span>
                  </div>
                  {(c.rigeDesde || c.lineasConReglaPropia > 0) && (
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                      {c.rigeDesde && `Regla vigente desde el ${fecha(c.rigeDesde)}`}
                      {c.rigeDesde && c.lineasConReglaPropia > 0 && " · "}
                      {c.lineasConReglaPropia > 0 &&
                        `${c.lineasConReglaPropia} ${c.lineasConReglaPropia === 1 ? "línea con regla propia de la prestación" : "líneas con regla propia de la prestación"}`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {sinProfesionalCents !== null && sinProfesionalCents > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Hoy entraron {formatMoney(sinProfesionalCents, currency)} que no son de ningún
              profesional (abonos sin prestación, cuotas de membresía): no generan comisión.
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Cada comisión usa la regla vigente de cada profesional hoy: sobre lo realizado o sobre
            lo cobrado, con su regla propia por prestación si la tiene. Es la misma cuenta del
            reporte y del cierre del período, en Reportes · Comisiones.
          </p>
        </>
      )}
    </section>
  );
}
