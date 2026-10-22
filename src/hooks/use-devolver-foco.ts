import { createElement, useLayoutEffect, useRef, type MutableRefObject } from "react";

/**
 * Devuelve el foco a quien abrió un diálogo cuando se cierra (UX-12).
 *
 * Radix ya lo hace si el diálogo tiene `DialogTrigger`. Muchos se abren de
 * otra forma (⌘K, un ítem de menú, un `open` controlado desde la página) y
 * al cerrarse el foco caía al `<body>`: con teclado o lector de pantalla
 * había que volver a recorrer toda la página.
 *
 * `marcador` va adentro del `Content` de Radix: se monta cuando el diálogo se
 * abre y, en su layout effect (antes del useEffect con el que Radix mueve el
 * foco adentro), anota quién tenía el foco. `alCerrar` envuelve el
 * `onCloseAutoFocus`: si después de lo que haga Radix el foco quedó en el
 * `<body>`, se lo devuelve a ese elemento.
 */
export function useDevolverFoco() {
  const anterior = useRef<HTMLElement | null>(null);

  function alCerrar(propio?: (e: Event) => void) {
    return (e: Event) => {
      propio?.(e);
      if (e.defaultPrevented) return;
      const destino = anterior.current;
      window.setTimeout(() => {
        const activo = document.activeElement;
        const sinFoco = !activo || activo === document.body;
        if (sinFoco && destino?.isConnected) destino.focus({ preventScroll: true });
      }, 0);
    };
  }

  return { marcador: createElement(MarcadorDeFoco, { destino: anterior }), alCerrar };
}

function MarcadorDeFoco({ destino }: { destino: MutableRefObject<HTMLElement | null> }) {
  useLayoutEffect(() => {
    const activo = document.activeElement;
    destino.current = activo instanceof HTMLElement && activo !== document.body ? activo : null;
  }, [destino]);
  return null;
}
