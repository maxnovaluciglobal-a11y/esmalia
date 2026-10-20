// Hero de la landing A+: la tarjeta "Hoy" crece con el scroll hasta mostrar
// el día por sillón.
//
// Cómo se mantiene sin saltos (CLS) ni contenido escondido:
// - El HTML del servidor trae la tarjeta "Hoy" en su lugar, legible. La
//   ventana en tinta que se expande arranca con un clip vacío (CSS), así que
//   sin JS no tapa nada.
// - El efecto de scroll se enciende solo en el cliente, solo si se puede
//   animar (ni prefers-reduced-motion ni "Pausar movimiento") y solo si el
//   escenario entra en la pantalla. El alto del escenario es el mismo con y
//   sin efecto: lo único que crece es la pista de scroll, por debajo del
//   primer pantallazo.
// - Sin animación, "Abrir el día" abre la vista completa al instante y
//   "Cerrar el día" la vuelve a la tarjeta.
// - Un solo listener de scroll pasivo con requestAnimationFrame, que escribe
//   estilos directo en el DOM (no re-renderiza React en cada cuadro).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";

import { PattyMark } from "@/components/patty";
import { useMovimiento } from "@/hooks/use-movimiento";
import { registrarEvento } from "@/lib/marketing/eventos";

import {
  DIA_EJEMPLO,
  SILLONES_HOY,
  formatoClp,
  minutos,
  resumenDelDia,
  type CitaEjemplo,
} from "./datos-ejemplo";

const H0 = DIA_EJEMPLO.inicio * 60;
const SPAN = (DIA_EJEMPLO.fin - DIA_EJEMPLO.inicio) * 60;
const HORAS = Array.from(
  { length: DIA_EJEMPLO.fin - DIA_EJEMPLO.inicio },
  (_, i) => DIA_EJEMPLO.inicio + i,
);
const RESUMEN = resumenDelDia(SILLONES_HOY, DIA_EJEMPLO.ahora);
// Ocupación ilustrativa del día: 12 tramos, 2 huecos (rayados) y uno libre.
const OCUPACION = ["", "", "", "h", "", "l", "", "", "h", "", "", ""] as const;

const pct = (min: number) => `${(min / SPAN) * 100}%`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function suave(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

type Caja = { t: number; l: number; w: number; h: number };

export function HeroDia() {
  const { animar } = useMovimiento();
  const [abierto, setAbierto] = useState(false);
  const [ofrecidos, setOfrecidos] = useState<ReadonlySet<string>>(new Set());

  const pista = useRef<HTMLDivElement>(null);
  const escenario = useRef<HTMLDivElement>(null);
  const tarjeta = useRef<HTMLDivElement>(null);
  const ventana = useRef<HTMLDivElement>(null);
  const dia = useRef<HTMLDivElement>(null);
  const izq = useRef<HTMLSpanElement>(null);
  const der = useRef<HTMLSpanElement>(null);
  const pie = useRef<HTMLDivElement>(null);
  const abrirBtn = useRef<HTMLButtonElement>(null);
  const cerrarBtn = useRef<HTMLButtonElement>(null);
  const motor = useRef({ activo: false, caja: { t: 0, l: 0, w: 0, h: 0 } as Caja });

  /** Pinta el progreso p (0 = tarjeta, 1 = día completo). */
  const pintar = useCallback((p: number) => {
    const st = escenario.current;
    const win = ventana.current;
    const hoy = tarjeta.current;
    const d = dia.current;
    if (!st || !win || !hoy || !d) return;
    const { caja } = motor.current;
    const sw = st.clientWidth;
    const sh = st.clientHeight;
    const e = suave(0, 0.75, p);
    const pad = window.innerWidth < 820 ? 10 : 20;
    const t = lerp(caja.t, pad, e);
    const l = lerp(caja.l, pad, e);
    const r = lerp(sw - caja.l - caja.w, pad, e);
    const b = lerp(sh - caja.t - caja.h, pad, e);
    win.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${lerp(18, 14, e)}px)`;

    const fuera = suave(0, 0.6, p);
    for (const [el, dir] of [
      [izq.current, -1],
      [der.current, 1],
    ] as const) {
      if (!el) continue;
      el.style.transform = fuera ? `translateX(${dir * fuera * 28}vw)` : "";
      el.style.opacity = fuera ? String(1 - fuera) : "";
      el.style.filter = fuera ? `blur(${fuera * 6}px)` : "";
    }
    if (pie.current) {
      const fo = 1 - suave(0, 0.3, p);
      pie.current.style.opacity = fo < 1 ? String(fo) : "";
      pie.current.style.visibility = fo < 0.02 ? "hidden" : "";
    }

    const hf = 1 - suave(0.05, 0.3, p);
    hoy.style.opacity = hf < 1 ? String(hf) : "";
    hoy.style.visibility = hf < 0.02 ? "hidden" : "";
    hoy.style.transform = hf < 1 ? `scale(${1 - (1 - hf) * 0.06})` : "";

    const df = suave(0.35, 0.7, p);
    d.style.opacity = String(df);
    d.style.transform = `translateY(${(1 - df) * 24}px)`;
    d.classList.toggle("vis", df > 0.02);
    if (df > 0.5) d.classList.add("open");
    if (p < 0.2) d.classList.remove("open");
  }, []);

  /** Mide la tarjeta respecto del escenario (punto de partida de la ventana). */
  const medir = useCallback(() => {
    const st = escenario.current;
    const hoy = tarjeta.current;
    if (!st || !hoy) return;
    const prev = hoy.style.transform;
    hoy.style.transform = "";
    const sr = st.getBoundingClientRect();
    const hr = hoy.getBoundingClientRect();
    hoy.style.transform = prev;
    motor.current.caja = { t: hr.top - sr.top, l: hr.left - sr.left, w: hr.width, h: hr.height };
  }, []);

  const limpiar = useCallback(() => {
    for (const el of [izq.current, der.current, pie.current, tarjeta.current, dia.current]) {
      if (!el) continue;
      el.style.transform = "";
      el.style.opacity = "";
      el.style.filter = "";
      el.style.visibility = "";
    }
    dia.current?.classList.remove("vis", "open");
    if (ventana.current) {
      ventana.current.style.clipPath = "";
      ventana.current.style.transition = "";
    }
  }, []);

  // Efecto de scroll: solo con movimiento y si el escenario entra en pantalla.
  useEffect(() => {
    const tr = pista.current;
    const st = escenario.current;
    const m = motor.current;
    if (!tr || !st) return;
    if (!animar) {
      m.activo = false;
      st.classList.remove("is-sticky");
      tr.style.height = "";
      return;
    }

    let raf = 0;
    const progreso = () => {
      if (!m.activo) return 0;
      const r = tr.getBoundingClientRect();
      const recorrido = r.height - st.offsetHeight;
      return recorrido > 0 ? clamp(-r.top / recorrido, 0, 1) : 0;
    };
    const actualizar = () => {
      raf = 0;
      pintar(progreso());
    };
    const disponer = () => {
      // Entra si el pie (lo último del escenario) termina dentro de la pantalla.
      const fondoPie = pie.current
        ? pie.current.getBoundingClientRect().bottom - st.getBoundingClientRect().top + 28
        : st.scrollHeight;
      const cabe = fondoPie <= window.innerHeight;
      const activo = window.innerHeight < 1150 && window.innerWidth > 380 && cabe;
      m.activo = activo;
      st.classList.toggle("is-sticky", activo);
      tr.style.height = activo ? `${st.offsetHeight + Math.round(window.innerHeight * 0.9)}px` : "";
      medir();
      if (activo) pintar(progreso());
      else limpiar();
    };
    const alScroll = () => {
      if (!raf) raf = requestAnimationFrame(actualizar);
    };

    disponer();
    window.addEventListener("scroll", alScroll, { passive: true });
    window.addEventListener("resize", disponer);
    void document.fonts?.ready.then(disponer);
    // Si el contenido cambia de alto (fuentes que terminan de cargar, texto
    // que se reacomoda), se vuelve a decidir si el escenario entra.
    const ro = new ResizeObserver(() => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          disponer();
        });
    });
    if (pie.current) ro.observe(pie.current);
    if (tarjeta.current) ro.observe(tarjeta.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", alScroll);
      window.removeEventListener("resize", disponer);
      m.activo = false;
      st.classList.remove("is-sticky");
      tr.style.height = "";
      limpiar();
    };
  }, [animar, pintar, medir, limpiar]);

  // Apertura con el botón cuando no hay efecto de scroll.
  useEffect(() => {
    if (motor.current.activo) return;
    if (!abierto) {
      limpiar();
      return;
    }
    medir();
    if (ventana.current) {
      ventana.current.style.transition = animar ? "clip-path 0.9s var(--ease-out)" : "";
    }
    pintar(1);
    cerrarBtn.current?.focus();
  }, [abierto, animar, pintar, medir, limpiar]);

  function abrirDia() {
    const tr = pista.current;
    const st = escenario.current;
    if (motor.current.activo && tr && st) {
      const r = tr.getBoundingClientRect();
      window.scrollTo({
        top: window.scrollY + r.top + (r.height - st.offsetHeight),
        behavior: "smooth",
      });
      return;
    }
    setAbierto(true);
  }

  function cerrarDia() {
    setAbierto(false);
    requestAnimationFrame(() => abrirBtn.current?.focus());
  }

  return (
    <section className="lv-hero" aria-labelledby="lv-hero-h">
      <div className="lv-hero-track" ref={pista}>
        <div className={abierto ? "lv-hero-stage forced" : "lv-hero-stage"} ref={escenario}>
          <div className="lv-hero-head">
            <div className="lv-hero-rowwrap">
              <h1 id="lv-hero-h">
                <span className="lv-kicker">Software para clínicas dentales</span>
                <span className="lv-hero-row">
                  <span className="lv-hh lv-hh-l" ref={izq}>
                    <span className="lv-ln">
                      <span>Cada silla</span>
                    </span>
                    <span className="lv-ln">
                      <span>vacía</span>
                    </span>
                  </span>
                  <span className="lv-hero-slot" aria-hidden="true" />
                  <span className="lv-hh lv-hh-r" ref={der}>
                    <span className="lv-ln">
                      <span>es plata</span>
                    </span>
                    <span className="lv-ln">
                      <span>que no vuelve.</span>
                    </span>
                  </span>
                </span>
              </h1>
              <div className="lv-hero-over">
                <div
                  className="lv-hoy"
                  ref={tarjeta}
                  role="group"
                  aria-label="Ejemplo de la pantalla Hoy"
                >
                  <div className="lv-t">
                    <span>
                      <b>Hoy</b> · {DIA_EJEMPLO.etiqueta}
                    </span>
                    <span>Ejemplo</span>
                  </div>
                  <p className="lv-big">
                    {RESUMEN.citas} citas<em>{SILLONES_HOY.length} sillones</em>
                  </p>
                  <p className="lv-gap">
                    {RESUMEN.huecos} huecos · {formatoClp(RESUMEN.porLlenarClp)} por llenar
                  </p>
                  <div
                    className="lv-occ"
                    role="img"
                    aria-label={`Ocupación del día de ejemplo, con ${RESUMEN.huecos} huecos`}
                  >
                    {OCUPACION.map((c, i) => (
                      <i key={i} className={c || undefined} />
                    ))}
                  </div>
                  <div className="lv-next">
                    {RESUMEN.proxima && (
                      <span>
                        <span className="lv-mono">{RESUMEN.proxima[0]}</span> {RESUMEN.proxima[2]} ·{" "}
                        {RESUMEN.proxima[3]}
                      </span>
                    )}
                    <button
                      ref={abrirBtn}
                      className="lv-openday"
                      type="button"
                      onClick={abrirDia}
                      aria-expanded={abierto}
                      aria-controls="lv-dia"
                    >
                      Abrir el día <span aria-hidden="true">↓</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="lv-hero-foot" ref={pie}>
            <div>
              <p className="lv-lead">
                Agenda por profesional, ficha con odontograma y caja del día, en una sola pantalla.
                Para consultorios y clínicas dentales de Latinoamérica.
              </p>
              <div className="lv-ctas">
                <Link
                  to="/auth"
                  search={{ signup: true }}
                  onClick={() => registrarEvento("cta_click", { cta: "signup", lugar: "v2-hero" })}
                  className="lv-btn lv-btn-ocre"
                >
                  Probar 14 días gratis{" "}
                  <span className="lv-arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
                <a
                  href="/demo"
                  onClick={() => registrarEvento("cta_click", { cta: "demo", lugar: "v2-hero" })}
                  className="lv-btn lv-btn-line"
                >
                  Entrar a la demo
                </a>
              </div>
              <p className="lv-fine">
                Sin tarjeta. Para la demo solo te pedimos nombre y email. Funciona en el navegador,
                también sin internet.
              </p>
            </div>
            <div className="lv-cue" aria-hidden="true">
              <i />
              Desliza para abrir el día
            </div>
          </div>

          <div className="lv-hero-win" ref={ventana}>
            <div className="lv-win-bg" />
            <div
              className="lv-dia lv-on-night"
              id="lv-dia"
              ref={dia}
              role="region"
              aria-label="Agenda del día por sillón, datos de ejemplo"
            >
              <button ref={cerrarBtn} className="lv-close-day" type="button" onClick={cerrarDia}>
                Cerrar el día
              </button>
              <div className="lv-dia-top">
                <div>
                  <h2>
                    {DIA_EJEMPLO.corto} · <em>tres sillones, un vistazo</em>
                  </h2>
                  <p className="lv-sub">Clínica demo · Providencia · pacientes ficticios</p>
                </div>
                <dl className="lv-kpis">
                  <div>
                    <dt>citas</dt>
                    <dd>{RESUMEN.citas}</dd>
                  </div>
                  <div>
                    <dt>confirmadas</dt>
                    <dd>{RESUMEN.confirmadas}</dd>
                  </div>
                  <div className="acc">
                    <dt>huecos por llenar</dt>
                    <dd>{RESUMEN.huecos}</dd>
                  </div>
                  <div>
                    <dt>no asistió</dt>
                    <dd>{RESUMEN.ausentes}</dd>
                  </div>
                </dl>
              </div>
              <div className="lv-tl-wrap">
                <div className="lv-tl">
                  <div />
                  <div
                    className="lv-tl-hours"
                    style={{ gridTemplateColumns: `repeat(${HORAS.length}, 1fr)` }}
                    aria-hidden="true"
                  >
                    {HORAS.map((h) => (
                      <span key={h}>{String(h).padStart(2, "0")}</span>
                    ))}
                  </div>
                  {SILLONES_HOY.map((s, fila) => (
                    <FilaSillon
                      key={s.sillon}
                      sillon={s.sillon}
                      profesional={s.profesional}
                      citas={s.citas}
                      desde={fila * 10}
                      ofrecidos={ofrecidos}
                      onOfrecer={(clave) => setOfrecidos((prev) => new Set(prev).add(clave))}
                    />
                  ))}
                  <div
                    className="lv-now"
                    style={{
                      left: `calc(150px + (100% - 150px) * ${(minutos(DIA_EJEMPLO.ahora) - H0) / SPAN})`,
                    }}
                    aria-hidden="true"
                  >
                    <span>{DIA_EJEMPLO.ahora}</span>
                  </div>
                </div>
              </div>
              <div className="lv-dia-bot">
                <span>
                  <b>9 recordatorios</b> de mañana listos. Los envía recepción, con un toque, por
                  WhatsApp.
                </span>
                <span className="lv-patty-mini">
                  <PattyMark size={16} className="text-current" />
                  Patty, en habilitación
                </span>
                <span className="lv-demo">Datos de ejemplo</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FilaSillon({
  sillon,
  profesional,
  citas,
  desde,
  ofrecidos,
  onOfrecer,
}: {
  sillon: string;
  profesional: string;
  citas: readonly CitaEjemplo[];
  desde: number;
  ofrecidos: ReadonlySet<string>;
  onOfrecer: (clave: string) => void;
}) {
  const [c0, c1] = DIA_EJEMPLO.colacion;
  return (
    <>
      <div className="lv-tl-who">
        {sillon}
        <small>{profesional}</small>
      </div>
      <div
        className="lv-tl-row"
        style={{
          background: `repeating-linear-gradient(90deg, var(--night-line) 0 1px, transparent 1px calc(100% / ${HORAS.length}))`,
        }}
      >
        <div
          className="lv-lunch"
          style={{ left: pct(minutos(c0) - H0), width: pct(minutos(c1) - minutos(c0)) }}
        />
        {citas.map((c, i) => {
          const clave = `${sillon}-${c[0]}`;
          const ofrecido = c[4] === "gap" && ofrecidos.has(clave);
          return (
            <div
              key={clave}
              className={`lv-ap ${c[4]}${ofrecido ? " filled" : ""}`}
              style={
                {
                  left: pct(minutos(c[0]) - H0),
                  width: `calc(${pct(minutos(c[1]) - minutos(c[0]))} - 3px)`,
                  "--i": desde + i,
                } as CSSProperties
              }
            >
              {ofrecido ? (
                <>
                  <span>Ofrecido a 3</span>
                  <small>lista de espera · ejemplo</small>
                </>
              ) : (
                <>
                  <span>{c[2]}</span>
                  <small>
                    <span className="lv-mono">{c[0]}</span> · {c[3]}
                  </small>
                  {c[4] === "gap" && (
                    <button
                      type="button"
                      aria-label={`Ofrecer el hueco de las ${c[0]} a la lista de espera`}
                      onClick={() => onOfrecer(clave)}
                    >
                      Ofrecer
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
