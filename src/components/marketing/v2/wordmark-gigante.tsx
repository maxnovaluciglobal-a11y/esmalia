// Wordmark "Esmalia" en texto Bricolage, gigante, con el punto de la i como
// molar (draft "C sobre /v2"). Es decorativo (aria-hidden): el nombre
// accesible y el link al inicio siguen siendo el logo real (EsmaliaLogo).
import { cn } from "@/lib/utils";

/** Molar chico para el punto de la i (viewBox 20 × 20). */
const PUNTO_MOLAR =
  "M2 7.2C1.8 3.6 4.6 1.6 7.3 2.4c1.1.3 1.8.7 2.7.7s1.6-.4 2.7-.7c2.7-.8 5.5 1.2 5.3 4.8-.1 2.4-1.4 3.6-1.9 6-.4 2-.6 4.7-1.9 5.2-1.3.5-1.6-1.3-1.9-3-.3-1.6-.7-2.6-2.3-2.6s-2 1-2.3 2.6c-.3 1.7-.6 3.5-1.9 3-1.3-.5-1.5-3.2-1.9-5.2-.5-2.4-1.8-3.6-1.9-6z";

export function WordmarkGigante({ className }: { className?: string }) {
  return (
    <span className={cn("lv-wm", className)} aria-hidden="true">
      <span>Esmal</span>
      <span className="lv-wm-i">
        <span className="lv-wm-stem">i</span>
        <svg className="lv-wm-dot" viewBox="0 0 20 20">
          <path d={PUNTO_MOLAR} />
        </svg>
      </span>
      <span>a</span>
    </span>
  );
}
