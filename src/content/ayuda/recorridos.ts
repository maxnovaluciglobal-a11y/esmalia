// src/content/ayuda/recorridos.ts
//
// Recorridos guiados (ONB-03). Opcionales: se ofrecen la primera vez que la
// persona entra a la pantalla, se pueden saltar y se vuelven a ver desde el
// botón de ayuda. Los selectores apuntan a elementos que ya existen
// (aria-label, ids estables); si uno no está (otro rol, otra vista, el
// celular), ese paso se muestra centrado.
import type { PantallaId, Recorrido } from "@/content/ayuda/tipos";

export const RECORRIDOS: readonly Recorrido[] = [
  {
    id: "hoy",
    pasos: [
      {
        selector: "[data-boton-ayuda]",
        titulo: "La ayuda siempre está aquí",
        texto:
          "Este botón abre la ayuda de la pantalla en que estás, el buscador, la Academia, las novedades y la forma de escribirnos.",
      },
      {
        selector: "#agenda-hoy",
        titulo: "La agenda de hoy",
        texto: "Las citas del día con su estado. «Abrir agenda» lleva a la agenda completa.",
      },
      {
        selector: '[aria-keyshortcuts="Meta+K Control+K /"]',
        titulo: "Busca desde cualquier lado",
        texto:
          "⌘K (o Ctrl+K, o la tecla /) busca pacientes, pantallas y acciones como «Nueva cita» o «Registrar pago».",
      },
    ],
  },
  {
    id: "agenda",
    pasos: [
      {
        selector: '[role="group"][aria-label="Vista"]',
        titulo: "Elige cómo ver la agenda",
        texto: "Día, Semana, Boxes, Mes o Lista. En el celular conviene Lista.",
      },
      {
        selector: 'button[aria-label="Período anterior"]',
        titulo: "Muévete en el calendario",
        texto: "Las flechas cambian de día o semana; «Hoy» vuelve al día actual.",
      },
      {
        selector: 'button[aria-keyshortcuts="N"]',
        titulo: "Crea una cita",
        texto:
          "«Nueva cita» o la tecla N. Ctrl+Enter guarda sin soltar el teclado. Si la hora choca con otra cita, te lo avisa.",
      },
      {
        selector: null,
        titulo: "Toca una cita para atenderla",
        texto:
          "Se abre su panel: pasar a sala, marcar finalizada, «No asistió», reagendar o abrir la ficha. En Semana se arrastra para moverla.",
      },
    ],
  },
  {
    id: "pacientes",
    pasos: [
      {
        selector: '#main-content input[type="search"]',
        titulo: "Busca como quieras",
        texto:
          "Nombre, RUT en cualquier formato, correo, teléfono o etiqueta. La tecla F te trae aquí.",
      },
      {
        selector: 'section[aria-label="Tu cartera"]',
        titulo: "Tu cartera en cifras",
        texto: "Cada cifra filtra la lista: sin cita futura, sin visita, fichas incompletas y más.",
      },
      {
        selector: '[aria-label^="Acciones de "]',
        titulo: "Acciones por paciente",
        texto: "El menú ⋮ de cada fila: ver ficha, agendar, cobrar, WhatsApp o etiquetar.",
      },
    ],
  },
  {
    id: "ficha",
    pasos: [
      {
        selector: 'section[aria-label="Datos clave del paciente"]',
        titulo: "Lo clave del paciente",
        texto: "Datos, alertas y, si tienes permiso de finanzas, su saldo.",
      },
      {
        selector: '[role="tablist"]',
        titulo: "Todo en pestañas",
        texto:
          "Odontograma, notas, presupuesto y pagos, anamnesis, documentos y mensajes. Las clínicas se ven solo con acceso clínico.",
      },
      {
        selector: 'button[aria-label="Más acciones"]',
        titulo: "Más acciones",
        texto: "Programar un control, editar datos, exportar o archivar la ficha.",
      },
    ],
  },
  {
    id: "caja",
    pasos: [
      {
        selector: null,
        titulo: "Tu caja del día",
        texto:
          "Abre tu caja con el monto inicial. Los cobros se registran en la ficha del paciente y caen en la caja de quien cobra.",
      },
      {
        selector: "#arqueo",
        titulo: "El arqueo",
        texto:
          "Al final del día cuenta el cajón por billete y moneda. Si no cuadra, escribe el motivo. Antes de cerrar te pedimos confirmar.",
      },
      {
        selector: "#caja-historial",
        titulo: "El historial",
        texto: "Los turnos anteriores con su cierre y su diferencia.",
      },
    ],
  },
];

const POR_ID = new Map(RECORRIDOS.map((r) => [r.id, r]));

export function recorridoDePantalla(id: PantallaId | null): Recorrido | null {
  return id ? (POR_ID.get(id) ?? null) : null;
}
