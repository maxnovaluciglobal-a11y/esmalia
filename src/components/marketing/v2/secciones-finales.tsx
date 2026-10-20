// Bloques finales de la landing A+: "Todavía no hacemos", espacios para
// testimonios de clínicas fundadoras (ninguno inventado) y FAQ corta.
import { Link } from "@tanstack/react-router";

import { FAQ_CORTA } from "./faq-corta-datos";

// Mismo contenido que "Qué no hace (todavía)" de src/content/llms-base.md.
const NO_HACEMOS = [
  {
    t: "Factura electrónica",
    d: "Registras cobros, saldos y caja. La boleta o factura la sigues emitiendo en tu sistema tributario.",
  },
  {
    t: "App nativa",
    d: "Funciona en el navegador del computador y del celular, también sin internet, y se puede instalar desde ahí. No hay app en las tiendas.",
  },
  {
    t: "Telemedicina",
    d: "No hay videollamadas ni consultas a distancia. Esmalia es para la clínica presencial.",
  },
] as const;

export function TodaviaNo() {
  return (
    <section className="lv-ny" aria-labelledby="lv-ny-h">
      <div className="lv-wrap lv-ny-grid">
        <div>
          <h2 className="lv-h-sec" id="lv-ny-h">
            Todavía <em>no hacemos.</em>
          </h2>
          <p className="lv-lead">Preferimos decirlo antes de la prueba que en la renovación.</p>
        </div>
        <ul className="lv-ny-list">
          {NO_HACEMOS.map((n) => (
            <li key={n.t}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M6 18L18 6" />
              </svg>
              <div>
                <b>{n.t}</b>
                <span>{n.d}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function TestimoniosReservados() {
  return (
    <section className="lv-tst" aria-labelledby="lv-tst-h">
      <div className="lv-wrap">
        <h2 className="lv-h-sec lv-h-sm" id="lv-tst-h">
          Las primeras clínicas <em>lo van a contar.</em>
        </h2>
        <ul className="lv-tst-grid">
          {[1, 2, 3].map((i) => (
            <li key={i} className="lv-ph">
              <p>Espacio para testimonio de clínica fundadora.</p>
              <span>Nombre · clínica · ciudad</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function FaqCorta() {
  return (
    <section className="lv-faq" id="preguntas" aria-labelledby="lv-faq-h">
      <div className="lv-wrap lv-faq-grid">
        <h2 className="lv-h-sec lv-h-sm" id="lv-faq-h">
          Preguntas <em>cortas.</em>
        </h2>
        <div>
          {FAQ_CORTA.map((f, i) => (
            <details key={f.q} name="lv-faq" open={i === 0}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
          <p className="lv-faq-mas">
            <Link to="/faq" className="underline underline-offset-4">
              Todas las preguntas frecuentes →
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
