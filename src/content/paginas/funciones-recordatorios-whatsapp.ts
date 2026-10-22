import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "funciones",
  path: "/funciones/recordatorios-whatsapp",
  titulo: "Recordatorios por WhatsApp para dentistas | Esmalia",
  descripcion:
    "Esmalia arma la cola de recordatorios por WhatsApp 48 h y 3 h antes de cada cita. Tu equipo los revisa y los envía con un toque desde una sola lista.",
  kicker: "Funciones",
  h1: "Recordatorios por WhatsApp para clínicas dentales",
  resumen:
    "Esmalia no manda recordatorios solos. Cada cita entra a una cola 48 horas y 3 horas antes; alguien de la clínica revisa la lista y envía cada mensaje con un toque, por wa.me o desde el número propio de la clínica conectado a Meta. Ningún mensaje sale sin que una persona lo dispare.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Cómo funcionan los recordatorios por WhatsApp en Esmalia?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Esmalia no tiene un robot que le escriba a tus pacientes. Lo que hace es armar la lista de a quién hay que escribirle y dejar el mensaje listo. El envío lo hace una persona de la clínica, con un toque por paciente.",
        },
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "**Agendas la cita.** La hora queda en el huso de la sucursal, así que el mensaje dice la hora local del paciente.",
            "**La cita entra a la cola.** Cuando faltan unas 48 horas aparece en la pantalla Recordatorios como recordatorio; cuando faltan unas 3 horas, como aviso previo. La lista se actualiza sola cada minuto.",
            "**El mensaje sale de una plantilla.** Lleva el nombre del paciente, el tratamiento, la fecha escrita completa, la hora, el profesional y el nombre de la clínica.",
            "**Alguien presiona WhatsApp.** En modo manual se abre WhatsApp con el texto ya escrito y tú presionas enviar. Con el número conectado, el mensaje sale desde el número de la clínica.",
            "**La cita sale de la cola.** Si el paciente no tiene teléfono cargado, la fila lo dice en rojo en vez de fallar en silencio.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Para que nadie dependa de acordarse de entrar, el equipo recibe por la mañana, antes del mediodía en la hora de la clínica, un resumen dentro de la app con lo que quedó pendiente. Ese resumen no le escribe a ningún paciente: solo avisa al equipo, y si no hay nada pendiente no llega.",
        },
      ],
    },
    {
      h2: "¿Qué diferencia hay entre el modo manual y el número conectado?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**Hoy Esmalia envía en modo manual.** Conectar el número propio de la clínica a WhatsApp Business (Meta) está en habilitación: el código está listo y falta la aprobación de Meta. Mientras tanto, todo lo de esta página funciona con el modo manual.",
        },
        {
          tipo: "tabla",
          columnas: [
            "Aspecto",
            "Modo manual (wa.me), disponible hoy",
            "Número conectado (Meta), en habilitación",
          ],
          filas: [
            [
              "Configuración",
              "Ninguna, funciona desde el primer día",
              "Vincular el WhatsApp Business de la clínica desde Conectar número",
            ],
            [
              "Desde qué número sale",
              "El WhatsApp que tengas abierto en ese equipo",
              "El número de la clínica, con plantillas aprobadas por Meta",
            ],
            ["Quién presiona enviar", "Tú, dentro de WhatsApp", "Tú, dentro de Esmalia"],
            [
              "Respuestas del paciente",
              "Llegan a tu WhatsApp, no a Esmalia",
              "Quedan en la conversación del paciente en Esmalia",
            ],
            [
              "Estado del mensaje",
              "En cola: Esmalia sabe que se abrió el link, no que se envió",
              "Enviado, entregado, leído o fallido, según informa Meta",
            ],
            ["Si algo falla", "No aplica", "Cae solo al modo manual, sin bloquear el envío"],
          ],
          nota: "Durante la prueba gratis, el número conectado se habilita al agendar la llamada de puesta en marcha o al suscribirte. El modo manual queda siempre como respaldo.",
        },
        {
          tipo: "p",
          texto:
            "El paso a paso para conectar el número está en [Conectar WhatsApp](/docs/whatsapp).",
        },
      ],
    },
    {
      h2: "¿Qué pasa cuando el paciente responde?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Con el número conectado, las respuestas llegan a Esmalia y se guardan en la conversación del paciente. Esmalia intenta entenderlas, pero ninguna respuesta cambia la agenda por sí sola:",
        },
        {
          tipo: "lista",
          items: [
            "**“Sí”, “confirmo”, “ahí voy”.** Se anota que el paciente avisó que viene y el equipo recibe el aviso. La cita no pasa a confirmada: eso lo decide el profesional desde la agenda. Una respuesta con signo de pregunta o que empieza con “no” no cuenta.",
            "**“¿Tienen hora para el jueves en la tarde?”.** Se lee como pedido de hora. Si trae una fecha clara, queda como solicitud pendiente en la agenda, con un tope de 3 por paciente cada 24 horas.",
            "**“Quiero cancelar mi hora”.** El equipo recibe el aviso con el texto original. No se cancela nada solo.",
            "**BAJA o STOP.** El paciente queda marcado como baja de WhatsApp y el equipo lo ve en el aviso.",
            "**Un número que no es paciente.** Queda guardado como lead nuevo para que alguien lo revise.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Cuando un mensaje no calza con ninguna regla, queda en la bandeja para una persona. Más adelante lo podrá leer [Patty, la IA de Esmalia](/funciones/patty-ia), hoy en habilitación; si tampoco lo entiende con confianza, seguirá quedando para una persona.",
        },
      ],
    },
    {
      h2: "¿Qué otros mensajes salen de la misma cola?",
      bloques: [
        {
          tipo: "p",
          texto:
            "La pantalla Recordatorios también junta pacientes candidatos a otros mensajes. Se envían igual: con un toque y revisados por alguien del equipo.",
        },
        {
          tipo: "lista",
          items: [
            "Llamado a control de higiene a quien lleva unos 6 meses sin venir.",
            "Pedido de reseña después de una visita.",
            "Aviso de saldo pendiente.",
            "Seguimiento de un presupuesto enviado que lleva 7 días sin respuesta.",
            "Saludo de cumpleaños.",
            "Seguimiento después de un tratamiento.",
            "Invitación a referir, con el código del paciente.",
            "Encuesta de satisfacción.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Estos mensajes respetan el permiso de WhatsApp de cada paciente. Si buscas textos de ejemplo, revisa las [plantillas de WhatsApp para clínicas dentales](/plantillas/whatsapp-clinica-dental).",
        },
      ],
    },
    {
      h2: "¿Para quién es y en qué plan está?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Sirve igual para un consultorio de un profesional que para una clínica con recepción. La pantalla la usan quienes gestionan la agenda: propietario, administración, doctores y recepción. Los recordatorios por WhatsApp vienen desde el plan Solo (US$29 al mes) y están en todos los planes. Revisa el detalle en [precios](/precios) o entra a la [demo](/demo).",
        },
      ],
    },
    {
      h2: "¿Qué no hace?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**Esmalia no envía recordatorios automáticos.** Ningún mensaje a pacientes sale sin que alguien de la clínica lo dispare, en ningún modo. Tampoco confirma citas en nombre del paciente ni cancela horas por un mensaje. En modo manual no ve las respuestas: llegan a tu WhatsApp, no a Esmalia. Y sin internet no se puede enviar nada; la app lo avisa en el momento.",
        },
        {
          tipo: "p",
          texto:
            "Sobre resultados: Esmalia no promete un porcentaje de baja en las inasistencias. La pantalla Efectividad compara ausencias con y sin recordatorio sobre 90 días de datos de tu clínica y aclara que es una comparación observacional. Con menos de 20 casos muestra el conteo, no un porcentaje. Más contexto en la [guía de inasistencias](/guias/inasistencias-clinica-dental).",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Esmalia manda los recordatorios de WhatsApp de forma automática?",
      a: "No. Esmalia calcula qué citas necesitan recordatorio 48 horas y 3 horas antes y las pone en una lista. Una persona de la clínica envía cada mensaje con un toque. Es una decisión de producto: nada sale a nombre de tu clínica sin que alguien lo vea.",
    },
    {
      q: "¿Necesito la API de WhatsApp Business para usar los recordatorios?",
      a: "No. El modo manual funciona desde el primer día con cualquier WhatsApp: Esmalia abre la conversación con el texto ya escrito. Conectar el número de la clínica vía Meta es opcional y sirve para que los mensajes salgan desde ese número y las respuestas lleguen a Esmalia.",
    },
    {
      q: "¿Qué pasa si el paciente responde “sí” al recordatorio?",
      a: "Con el número conectado, Esmalia anota que el paciente avisó que viene y le avisa al equipo. La cita no queda confirmada por eso: confirmarla es una decisión del profesional desde la agenda.",
    },
    {
      q: "¿Los recordatorios funcionan sin internet?",
      a: "No. La agenda, los cobros y las notas sí se pueden usar sin conexión, pero enviar un WhatsApp necesita internet. La app lo avisa en vez de fallar en silencio. Más en [Esmalia sin internet](/funciones/sin-internet).",
    },
    {
      q: "¿Cuánto cuesta tener recordatorios por WhatsApp en Esmalia?",
      a: "Vienen incluidos desde el plan Solo, US$29 al mes, con 14 días gratis sin tarjeta. El modo manual no suma costos de mensajería: envías desde tu propio WhatsApp.",
    },
  ],
  relacionados: [
    "/plantillas/whatsapp-clinica-dental",
    "/guias/inasistencias-clinica-dental",
    "/funciones/patty-ia",
    "/funciones/sin-internet",
  ],
  enUnaLinea:
    "Cola de recordatorios por WhatsApp 48 h y 3 h antes de cada cita, enviados con un toque por el equipo.",
};
