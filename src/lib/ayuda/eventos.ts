// src/lib/ayuda/eventos.ts
//
// Eventos de ventana para abrir piezas de la ayuda desde cualquier lugar
// (el menú Ayuda de la barra lateral, el centro de ayuda, el checklist) sin
// pasar props por el shell. Los escucha `BotonAyuda`, que está montado una
// sola vez en la barra superior. Mismo patrón que EVENTO_ABRIR_ATAJOS.

export const EVENTO_ABRIR_AYUDA = "esmalia:ayuda:abrir";
export const EVENTO_ABRIR_REPORTE = "esmalia:ayuda:reportar";
export const EVENTO_VER_RECORRIDO = "esmalia:ayuda:recorrido";

export function abrirPanelDeAyuda() {
  window.dispatchEvent(new Event(EVENTO_ABRIR_AYUDA));
}

export function abrirReporte() {
  window.dispatchEvent(new Event(EVENTO_ABRIR_REPORTE));
}

/** Inicia el recorrido de la pantalla actual (si tiene). */
export function verRecorrido() {
  window.dispatchEvent(new Event(EVENTO_VER_RECORRIDO));
}
