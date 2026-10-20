// Cifras del producto en carrusel. Cada número sale de algo que Esmalia hace
// hoy, respaldado por el código y por las páginas de funciones:
// - 29 condiciones: catálogo del odontograma (content/paginas/funciones-odontograma.ts).
// - 2 avisos a las 48 y 3 h, enviados por una persona (llms-base.md).
// - 7 días guardados sin internet (content/paginas/funciones-sin-internet.ts).
// - 8 plantillas de consentimiento (llms-base.md).
// - 14 días de prueba sin tarjeta y exportación en ZIP (#67).
import { useCallback, useEffect, useRef } from "react";

import { useMovimiento } from "@/hooks/use-movimiento";

const CIFRAS = [
  {
    n: "29",
    texto: "condiciones que puedes marcar en cada pieza del odontograma FDI.",
    fuente: "Ficha clínica",
    tono: "lv-s-ocre",
  },
  {
    n: "2",
    texto: "avisos por cita: a las 48 y a las 3 horas. Cada uno lo envía una persona.",
    fuente: "Recordatorios",
    tono: "lv-s-cob",
  },
  {
    n: "7",
    unidad: "días",
    texto: "de agenda y pacientes guardados en el equipo si se corta internet.",
    fuente: "Sin conexión",
    tono: "lv-s-pet",
  },
  {
    n: "8",
    texto: "plantillas de consentimiento para revisar, con firma en pantalla.",
    fuente: "Consentimientos",
    tono: "lv-s-ink",
  },
  {
    n: "14",
    unidad: "días",
    texto: "de prueba, sin tarjeta. Si no te sirve, exportas todo en un ZIP.",
    fuente: "Prueba",
    tono: "lv-s-ocre2",
  },
  {
    n: "1",
    texto: "toque para enviar el recordatorio desde el WhatsApp de la clínica.",
    fuente: "Recepción",
    tono: "lv-s-paper",
  },
] as const;

export function Cifras() {
  const { animar } = useMovimiento();
  const riel = useRef<HTMLUListElement>(null);
  const barra = useRef<HTMLElement>(null);

  const progreso = useCallback(() => {
    const r = riel.current;
    const b = barra.current;
    if (!r || !b) return;
    const max = r.scrollWidth - r.clientWidth;
    const f = r.scrollWidth ? r.clientWidth / r.scrollWidth : 1;
    b.style.width = `${f * 100}%`;
    b.style.left = `${max ? (r.scrollLeft / max) * (1 - f) * 100 : 0}%`;
  }, []);

  useEffect(() => {
    const r = riel.current;
    if (!r) return;
    progreso();
    r.addEventListener("scroll", progreso, { passive: true });
    window.addEventListener("resize", progreso);

    // Arrastre con el mouse (en táctil el scroll horizontal ya es nativo).
    let arrastre: { x: number; s: number } | null = null;
    const abajo = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      arrastre = { x: e.clientX, s: r.scrollLeft };
      r.style.scrollSnapType = "none";
    };
    const mover = (e: PointerEvent) => {
      if (arrastre) r.scrollLeft = arrastre.s - (e.clientX - arrastre.x);
    };
    const arriba = () => {
      if (!arrastre) return;
      arrastre = null;
      r.style.scrollSnapType = "";
    };
    r.classList.add("is-grab");
    r.addEventListener("pointerdown", abajo);
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", arriba);
    return () => {
      r.removeEventListener("scroll", progreso);
      window.removeEventListener("resize", progreso);
      r.removeEventListener("pointerdown", abajo);
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", arriba);
    };
  }, [progreso]);

  function mover(dir: -1 | 1) {
    const r = riel.current;
    const c = r?.querySelector("li");
    if (!r || !c) return;
    r.scrollBy({ left: dir * (c.offsetWidth + 16), behavior: animar ? "smooth" : "auto" });
  }

  return (
    <section className="lv-nums" aria-labelledby="lv-nums-h">
      <div className="lv-wrap lv-sec-head">
        <h2 className="lv-h-sec" id="lv-nums-h">
          Cifras que salen <em>del producto,</em> no de un estudio.
        </h2>
        <p className="lv-lead">
          Ninguna es una métrica de uso: son lo que Esmalia hace hoy, contado con números.
        </p>
      </div>
      {/* tabIndex: el riel se desplaza con las flechas del teclado. */}
      <ul className="lv-rail" ref={riel} tabIndex={0} aria-label="Cifras de Esmalia">
        {CIFRAS.map((c) => (
          <li key={c.fuente} className={`lv-stat ${c.tono}`}>
            <p className="n">
              {c.n}
              {"unidad" in c && <small>{c.unidad}</small>}
            </p>
            <p className="tx">{c.texto}</p>
            <span className="src">{c.fuente}</span>
          </li>
        ))}
      </ul>
      <div className="lv-wrap lv-rail-ctl">
        <div className="lv-prog" aria-hidden="true">
          <i ref={barra} />
        </div>
        <div className="lv-arrows">
          <button
            type="button"
            className="lv-rbtn"
            aria-label="Cifra anterior"
            onClick={() => mover(-1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            className="lv-rbtn"
            aria-label="Cifra siguiente"
            onClick={() => mover(1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
