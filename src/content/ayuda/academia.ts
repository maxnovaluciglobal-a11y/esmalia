// src/content/ayuda/academia.ts
//
// Academia por rol (ONB-04): lecciones cortas con texto y espacio de video.
// Qué ve cada rol lo decide `src/lib/ayuda/academia.ts`. Todo lo que dicen
// tiene que ser verdad en la app de hoy.
import type { Leccion } from "@/content/ayuda/tipos";

export const LECCIONES: readonly Leccion[] = [
  // ── Lo básico: todo el equipo ────────────────────────────────────────────
  {
    id: "primer-dia",
    titulo: "Tu primer día en Esmalia",
    pistas: "todas",
    minutos: 3,
    cuerpo: [
      "El menú tiene los destinos del día a día: Hoy, Agenda, Pacientes, Mensajes, Caja, Reportes y Operación. Ajustes y Ayuda están abajo. Cada persona ve solo lo que su rol permite.",
      "Hoy es tu punto de partida: arriba están las alertas de tu rol, cada una lleva a donde se resuelve.",
      "Si algo no se entiende, el botón de ayuda (arriba, junto a la campana) explica la pantalla en que estás.",
    ],
    pantalla: "hoy",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Entrar a la demo, recorrer el menú, mostrar Hoy con sus alertas y abrir el botón de ayuda en dos pantallas.",
    },
  },
  {
    id: "buscar-y-atajos",
    titulo: "Buscar rápido y atajos de teclado",
    pistas: "todas",
    minutos: 2,
    cuerpo: [
      "⌘K (Ctrl+K en Windows) o la tecla / abre el buscador: pacientes, pantallas y acciones como «Nueva cita», «Abrir caja» o «Registrar pago».",
      "La tecla ? muestra todos los atajos. En la agenda, N crea una cita; en Pacientes, N crea un paciente y F lleva al buscador.",
      "Los atajos de una sola tecla no se activan mientras escribes en un campo.",
    ],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Usar ⌘K para encontrar un paciente y para Registrar pago, abrir la hoja de atajos con ? y crear una cita con N.",
    },
  },
  {
    id: "ayuda-y-reportar",
    titulo: "Cómo pedir ayuda o sugerir algo",
    pistas: "todas",
    minutos: 1,
    cuerpo: [
      "Desde el botón de ayuda puedes escribirnos por WhatsApp o mandar un reporte con una captura de la pantalla.",
      "La captura es opcional. Antes de enviarla puedes tapar lo que quieras: no mandes datos de pacientes que no hagan falta.",
    ],
    video: {
      estado: "pendiente",
      duracion: "1 min",
      guion: "Abrir Reportar un problema, tomar la captura, tapar una zona y enviar.",
    },
  },

  // ── Dueño o administración ──────────────────────────────────────────────
  {
    id: "dueno-equipo",
    titulo: "Arma tu equipo y sus permisos",
    pistas: ["dueno"],
    minutos: 3,
    cuerpo: [
      "En Equipo y permisos invitas a cada persona con su rol: administración, coordinación, profesional, asistente, recepción, contabilidad o técnico/a dental.",
      "Si alguien necesita algo puntual, «Permisos» da o quita un permiso sin cambiar su rol. Ningún ajuste abre la historia clínica a quien no es del área clínica.",
      "Con «Ver como otro rol» (Ajustes) compruebas cómo ve la app cada persona.",
    ],
    pantalla: "equipo",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Invitar a una recepcionista, quitarle un permiso puntual y comprobarlo con Ver como otro rol.",
    },
  },
  {
    id: "dueno-puesta-en-marcha",
    titulo: "Deja la clínica lista",
    pistas: ["dueno"],
    minutos: 4,
    cuerpo: [
      "Carga sucursales, boxes y el horario de atención; después el arancel con tus prestaciones y precios (Ajustes → Precios y cobro).",
      "Si vienes de otro sistema, Ajustes → Migración de datos importa pacientes y citas desde CSV o Excel, con vista previa y reversa del lote completo.",
      "La puesta en marcha con el equipo de Esmalia activa WhatsApp, el portal de pacientes y efectividad.",
    ],
    pantalla: "ajustes",
    video: {
      estado: "pendiente",
      duracion: "4 min",
      guion:
        "Crear una sucursal con su box y horario, cargar tres prestaciones del arancel e importar un CSV de pacientes con vista previa.",
    },
  },
  {
    id: "dueno-numeros",
    titulo: "Los números de la clínica",
    pistas: ["dueno"],
    minutos: 3,
    cuerpo: [
      "Finanzas resume el período: ingresos, gastos, producción por profesional y conversión de presupuestos.",
      "Informes responde preguntas: cómo vamos, ocupación de la agenda y los boxes, embudo de pacientes, equipo y sucursales. Toda cifra abre sus registros.",
      "Comisiones calcula lo de cada profesional; al cerrar el período, la liquidación queda congelada.",
    ],
    pantalla: "informes",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Recorrer Finanzas del mes, abrir Informes → Cómo vamos y tocar una cifra, y cerrar el período de comisiones.",
    },
  },
  {
    id: "dueno-pacientes-vuelvan",
    titulo: "Que los pacientes vuelvan",
    pistas: ["dueno"],
    minutos: 3,
    cuerpo: [
      "Seguimiento junta tareas, controles pendientes, tratamientos detenidos y riesgo de abandono.",
      "Campañas le escribe a un segmento por correo (sale del servidor) o por WhatsApp (una cola que se despacha a mano) y mide quién volvió.",
      "La reserva en línea deja que los pacientes elijan su hora; cada reserva entra por confirmar.",
    ],
    pantalla: "campanas",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Crear un segmento de pacientes sin visita en 12 meses, lanzarle una campaña por correo y encender la reserva en línea.",
    },
  },

  // ── Profesional ─────────────────────────────────────────────────────────
  {
    id: "profesional-dia",
    titulo: "Tu día como profesional",
    pistas: ["profesional"],
    minutos: 2,
    cuerpo: [
      "Mi agenda muestra solo tus citas: «Por aceptar» (las tentativas, como las reservas en línea) y las de hoy.",
      "Confirmar una cita es tuyo: la recepción la agenda, tú la aceptas.",
    ],
    pantalla: "mi-agenda",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Aceptar una reserva en línea desde Mi agenda y abrir la primera cita del día.",
    },
  },
  {
    id: "profesional-ficha",
    titulo: "La ficha clínica",
    pistas: ["profesional", "asistente"],
    minutos: 4,
    cuerpo: [
      "En el odontograma marcas hallazgos por pieza y cara; con «Seleccionar varias» marcas muchas piezas de una vez. Lo marcado se puede llevar al presupuesto.",
      "Las notas se firman con tu nombre y registro. Una nota firmada no se edita: se corrige con una adenda.",
      "Antecedentes, alergias y signos vitales están en Anamnesis y datos; las alergias aparecen como alerta arriba.",
    ],
    pantalla: "ficha",
    video: {
      estado: "pendiente",
      duracion: "4 min",
      guion:
        "Marcar caries en tres piezas con Seleccionar varias, pasar los hallazgos al presupuesto y firmar una nota con adenda.",
    },
  },
  {
    id: "profesional-documentos",
    titulo: "Recetas y documentos",
    pistas: ["profesional"],
    minutos: 3,
    cuerpo: [
      "Desde la ficha emites recetas (con alerta de alergias), certificados, consentimientos e informes con las plantillas de la clínica.",
      "Lo emitido queda con folio y huella, y se anula con motivo; nunca se borra.",
      "El paciente puede firmar a distancia un documento o aceptar un presupuesto con un enlace de un solo uso.",
    ],
    pantalla: "ficha",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Emitir una receta con alerta de alergia y mandar un consentimiento a firmar a distancia.",
    },
  },
  {
    id: "profesional-desempeno",
    titulo: "Tu desempeño y comisión",
    pistas: ["profesional"],
    minutos: 2,
    cuerpo: [
      "Mi desempeño muestra tu producción y tu comisión estimada del período.",
      "Lo final es la liquidación que cierra la administración: desde ahí ya no cambia.",
    ],
    pantalla: "comisiones",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Abrir Mi desempeño, cambiar el período y ver una liquidación cerrada.",
    },
  },

  // ── Recepción y coordinación ────────────────────────────────────────────
  {
    id: "recepcion-agenda",
    titulo: "La agenda sin errores",
    pistas: ["recepcion"],
    minutos: 4,
    cuerpo: [
      "«Nueva cita» (tecla N): paciente, profesional, tipo, duración y box. Si la hora choca con otra cita o un bloqueo, te lo avisa.",
      "Durante el día: pasar a sala, marcar finalizada o «No asistió» desde el panel de la cita.",
      "«Solicitudes y espera» junta lo que pidieron los pacientes desde el portal y la lista de espera.",
    ],
    pantalla: "agenda",
    video: {
      estado: "pendiente",
      duracion: "4 min",
      guion:
        "Agendar una cita con choque y resolverla, pasar un paciente a sala y agendar una solicitud del portal.",
    },
  },
  {
    id: "recepcion-confirmar",
    titulo: "Confirmar y recordar citas",
    pistas: ["recepcion"],
    minutos: 3,
    cuerpo: [
      "Recordatorios trae los avisos del día listos: cada uno abre WhatsApp con el mensaje y tú lo envías. «Enviar todos» arma una cola, un clic por paciente.",
      "Cuando el paciente responde que va, anótalo en la cita: su confirmación es aparte de la del profesional.",
      "Nada sale solo por WhatsApp.",
    ],
    pantalla: "recordatorios",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Enviar los recordatorios de 48 h con la cola guiada y anotar que un paciente confirmó por teléfono.",
    },
  },
  {
    id: "recepcion-cobrar",
    titulo: "Cobrar y cerrar la caja",
    pistas: ["recepcion"],
    minutos: 4,
    cuerpo: [
      "Abre tu caja con el monto inicial. Se cobra desde la ficha («Cobrar» o ⌘K → Registrar pago); un cobro puede tener varios medios.",
      "Al final del día, el arqueo: cuenta por billete, revisa la diferencia y cierra. Una caja cerrada no se vuelve a abrir.",
      "«Atendidas sin cobro» te recuerda a quién falta cobrarle.",
    ],
    pantalla: "caja",
    video: {
      estado: "pendiente",
      duracion: "4 min",
      guion:
        "Abrir caja, cobrar un pago con dos medios desde la ficha, registrar un retiro y cerrar con arqueo.",
    },
  },
  {
    id: "recepcion-pacientes",
    titulo: "Pacientes al día",
    pistas: ["recepcion"],
    minutos: 3,
    cuerpo: [
      "Al crear un paciente, el RUT se valida y la ficha avisa qué falta completar.",
      "Las etiquetas y los segmentos ordenan la cartera; «Fichas incompletas» muestra a quién le faltan datos.",
      "Las fichas se archivan con motivo; nunca se borran.",
    ],
    pantalla: "pacientes",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion: "Crear un paciente con RUT, completar su previsión y etiquetar fichas incompletas.",
    },
  },

  // ── Asistente dental ────────────────────────────────────────────────────
  {
    id: "asistente-dia",
    titulo: "Tu día como asistente",
    pistas: ["asistente"],
    minutos: 2,
    cuerpo: [
      "Ves la agenda del día para preparar cada box. Cambiarla es de recepción y de los profesionales.",
      "La historia clínica la ves si la clínica te dio acceso clínico; los pagos no son de tu rol.",
    ],
    pantalla: "agenda",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Revisar la agenda del día por box y abrir la ficha del primer paciente.",
    },
  },
  {
    id: "asistente-inventario",
    titulo: "Inventario y laboratorio",
    pistas: ["asistente", "tecnico"],
    minutos: 3,
    cuerpo: [
      "Inventario avisa lo que está bajo el mínimo y los lotes por vencer en 60 días.",
      "Laboratorios muestra cada orden con su estado y su fecha comprometida; las atrasadas se marcan.",
    ],
    pantalla: "inventario",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Registrar una salida de insumo, revisar los lotes por vencer y seguir una orden de laboratorio.",
    },
  },

  // ── Técnico/a dental ────────────────────────────────────────────────────
  {
    id: "tecnico-ordenes",
    titulo: "Las órdenes de laboratorio",
    pistas: ["tecnico"],
    minutos: 3,
    cuerpo: [
      "Cada orden trae el trabajo, el color VITA, el material, el margen y la fecha comprometida.",
      "El estado (enviado, en proceso, recibido, reprocesar) lo ve todo el equipo y las órdenes atrasadas se marcan.",
      "En Inventario puedes ver el stock; los movimientos los registran propietario, administración, profesionales y asistentes.",
    ],
    pantalla: "laboratorios",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion: "Abrir una orden, revisar color y margen y seguir su estado hasta recibido.",
    },
  },
];
