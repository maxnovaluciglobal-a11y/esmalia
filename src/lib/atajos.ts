/**
 * Atajos de teclado globales (NAV-03 y NAV-05 lite, Ola 1).
 *
 * - `/` abre la búsqueda de pacientes (el mismo buscador que ⌘K).
 * - `?` abre la hoja de atajos.
 * - En la agenda, `N` abre "Nueva cita".
 * - En Pacientes (Ola 8, NAV-05): `N` abre "Nuevo paciente", `F` lleva al
 *   buscador de la lista y `Esc` quita la selección de fichas.
 *
 * Una tecla suelta nunca se roba mientras alguien escribe: si el foco está
 * en un campo editable, con un modificador apretado o con un diálogo abierto,
 * el atajo no corre. Puro para poder probarlo sin navegador
 * (`tests/atajos.test.ts`).
 */

/** Tipos de `<input>` que no son para escribir texto. */
const INPUTS_NO_EDITABLES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

type ElementoMinimo = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
};

/** ¿El elemento recibe texto del teclado? (input de texto, textarea, select, contenteditable). */
export function esCampoEditable(objetivo: unknown): boolean {
  if (!objetivo || typeof objetivo !== "object") return false;
  const el = objetivo as ElementoMinimo;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !INPUTS_NO_EDITABLES.has((el.type ?? "text").toLowerCase());
  return false;
}

export type EventoTecla = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  /** El `EventTarget` del evento (un elemento, o cualquier cosa). */
  target?: unknown;
};

/**
 * ¿Esta tecla suelta se puede tomar como atajo? Shift sí se permite (en
 * muchos teclados `?` es Shift + `'` o Shift + `/`).
 */
export function puedeAtenderAtajo(e: EventoTecla, hayDialogoAbierto = false): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (hayDialogoAbierto) return false;
  return !esCampoEditable(e.target);
}

/** `/`: abre la búsqueda de pacientes. */
export function esAtajoBuscar(e: EventoTecla, hayDialogoAbierto = false): boolean {
  return e.key === "/" && puedeAtenderAtajo(e, hayDialogoAbierto);
}

/** `?`: abre la hoja de atajos. */
export function esAtajoAyuda(e: EventoTecla, hayDialogoAbierto = false): boolean {
  return e.key === "?" && puedeAtenderAtajo(e, hayDialogoAbierto);
}

/** `N` en la agenda: abre "Nueva cita". */
export function esAtajoNuevaCita(e: EventoTecla, hayDialogoAbierto = false): boolean {
  return (e.key === "n" || e.key === "N") && puedeAtenderAtajo(e, hayDialogoAbierto);
}

/** `N` en Pacientes: abre "Nuevo paciente" (misma tecla que en la agenda). */
export function esAtajoNuevoPaciente(e: EventoTecla, hayDialogoAbierto = false): boolean {
  return esAtajoNuevaCita(e, hayDialogoAbierto);
}

/** `F` en una lista: lleva el foco al buscador de esa lista. */
export function esAtajoFiltrar(e: EventoTecla, hayDialogoAbierto = false): boolean {
  return (e.key === "f" || e.key === "F") && puedeAtenderAtajo(e, hayDialogoAbierto);
}

/** ⌘/Ctrl + Enter dentro de un formulario de cita: guardar. */
export function esAtajoGuardar(e: EventoTecla): boolean {
  return e.key === "Enter" && Boolean(e.metaKey || e.ctrlKey) && !e.altKey;
}

/** Evento de ventana que abre la hoja de atajos (menú Ayuda → "Atajos de teclado"). */
export const EVENTO_ABRIR_ATAJOS = "esmalia:abrir-atajos";

/** ¿Hay un diálogo modal abierto en la página? */
export function hayDialogoAbierto(doc: Pick<Document, "querySelector"> = document): boolean {
  return Boolean(doc.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]'));
}

export type Atajo = { teclas: string[]; descripcion: string };
export type GrupoDeAtajos = { titulo: string; atajos: Atajo[] };

/** Lo que muestra la hoja de atajos (`?`). `mod` es ⌘ en Mac y Ctrl en el resto. */
export function gruposDeAtajos(mod: "⌘" | "Ctrl"): GrupoDeAtajos[] {
  return [
    {
      titulo: "En toda la app",
      atajos: [
        { teclas: [mod, "K"], descripcion: "Buscar paciente, página o acción" },
        { teclas: ["/"], descripcion: "Buscar paciente" },
        { teclas: ["?"], descripcion: "Ver estos atajos" },
        { teclas: ["Esc"], descripcion: "Cerrar el diálogo abierto" },
      ],
    },
    {
      titulo: `En el buscador (${mod} K)`,
      atajos: [
        { teclas: ["↑", "↓", "Enter"], descripcion: "Elegir un resultado" },
        { teclas: ["cobrar"], descripcion: "Registrar pago (también “pagar” o “abono”)" },
        { teclas: ["turno"], descripcion: "Nueva cita (también “hora” o “agendar”)" },
        { teclas: ["saldo"], descripcion: "Pacientes con saldo" },
        { teclas: ["ajustes"], descripcion: "Ir a cualquier pantalla de Ajustes" },
      ],
    },
    {
      titulo: "Pacientes",
      atajos: [
        { teclas: ["N"], descripcion: "Nuevo paciente" },
        { teclas: ["F"], descripcion: "Buscar en la lista" },
        { teclas: ["Espacio"], descripcion: "Marcar la ficha (en su casilla)" },
        { teclas: ["Esc"], descripcion: "Quitar la selección" },
        { teclas: ["Enter"], descripcion: "Abrir el menú ⋮ de la fila enfocada" },
      ],
    },
    {
      titulo: "Agenda",
      atajos: [
        { teclas: ["N"], descripcion: "Nueva cita" },
        { teclas: [mod, "Enter"], descripcion: "Guardar la cita (dentro del formulario)" },
        { teclas: ["←", "→"], descripcion: "Elegir tipo, procedimiento o duración" },
        { teclas: ["Alt", "↑ ↓ ← →"], descripcion: "Mover la cita enfocada en la grilla" },
      ],
    },
  ];
}
