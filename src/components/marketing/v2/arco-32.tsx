// Arco de 32 piezas (versión del draft C, 20-oct-2026): las piezas parten
// dispersas y en colores y con el scroll (sticky) se ordenan en las arcadas
// superior e inferior FDI, con tres pasos y una barra de progreso. Al final
// aparecen los números y las condiciones de la paciente de ejemplo, con la
// convención clínica del odontograma: azul = existente, rojo = por realizar,
// X = pieza ausente (azul) o extracción indicada (roja).
//
// El HTML del servidor trae el arco ya ordenado, completo y los tres pasos
// a la vista. El desorden, el sticky y el paso a paso se encienden solo en
// el cliente, con movimiento permitido y si la sección entra en la pantalla.
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

// Siluetas del draft C (corona arriba, raíces abajo, centradas en 0,0).
const FORMAS = {
  m: "M-17-14c-1-9 5-14 11-12 2 1 4 2 6 2s4-1 6-2c6-2 12 3 11 12-1 6-4 9-5 15-1 6-1 13-4 15-3 1-4-4-5-9-1-4-2-6-3-6s-2 2-3 6c-1 5-2 10-5 9-3-2-3-9-4-15-1-6-4-9-5-15z",
  p: "M-12-13c0-7 5-11 12-11s12 4 12 11c0 6-3 10-4 16-1 7-3 18-8 18s-7-11-8-18c-1-6-4-10-4-16z",
  c: "M-10-10c0-8 6-15 10-16 4 1 10 8 10 16 0 6-3 10-4 17-1 8-2 19-6 19s-5-11-6-19c-1-7-4-11-4-17z",
  i: "M-10-22c6-2 14-2 20 0 1 8 0 14-2 19-2 6-3 22-8 22s-6-16-8-22c-2-5-3-11-2-19z",
} as const;
const ESCALA = { m: 1.12, p: 0.92, c: 0.92, i: 0.86 } as const;

function tipo(n: number): keyof typeof FORMAS {
  const u = n % 10;
  return u >= 6 ? "m" : u >= 4 ? "p" : u === 3 ? "c" : "i";
}

const PASOS = [
  <>
    Así llega casi cualquier clínica: <b>planilla, cuaderno, post-its y el WhatsApp personal</b>.
    Cada dato en otro lado.
  </>,
  <>
    Cada diente encuentra su lugar en el <b>odontograma FDI</b>, con su historia: varias condiciones
    por pieza, cada una existente o por realizar.
  </>,
  <>
    <b>Azul es existente y rojo, por realizar.</b> La X marca la pieza ausente.
  </>,
];

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
        // Corona hacia el centro de la boca, raíces hacia afuera.
        r: arriba ? grados + 180 : -grados,
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

function Condicion({ c, molar }: { c: string | undefined; molar: boolean }) {
  if (c === "ex" || c === "pl")
    return <ellipse className={`cnd ${c}`} cx="0" cy="-12" rx={molar ? 9 : 6} ry="6" />;
  if (c === "plx" || c === "ausente")
    return <path className={`cnd x ${c}`} d="M-14-18L14 18M14-18L-14 18" />;
  return null;
}

export function Arco32() {
  const { animar } = useMovimiento();
  const pista = useRef<HTMLDivElement>(null);
  const escenario = useRef<HTMLDivElement>(null);
  const grupos = useRef<(SVGGElement | null)[]>([]);
  const pasos = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const tr = pista.current;
    const st = escenario.current;
    if (!tr || !st || !animar) return;

    const facil = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    let pasoActual = -1;
    const marcarPaso = (k: number) => {
      if (k === pasoActual) return;
      pasoActual = k;
      pasos.current?.querySelectorAll("li").forEach((li, i) => li.classList.toggle("on", i === k));
      st.querySelectorAll(".lv-arc-bars i").forEach((b, i) => b.classList.toggle("on", i <= k));
    };
    const pintar = (p: number) => {
      marcarPaso(p < 0.36 ? 0 : p < 0.7 ? 1 : 2);
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
      pasoActual = -1;
      pasos.current?.querySelectorAll("li").forEach((li) => li.classList.remove("on"));
      st.querySelectorAll(".lv-arc-bars i").forEach((b) => b.classList.remove("on"));
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
      // Se mide ya en modo sticky (los pasos apilados ocupan menos).
      st.classList.add("is-sticky");
      const alto = (st.firstElementChild as HTMLElement | null)?.offsetHeight ?? Infinity;
      activo = window.innerHeight < 1150 && alto <= window.innerHeight - 24;
      st.classList.toggle("is-sticky", activo);
      tr.style.height = activo ? `${st.offsetHeight + 1300}px` : "";
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
              <ol className="lv-arc-steps" ref={pasos}>
                {PASOS.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
              <div className="lv-arc-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div className="lv-arc-leg">
                <span>
                  <i className="ex" />
                  Azul · existente
                </span>
                <span>
                  <i className="pl" />
                  Rojo · por realizar
                </span>
                <span>
                  <i className="x" />
                  Ausente
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
              aria-label="Las 32 piezas dentales ordenadas en las arcadas superior e inferior; en azul lo existente, en rojo lo por realizar y con una X las piezas ausentes. Paciente de ejemplo."
            >
              <line className="mid-l" x1="40" y1="324" x2="760" y2="324" />
              <line className="mid-l" x1="400" y1="20" x2="400" y2="620" />
              {PIEZAS.map((t, i) => {
                const k = tipo(t.n);
                const c = CONDICION[t.n];
                return (
                  <g
                    key={t.n}
                    ref={(el) => {
                      grupos.current[i] = el;
                    }}
                    className={`c${t.n % 5}${c === "ausente" ? " aus" : ""}`}
                    transform={`translate(${f1(t.x)} ${f1(t.y)})`}
                  >
                    <g transform={`rotate(${f1(t.r)})`}>
                      <g transform={`scale(${ESCALA[k]})`}>
                        <path className="tb" d={FORMAS[k]} />
                        <Condicion c={c} molar={k === "m"} />
                      </g>
                    </g>
                    <text
                      className="tn"
                      x={f1(Math.cos(t.th) * 44)}
                      y={f1((t.arriba ? -1 : 1) * Math.sin(t.th) * 44 + 4)}
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
