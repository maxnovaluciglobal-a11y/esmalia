import { useId, useMemo, useState } from "react";

import {
  buscarEnVademecum,
  ETIQUETA_VIA,
  etiquetaMedicamento,
  type MedicamentoVademecum,
} from "@/lib/clinical/vademecum";
import { cn } from "@/lib/utils";

/**
 * Campo "Medicamento" con autocompletado del vademécum (base + clínica).
 * Combobox accesible: flechas para moverse, Enter para elegir, Escape para
 * cerrar. Elegir una sugerencia completa la fila con su posología sugerida;
 * escribir a mano también vale.
 */
export function CampoMedicamento({
  id,
  valor,
  vademecum,
  onEscribir,
  onElegir,
  className,
}: {
  id: string;
  valor: string;
  vademecum: readonly MedicamentoVademecum[];
  onEscribir: (texto: string) => void;
  onElegir: (m: MedicamentoVademecum) => void;
  className?: string;
}) {
  const idLista = `${useId()}-lista`;
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const sugerencias = useMemo(() => buscarEnVademecum(vademecum, valor), [vademecum, valor]);
  const visible = abierto && sugerencias.length > 0;

  function elegir(m: MedicamentoVademecum) {
    onElegir(m);
    setAbierto(false);
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={visible}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={visible ? `${idLista}-${activo}` : undefined}
        autoComplete="off"
        value={valor}
        placeholder="Escribe para buscar en el vademécum"
        className={className}
        onChange={(e) => {
          onEscribir(e.target.value);
          setActivo(0);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
        onKeyDown={(e) => {
          if (!visible) {
            if (e.key === "ArrowDown") setAbierto(true);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActivo((i) => (i + 1) % sugerencias.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActivo((i) => (i - 1 + sugerencias.length) % sugerencias.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            elegir(sugerencias[activo] ?? sugerencias[0]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setAbierto(false);
          }
        }}
      />
      {visible && (
        <ul
          id={idLista}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {sugerencias.map((m, i) => (
            <li
              key={m.codigo}
              id={`${idLista}-${i}`}
              role="option"
              aria-selected={i === activo}
              // mousedown (no click): el blur del input cerraría la lista antes.
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(m);
              }}
              onMouseEnter={() => setActivo(i)}
              className={cn(
                "cursor-pointer rounded-sm px-2 py-1.5 text-sm",
                i === activo && "bg-accent text-accent-foreground",
              )}
            >
              <span className="font-medium">{etiquetaMedicamento(m)}</span>
              <span className="block text-xs text-muted-foreground">
                {ETIQUETA_VIA[m.via]}
                {m.dosis ? ` · ${m.dosis}, ${m.frecuencia}, ${m.duracion}` : " · dosis según peso"}
                {m.origen === "clinica" ? " · de la clínica" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
