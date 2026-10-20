import { useId, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";

import { BloqueoEscritura } from "@/components/solo-lectura";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useMovimiento } from "@/hooks/use-movimiento";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { claseTexto, type TonoEstado } from "@/lib/clinic-operations/estado-cita-tono";
import { motivoFaltante, MOTIVO_MINIMO } from "@/lib/finance/cash-registers";
import {
  ajustarCantidad,
  claveDenominacion,
  denominacionesDe,
  detalleDeConteo,
  MAX_PIEZAS_POR_DENOMINACION,
  subtotal,
  totalDeConteo,
  type Conteo,
  type FilaDeConteo,
} from "@/lib/finance/denominaciones";
import { formatMoney } from "@/lib/finance/finance";
import { cn } from "@/lib/utils";

export type CierreArqueo = {
  declaredClosingCents: number;
  /** Solo si se contó por billete; con "Ingresar total" no viaja. */
  denominations?: FilaDeConteo[];
  notes?: string;
};

type Modo = "billetes" | "total";

/** Lectura de la diferencia: el color acompaña, el texto informa. */
function veredicto(
  diff: number,
  currency: string,
): { titulo: string; detalle: string; tono: TonoEstado } {
  if (diff === 0) {
    return {
      titulo: "Cuadra exacto.",
      detalle: "Lo contado es igual a lo esperado.",
      tono: "success",
    };
  }
  if (diff < 0) {
    return {
      titulo: `Faltan ${formatMoney(-diff, currency)}.`,
      detalle: "Revisa el cajón o deja el motivo en el cierre.",
      tono: "danger",
    };
  }
  return {
    titulo: `Sobran ${formatMoney(diff, currency)}.`,
    detalle: "Revisa si quedó un vuelto sin entregar.",
    tono: "warning",
  };
}

/**
 * Arqueo de caja por billete y moneda (PR 12 del rediseño A+).
 *
 * Cuenta el cajón por denominación, suma sola, compara contra lo esperado y,
 * si no cuadra, pide el motivo (el servidor lo vuelve a exigir con su propia
 * diferencia). "Ingresar total" deja el `MoneyInput` de siempre para quien
 * prefiere contar a mano o para una moneda sin tabla de billetes.
 */
export function ArqueoDenominaciones({
  currency,
  expectedCents,
  expectedNota,
  etiquetaSello,
  enviando,
  onCerrar,
}: {
  currency: string;
  /** Apertura + cobros del turno, o `null` mientras carga o si falló. */
  expectedCents: number | null;
  expectedNota: string;
  /** Texto del anillo del sello, p. ej. "LUNES 19". */
  etiquetaSello: string;
  enviando: boolean;
  onCerrar: (cierre: CierreArqueo) => void;
}) {
  const uid = useId();
  const tabla = useMemo(() => denominacionesDe(currency), [currency]);
  const [modo, setModo] = useState<Modo>(tabla ? "billetes" : "total");
  const [conteo, setConteo] = useState<Conteo>({});
  const [totalManual, setTotalManual] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const soloLectura = useSoloLectura();
  const motivoRef = useRef<HTMLTextAreaElement>(null);

  const contado = modo === "billetes" ? totalDeConteo(conteo, currency) : totalManual;
  const diff = expectedCents !== null && contado !== null ? contado - expectedCents : null;
  const lectura = diff === null ? null : veredicto(diff, currency);
  const faltaMotivo = diff !== null && motivoFaltante(diff, motivo);
  const puedeCerrar = diff !== null && !faltaMotivo && !enviando && !soloLectura;

  function cambiar(clave: string, cantidad: number) {
    setConteo((prev) => ({ ...prev, [clave]: cantidad }));
  }

  function cerrar() {
    if (contado === null || diff === null) return;
    if (faltaMotivo) {
      motivoRef.current?.focus();
      return;
    }
    const detalle = modo === "billetes" ? detalleDeConteo(conteo, currency) : null;
    onCerrar({
      declaredClosingCents: contado,
      denominations: detalle?.filas,
      notes: motivo.trim() || undefined,
    });
  }

  return (
    <section
      id="arqueo"
      aria-labelledby={`${uid}-titulo`}
      className="rounded-md border border-border bg-card p-5 sm:p-6"
    >
      <h2
        id={`${uid}-titulo`}
        tabIndex={-1}
        className="font-display text-3xl font-normal leading-none outline-none"
      >
        Arqueo de <em className="text-brand-600 dark:text-brand">efectivo</em>
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {modo === "billetes"
          ? "Cuenta el cajón por billete y moneda. Esmalia suma."
          : "Cuenta el cajón y anota el total."}
      </p>

      {tabla && (
        <div
          role="group"
          aria-label="Cómo contar"
          className="mt-4 inline-flex rounded-md border border-border p-0.5 text-sm"
        >
          {(
            [
              ["billetes", "Contar por billete"],
              ["total", "Ingresar total"],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              aria-pressed={modo === valor}
              onClick={() => setModo(valor)}
              className={cn(
                "rounded-[5px] px-3 py-1.5 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                modo === valor
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {texto}
            </button>
          ))}
        </div>
      )}

      {modo === "billetes" && tabla ? (
        <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
          {tabla.map((d) => {
            const clave = claveDenominacion(d);
            const cantidad = conteo[clave] ?? 0;
            const nombre = `${d.tipo === "billete" ? "billetes" : "monedas"} de ${formatMoney(d.valorCents, currency)}`;
            return (
              <li
                key={clave}
                className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem] items-center gap-3 py-1.5"
              >
                <span className="min-w-0 tabular-nums leading-tight">
                  <span className="font-medium">{formatMoney(d.valorCents, currency)}</span>{" "}
                  <span className="block text-xs text-muted-foreground sm:inline">{d.tipo}</span>
                </span>
                <span className="inline-flex h-9 items-center rounded-full border border-input">
                  <button
                    type="button"
                    onClick={() => cambiar(clave, ajustarCantidad(cantidad, -1))}
                    disabled={cantidad === 0}
                    aria-label={`Quitar uno: ${nombre}`}
                    className="grid size-9 place-items-center rounded-full outline-none hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                  >
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_PIEZAS_POR_DENOMINACION}
                    step={1}
                    value={cantidad}
                    aria-label={`Cantidad de ${nombre}`}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      cambiar(clave, Number.isNaN(n) ? 0 : ajustarCantidad(0, n));
                    }}
                    className="w-10 appearance-none bg-transparent text-center text-sm tabular-nums outline-none [-moz-appearance:textfield] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => cambiar(clave, ajustarCantidad(cantidad, 1))}
                    aria-label={`Agregar uno: ${nombre}`}
                    className="grid size-9 place-items-center rounded-full outline-none hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                </span>
                <span className="text-right text-sm tabular-nums text-muted-foreground">
                  {formatMoney(subtotal(d, cantidad), currency)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 space-y-2">
          <Label htmlFor={`${uid}-total`}>Monto contado</Label>
          <MoneyInput
            id={`${uid}-total`}
            valueCents={totalManual}
            onValueChange={setTotalManual}
            currency={currency}
          />
        </div>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-md border border-hairline px-3.5 py-3">
          <dt className="text-xs text-muted-foreground">Esperado</dt>
          <dd className="mt-1 whitespace-nowrap font-display text-[clamp(1.5rem,5.5vw,2rem)] leading-none tabular-nums">
            {expectedCents === null ? "—" : formatMoney(expectedCents, currency)}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">{expectedNota}</dd>
        </div>
        <div className="rounded-md border border-hairline px-3.5 py-3">
          <dt className="text-xs text-muted-foreground">Contado</dt>
          <dd className="mt-1 whitespace-nowrap font-display text-[clamp(1.5rem,5.5vw,2rem)] leading-none tabular-nums">
            {contado === null ? "—" : formatMoney(contado, currency)}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">en el cajón</dd>
        </div>
      </dl>

      <div
        aria-live="polite"
        className="mt-4 grid min-h-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
      >
        {lectura ? (
          <p className={cn("text-base font-semibold", claseTexto[lectura.tono])}>
            {lectura.titulo}
            <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
              {lectura.detalle}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {expectedCents === null
              ? "Calculando lo esperado…"
              : "Anota el total para ver si cuadra."}
          </p>
        )}
        {diff === 0 && <SelloCuadra etiqueta={etiquetaSello} />}
      </div>

      {diff !== null && diff !== 0 && (
        <div className="mt-2 space-y-2">
          <Label htmlFor={`${uid}-motivo`}>Motivo de la diferencia (queda en el cierre)</Label>
          <textarea
            id={`${uid}-motivo`}
            ref={motivoRef}
            rows={2}
            required
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            aria-invalid={faltaMotivo || undefined}
            aria-describedby={`${uid}-motivo-ayuda`}
            placeholder="Ej.: vuelto mal dado a las 15:20"
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <p id={`${uid}-motivo-ayuda`} className="text-xs text-muted-foreground">
            Obligatorio si no cuadra (mínimo {MOTIVO_MINIMO} caracteres).
          </p>
        </div>
      )}

      <BloqueoEscritura>
        <Button
          type="button"
          size="lg"
          className="mt-4 w-full"
          onClick={cerrar}
          disabled={!puedeCerrar}
        >
          {enviando && <Loader2 className="animate-spin" aria-hidden />}
          {diff === null || diff === 0 ? "Cerrar caja" : "Cerrar con diferencia"}
        </Button>
      </BloqueoEscritura>
    </section>
  );
}

/**
 * Sello "Cuadra". Decorativo (el veredicto ya lo dice en texto). Con
 * movimiento reducido o pausado aparece quieto y en su lugar: nunca queda
 * invisible esperando una animación.
 */
function SelloCuadra({ etiqueta }: { etiqueta: string }) {
  const { animar } = useMovimiento();
  const arcoId = useId();
  const texto = `CAJA · ${etiqueta} · CAJA · ${etiqueta} ·`;
  return (
    <div
      aria-hidden
      data-sello-cuadra
      className={cn(
        "size-[5.75rem] -rotate-12 text-brand-600 dark:text-brand",
        animar && "animate-sello-cuadra",
      )}
    >
      <svg viewBox="0 0 100 100" className="size-full">
        <g className={cn("origin-center", animar && "animate-sello-giro")}>
          <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle
            cx="50"
            cy="50"
            r="39"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
          <path id={arcoId} d="M50 50 m-31 0 a31 31 0 1 1 62 0 a31 31 0 1 1 -62 0" fill="none" />
          <text fontSize="8" fontWeight="600" letterSpacing="2" fill="currentColor">
            <textPath href={`#${arcoId}`}>{texto}</textPath>
          </text>
        </g>
        <text
          x="50"
          y="56"
          textAnchor="middle"
          fill="currentColor"
          className="font-display"
          fontStyle="italic"
          fontWeight="600"
          fontSize="22"
        >
          Cuadra
        </text>
      </svg>
    </div>
  );
}
