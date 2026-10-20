import { useEffect, useRef, useState, type PointerEvent } from "react";

import {
  encajar,
  esMovible,
  indiceDeCarril,
  limitarAlRango,
  PASO_ENCAJE_MIN,
  PASO_FINO_MIN,
  PULSACION_LARGA_MS,
  pxAMinutos,
  UMBRAL_ARRASTRE_PX,
  type Carril,
  type Destino,
  type Veredicto,
} from "@/components/agenda-movimiento";
import { PIXELES_POR_MINUTO, type Cita } from "@/lib/clinic-operations/clinic-data";

export const ID_AYUDA_ARRASTRE = "agenda-ayuda-arrastre";

/** Devuelve el foco al bloque de la cita después de moverla (se re-monta en otro carril). */
export function enfocarCita(citaId: string) {
  window.setTimeout(() => {
    document.querySelector<HTMLElement>(`[data-cita-id="${CSS.escape(citaId)}"]`)?.focus();
  }, 60);
}

/** Lo que se dibuja mientras se arrastra: dónde caería la cita y si se puede soltar ahí. */
export interface Fantasma {
  citaId: string;
  duracion: number;
  destino: Destino;
  veredicto: Veredicto;
}

interface Opciones {
  habilitado: boolean;
  carriles: Carril[];
  /** Elemento DOM del carril (la columna donde se posicionan los bloques). */
  elementoDeCarril: (carril: Carril) => HTMLElement | null | undefined;
  rango: { desde: number; hasta: number };
  validar: (cita: Cita, destino: Destino) => Veredicto;
  onSoltar: (cita: Cita, destino: Destino) => void;
  onRechazo: (mensaje: string) => void;
  pxPorMinuto?: number;
}

interface Gesto {
  cita: Cita;
  pointerId: number;
  tipo: string;
  x: number;
  y: number;
  /** Distancia del puntero al borde superior del bloque, para que el bloque no "salte". */
  dy: number;
  activo: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Controlador del gesto, creado una sola vez por componente: los listeners
 * de `window` tienen que ser siempre la misma función para poder quitarlos,
 * y leen las opciones vigentes desde `opciones.current`.
 */
function crearControlador(
  opciones: { current: Opciones },
  setFantasma: (f: Fantasma | null) => void,
) {
  let gesto: Gesto | null = null;
  let fantasma: Fantasma | null = null;
  let suprimirClick = false;

  function fijar(f: Fantasma | null) {
    fantasma = f;
    setFantasma(f);
  }

  function bloquearScroll(e: TouchEvent) {
    if (gesto?.activo) e.preventDefault();
  }

  function terminar() {
    if (gesto?.timer) clearTimeout(gesto.timer);
    gesto = null;
    fijar(null);
    if (typeof window === "undefined") return;
    document.documentElement.classList.remove("agenda-arrastrando");
    window.removeEventListener("pointermove", alMover);
    window.removeEventListener("pointerup", alSoltar);
    window.removeEventListener("pointercancel", terminar);
    window.removeEventListener("keydown", alTecla, true);
    document.removeEventListener("touchmove", bloquearScroll);
  }

  function activar(g: Gesto) {
    g.activo = true;
    document.documentElement.classList.add("agenda-arrastrando");
  }

  function calcular(e: { clientX: number; clientY: number; shiftKey: boolean }) {
    const g = gesto;
    if (!g) return;
    const { carriles, elementoDeCarril, rango, validar, pxPorMinuto } = opciones.current;
    const rects = carriles.map((c) => elementoDeCarril(c)?.getBoundingClientRect());
    const idx = indiceDeCarril(
      e.clientX,
      rects.map((rc) => ({ izquierda: rc?.left ?? 0, derecha: rc?.right ?? 0 })),
    );
    if (idx < 0) return;
    const rc = rects[idx]!;
    const paso = e.shiftKey ? PASO_FINO_MIN : PASO_ENCAJE_MIN;
    const crudo =
      rango.desde + pxAMinutos(e.clientY - g.dy - rc.top, pxPorMinuto ?? PIXELES_POR_MINUTO);
    const destino: Destino = {
      fecha: carriles[idx].fecha,
      profesionalId: carriles[idx].profesionalId,
      inicio: limitarAlRango(encajar(crudo, paso), g.cita.duracion, rango),
    };
    if (
      fantasma &&
      fantasma.destino.fecha === destino.fecha &&
      fantasma.destino.inicio === destino.inicio &&
      fantasma.destino.profesionalId === destino.profesionalId
    )
      return;
    fijar({
      citaId: g.cita.id,
      duracion: g.cita.duracion,
      destino,
      veredicto: validar(g.cita, destino),
    });
  }

  function alMover(e: globalThis.PointerEvent) {
    const g = gesto;
    if (!g || e.pointerId !== g.pointerId) return;
    const lejos = Math.hypot(e.clientX - g.x, e.clientY - g.y) >= UMBRAL_ARRASTRE_PX;
    if (!g.activo) {
      if (g.tipo === "touch") {
        // Se movió antes de la pulsación larga: es scroll, no arrastre.
        if (lejos) terminar();
        return;
      }
      if (!lejos) return;
      activar(g);
    }
    e.preventDefault();
    calcular(e);
  }

  function alSoltar(e: globalThis.PointerEvent) {
    const g = gesto;
    if (!g || e.pointerId !== g.pointerId) return;
    const f = fantasma;
    terminar();
    if (!g.activo) return;
    // El pointerup de un arrastre dispara un click sobre el bloque: no tiene
    // que abrir el popover ni el panel.
    suprimirClick = true;
    setTimeout(() => (suprimirClick = false), 0);
    if (!f) return;
    if (f.veredicto.ok) opciones.current.onSoltar(g.cita, f.destino);
    else if (f.veredicto.motivo !== "sin-cambio") opciones.current.onRechazo(f.veredicto.mensaje);
  }

  function alTecla(e: KeyboardEvent) {
    if (e.key === "Escape" && gesto) {
      e.preventDefault();
      e.stopPropagation();
      terminar();
    }
  }

  function alPresionar(e: PointerEvent<HTMLElement>, cita: Cita) {
    if (!opciones.current.habilitado || !esMovible(cita) || e.button !== 0 || e.altKey) return;
    if (gesto) terminar();
    const rect = e.currentTarget.getBoundingClientRect();
    const g: Gesto = {
      cita,
      pointerId: e.pointerId,
      tipo: e.pointerType,
      x: e.clientX,
      y: e.clientY,
      dy: e.clientY - rect.top,
      activo: false,
    };
    gesto = g;
    window.addEventListener("pointermove", alMover, { passive: false });
    window.addEventListener("pointerup", alSoltar);
    window.addEventListener("pointercancel", terminar);
    window.addEventListener("keydown", alTecla, true);
    if (e.pointerType === "touch") {
      document.addEventListener("touchmove", bloquearScroll, { passive: false });
      const { clientX, clientY } = e;
      g.timer = setTimeout(() => {
        if (gesto !== g) return;
        activar(g);
        navigator.vibrate?.(10);
        calcular({ clientX, clientY, shiftKey: false });
      }, PULSACION_LARGA_MS);
    }
  }

  return {
    alPresionar,
    terminar,
    /** Para el `onClick` del bloque: true si el clic viene de soltar un arrastre. */
    clicDeArrastre: () => suprimirClick,
  };
}

/**
 * Arrastre con pointer events propios (sin librerías, plan A+ §5.1).
 *
 * - Mouse y lápiz: el arrastre empieza al pasar UMBRAL_ARRASTRE_PX; antes de
 *   eso es un clic común (abre el popover o el panel).
 * - Táctil: pulsación larga de PULSACION_LARGA_MS sin moverse. Si el dedo se
 *   mueve antes, es scroll y no se toca nada.
 * - Shift encaja a 5 minutos en lugar de 15. Escape cancela.
 *
 * La lógica de encaje, límites y validación es pura (`agenda-movimiento.ts`);
 * acá solo se traduce el puntero a un `Destino`.
 */
export function useArrastreCita(opciones: Opciones) {
  const [fantasma, setFantasma] = useState<Fantasma | null>(null);
  const ref = useRef(opciones);
  ref.current = opciones;
  const [controlador] = useState(() => crearControlador(ref, setFantasma));
  useEffect(() => controlador.terminar, [controlador]);
  return {
    fantasma,
    alPresionar: controlador.alPresionar,
    clicDeArrastre: controlador.clicDeArrastre,
  };
}
