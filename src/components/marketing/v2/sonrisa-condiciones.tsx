// Cinta de condiciones sobre la curva de una sonrisa (draft C, 20-oct-2026):
// encabezado de "Lo que pasa mientras atiendes". Decorativa (aria-hidden):
// las palabras ya están en la cinta ocre de arriba.
//
// El servidor manda el texto ya sobre la curva, quieto. En el cliente corre
// solo con movimiento permitido y mientras está en pantalla.
import { useEffect, useRef } from "react";

import { useMovimiento } from "@/hooks/use-movimiento";

import { CONDICIONES } from "./condiciones";

const CURVA = "M-120 40 C 260 400, 1180 400, 1560 40";
const COPIAS = 3;

export function SonrisaCondiciones() {
  const { animar } = useMovimiento();
  const texto = useRef<SVGTextPathElement>(null);

  useEffect(() => {
    const tp = texto.current;
    if (!tp || !animar) return;
    let ciclo = 0;
    const medir = () => {
      try {
        ciclo = tp.getComputedTextLength() / COPIAS;
      } catch {
        ciclo = 0;
      }
    };
    let off = 0;
    let ultimo = performance.now();
    let raf = 0;
    let visible = false;
    const tick = (t: number) => {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(64, t - ultimo);
      ultimo = t;
      if (!ciclo) medir();
      if (ciclo) {
        off -= dt * 0.065;
        if (off < -ciclo) off += ciclo;
        tp.setAttribute("startOffset", off.toFixed(1));
      }
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) {
        ultimo = performance.now();
        raf = requestAnimationFrame(tick);
      }
    });
    io.observe(tp.ownerSVGElement ?? tp);
    void document.fonts?.ready.then(medir);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [animar]);

  return (
    <div className="lv-smile" aria-hidden="true">
      <svg viewBox="0 0 1440 330" preserveAspectRatio="xMidYMid meet">
        <defs>
          <path id="lv-smile-path" d={CURVA} />
        </defs>
        <path className="lip" d={CURVA} />
        <text>
          <textPath ref={texto} href="#lv-smile-path" startOffset="0">
            {Array.from({ length: COPIAS }, (_, r) =>
              CONDICIONES.map((w, i) => (
                <tspan key={`${r}-${w}`} className={i % 2 ? "a" : "b"}>
                  {`${w}  ·  `}
                </tspan>
              )),
            )}
          </textPath>
        </text>
      </svg>
    </div>
  );
}
