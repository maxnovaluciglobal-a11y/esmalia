// Arco de 32 piezas: parten desordenadas (contorno ocre) y con el scroll se
// ordenan en las arcadas superior e inferior FDI. Al final aparecen los
// números y las condiciones de la paciente de ejemplo, con la convención
// clínica del odontograma: azul = existente, rojo = por realizar.
//
// El HTML del servidor trae el arco ya ordenado y completo. El desorden y el
// scroll se encienden solo en el cliente, con movimiento permitido.
import { useEffect, useRef } from "react";

import { useMovimiento } from "@/hooks/use-movimiento";

const ARRIBA = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const ABAJO = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
// Paciente de ejemplo: ex = existente (azul), pl = por realizar (rojo),
// plx = extracción indicada, ausente = pieza ausente.
const CONDICION: Record<number, "ex" | "pl" | "plx" | "ausente"> = {
  18: "ausente",
  38: "ausente",
  16: "ex",
  11: "ex",
  24: "ex",
  37: "ex",
  46: "ex",
  33: "ex",
  14: "pl",
  26: "pl",
  28: "plx",
  36: "pl",
  45: "pl",
};

type Pieza = {
  n: number;
  th: number;
  x: number;
  y: number;
  r: number;
  sx: number;
  sy: number;
  sr: number;
  arriba: boolean;
};

function tamano(n: number): [number, number] {
  const u = n % 10;
  return u >= 6 ? [44, 40] : u >= 4 ? [32, 30] : u === 3 ? [28, 28] : [30, 20];
}

// Desorden determinista (misma semilla en servidor y cliente).
function piezas(): Pieza[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const out: Pieza[] = [];
  const ubicar = (lista: number[], arriba: boolean) =>
    lista.forEach((n, i) => {
      const th = ((172 - i * (164 / 15)) * Math.PI) / 180;
      const cy = arriba ? 296 : 352;
      const rx = arriba ? 330 : 310;
      const ry = arriba ? 250 : 240;
      const x = 400 + rx * Math.cos(th);
      const y = arriba ? cy - ry * Math.sin(th) : cy + ry * Math.sin(th);
      const grados = 90 - (th * 180) / Math.PI;
      out.push({
        n,
        th,
        x,
        y,
        r: arriba ? grados : -grados,
        sx: 60 + rnd() * 680,
        sy: 40 + rnd() * 560,
        sr: rnd() * 360 - 180,
        arriba,
      });
    });
  ubicar(ARRIBA, true);
  ubicar(ABAJO, false);
  return out;
}

const PIEZAS = piezas();
const f1 = (v: number) => v.toFixed(1);

function Condicion({ c, w, h }: { c: string | undefined; w: number; h: number }) {
  if (c === "ex")
    return (
      <rect
        className="cnd"
        x={-w / 4}
        y={-h / 4}
        width={w / 2}
        height={h / 2}
        rx="4"
        fill="var(--lv-clin-ex)"
      />
    );
  if (c === "pl")
    return (
      <rect
        className="cnd"
        x={-w / 4}
        y={-h / 4}
        width={w / 2}
        height={h / 2}
        rx="4"
        fill="color-mix(in srgb, var(--lv-clin-pl) 12%, var(--card))"
        stroke="var(--lv-clin-pl)"
        strokeWidth="2.4"
      />
    );
  if (c === "plx" || c === "ausente")
    return (
      <path
        className="cnd"
        d={`M${f1(-w / 2.4)} ${f1(-h / 2.4)}L${f1(w / 2.4)} ${f1(h / 2.4)}M${f1(w / 2.4)} ${f1(-h / 2.4)}L${f1(-w / 2.4)} ${f1(h / 2.4)}`}
        stroke={c === "plx" ? "var(--lv-clin-pl)" : "var(--lv-clin-ex)"}
        strokeWidth="3"
        strokeLinecap="round"
      />
    );
  return null;
}

export function Arco32() {
  const { animar } = useMovimiento();
  const pista = useRef<HTMLDivElement>(null);
  const escenario = useRef<HTMLDivElement>(null);
  const grupos = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    const tr = pista.current;
    const st = escenario.current;
    if (!tr || !st || !animar) return;

    const facil = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const pintar = (p: number) => {
      const e = facil(Math.min(1, p / 0.8));
      const k = Math.max(0, Math.min(1, (p - 0.75) / 0.2));
      PIEZAS.forEach((t, i) => {
        const g = grupos.current[i];
        if (!g) return;
        const x = t.sx + (t.x - t.sx) * e;
        const y = t.sy + (t.y - t.sy) * e;
        const r = t.sr + (t.r - t.sr) * e;
        g.setAttribute("transform", `translate(${f1(x)} ${f1(y)})`);
        g.firstElementChild?.setAttribute("transform", `rotate(${f1(r)})`);
        g.classList.toggle("scat", e < 0.98);
        g.querySelectorAll<SVGElement>(".cnd, .tn").forEach((el) => {
          el.style.opacity = String(k);
        });
      });
    };
    const reponer = () => {
      PIEZAS.forEach((t, i) => {
        const g = grupos.current[i];
        if (!g) return;
        g.setAttribute("transform", `translate(${f1(t.x)} ${f1(t.y)})`);
        g.firstElementChild?.setAttribute("transform", `rotate(${f1(t.r)})`);
        g.classList.remove("scat");
        g.querySelectorAll<SVGElement>(".cnd, .tn").forEach((el) => {
          el.style.opacity = "";
        });
      });
    };

    let activo = false;
    let raf = 0;
    const progreso = () => {
      const r = tr.getBoundingClientRect();
      const recorrido = r.height - st.offsetHeight;
      return recorrido > 0 ? Math.max(0, Math.min(1, -r.top / recorrido)) : 1;
    };
    const disponer = () => {
      // Solo si el contenido entra entero en la pantalla (en un celular
      // angosto el texto y el arco apilados no entran: queda quieto).
      const alto = (st.firstElementChild as HTMLElement | null)?.offsetHeight ?? Infinity;
      activo = window.innerHeight < 1150 && alto <= window.innerHeight - 24;
      st.classList.toggle("is-sticky", activo);
      tr.style.height = activo ? `${st.offsetHeight + 1100}px` : "";
      if (activo) pintar(progreso());
      else reponer();
    };
    const alScroll = () => {
      if (!activo || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        pintar(progreso());
      });
    };
    disponer();
    window.addEventListener("scroll", alScroll, { passive: true });
    window.addEventListener("resize", disponer);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", alScroll);
      window.removeEventListener("resize", disponer);
      st.classList.remove("is-sticky");
      tr.style.height = "";
      reponer();
    };
  }, [animar]);

  return (
    <section className="lv-arc-sec" id="arco" aria-labelledby="lv-arc-h">
      <div className="lv-arc-track" ref={pista}>
        <div className="lv-arc-stage" ref={escenario}>
          <div className="lv-wrap lv-arc-in">
            <div>
              <h2 className="lv-h-sec" id="lv-arc-h">
                32 piezas. <em>Una ficha.</em>
              </h2>
              <p className="lv-lead">
                Cada diente encuentra su lugar en el odontograma FDI, con su historia: varias
                condiciones por pieza, cada una existente o por realizar.
              </p>
              <div className="lv-arc-leg">
                <span>
                  <i className="ex" />
                  Azul · existente
                </span>
                <span>
                  <i className="pl" />
                  Rojo · por realizar
                </span>
              </div>
              <p className="lv-why">
                <b>Por qué azul y rojo:</b> es la convención con la que el dentista aprendió a
                llenar la ficha en papel. Esmalia la respeta para que nadie tenga que reaprender a
                leer una boca.
              </p>
            </div>
            <svg
              className="lv-arc-svg"
              viewBox="0 0 800 640"
              role="img"
              aria-label="Las 32 piezas dentales ordenadas en las arcadas superior e inferior; en azul lo existente y en rojo lo por realizar. Paciente de ejemplo."
            >
              <line className="mid-l" x1="40" y1="324" x2="760" y2="324" />
              <line className="mid-l" x1="400" y1="20" x2="400" y2="620" />
              {PIEZAS.map((t, i) => {
                const [w, h] = tamano(t.n);
                return (
                  <g
                    key={t.n}
                    ref={(el) => {
                      grupos.current[i] = el;
                    }}
                    transform={`translate(${f1(t.x)} ${f1(t.y)})`}
                  >
                    <g transform={`rotate(${f1(t.r)})`}>
                      <rect
                        className="tb"
                        x={-w / 2}
                        y={-h / 2}
                        width={w}
                        height={h}
                        rx={Math.min(w, h) * 0.42}
                      />
                      <Condicion c={CONDICION[t.n]} w={w} h={h} />
                    </g>
                    <text
                      className="tn"
                      x={f1(Math.cos(t.th) * 36)}
                      y={f1((t.arriba ? -1 : 1) * Math.sin(t.th) * 36 + 4)}
                    >
                      {t.n}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
