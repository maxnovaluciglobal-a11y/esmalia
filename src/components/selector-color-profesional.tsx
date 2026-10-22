import { useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";

import {
  colorDePaleta,
  PALETA_PROFESIONALES,
  type ColorDePaleta,
} from "@/lib/clinic-operations/color-profesional";
import { cn } from "@/lib/utils";

/**
 * Elegir el color de un profesional en la agenda (AGE-06): ocho muestras de
 * la paleta de tokens, como un grupo de opciones. Se navega con flechas
 * (una sola parada de Tab) y cada muestra dice su nombre: el color nunca es
 * la única pista. Guarda el hex del modo claro del token (ver
 * `color-profesional.ts`).
 */
export function SelectorColorProfesional({
  id,
  value,
  onChange,
  usados = [],
}: {
  id: string;
  /** Hex guardado (puede ser uno libre de antes: se marca el más parecido). */
  value: string;
  onChange: (hex: string) => void;
  /** Colores que ya usan otros profesionales, para decirlo en la muestra. */
  usados?: readonly string[];
}) {
  const elegido = colorDePaleta(value);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const usadosTokens = new Set(usados.map((u) => colorDePaleta(u).token));

  function elegir(c: ColorDePaleta) {
    onChange(c.claro);
    refs.current.get(c.token)?.focus();
  }

  function alTeclear(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = PALETA_PROFESIONALES.length;
    let j: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + n) % n;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = n - 1;
    if (j === null) return;
    e.preventDefault();
    elegir(PALETA_PROFESIONALES[j]);
  }

  return (
    <div className="space-y-1.5">
      <p id={`${id}-etiqueta`} className="text-sm font-medium leading-none">
        Color en agenda
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-etiqueta`}
        aria-describedby={`${id}-ayuda`}
        className="flex flex-wrap gap-1.5"
      >
        {PALETA_PROFESIONALES.map((c, i) => {
          const activo = c.token === elegido.token;
          const enUso = usadosTokens.has(c.token) && !activo;
          return (
            <button
              key={c.token}
              ref={(el) => {
                if (el) refs.current.set(c.token, el);
                else refs.current.delete(c.token);
              }}
              type="button"
              role="radio"
              aria-checked={activo}
              aria-label={enUso ? `${c.nombre} (ya lo usa otro profesional)` : c.nombre}
              title={enUso ? `${c.nombre} · ya lo usa otro profesional` : c.nombre}
              tabIndex={activo ? 0 : -1}
              onClick={() => elegir(c)}
              onKeyDown={(e) => alTeclear(e, i)}
              className={cn(
                "grid size-8 place-items-center rounded-full border-2 border-transparent transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-11",
                activo && "border-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-6 place-items-center rounded-full text-card pointer-coarse:size-8"
                style={{ backgroundColor: `var(--${c.token})` }}
              >
                {activo && <Check className="size-3.5" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      <p id={`${id}-ayuda`} className="text-[11px] text-muted-foreground">
        {elegido.nombre}. Marca el borde de sus citas en la agenda; se ajusta solo al modo oscuro.
      </p>
    </div>
  );
}
