// "Patty propone. Tú decides." Patty está en habilitación (#70, AI_ENABLED
// apagado): esta sección es una muestra estática y no llama a ningún
// servidor. "No verá nombres ni RUT" describe cómo va a trabajar cuando
// vuelva (anonimización antes del proveedor, docs/IA.md).
//
// El checklist corre solo con movimiento permitido; el HTML del servidor
// llega con todos los pasos hechos y el borrador visible.
import { useEffect, useState } from "react";

import { useMovimiento } from "@/hooks/use-movimiento";

import { PattyCara } from "./patty-cara";

const PASOS = [
  "Quitando nombre y RUT antes de leer",
  "Leyendo tus apuntes de la pieza 36",
  "Ordenándolos en S, O, A y P",
  "Revisando alergias registradas",
  "Borrador listo para tu revisión",
] as const;

export function PattySeccion() {
  const { animar } = useMovimiento();
  const [paso, setPaso] = useState<number>(PASOS.length);

  useEffect(() => {
    if (!animar) {
      setPaso(PASOS.length);
      return;
    }
    let i = 0;
    setPaso(0);
    const t = window.setInterval(() => {
      i = i > PASOS.length + 3 ? 0 : i + 1;
      setPaso(Math.min(i, PASOS.length));
    }, 1100);
    return () => window.clearInterval(t);
  }, [animar]);

  return (
    <section className="lv-pt-sec" id="patty" aria-labelledby="lv-pt-h">
      <div className="lv-wrap lv-pt-grid">
        <div className="lv-pt-copy">
          <PattyCara className="lv-pt-av" px={88} />
          <h2 className="lv-h-sec" id="lv-pt-h">
            Patty propone. <em>Tú decides.</em>
          </h2>
          <p className="lv-lead">
            La IA de Esmalia está en habilitación mientras pasa a un proveedor con contrato para
            datos de salud. Así va a trabajar cuando vuelva:
          </p>
          <ul className="lv-pt-rules">
            <li>
              <b>No verá nombres ni RUT.</b> Recibe la nota clínica sin datos que identifiquen al
              paciente.
            </li>
            <li>
              <b>Muestra lo que hace</b>, paso a paso, mientras lo hace.
            </li>
            <li>
              <b>Nada se guarda sin tu aprobación.</b> No firma notas, no le escribe sola a ningún
              paciente y no mueve la agenda.
            </li>
          </ul>
        </div>
        <div className="lv-pt-card">
          <div className="lv-pt-card-h">
            <span>
              <PattyCara px={26} />
              <span>
                <b>Patty</b> · nota de hoy, paciente 7F2A
              </span>
            </span>
            <span className="lv-st lv-st-patty">En habilitación</span>
          </div>
          <ol className="lv-pt-list" aria-label="Pasos de Patty, ejemplo">
            {PASOS.map((p, j) => (
              <li key={p} className={j < paso ? "done" : j === paso ? "run" : undefined}>
                <i aria-hidden="true" />
                {p}
              </li>
            ))}
          </ol>
          <div className={paso < PASOS.length ? "lv-pt-draft wait" : "lv-pt-draft"}>
            <p className="lbl">Borrador propuesto</p>
            <dl>
              <dt>S</dt>
              <dd>Dolor al frío en 36, más de 30 segundos, hace una semana.</dd>
              <dt>A</dt>
              <dd>Pulpitis irreversible sintomática en 36.</dd>
              <dt>P</dt>
              <dd>Endodoncia en dos sesiones. Analgesia sin penicilina (alergia registrada).</dd>
            </dl>
            <div className="lv-pt-acts">
              <button type="button" className="lv-btn lv-btn-sm" disabled>
                Aprobar y pasar a la nota
              </button>
              <button type="button" className="lv-btn lv-btn-sm lv-btn-line" disabled>
                Descartar
              </button>
            </div>
            <p className="lv-pt-foot">
              Ejemplo. Los botones se activan cuando Patty salga de habilitación.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
