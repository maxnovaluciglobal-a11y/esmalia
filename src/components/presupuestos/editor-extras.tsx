import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Package } from "lucide-react";

import { MoneyInput } from "@/components/money-input";
import {
  lineasDePaquete,
  moverSeccion,
  resumenDeSecciones,
  type LineaBase,
  type LineaSumadaDePaquete,
} from "@/lib/finance/calculo-presupuesto";
import { SIN_FASE_LABEL, formatMoney, type Procedure } from "@/lib/finance/finance";
import { listPaquetes } from "@/lib/finance/paquetes.functions";
import { cn } from "@/lib/utils";

/**
 * Piezas del editor de presupuestos de la ficha (Ola 3, frente Planes). Viven
 * aparte de `finance-section.tsx` para que ese archivo, que comparten varios
 * frentes, solo las monte.
 */

const CAMPO =
  "rounded-md border border-hairline bg-transparent px-2 py-1 text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Secciones del presupuesto (PLA-04) con su subtotal y flechas para
 * ordenarlas. Mover una sección mueve su bloque de líneas: el orden de la
 * lista es el orden que se guarda (`posicionesDeSecciones`).
 */
export function SeccionesDelPresupuesto<T extends LineaBase>({
  lineas,
  setLineas,
  currency,
}: {
  lineas: T[];
  setLineas: (next: T[]) => void;
  currency: string;
}) {
  const resumen = resumenDeSecciones(lineas);
  const conNombre = resumen.filter((s) => s.label !== null);
  if (conNombre.length === 0) return null;
  return (
    <div className="rounded-lg border border-hairline">
      <p className="border-b border-hairline px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Secciones
      </p>
      <ol className="divide-y divide-hairline">
        {resumen.map((s) => {
          const i = s.label === null ? -1 : conNombre.findIndex((x) => x.label === s.label);
          return (
            <li
              key={s.label ?? "sin-seccion"}
              className="flex items-center gap-2 px-3 py-1.5 text-xs"
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  s.label === null && "text-muted-foreground",
                )}
              >
                {s.label ?? SIN_FASE_LABEL}
                <span className="ml-1 text-muted-foreground">
                  · {s.lineas} {s.lineas === 1 ? "ítem" : "ítems"}
                </span>
              </span>
              <span className="cifra">{formatMoney(s.subtotalCents, currency)}</span>
              {s.label !== null ? (
                <span className="flex">
                  <button
                    type="button"
                    onClick={() => setLineas(moverSeccion(lineas, s.label!, -1))}
                    disabled={i <= 0}
                    aria-label={`Subir la sección ${s.label}`}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLineas(moverSeccion(lineas, s.label!, 1))}
                    disabled={i === conNombre.length - 1}
                    aria-label={`Bajar la sección ${s.label}`}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </span>
              ) : (
                <span className="w-[3.25rem]" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Suma un paquete (PLA-12) de una vez: devuelve sus líneas con el precio
 * repartido y el ahorro como descuento (`lineasDePaquete`).
 */
export function AgregarPaquete({
  clinicId,
  procedures,
  onAgregar,
}: {
  clinicId: string;
  procedures: Procedure[];
  onAgregar: (lineas: LineaSumadaDePaquete[], nombre: string) => void;
}) {
  const id = useId();
  const fetchPaquetes = useServerFn(listPaquetes);
  const { data: paquetes = [] } = useQuery({
    queryKey: ["paquetes", clinicId, "activos"],
    queryFn: () => fetchPaquetes({ data: { clinicId } }),
  });
  if (!paquetes.length) return null;
  const precio = new Map(procedures.map((p) => [p.id, p.defaultPriceCents]));
  return (
    <label
      htmlFor={id}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700"
    >
      <Package className="size-3.5" aria-hidden />
      <span className="sr-only">Agregar paquete</span>
      <select
        id={id}
        value=""
        onChange={(e) => {
          const p = paquetes.find((x) => x.id === e.target.value);
          if (!p) return;
          onAgregar(
            lineasDePaquete(p, (pid) => (pid ? (precio.get(pid) ?? 0) : 0)),
            p.name,
          );
        }}
        className={cn(CAMPO, "text-brand-700")}
      >
        <option value="">Agregar paquete…</option>
        {paquetes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {formatMoney(p.priceCents, p.currency)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Validez y profesional a cargo del presupuesto (PLA-06, UX-16). Sin fecha,
 * el servidor pone la validez por defecto de la clínica.
 */
export function ValidezYProfesional({
  validUntil,
  setValidUntil,
  professionalId,
  setProfessionalId,
  profesionales,
  hoy,
  diasPorDefecto,
}: {
  validUntil: string;
  setValidUntil: (v: string) => void;
  professionalId: string;
  setProfessionalId: (v: string) => void;
  profesionales: { id: string; nombre: string }[];
  hoy: string;
  diasPorDefecto: number | null;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label htmlFor={`${id}-validez`} className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-muted-foreground">Válido hasta</span>
        <input
          id={`${id}-validez`}
          type="date"
          min={hoy}
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          className={cn(CAMPO, "w-36")}
        />
        {!validUntil && diasPorDefecto !== null && (
          <span className="text-[11px] text-muted-foreground">
            Sin fecha: {diasPorDefecto} días desde hoy
          </span>
        )}
      </label>
      <label htmlFor={`${id}-prof`} className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-muted-foreground">Profesional a cargo</span>
        <select
          id={`${id}-prof`}
          value={professionalId}
          onChange={(e) => setProfessionalId(e.target.value)}
          className={cn(CAMPO, "w-48")}
        >
          <option value="">Sin asignar</option>
          {profesionales.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Descuento comercial global en dinero o en % (PLA-05). */
export function DescuentoGlobal({
  modo,
  setModo,
  valor,
  setValor,
  currency,
}: {
  modo: "amount" | "pct";
  setModo: (m: "amount" | "pct") => void;
  valor: number;
  setValor: (v: number) => void;
  currency: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="sr-only">
        Descuento comercial {modo === "pct" ? "en porcentaje" : "en dinero"}
      </label>
      {modo === "pct" ? (
        <input
          id={id}
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={valor}
          onChange={(e) => setValor(Math.min(100, Math.max(0, Number(e.target.value))))}
          className={cn(CAMPO, "w-20 rounded-r-none text-right")}
        />
      ) : (
        <MoneyInput
          id={id}
          currency={currency}
          min={0}
          valueCents={valor}
          onValueChange={(c) => setValor(c ?? 0)}
          mostrarMoneda={false}
          className={cn(CAMPO, "w-24 rounded-r-none text-right")}
        />
      )}
      <button
        type="button"
        onClick={() => {
          setModo(modo === "pct" ? "amount" : "pct");
          setValor(0);
        }}
        aria-label={`Descuento comercial en ${modo === "pct" ? "porcentaje" : "dinero"}. Cambiar.`}
        className="-ml-1 rounded-r-md border border-l-0 border-hairline px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary"
      >
        {modo === "pct" ? "%" : "$"}
      </button>
    </div>
  );
}
