/**
 * Patty como personaje (landing A+): su cara, con la etiqueta "IA" siempre
 * visible para que nadie la confunda con una persona del equipo.
 *
 * La imagen la generó Walter con IA (Gemini, 20-oct-2026); no es una persona
 * real. Origen y recorte: `04 - Marca y Diseno/patty-avatar-2026-10-20/`.
 * Sin fondo (recorte de sujeto de macOS Vision) y con la cara centrada; el
 * círculo de atrás es `--ai-soft`. Archivos: `public/brand/patty/cara-128.webp`
 * y `cara-256.webp`.
 */
type PattyCaraProps = {
  className?: string;
  /** Lado en px con el que se muestra; elige la imagen y el tamaño de la etiqueta. */
  px?: number;
  /** "eager" solo cuando está a la vista al cargar la página. */
  carga?: "lazy" | "eager";
};

export function PattyCara({ className, px = 40, carga = "lazy" }: PattyCaraProps) {
  const chica = px < 32;
  return (
    <span
      role="img"
      aria-label="Patty, la inteligencia artificial de Esmalia"
      className={["lv-patty-cara", chica ? "chica" : "", className ?? ""].join(" ").trim()}
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
      />
      <span className="ia" aria-hidden="true">
        IA
      </span>
    </span>
  );
}
