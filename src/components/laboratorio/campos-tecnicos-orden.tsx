import { Label } from "@/components/ui/label";
import {
  COLORES_POR_GUIA,
  GUIAS_COLOR,
  GUIA_COLOR_LABELS,
  MARGENES,
  MARGEN_LABELS,
  MATERIALES,
  MATERIAL_LABELS,
  type GuiaColor,
  type Margen,
  type Material,
  type ValorTecnico,
} from "@/lib/clinic-operations/lab-orden-detalle";

/**
 * Ola 9 · LAB-03/04/05: guía y color VITA, material y margen de la orden.
 * El color se elige de la guía (no texto libre): lo que el técnico lee es
 * exactamente lo que está en su muestrario.
 */
export function CamposTecnicosOrden({
  idBase,
  valor,
  onChange,
  claseInput,
}: {
  idBase: string;
  valor: ValorTecnico;
  onChange: (v: ValorTecnico) => void;
  claseInput: string;
}) {
  const colores = valor.shadeGuide ? COLORES_POR_GUIA[valor.shadeGuide] : [];
  return (
    <fieldset className="space-y-3 rounded-[12px] border border-hairline p-3">
      <legend className="px-1 text-[13px] font-semibold text-muted-foreground">
        Detalle para el técnico
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-guia`}>Guía de color</Label>
          <select
            id={`${idBase}-guia`}
            value={valor.shadeGuide}
            onChange={(e) =>
              onChange({ ...valor, shadeGuide: e.target.value as GuiaColor | "", shade: "" })
            }
            className={claseInput}
          >
            <option value="">Sin color</option>
            {GUIAS_COLOR.map((g) => (
              <option key={g} value={g}>
                {GUIA_COLOR_LABELS[g]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-color`}>Color</Label>
          <select
            id={`${idBase}-color`}
            value={valor.shade}
            disabled={!valor.shadeGuide}
            onChange={(e) => onChange({ ...valor, shade: e.target.value })}
            className={`${claseInput} disabled:opacity-50`}
          >
            <option value="">{valor.shadeGuide ? "Elige el color" : "Elige la guía"}</option>
            {colores.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-material`}>Material</Label>
          <select
            id={`${idBase}-material`}
            value={valor.material}
            onChange={(e) => onChange({ ...valor, material: e.target.value as Material | "" })}
            className={claseInput}
          >
            <option value="">Sin especificar</option>
            {MATERIALES.map((m) => (
              <option key={m} value={m}>
                {MATERIAL_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-margen`}>Margen</Label>
          <select
            id={`${idBase}-margen`}
            value={valor.marginType}
            onChange={(e) => onChange({ ...valor, marginType: e.target.value as Margen | "" })}
            className={claseInput}
          >
            <option value="">Sin especificar</option>
            {MARGENES.map((m) => (
              <option key={m} value={m}>
                {MARGEN_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>
  );
}
