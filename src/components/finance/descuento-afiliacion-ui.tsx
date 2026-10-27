/**
 * Piezas del descuento de afiliación en el presupuesto (cierre · ítem 2): el
 * selector de los diálogos de crear y editar, y la línea de origen que se ve en
 * el presupuesto. El descuento es el comercial de siempre; acá solo se dice de
 * dónde sale, se deja elegir y se avisa si quedó distinto de lo propuesto.
 */
import { useId } from "react";
import { BadgePercent } from "lucide-react";

import {
  ETIQUETA_ORIGEN,
  estadoDelRastro,
  valorDelCandidato,
  type CandidatoDescuento,
} from "@/lib/finance/descuento-afiliacion";
import { formatMoney, type AffiliationDiscountTrace } from "@/lib/finance/finance";
import { cn } from "@/lib/utils";

export interface SeleccionAfiliacion {
  source: CandidatoDescuento["source"];
  sourceId: string;
}

/**
 * Selector del descuento de afiliación. Con candidatos siempre muestra la
 * opción de no aplicar ninguno, y dice cuánto es cada uno sobre el subtotal de
 * hoy. `aviso` es el estado frente a lo propuesto ("ajustado a la baja").
 */
export function SelectorDescuentoAfiliacion({
  candidatos,
  seleccion,
  onSeleccionar,
  subtotalCents,
  currency,
  aviso,
  origenPerdido,
}: {
  candidatos: readonly CandidatoDescuento[];
  seleccion: SeleccionAfiliacion | null;
  onSeleccionar: (c: CandidatoDescuento | null) => void;
  subtotalCents: number;
  currency: string;
  /** "ajustado a la baja", etc., si el descuento de abajo ya no es el propuesto. */
  aviso?: string;
  /** Nombre del origen guardado que el paciente ya no tiene. */
  origenPerdido?: string | null;
}) {
  const grupo = useId();
  if (candidatos.length === 0 && !origenPerdido) return null;
  return (
    <fieldset className="space-y-2 rounded-lg border border-hairline bg-muted/40 p-3 text-sm">
      <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <BadgePercent className="size-3.5" aria-hidden /> Descuento de afiliación
      </legend>
      <p className="text-xs text-muted-foreground">
        Este paciente tiene una condición comercial. Se aplica como descuento comercial: puedes
        cambiar el valor abajo. Los descuentos de empresa y de membresía no se acumulan.
      </p>
      {origenPerdido && (
        <p role="status" className="text-xs text-warning">
          El descuento de {origenPerdido} ya no corresponde a este paciente. Se guarda como
          descuento comercial sin origen, o quítalo abajo.
        </p>
      )}
      <div className="space-y-1.5">
        {candidatos.map((c) => {
          const activo =
            seleccion !== null &&
            seleccion.source === c.source &&
            seleccion.sourceId === c.sourceId;
          const id = `${grupo}-${c.source}-${c.sourceId}`;
          const valor = valorDelCandidato(c, subtotalCents);
          return (
            <label
              key={id}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2",
                activo ? "border-foreground/40 bg-card" : "border-hairline",
              )}
            >
              <input
                id={id}
                type="radio"
                name={grupo}
                checked={activo}
                onChange={() => onSeleccionar(c)}
                className="mt-1"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {ETIQUETA_ORIGEN[c.source]} · {c.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {c.rule}
                  {subtotalCents > 0 && ` · hoy son ${formatMoney(valor, currency)}`}
                </span>
              </span>
            </label>
          );
        })}
        <label
          htmlFor={`${grupo}-ninguno`}
          className={cn(
            "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2",
            seleccion === null ? "border-foreground/40 bg-card" : "border-hairline",
          )}
        >
          <input
            id={`${grupo}-ninguno`}
            type="radio"
            name={grupo}
            checked={seleccion === null}
            onChange={() => onSeleccionar(null)}
          />
          <span>Sin descuento de afiliación</span>
        </label>
      </div>
      {aviso && (
        <p role="status" className="text-xs text-warning">
          El descuento de abajo está {aviso}: el presupuesto lo deja anotado.
        </p>
      )}
    </fieldset>
  );
}

/**
 * Línea de origen del descuento en el presupuesto: "Empresa con convenio ·
 * Constructora Andes (15 % de descuento)", con el aviso si se ajustó.
 */
export function OrigenDelDescuento({
  rastro,
  subtotalCents,
  discountCents,
  className,
}: {
  rastro: AffiliationDiscountTrace;
  subtotalCents: number;
  discountCents: number;
  className?: string;
}) {
  const estado = estadoDelRastro(rastro, { subtotalCents, discountCents });
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Origen: {ETIQUETA_ORIGEN[rastro.source]} · {rastro.name}
      {rastro.rule ? ` (${rastro.rule})` : ""}
      {estado.texto ? ` · ${estado.texto}` : ""}
    </p>
  );
}
