import { cn } from "@/lib/utils";

/**
 * La cara de Patty, compartida por la app y la landing, con la etiqueta "IA"
 * siempre visible para que nadie la confunda con una persona del equipo.
 *
 * La imagen la generó Walter con IA (Gemini, 20-oct-2026); no es una persona
 * real. Origen y recorte: `04 - Marca y Diseno/patty-avatar-2026-10-20/`.
 * Sin fondo (recorte de sujeto de macOS Vision) y con la cara centrada; el
 * círculo de atrás es `--ai-soft`. Archivos: `public/brand/patty/cara-128.webp`
 * y `cara-256.webp`.
 *
 * Dos estilos con el mismo marcado:
 * - `"app"` (por defecto): utilidades de Tailwind con los tokens `ai` de
 *   `styles.css`. La app nunca carga `landing-v2.css`.
 * - `"landing"`: las clases `lv-patty-cara` de `landing-v2.css`, que se
 *   mantiene autocontenido. Lo usa `marketing/v2/patty-cara.tsx`.
 */
export const PATTY_ARIA_LABEL = "Patty, la inteligencia artificial de Esmalia";

/** Debajo de este lado la etiqueta "IA" se achica. */
const LADO_CHICO = 32;

export type PattyCaraProps = {
  className?: string;
  /** Lado en px con el que se muestra; elige la imagen y el tamaño de la etiqueta. */
  px?: number;
  /** "eager" solo cuando está a la vista al cargar la página. */
  carga?: "lazy" | "eager";
  /**
   * `true` cuando el texto de al lado ya nombra a Patty: la cara queda
   * `aria-hidden` para que el lector de pantalla no la anuncie dos veces.
   */
  decorativa?: boolean;
  estilo?: "app" | "landing";
};

export function PattyCara({
  className,
  px = 40,
  carga = "lazy",
  decorativa = false,
  estilo = "app",
}: PattyCaraProps) {
  const chica = px < LADO_CHICO;
  const landing = estilo === "landing";
  const accesible = decorativa
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": PATTY_ARIA_LABEL } as const);

  return (
    <span
      {...accesible}
      className={
        landing
          ? ["lv-patty-cara", chica ? "chica" : "", className ?? ""].join(" ").trim()
          : cn("relative inline-block shrink-0 rounded-full", className)
      }
      style={{ width: px, height: px }}
    >
      <img
        src="/brand/patty/cara-128.webp"
        srcSet="/brand/patty/cara-128.webp 128w, /brand/patty/cara-256.webp 256w"
        sizes={`${px}px`}
        width={px}
        height={px}
        alt=""
        loading={carga}
        decoding="async"
        className={
          landing
            ? undefined
            : "block size-full rounded-full bg-ai-soft object-cover ring-2 ring-ai-border"
        }
      />
      <span
        className={
          landing
            ? "ia"
            : cn(
                "absolute rounded-full bg-ai font-bold leading-[1.35] tracking-[0.04em] text-ai-foreground ring-2 ring-background",
                chica
                  ? "-right-1.5 -bottom-1 px-[3px] text-[8px]"
                  : "-right-1 -bottom-[3px] px-[5px] text-[10px]",
              )
        }
        aria-hidden="true"
      >
        IA
      </span>
    </span>
  );
}
