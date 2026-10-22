import { cloneElement, useId, useState, type ReactElement, type ReactNode } from "react";

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Hijo = ReactElement<{
  disabled?: boolean;
  className?: string;
  "aria-describedby"?: string;
}>;

/**
 * Acción deshabilitada con el motivo a la vista (UX-05, Ola 0).
 *
 * Un botón gris sin explicación obliga a adivinar; un `title` no se ve en el
 * celular ni lo lee bien un lector de pantalla. Con `motivo`:
 *
 * - el hijo (un botón, o un `DialogTrigger asChild`) queda `disabled` y con
 *   `aria-describedby` apuntando al texto del motivo, así que el lector de
 *   pantalla lo anuncia junto al botón;
 * - `como="texto"` (por defecto) muestra el motivo debajo, siempre visible:
 *   para formularios y pasos ("Continuar");
 * - `como="globo"` lo muestra en un globo al pasar el puntero, al enfocar o al
 *   tocar (también en pantallas táctiles): para barras de acciones donde un
 *   texto debajo rompería la fila.
 *
 * Sin `motivo` (null, undefined o "") devuelve el hijo tal cual: la acción
 * está disponible.
 */
export function AccionDeshabilitada({
  motivo,
  children,
  como = "texto",
  className,
}: {
  motivo: ReactNode | null | undefined | false;
  children: Hijo;
  como?: "texto" | "globo";
  className?: string;
}) {
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  if (!motivo) return children;

  const idMotivo = `motivo-${id}`;
  const describedBy = [children.props["aria-describedby"], idMotivo].filter(Boolean).join(" ");

  if (como === "texto") {
    return (
      <span className={cn("inline-flex flex-col items-end gap-1", className)}>
        {cloneElement(children, { disabled: true, "aria-describedby": describedBy })}
        <span id={idMotivo} className="max-w-72 text-right text-xs text-muted-foreground">
          {motivo}
        </span>
      </span>
    );
  }

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverAnchor asChild>
        {/* El botón deshabilitado no recibe el puntero ni el foco: quien
            muestra el globo es este envoltorio (hover, foco con teclado y
            toque en el celular). */}
        <span
          tabIndex={0}
          data-accion-deshabilitada=""
          aria-describedby={idMotivo}
          className={cn(
            "inline-flex cursor-not-allowed rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700",
            className,
          )}
          onMouseEnter={() => setAbierto(true)}
          onMouseLeave={() => setAbierto(false)}
          onFocus={() => setAbierto(true)}
          onBlur={() => setAbierto(false)}
          onClick={() => setAbierto((a) => !a)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAbierto(false);
          }}
        >
          {cloneElement(children, {
            disabled: true,
            "aria-describedby": describedBy,
            className: cn(children.props.className, "pointer-events-none"),
          })}
          <span id={idMotivo} className="sr-only">
            {motivo}
          </span>
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        role="tooltip"
        className="w-auto max-w-72 px-3 py-2 text-xs leading-snug"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {motivo}
      </PopoverContent>
    </Popover>
  );
}
