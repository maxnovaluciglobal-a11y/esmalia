// src/content/ayuda/novedades.ts
//
// Novedades (NAV-10): los cambios recientes contados para la clínica, la más
// nueva primero. Cada una tiene un id estable: la marca de "leída" se guarda
// por persona (help_progress, kind 'novedad'). Para agregar una novedad, se
// suma arriba con un id nuevo; nunca se cambia el id de una que ya salió.
import type { Novedad } from "@/content/ayuda/tipos";

export const NOVEDADES: readonly Novedad[] = [
  // ── Ola 12 ──────────────────────────────────────────────────────────────
  {
    id: "ayuda-en-cada-pantalla",
    fecha: "2026-10-27",
    titulo: "Ayuda en cada pantalla, recorridos y Academia",
    texto:
      "El botón de ayuda (junto a la campana) explica la pantalla en que estás, ofrece un recorrido guiado y busca en todos los artículos. La Academia tiene lecciones cortas para cada rol.",
    enlace: { href: "/ayuda/academia", texto: "Abrir la Academia" },
  },
  {
    id: "reportar-con-captura",
    fecha: "2026-10-27",
    titulo: "Cuéntanos un problema con una captura",
    texto:
      "Desde la ayuda puedes mandarnos un problema o una sugerencia con una captura de la pantalla. Antes de enviarla puedes tapar lo que no quieras mostrar.",
  },
  {
    id: "confirmar-acciones",
    fecha: "2026-10-27",
    titulo: "Te avisamos antes de lo que no tiene vuelta atrás",
    texto:
      "Cerrar la caja, cancelar una cita, cambiar el rol de alguien, cerrar comisiones o marcarlas pagadas ahora piden confirmar y te dicen qué va a pasar, con la cifra.",
  },
  // ── Ola 11 ──────────────────────────────────────────────────────────────
  {
    id: "informes-por-pregunta",
    fecha: "2026-10-27",
    titulo: "Informes que responden preguntas",
    texto:
      "Reportes → Informes: cómo vamos contra el período anterior, ocupación de la agenda y los boxes, embudo de pacientes, equipo y sucursales. Toca cualquier cifra para ver sus registros y exporta a CSV o PDF.",
    enlace: { href: "/informes", texto: "Ver informes" },
  },
  {
    id: "hoy-por-rol",
    fecha: "2026-10-27",
    titulo: "Hoy te muestra lo que requiere acción",
    texto:
      "Arriba de Hoy aparecen las alertas de tu rol: citas sin confirmar, reservas por aceptar, cajas sin cerrar, laboratorio atrasado, stock bajo y más. La campana tiene su bandeja completa en Notificaciones.",
    enlace: { href: "/dashboard", texto: "Ir a Hoy" },
  },
  // ── Ola 10 ──────────────────────────────────────────────────────────────
  {
    id: "caja-por-persona",
    fecha: "2026-10-27",
    titulo: "Cada persona con su caja",
    texto:
      "Cada quien abre y cierra su caja; el cobro va a la caja de quien cobra. Traspasos, retiros y depósitos quedan registrados con su motivo.",
    enlace: { href: "/cajas", texto: "Ir a la caja", permiso: "cash:manage" },
  },
  {
    id: "comisiones-congeladas",
    fecha: "2026-10-27",
    titulo: "Comisiones con «rige desde» y liquidación congelada",
    texto:
      "Las reglas de comisión tienen fecha de inicio y cada profesional ve su comisión en Mi desempeño. Al cerrar el período, la liquidación ya no cambia.",
  },
  {
    id: "finanzas-y-membresias",
    fecha: "2026-10-27",
    titulo: "Finanzas, gastos fijos, convenios y membresías",
    texto:
      "Una vista general de las finanzas por sucursal, gastos fijos que se confirman cada mes, empresas con convenio y membresías con sus cuotas.",
  },
  {
    id: "permisos-por-persona",
    fecha: "2026-10-27",
    titulo: "Permisos por persona y roles nuevos",
    texto:
      "Ahora puedes dar o quitar un permiso puntual a alguien sin cambiar su rol. Llegaron los roles Coordinación y Técnico/a dental.",
  },
  // ── Ola 9 ───────────────────────────────────────────────────────────────
  {
    id: "odontograma-varias-piezas",
    fecha: "2026-10-27",
    titulo: "Odontograma: varias piezas de una vez",
    texto:
      "Marca muchas piezas en un solo paso, mira el presupuesto sobre el odontograma y compara dos periodontogramas sitio por sitio.",
  },
  {
    id: "laboratorio-y-ortodoncia",
    fecha: "2026-10-27",
    titulo: "Laboratorio con color VITA y ortodoncia con etapas",
    texto:
      "Las órdenes de laboratorio llevan color, material, margen y fecha comprometida con aviso de atraso. Ortodoncia sigue alineadores, progreso y etapas.",
  },
  {
    id: "ficha-clinica-completa",
    fecha: "2026-10-27",
    titulo: "Antecedentes completos, interconsultas e implantes",
    texto:
      "La anamnesis trae 29 preguntas en 8 grupos, hay interconsultas con documento de derivación, protocolos clínicos por clínica y seguimiento de implantes por lote.",
  },
  // ── Ola 8 ───────────────────────────────────────────────────────────────
  {
    id: "seguimiento-y-campanas",
    fecha: "2026-10-27",
    titulo: "Seguimiento y campañas",
    texto:
      "Tareas, controles pendientes y tratamientos detenidos en un solo lugar, y campañas a un segmento por correo o WhatsApp (que despachas a mano), con quién volvió.",
    enlace: { href: "/seguimiento", texto: "Ver seguimiento", permiso: "agenda:manage" },
  },
  {
    id: "pacientes-segmentos",
    fecha: "2026-10-27",
    titulo: "Pacientes con filtros, etiquetas y segmentos",
    texto:
      "Filtros rápidos (con saldo, sin próxima cita, cumpleaños, fichas incompletas), etiquetas de colores, segmentos guardados y archivo con motivo, también en lote.",
    enlace: { href: "/pacientes", texto: "Ver pacientes", permiso: "patients:view" },
  },
  // ── Ola 7 ───────────────────────────────────────────────────────────────
  {
    id: "reserva-en-linea",
    fecha: "2026-10-27",
    titulo: "Reserva en línea",
    texto:
      "Tus pacientes eligen su hora desde un enlace, con las horas reales de tu agenda. Cada reserva entra por confirmar y la acepta el profesional.",
    enlace: { href: "/reserva-en-linea", texto: "Configurar", permiso: "settings:manage" },
  },
  {
    id: "correos-al-paciente",
    fecha: "2026-10-27",
    titulo: "Correos automáticos al paciente",
    texto:
      "Confirmación al agendar, recordatorios, formulario antes de la cita y encuesta de satisfacción, por correo. Todo viene apagado: lo enciendes en Notificaciones a pacientes.",
  },
];
