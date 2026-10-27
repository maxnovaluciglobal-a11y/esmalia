import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

import type { Recorrido } from "@/content/ayuda/tipos";
import { cn } from "@/lib/utils";

/**
 * Recorrido guiado de una pantalla (ONB-03). Sin librería: un foco de luz
 * sobre el elemento y una tarjeta con el paso.
 *
 * Accesible con teclado y lector de pantalla:
 * - la tarjeta es un `dialog` con título y descripción; al cambiar de paso
 *   el foco va a su título y una región `aria-live` anuncia "Paso 2 de 4";
 * - flechas izquierda/derecha cambian de paso, Escape lo cierra, Tab recorre
 *   solo los botones de la tarjeta;
 * - al cerrar, el foco vuelve a donde estaba (el botón de ayuda).
 * Si el elemento de un paso no está en pantalla (otro rol, otra vista, el
 * celular), el paso se muestra igual, centrado y sin foco de luz.
 */
export function RecorridoGuiado({
  recorrido,
  nombrePantalla,
  onCerrar,
}: {
  recorrido: Recorrido;
  nombrePantalla: string;
  /** `completo` = llegó al último paso y tocó "Terminar". */
  onCerrar: (completo: boolean) => void;
}) {
  const [indice, setIndice] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [posTarjeta, setPosTarjeta] = useState<{ top: number; left: number } | null>(null);
  const tarjeta = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const focoPrevio = useRef<HTMLElement | null>(null);
  const id = useId();
  const total = recorrido.pasos.length;
  const paso = recorrido.pasos[indice];
  const ultimo = indice === total - 1;

  const cerrar = useCallback(
    (completo: boolean) => {
      onCerrar(completo);
      const destino = focoPrevio.current;
      window.setTimeout(() => {
        if (destino?.isConnected) destino.focus({ preventScroll: true });
      }, 0);
    },
    [onCerrar],
  );

  // Quién tenía el foco al abrir.
  useLayoutEffect(() => {
    const activo = document.activeElement;
    focoPrevio.current = activo instanceof HTMLElement && activo !== document.body ? activo : null;
  }, []);

  // Elemento del paso: llevarlo a la vista y medirlo (también al hacer
  // scroll o cambiar el tamaño de la ventana).
  useEffect(() => {
    const el = paso.selector ? document.querySelector<HTMLElement>(paso.selector) : null;
    const visible = el && el.getClientRects().length > 0 ? el : null;
    const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (visible) {
      visible.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reducido ? "auto" : "smooth",
      });
    }
    let frame = 0;
    const medir = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setRect(visible ? visible.getBoundingClientRect() : null),
      );
    };
    medir();
    // El scroll suave tarda: volver a medir cuando termina.
    const t = window.setTimeout(medir, reducido ? 0 : 400);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(t);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [paso.selector]);

  // Foco al título en cada paso.
  useEffect(() => {
    titulo.current?.focus({ preventScroll: true });
  }, [indice]);

  // Ubicar la tarjeta: debajo del elemento si cabe, si no arriba; en el
  // celular (o sin elemento) va abajo, a lo ancho.
  useLayoutEffect(() => {
    const card = tarjeta.current;
    if (!card) return;
    const ancho = window.innerWidth;
    const alto = window.innerHeight;
    if (!rect || ancho < 640) {
      setPosTarjeta(null);
      return;
    }
    const h = card.offsetHeight;
    const w = card.offsetWidth;
    const margen = 14;
    let top = rect.bottom + margen;
    if (top + h > alto - margen) top = rect.top - h - margen;
    if (top < margen) top = Math.max(margen, alto - h - margen);
    const left = Math.min(Math.max(margen, rect.left), ancho - w - margen);
    setPosTarjeta({ top, left });
  }, [rect, indice]);

  const irA = (n: number) => setIndice(Math.min(Math.max(0, n), total - 1));

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar(false);
    } else if (e.key === "ArrowRight" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      if (ultimo) cerrar(true);
      else irA(indice + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      irA(indice - 1);
    } else if (e.key === "Tab" && tarjeta.current) {
      // Tab queda dentro de la tarjeta.
      const enfocables = Array.from(
        tarjeta.current.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='-1']"),
      ).filter((n) => n.tagName === "BUTTON");
      if (enfocables.length === 0) return;
      const primero = enfocables[0];
      const fin = enfocables[enfocables.length - 1];
      const activo = document.activeElement;
      if (e.shiftKey && (activo === primero || activo === titulo.current)) {
        e.preventDefault();
        fin.focus();
      } else if (!e.shiftKey && activo === fin) {
        e.preventDefault();
        primero.focus();
      }
    }
  }

  const PAD = 6;
  return createPortal(
    <div className="fixed inset-0 z-[60]" onKeyDown={onKeyDown}>
      {/* Fondo: atrapa los clics para que la pantalla no cambie a mitad
          del recorrido. El foco de luz es un recorte con sombra. */}
      <div aria-hidden className="absolute inset-0" />
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[12px] outline-2 outline-offset-2 outline-brand-600 transition-[top,left,width,height] duration-200 motion-reduce:transition-none"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px color-mix(in oklab, var(--night) 55%, transparent)",
          }}
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "color-mix(in oklab, var(--night) 55%, transparent)" }}
        />
      )}

      <div
        ref={tarjeta}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-texto`}
        className={cn(
          "absolute w-[min(26rem,calc(100vw-2rem))] rounded-[14px] border border-hairline bg-card p-5 text-card-foreground shadow-lg",
          !posTarjeta && "inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] mx-auto",
        )}
        style={posTarjeta ? { top: posTarjeta.top, left: posTarjeta.left } : undefined}
      >
        <p className="text-[12.5px] font-semibold text-muted-foreground">
          Recorrido · {nombrePantalla} ·{" "}
          <span className="cifra">
            {indice + 1}/{total}
          </span>
        </p>
        <h2
          ref={titulo}
          id={`${id}-titulo`}
          tabIndex={-1}
          className="mt-1.5 font-display text-[22px] font-medium leading-tight outline-none"
        >
          {paso.titulo}
        </h2>
        <p id={`${id}-texto`} className="mt-2 text-[15px] leading-snug text-foreground/85">
          {paso.texto}
        </p>
        <p aria-live="polite" className="sr-only">
          Paso {indice + 1} de {total}: {paso.titulo}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => cerrar(false)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9"
          >
            <X aria-hidden className="size-4" /> Saltar
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => irA(indice - 1)}
              disabled={indice === 0}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-semibold hover:border-foreground disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9"
            >
              <ArrowLeft aria-hidden className="size-4" /> Anterior
            </button>
            <button
              type="button"
              onClick={() => (ultimo ? cerrar(true) : irA(indice + 1))}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9"
            >
              {ultimo ? "Terminar" : "Siguiente"}
              {!ultimo && <ArrowRight aria-hidden className="size-4" />}
            </button>
          </div>
        </div>
        <p className="mt-3 hidden text-[12px] text-muted-foreground pointer-fine:block">
          Flechas para avanzar o volver · Esc para salir
        </p>
      </div>
    </div>,
    document.body,
  );
}
