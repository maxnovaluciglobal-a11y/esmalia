// "Una pieza, cuatro lecturas": la 36 de M. Soto vista desde la agenda, la
// ficha, la caja y Patty. Datos de ejemplo; los montos en CLP cuadran entre
// sí (fase 1 de $380.000, pagado $190.000, saldo $190.000).
//
// Accesible: cada lectura es un botón con aria-expanded que controla su
// panel. Avanza solo cada 6 s únicamente con movimiento permitido, si está
// en pantalla y mientras nadie lo tocó; al tocarlo, se queda donde lo dejan.
import { useEffect, useRef, useState } from "react";

import { useMovimiento } from "@/hooks/use-movimiento";

type Modulo = "agenda" | "ficha" | "caja" | "patty";

const LECTURAS: readonly {
  id: Modulo;
  nombre: string;
  texto: string;
  chips?: readonly string[];
  no?: [string, string];
}[] = [
  {
    id: "agenda",
    nombre: "Agenda",
    texto:
      "Por profesional y por sucursal, con la hora de cada sede. Cada estado se lee por forma, ícono y texto, no solo por color.",
    chips: ["Lista de espera", "Estados de cita", "Sin internet"],
  },
  {
    id: "ficha",
    nombre: "Ficha clínica",
    texto:
      "Odontograma FDI con varias condiciones por pieza, periodontograma y notas clínicas que no se sobrescriben: se firman y se corrigen con adenda.",
    chips: ["Alertas clínicas", "Consentimientos", "Recetas"],
  },
  {
    id: "caja",
    nombre: "Caja",
    texto:
      "El presupuesto por fases se vuelve plan, cada pago descuenta el saldo y al cierre del día el arqueo te dice si cuadra.",
    chips: ["Arqueo", "Comisiones", "Medios de pago"],
    no: ["No hace", "factura electrónica."],
  },
  {
    id: "patty",
    nombre: "Patty",
    texto:
      "La IA de Esmalia está en habilitación mientras pasa a un proveedor con contrato para datos de salud. Cuando vuelva, pasará tus apuntes a una nota ordenada y resumirá la nota para la próxima consulta.",
    no: [
      "Propone, no decide:",
      "no firma notas, no le escribe sola a ningún paciente y no mueve la agenda.",
    ],
  },
];

const CONTORNO =
  "M80 170 C70 110 95 60 140 58 C165 57 180 75 200 75 C220 75 235 57 260 58 C305 60 330 110 320 170 C315 215 300 240 295 270 C290 320 285 390 262 440 C255 455 238 452 236 436 C230 390 225 330 200 320 C175 330 170 390 164 436 C162 452 145 455 138 440 C115 390 110 320 105 270 C100 240 85 215 80 170 Z";

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function AcordeonMolar() {
  const { animar } = useMovimiento();
  const [actual, setActual] = useState(0);
  const [tocado, setTocado] = useState(false);
  const [enVista, setEnVista] = useState(false);
  const figura = useRef<HTMLElement>(null);
  const corre = animar && enVista && !tocado;

  useEffect(() => {
    const el = figura.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setEnVista(e.isIntersecting), {
      threshold: 0.35,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!corre) return;
    const t = window.setTimeout(() => setActual((k) => (k + 1) % LECTURAS.length), 6000);
    return () => window.clearTimeout(t);
  }, [corre, actual]);

  const mod = LECTURAS[actual].id;

  return (
    <section className="lv-tooth-sec" aria-labelledby="lv-ts-h">
      <div className="lv-wrap lv-ts-grid">
        <div className="lv-ts-title">
          <h2 className="lv-h-sec" id="lv-ts-h">
            Una pieza, <em>cuatro lecturas.</em>
          </h2>
          <p className="lv-lead">
            La 36 de M. Soto, vista desde cada módulo. Todo apunta al mismo diente: la cita, la
            condición, lo que se cobró y lo que Patty propondría. Datos de ejemplo.
          </p>
        </div>
        <figure className="lv-fig" data-mod={mod} ref={figura}>
          <div className="tilt">
            <svg
              viewBox="0 0 400 500"
              role="img"
              aria-label="Molar 36 dibujado, con la lectura del módulo elegido"
            >
              <defs>
                <linearGradient id="lv-enamel" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" stopColor="#E8DCC7" />
                  <stop offset=".35" stopColor="#FFFBF3" />
                  <stop offset=".7" stopColor="#F1E6D2" />
                  <stop offset="1" stopColor="#C9B28C" />
                </linearGradient>
                <linearGradient id="lv-root" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#E4D3B4" />
                  <stop offset="1" stopColor="#C3A77A" />
                </linearGradient>
                <radialGradient id="lv-aur">
                  <stop offset="0" stopColor="#8F6BC8" stopOpacity=".55" />
                  <stop offset="1" stopColor="#8F6BC8" stopOpacity="0" />
                </radialGradient>
                <clipPath id="lv-tooth-clip">
                  <path d={CONTORNO} />
                </clipPath>
              </defs>
              <ellipse
                className="ov ov-patty"
                cx="200"
                cy="250"
                rx="210"
                ry="250"
                fill="url(#lv-aur)"
              />
              <circle className="ring" cx="200" cy="250" r="190" transform="rotate(-90 200 250)" />
              <ellipse cx="200" cy="478" rx="110" ry="10" fill="var(--night)" opacity=".12" />
              <g clipPath="url(#lv-tooth-clip)">
                <rect x="0" y="0" width="400" height="500" fill="url(#lv-root)" />
                <path d="M60 40 H340 V262 Q200 300 60 262 Z" fill="url(#lv-enamel)" />
                <rect
                  className="fillpay"
                  x="0"
                  y="0"
                  width="400"
                  height="500"
                  fill="var(--brand)"
                  opacity=".55"
                />
              </g>
              <path
                d={CONTORNO}
                fill="none"
                stroke="var(--brand-700)"
                strokeOpacity=".55"
                strokeWidth="2"
              />
              <path
                d="M98 262 Q200 300 302 262"
                fill="none"
                stroke="var(--brand-700)"
                strokeOpacity=".35"
                strokeWidth="1.5"
              />
              <path
                d="M150 100 Q175 120 200 104 Q225 120 250 100"
                fill="none"
                stroke="var(--brand-700)"
                strokeOpacity=".35"
                strokeWidth="1.5"
              />
              <g className="ov ov-ficha">
                <path
                  d="M168 112 q8 -9 18 -2 q6 10 -4 14 q-12 3 -14 -12z"
                  fill="var(--lv-clin-pl)"
                />
                <path
                  d="M222 118 q7 -6 13 0 q3 8 -5 10 q-9 1 -8 -10z"
                  fill="var(--lv-clin-pl)"
                  opacity=".85"
                />
                <path
                  d="M72 168 C62 104 92 46 140 44 C165 43 180 62 200 62 C220 62 235 43 260 44 C308 46 338 104 328 168"
                  fill="none"
                  stroke="var(--lv-clin-pl)"
                  strokeWidth="2.5"
                  strokeDasharray="7 6"
                />
              </g>
            </svg>
          </div>
          <div className="lv-tag t-agenda" style={{ left: "-4%", top: "6%" }}>
            Pieza 36 · Endodoncia
            <small className="lv-mono">mié 21 · 10:30 · Dra. Paz Rojas</small>
            <span className="lv-st lv-st-ok">
              <Check />
              Confirmada
            </span>
          </div>
          <div className="lv-tag t-ficha" style={{ right: "-6%", top: "4%" }}>
            Caries oclusal
            <small>Por tratar · registrada el 2 de octubre</small>
            <span className="lv-st lv-st-pl">Corona · por realizar</span>
          </div>
          <div className="lv-tag t-caja" style={{ left: "-6%", bottom: "18%" }}>
            Plan, fase 1 · $380.000
            <small className="lv-mono">Pagado $190.000 · saldo $190.000</small>
            <div className="lv-pbar">
              <i />
            </div>
          </div>
          <div className="lv-tag t-patty" style={{ right: "-8%", bottom: "14%" }}>
            <b>Patty</b> propondría
            <small>“En la nota dice ‘dolor al frío en 36’. ¿La ordeno?” Hoy no está activa.</small>
            <span className="lv-st lv-st-patty">En habilitación</span>
          </div>
        </figure>
        <div className="lv-acc">
          {LECTURAS.map((l, k) => {
            const abierto = k === actual;
            return (
              <div key={l.id} className={abierto ? "lv-acc-i open" : "lv-acc-i"}>
                <h3>
                  <button
                    className="lv-acc-b"
                    type="button"
                    id={`lv-acc-b-${l.id}`}
                    aria-expanded={abierto}
                    aria-controls={`lv-acc-p-${l.id}`}
                    onClick={() => {
                      setTocado(true);
                      setActual(k);
                    }}
                  >
                    <span className={l.id === "patty" ? "nm patty" : "nm"}>{l.nombre}</span>
                    <span className="pl" aria-hidden="true">
                      <svg viewBox="0 0 14 14">
                        <path d="M7 1v12M1 7h12" />
                      </svg>
                    </span>
                  </button>
                </h3>
                <div className="lv-timer" aria-hidden="true">
                  <i key={`${actual}-${corre}`} className={abierto && corre ? "run" : undefined} />
                </div>
                <div
                  className="lv-acc-p"
                  id={`lv-acc-p-${l.id}`}
                  role="region"
                  aria-labelledby={`lv-acc-b-${l.id}`}
                  inert={!abierto}
                >
                  <div>
                    <p>{l.texto}</p>
                    {l.chips && (
                      <ul>
                        {l.chips.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    )}
                    {l.no && (
                      <p className="no">
                        <b>{l.no[0]}</b> {l.no[1]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
