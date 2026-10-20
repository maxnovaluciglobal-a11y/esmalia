// Molar en halftone para el cierre (draft C, 20-oct-2026). Canvas 2D sin
// dependencias, decorativo. Se dibuja recién cuando la sección se acerca a la
// pantalla (nunca en el primer pintado) y se redibuja al cambiar de tamaño.
// Es estático: con movimiento reducido se ve igual.
import { useEffect, useRef } from "react";

const MOLAR =
  "M30 70C24 40 40 18 62 22c12 2 20 12 38 8 18 4 26-6 38-8 22-4 38 18 32 48-4 22-10 38-14 54-6 26-6 56-12 90-3 16-18 18-22 2-6-26-10-50-22-56-12 6-16 30-22 56-4 16-19 14-22-2-6-34-6-64-12-90-4-16-10-32-14-54z";

function dibujar(lienzo: HTMLCanvasElement) {
  const lado = Math.round(lienzo.getBoundingClientRect().width);
  if (!lado) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  lienzo.width = lado * dpr;
  lienzo.height = lado * dpr;
  const ctx = lienzo.getContext("2d");
  const mapa = document.createElement("canvas");
  mapa.width = mapa.height = lado;
  const g = mapa.getContext("2d", { willReadFrequently: true });
  if (!ctx || !g) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, lado, lado);

  // Mapa de grises del molar (un degradé que simula luz desde arriba a la izquierda).
  g.fillStyle = "#fff";
  g.fillRect(0, 0, lado, lado);
  g.save();
  const sc = lado / 250;
  g.translate(lado * 0.5 - 100 * sc, lado * 0.04);
  g.scale(sc, sc);
  g.rotate(-0.08);
  const gr = g.createRadialGradient(80, 70, 10, 100, 120, 160);
  gr.addColorStop(0, "#9a9a9a");
  gr.addColorStop(0.45, "#3a3a3a");
  gr.addColorStop(1, "#000");
  g.fillStyle = gr;
  g.fill(new Path2D(MOLAR));
  g.restore();

  const datos = g.getImageData(0, 0, lado, lado).data;
  const paso = Math.max(9, Math.round(lado / 58));
  ctx.fillStyle = "#15120f";
  for (let y = paso / 2; y < lado; y += paso) {
    for (let x = paso / 2; x < lado; x += paso) {
      const d = 1 - datos[((y | 0) * lado + (x | 0)) * 4] / 255;
      if (d < 0.04) continue;
      ctx.beginPath();
      ctx.arc(x, y, Math.sqrt(d) * paso * 0.56, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function MolarHalftone({ className }: { className?: string }) {
  const lienzo = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    let dibujado = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || dibujado) return;
        dibujado = true;
        dibujar(c);
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(c);
    const alCambiar = () => {
      if (!dibujado) return;
      clearTimeout(t);
      t = setTimeout(() => dibujar(c), 150);
    };
    window.addEventListener("resize", alCambiar);
    return () => {
      io.disconnect();
      clearTimeout(t);
      window.removeEventListener("resize", alCambiar);
    };
  }, []);

  return <canvas ref={lienzo} className={className} aria-hidden="true" />;
}
