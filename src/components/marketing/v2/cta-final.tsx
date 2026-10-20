import { Link } from "@tanstack/react-router";

import { registrarEvento } from "@/lib/marketing/eventos";

import { Marquee } from "./marquee";
import { MolarHalftone } from "./molar-halftone";

const MODULOS = [
  "agenda",
  "ficha",
  "caja",
  "recordatorios",
  "odontograma",
  "arqueo",
  "presupuestos",
] as const;

// Cierre como en el draft C: bloque ocre con titular gigante, botones en
// tinta y el molar en halftone al costado (en móvil, abajo). Las cintas de
// módulos siguen debajo, sobre noche, como en /v2.
export function CtaFinal() {
  return (
    <section className="lv-end" aria-labelledby="lv-end-h">
      <div className="lv-end-ocre">
        <MolarHalftone className="lv-halftone" />
        <div className="lv-wrap lv-end-in">
          <h2 className="lv-h-sec" id="lv-end-h">
            Llena la silla de las 12. <em>Empieza hoy.</em>
          </h2>
          <p className="lv-lead">
            14 días gratis, sin tarjeta. Si no es para ti, exportas todo y listo.
          </p>
          <div className="lv-ctas">
            <Link
              to="/auth"
              search={{ signup: true }}
              onClick={() => registrarEvento("cta_click", { cta: "signup", lugar: "v2-cierre" })}
              className="lv-btn lv-btn-ink"
            >
              Probar 14 días gratis{" "}
              <span className="lv-arrow" aria-hidden="true">
                →
              </span>
            </Link>
            <a
              href="/demo"
              onClick={() => registrarEvento("cta_click", { cta: "demo", lugar: "v2-cierre" })}
              className="lv-btn lv-btn-line"
            >
              Entrar a la demo
            </a>
          </div>
        </div>
      </div>
      <div className="lv-on-night">
        <Marquee palabras={MODULOS} direccion={-0.7} className="lv-big-marq" />
      </div>
    </section>
  );
}
