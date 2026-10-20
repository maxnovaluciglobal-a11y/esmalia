// "Una pieza, cuatro lecturas": la 36 de M. Soto vista como cita, condición,
// cobro y lo que Patty propondría. Datos de ejemplo; los montos en CLP
// cuadran entre sí (fase 1 de $380.000, pagado $190.000, saldo $190.000).
//
// Mezcla de /v2 y del draft C (20-oct-2026): el molar y los datos son los de
// /v2; las lecturas son filas a todo el ancho con título grande y barrido
// ocre (las `.frow` de C). Desktop: molar a la izquierda (sticky) y filas a
// la derecha; en móvil, el molar arriba.
//
// Accesible: cada fila es un botón con aria-expanded que controla su panel;
// una abierta a la vez (se abre al pasar el mouse, al hacer focus o al hacer
// clic). El HTML del servidor llega con las cuatro abiertas, así la sección
// se lee completa sin JS; al hidratar queda abierta la primera.
// Debajo, las funciones de cada módulo como filas estilo C, sin perder texto.
import { useEffect, useState } from "react";

type Modulo = "agenda" | "ficha" | "caja" | "patty";

/** Funciones de cada módulo (filas de abajo). */
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

/** Las cuatro lecturas de la 36 (filas de arriba). `mod` elige lo que se resalta en el molar. */
const PIEZA: readonly { mod: Modulo; titulo: string; resumen: string }[] = [
  { mod: "agenda", titulo: "La cita", resumen: "mié 21 · 10:30 · Dra. Paz Rojas" },
  { mod: "ficha", titulo: "La condición", resumen: "Caries oclusal · corona por realizar" },
  { mod: "caja", titulo: "El cobro", resumen: "Saldo $190.000" },
  { mod: "patty", titulo: "Patty", resumen: "Lo que propondría · en habilitación" },
];

const PATTY = LECTURAS.find((l) => l.id === "patty");

function Detalle({ mod }: { mod: Modulo }) {
  if (mod === "agenda")
    return (
      <>
        <p className="lv-rw-t">Pieza 36 · Endodoncia</p>
        <p className="lv-mono">mié 21 · 10:30 · Dra. Paz Rojas</p>
        <span className="lv-st lv-st-ok">
          <Check />
          Confirmada
        </span>
      </>
    );
  if (mod === "ficha")
    return (
      <>
        <p className="lv-rw-t">Caries oclusal</p>
        <p>Por tratar · registrada el 2 de octubre</p>
        <span className="lv-st lv-st-pl">Corona · por realizar</span>{" "}
        <span className="lv-st lv-st-ex">Obturación MO · existente</span>
      </>
    );
  if (mod === "caja")
    return (
      <>
        <p className="lv-rw-t">Plan, fase 1 · $380.000</p>
        <p className="lv-mono">Pagado $190.000 · saldo $190.000</p>
        <div className="lv-pbar" role="img" aria-label="Pagado la mitad del plan">
          <i />
        </div>
      </>
    );
  return (
    <>
      <p className="lv-rw-t">
        <b>Patty</b> propondría
      </p>
      <p>“En la nota dice ‘dolor al frío en 36’. ¿La ordeno?” Hoy no está activa.</p>
      <span className="lv-st lv-st-patty">En habilitación</span>
      {PATTY && <p>{PATTY.texto}</p>}
      {PATTY?.no && (
        <p className="no">
          <b>{PATTY.no[0]}</b> {PATTY.no[1]}
        </p>
      )}
    </>
  );
}

export function AcordeonMolar() {
  // null = todas abiertas (servidor e hidratación); después, una sola.
  const [abierta, setAbierta] = useState<number | null>(null);
  useEffect(() => setAbierta(0), []);

  const mod = PIEZA[abierta ?? 0].mod;

  return (
    <section className="lv-tooth-sec" aria-labelledby="lv-ts-h">
      <div className="lv-wrap">
        <div className="lv-ts-head">
          <h2 className="lv-h-sec" id="lv-ts-h">
            Una pieza, <em>cuatro lecturas.</em>
          </h2>
          <p className="lv-lead">
            La 36 de M. Soto, vista desde cada módulo. Todo apunta al mismo diente: la cita, la
            condición, lo que se cobró y lo que Patty propondría. Datos de ejemplo.
          </p>
        </div>
        <div className="lv-ts-grid">
          <figure className="lv-fig" data-mod={mod}>
            <div className="tilt">
              <svg
                viewBox="0 0 400 500"
                role="img"
                aria-label="Molar 36 de una paciente de ejemplo, con lo que muestra la lectura elegida"
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
                <circle
                  className="ring"
                  cx="200"
                  cy="250"
                  r="190"
                  transform="rotate(-90 200 250)"
                />
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
                    className="obt"
                    d="M118 120 q14 -10 30 -2 q4 14 -10 18 q-16 2 -20 -16z"
                    fill="var(--lv-clin-ex)"
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
            <div className="lv-tag t-agenda" aria-hidden="true" style={{ left: "-2%", top: "6%" }}>
              mié 21 · 10:30
            </div>
            <div className="lv-tag t-ficha" aria-hidden="true" style={{ right: "-4%", top: "4%" }}>
              <span className="lv-st lv-st-pl">Corona · por realizar</span>
              <span className="lv-st lv-st-ex">Obturación · existente</span>
            </div>
            <div
              className="lv-tag t-caja"
              aria-hidden="true"
              style={{ left: "-4%", bottom: "18%" }}
            >
              <span className="lv-mono">Saldo $190.000</span>
            </div>
            <div
              className="lv-tag t-patty"
              aria-hidden="true"
              style={{ right: "-6%", bottom: "14%" }}
            >
              <span className="lv-st lv-st-patty">Patty · en habilitación</span>
            </div>
          </figure>
          <div className="lv-rows">
            {PIEZA.map((l, k) => {
              const abiertaEsta = abierta === null || abierta === k;
              return (
                <div
                  key={l.mod}
                  className={abiertaEsta ? "lv-row open" : "lv-row"}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") setAbierta(k);
                  }}
                >
                  <h3>
                    <button
                      className="lv-row-b"
                      type="button"
                      id={`lv-row-b-${l.mod}`}
                      aria-expanded={abiertaEsta}
                      aria-controls={`lv-row-p-${l.mod}`}
                      onFocus={() => setAbierta(k)}
                      onClick={() => setAbierta(k)}
                    >
                      <span className="nm">{l.titulo}</span>
                      <span className="sm">{l.resumen}</span>
                    </button>
                  </h3>
                  <div
                    className="lv-row-p"
                    id={`lv-row-p-${l.mod}`}
                    role="region"
                    aria-labelledby={`lv-row-b-${l.mod}`}
                    inert={!abiertaEsta}
                  >
                    <div>
                      <Detalle mod={l.mod} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <ul className="lv-frows" aria-label="Lo que hace cada módulo">
          {LECTURAS.filter((l) => l.id !== "patty").map((l) => (
            <li key={l.id} className="lv-frow">
              <h3>{l.nombre}</h3>
              <div className="fd">
                <p>{l.texto}</p>
                {l.no && (
                  <p className="no">
                    <b>{l.no[0]}</b> {l.no[1]}
                  </p>
                )}
              </div>
              {l.chips && (
                <ul className="ch">
                  {l.chips.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
