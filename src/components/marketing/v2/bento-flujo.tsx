// Bento en tinta: el flujo cita → aviso → WhatsApp → respuesta → Patty →
// recepción aprueba, más cuatro piezas del producto. Datos de ejemplo.
//
// Veracidad: ningún mensaje sale solo (lo envía alguien con un toque), el
// WhatsApp oficial y Patty están en habilitación, y el odontograma usa la
// convención clínica azul = existente / rojo = por realizar (nunca cobalto;
// el cobalto acá es solo el dato de ocupación).
import { useEffect, useRef, useState } from "react";

import { PattyMark } from "@/components/patty";
import { useMovimiento } from "@/hooks/use-movimiento";

import { PausarMovimiento } from "./pausar-movimiento";
import { SonrisaCondiciones } from "./sonrisa-condiciones";

const PASOS_FLUJO = 6;

const ESTADOS_SIN_CONEXION = [
  ["off", "Sin conexión · agenda abierta"],
  ["queue", "3 cambios en cola"],
  ["sync", "Sincronizado en orden"],
] as const;

const OCUPACION = [
  { dia: "lun", v: 86 },
  { dia: "mar", v: 92 },
  { dia: "mié", v: 71, bajo: true },
  { dia: "jue", v: 88 },
  { dia: "vie", v: 95 },
  { dia: "sáb", v: 60, bajo: true },
] as const;

const PIEZAS = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] as const;
const EXISTENTES = new Set<number>([46, 37]);
const POR_REALIZAR = new Set<number>([36, 45]);

function formaPieza(n: number) {
  const u = n % 10;
  if (u >= 6)
    return "M4 8 Q4 2 10 3 Q15 5 20 3 Q26 2 26 8 L25 22 Q24 34 20 40 Q18 30 15 28 Q12 30 10 40 Q6 34 5 22Z";
  if (u >= 4) return "M7 7 Q7 2 15 2 Q23 2 23 7 L22 22 Q20 36 15 42 Q10 36 8 22Z";
  return "M9 5 Q9 2 15 2 Q21 2 21 5 L20 22 Q18 38 15 44 Q12 38 10 22Z";
}

const MAS = [
  "Periodontograma",
  "Notas clínicas con versiones, firma y adenda",
  "8 plantillas de consentimiento",
  "Recetas en PDF",
  "Presupuesto por fases que pasa a plan",
  "Portal del paciente",
  "Exportación completa",
  "Verificación en dos pasos",
] as const;

function Icono({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function BentoFlujo() {
  const { animar } = useMovimiento();
  // El estado inicial (SSR) es el final del recorrido: "Confirmada".
  const [paso, setPaso] = useState(PASOS_FLUJO - 1);
  const [red, setRed] = useState(2);
  const lineas = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = lineas.current;
    if (!animar) {
      svg?.pauseAnimations?.();
      return;
    }
    svg?.unpauseAnimations?.();
    const a = window.setInterval(() => setPaso((p) => (p + 1) % PASOS_FLUJO), 1400);
    const b = window.setInterval(() => setRed((r) => (r + 1) % ESTADOS_SIN_CONEXION.length), 2200);
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, [animar]);

  const on = (k: number) => (paso === k ? " on" : "");
  const confirmada = paso === PASOS_FLUJO - 1;
  const [estadoRed, textoRed] = ESTADOS_SIN_CONEXION[red];

  return (
    <section className="lv-bento-sec lv-on-night" id="producto" aria-labelledby="lv-bento-h">
      <SonrisaCondiciones />
      <div className="lv-wrap">
        <div className="lv-sec-head">
          <h2 className="lv-h-sec" id="lv-bento-h">
            Lo que pasa <em>mientras atiendes.</em>
          </h2>
          <p className="lv-lead">
            La recepción no persigue a nadie. Esmalia arma los recordatorios, alguien los envía con
            un toque y la respuesta vuelve a la agenda. Patty, cuando salga de habilitación, solo
            propone.
          </p>
        </div>
        <div className="lv-bento">
          <article className="lv-cell lv-c-flow">
            <div className="lv-flow-head">
              <h3>
                De la cita al <em>“confirmo”</em>, sin llamar a nadie
              </h3>
              <PausarMovimiento />
            </div>
            <div className="lv-flow">
              <svg
                className="lines"
                viewBox="0 0 1000 430"
                preserveAspectRatio="none"
                aria-hidden="true"
                ref={lineas}
              >
                <path
                  id="lv-flow-path"
                  className="ln-base"
                  d="M150 95 L500 95 L850 95 C960 95 960 335 850 335 L500 335 L150 335"
                />
                <path
                  className="ln-run"
                  d="M150 95 L500 95 L850 95 C960 95 960 335 850 335 L500 335 L150 335"
                />
                {animar && (
                  <circle r="7" fill="var(--brand-on-night)">
                    <animateMotion dur="8.4s" repeatCount="indefinite" rotate="auto">
                      <mpath href="#lv-flow-path" />
                    </animateMotion>
                  </circle>
                )}
              </svg>
              <ol className="lv-flow-ol" aria-label="Recorrido de un recordatorio, ejemplo">
                <li className={`lv-node${on(0)}`} style={{ left: "15%", top: "22%" }}>
                  <div className="k">
                    <Icono d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" />
                    Cita creada
                  </div>
                  <div className="d lv-mono">mié 21 · 10:30 · M. Soto</div>
                </li>
                <li className={`lv-node${on(1)}`} style={{ left: "50%", top: "22%" }}>
                  <div className="k">
                    <Icono d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    Aviso de 48 h listo
                  </div>
                  <div className="d">Esmalia arma el mensaje</div>
                </li>
                <li className={`lv-node${on(2)}`} style={{ left: "85%", top: "22%" }}>
                  <div className="k">
                    <Icono d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.3A8 8 0 1 1 20 12z" />
                    Enviado con un toque
                  </div>
                  <div className="d">desde el WhatsApp de recepción</div>
                </li>
                <li className={`lv-node${on(3)}`} style={{ left: "85%", top: "78%" }}>
                  <div className="k">
                    <Icono d="M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21a8 8 0 0 1 16 0" />
                    M. Soto responde
                  </div>
                  <div className="bub">Confirmo, ahí estaré</div>
                </li>
                <li className={`lv-node patty${on(4)}`} style={{ left: "50%", top: "78%" }}>
                  <div className="k">
                    <PattyMark size={16} className="text-current" />
                    Patty lo lee y propone
                  </div>
                  <div className="d">
                    <span className="lv-st lv-st-n-patty">En habilitación</span>
                  </div>
                </li>
                <li className={`lv-node${on(5)}`} style={{ left: "15%", top: "78%" }}>
                  <div className="k">
                    <Icono d="M5 12l5 5L20 7" />
                    Recepción aprueba
                  </div>
                  <div className="flip">
                    {confirmada ? (
                      <span className="lv-st lv-st-n-ok">
                        <Icono d="M5 12l5 5L20 7" />
                        Confirmada
                      </span>
                    ) : (
                      <span className="lv-st lv-st-n-warn">
                        <Icono d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                        Por confirmar
                      </span>
                    )}
                  </div>
                </li>
              </ol>
            </div>
            <div className="lv-flow-foot">
              <span>Ningún mensaje sale solo. Patty propone; una persona decide.</span>
              <span>WhatsApp oficial de la clínica: en habilitación con Meta</span>
            </div>
          </article>

          <article className="lv-cell lv-c-off">
            <h3>
              Se corta el wifi. <em>La agenda no.</em>
            </h3>
            <p>
              Hasta 7 días guardados en el equipo. Al volver la conexión, los cambios se sincronizan
              en orden.
            </p>
            <div className="lv-off-pill" data-s={estadoRed}>
              <Icono d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01" />
              <span>{textoRed}</span>
            </div>
          </article>

          <article className="lv-cell lv-c-occ">
            <h3>
              Dónde se te <em>van las sillas</em>
            </h3>
            <ul
              className="lv-bars"
              aria-label="Ocupación por día, semana de ejemplo, en porcentaje"
            >
              {OCUPACION.map((o) => (
                <li key={o.dia}>
                  <b>{o.v}</b>
                  <i className={"bajo" in o ? "lo" : undefined} style={{ height: `${o.v}%` }} />
                  <span>{o.dia}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="lv-cell lv-c-odo">
            <h3>
              Odontograma FDI <em>con memoria</em>
            </h3>
            <p>
              Varias condiciones por pieza, cada una existente o por realizar, y la historia de cada
              cambio.
            </p>
            <div className="lv-mini-odo" aria-hidden="true">
              {PIEZAS.map((n) => (
                <svg
                  key={n}
                  viewBox="0 0 30 58"
                  className={EXISTENTES.has(n) ? "ex" : POR_REALIZAR.has(n) ? "pl" : undefined}
                >
                  <path className="tooth" d={formaPieza(n)} strokeWidth="1" />
                  <text x="15" y="56" textAnchor="middle">
                    {n}
                  </text>
                </svg>
              ))}
            </div>
            <div className="lv-legend">
              <span>
                <i style={{ background: "var(--lv-clin-ex-n)" }} />
                Azul · existente
              </span>
              <span>
                <i
                  style={{
                    background: "color-mix(in srgb, var(--lv-clin-pl-n) 20%, transparent)",
                    outline: "1.5px solid var(--lv-clin-pl-n)",
                    outlineOffset: "-1.5px",
                  }}
                />
                Rojo · por realizar
              </span>
            </div>
          </article>

          <article className="lv-cell lv-c-caja">
            <h3>
              La caja dice <em>si cuadra</em>
            </h3>
            <p>
              Arqueo al cierre, por medio de pago, y comisiones por profesional sin planilla aparte.
            </p>
            <div className="lv-caja-mini">
              <p>
                <span>Esperado en efectivo</span>
                <b>$236.000</b>
              </p>
              <p>
                <span>Contado</span>
                <b>$236.000</b>
              </p>
              <div className="lv-seal" role="img" aria-label="Cuadra exacto">
                Cuadra
                <br />
                exacto
              </div>
            </div>
          </article>

          <ul className="lv-cell lv-c-more" aria-label="Y además">
            <li className="lbl" aria-hidden="true">
              Y además
            </li>
            {MAS.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
