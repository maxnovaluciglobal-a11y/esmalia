import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "funciones",
  path: "/funciones/sin-internet",
  titulo: "Software dental que funciona sin internet | Esmalia",
  descripcion:
    "Esmalia sigue funcionando si se corta internet: agendas, cobras y escribes notas, y todo se sincroniza solo al volver la conexión, sin duplicados.",
  kicker: "Funciones",
  h1: "Software dental que sigue funcionando sin internet",
  resumen:
    "Sí. Si se corta internet, Esmalia sigue abierta: puedes agendar, cambiar el estado de una cita, cobrar, guardar notas clínicas, marcar el odontograma y editar la anamnesis. Todo queda en una cola en el equipo y se sincroniza solo, en orden, cuando vuelve la conexión. Enviar WhatsApp y crear presupuestos sí necesitan internet.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué puedes hacer en Esmalia sin internet?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Esmalia funciona en el navegador, pero no se detiene cuando se cae el wifi. Para usarla sin conexión tienes que haber entrado antes con tu usuario en ese equipo. Desde ahí, esto es lo que pasa:",
        },
        {
          tipo: "tabla",
          columnas: ["Acción", "Sin internet", "Qué pasa al volver la conexión"],
          filas: [
            ["Ver la agenda y buscar pacientes", "Sí", "Se actualiza con lo último del servidor."],
            [
              "Agendar una cita",
              "Sí, queda en cola",
              "Se crea; si choca con otra del mismo profesional, te avisa.",
            ],
            [
              "Cambiar el estado de una cita",
              "Sí, queda en cola",
              "Se aplica en el orden en que lo hiciste.",
            ],
            [
              "Registrar un cobro",
              "Sí, queda en cola",
              "Se guarda con la hora en que cobraste, sin duplicarse.",
            ],
            [
              "Guardar una nota clínica",
              "Sí, queda en cola",
              "Si alguien editó la misma nota, eliges cuál vale.",
            ],
            [
              "Marcar el odontograma",
              "Sí, queda en cola",
              "Igual que la nota, por pieza y superficie.",
            ],
            [
              "Editar alergias, medicación y antecedentes",
              "Sí, queda en cola",
              "Se sincroniza solo.",
            ],
            ["Enviar un WhatsApp", "No", "La app lo avisa en el momento."],
            ["Crear un presupuesto", "No", "La app lo avisa en el momento."],
            ["Usar Patty, la IA", "No", "Corre en el servidor."],
          ],
          nota: "La agenda, los pacientes, los profesionales, las sucursales, las prestaciones y la lista de espera quedan guardados en el equipo hasta por 7 días.",
        },
      ],
    },
    {
      h2: "¿Cómo sabe Esmalia que se cortó internet?",
      bloques: [
        {
          tipo: "p",
          texto:
            "No le cree solo al navegador. Un computador puede estar conectado a un wifi cuyo router no tiene salida a internet, y el sistema igual dice que hay red. Por eso Esmalia prueba si el servidor responde: cada 45 segundos cuando hay conexión y cada 10 cuando no. Si no responde, aparece una franja que dice qué puedes seguir haciendo y de qué hora es la información que estás viendo.",
        },
      ],
    },
    {
      h2: "¿Cómo se sincroniza cuando vuelve la conexión?",
      bloques: [
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "**Sola.** Nadie tiene que apretar nada, y la app muestra cuántas operaciones faltan por subir.",
            "**En orden.** Las operaciones suben en el orden en que se hicieron. Un cobro y el cambio de estado de la misma cita llegan como pasaron.",
            "**Sin duplicados.** Cada operación lleva un identificador creado en el equipo. Si la subida se reintenta, el servidor reconoce que ya la tenía.",
            "**Idéntica.** Lo que sube es exactamente lo que se habría enviado con conexión, sin recalcular montos ni fechas.",
            "**Con los errores a la vista.** Si el servidor rechaza algo por una regla de negocio o por permisos, queda marcado como fallido para que alguien lo revise, en vez de reintentarse para siempre.",
          ],
        },
      ],
    },
    {
      h2: "¿Qué pasa si dos personas cambian lo mismo?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Mientras un equipo estaba sin internet, alguien en otro pudo editar la misma nota o marcar la misma pieza. Esmalia no deja que una versión pise a la otra en silencio. La edición sin conexión se guarda igual, pero va a una bandeja de Conflictos con las dos versiones a la vista. El profesional elige: quedarse con la suya o con la que ya estaba. En las notas clínicas, el choque además queda anotado en la auditoría.",
        },
      ],
    },
    {
      h2: "¿Es seguro usarlo en un computador compartido?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "Lo guardado para consultar pertenece al usuario que lo guardó. Si entra otra persona en ese equipo, se descarta en vez de mostrarle datos de un colega.",
            "Al cerrar sesión se borra lo guardado para consultar.",
            "La cola de cobros y citas pendientes no se borra al cerrar sesión: son cosas que ya pasaron frente al paciente. Se suben cuando quien las registró vuelve a entrar.",
            "Las notas clínicas, el odontograma, los pagos, los presupuestos y los mensajes quedan fuera de lo que se guarda para consultar. En el equipo solo quedan las ediciones que hiciste sin conexión, hasta que se suben.",
          ],
        },
      ],
    },
    {
      h2: "¿Por qué importa esto en una clínica dental?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Un corte de internet en plena jornada deja a recepción sin agenda y al profesional sin la ficha. Un programa instalado en un solo computador sigue funcionando, pero los datos viven en esa máquina. Un sistema en la nube tiene los datos disponibles desde cualquier equipo, pero suele necesitar conexión: Dentalink, por ejemplo, dice en su web que funciona 100 % en la nube y, en su página de planes, que una conexión estable de 2 Mbps es suficiente (revisado el 11-oct-2026). Para una clínica con buena conexión eso no es un problema. Esmalia apuesta por las dos cosas: los datos en la nube y la jornada sin cortes.",
        },
      ],
    },
    {
      h2: "¿En qué plan está?",
      bloques: [
        {
          tipo: "p",
          texto:
            "En todos, desde Solo (US$19,99 al mes), sin configurar nada. Si quieres, instalas Esmalia desde el navegador y queda como una aplicación más, sin pasar por ninguna tienda. Revisa los [precios](/precios) o mira la app por dentro en la [demo](/demo).",
        },
      ],
    },
    {
      h2: "¿Qué no hace?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**No es un programa de escritorio.** La primera vez necesitas internet para entrar, y lo guardado para consultar caduca a los 7 días. Sin conexión no se envían WhatsApp, no se crean presupuestos y no funcionan Patty ni los reportes. Si recargas la página sin internet, verás la agenda y los pacientes, pero no las notas, el odontograma ni los pagos anteriores. Y la cola vive en el navegador de ese equipo: si borras los datos del navegador antes de que se sincronice, lo pendiente se pierde.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "Si cobro sin internet, ¿se puede duplicar el pago?",
      a: "No. Cada cobro lleva un identificador generado en el equipo; si la sincronización se reintenta, el servidor sabe que ya lo guardó. Además queda con la hora en que cobraste, así que el cierre de caja del día cuadra.",
    },
    {
      q: "¿Cuánto tiempo puedo trabajar sin conexión?",
      a: "Lo que registres queda en cola hasta que vuelva internet, sin fecha de vencimiento. Lo guardado para consultar (agenda, pacientes, profesionales) se descarta después de 7 días.",
    },
    {
      q: "¿Qué pasa si cierro sesión con cosas sin sincronizar?",
      a: "No se pierden. La cola sobrevive al cierre de sesión y se sube cuando la misma persona vuelve a entrar en ese equipo.",
    },
    {
      q: "¿Funciona sin internet desde el celular?",
      a: "Sí, desde el navegador del celular funciona igual. Cada equipo tiene su propia cola, así que lo pendiente se sube desde el equipo donde se registró.",
    },
    {
      q: "¿Tengo que instalar algo para usar Esmalia sin conexión?",
      a: "No. Funciona desde el navegador. Si quieres, la instalas desde el mismo navegador y queda con su ícono, sin tienda de aplicaciones.",
    },
  ],
  fuentes: [
    { titulo: "Dentalink: inicio", url: "https://www.softwaredentalink.com/" },
    {
      titulo: "Dentalink: planes y preguntas frecuentes",
      url: "https://www.softwaredentalink.com/planes",
    },
  ],
  relacionados: [
    "/funciones/ficha-clinica",
    "/funciones/odontograma",
    "/funciones/recordatorios-whatsapp",
    "/alternativas/dentalink",
  ],
  enUnaLinea:
    "Agenda, cobros, notas y odontograma siguen funcionando sin internet y se sincronizan solos, sin duplicados.",
};
