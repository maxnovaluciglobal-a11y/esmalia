import { useEffect, useRef } from "react";

import { useMovimiento } from "@/hooks/use-movimiento";

/**
 * Cinta de palabras que corre sola y acelera con la velocidad del scroll.
 * Decorativa (`aria-hidden`): las palabras ya están dichas en otras partes.
 *
 * - El contenido va duplicado en el HTML (así el bucle no salta y el
 *   servidor y el cliente renderizan lo mismo).
 * - Quieta sin movimiento (prefers-reduced-motion o "Pausar movimiento") y
 *   cuando está fuera de pantalla (IntersectionObserver), para no gastar CPU.
 */
export function Marquee({
  palabras,
  direccion = 1,
  className,
}: {
  palabras: readonly string[];
  /** 1 corre hacia la izquierda, -1 hacia la derecha; el valor escala la velocidad. */
  direccion?: number;
  className?: string;
}) {
  const { animar } = useMovimiento();
  const cinta = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cinta.current;
    if (!el || !animar) return;

    let x = 0;
    let vel = 0;
    let ultimoY = window.scrollY;
    let ultimoT = performance.now();
    let raf = 0;
    let visible = false;

    const tick = (t: number) => {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(64, t - ultimoT);
      ultimoT = t;
      const dy = window.scrollY - ultimoY;
      ultimoY = window.scrollY;
      vel = vel * 0.9 + dy * 0.1;
      const mitad = el.scrollWidth / 2;
      const sentido = vel < -1 ? -1 : 1;
      const rapidez = (0.045 + Math.min(1.2, Math.abs(vel) * 0.02)) * direccion * sentido;
      x -= rapidez * dt;
      if (x <= -mitad) x += mitad;
      if (x > 0) x -= mitad;
      el.style.transform = `translate3d(${x}px,0,0)`;
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) {
        ultimoT = performance.now();
        ultimoY = window.scrollY;
        raf = requestAnimationFrame(tick);
      }
    });
    io.observe(el);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [animar, direccion]);

  return (
    <div className={className} aria-hidden="true">
      <div className="lv-marq" ref={cinta}>
        {[0, 1].map((copia) => palabras.map((p) => <span key={`${copia}-${p}`}>{p}</span>))}
      </div>
    </div>
  );
}
