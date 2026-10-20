import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "funciones",
  path: "/funciones/patty-ia",
  titulo: "Patty: IA para dentistas con límites claros | Esmalia",
  descripcion:
    "Patty, la IA de Esmalia, está en habilitación. Pasará tus apuntes a una nota SOAP y resumirá la nota. No firma, no escribe a pacientes ni mueve la agenda.",
  kicker: "Funciones",
  h1: "Patty, la IA de Esmalia para dentistas: qué hace y qué no",
  resumen:
    "Patty, la IA de Esmalia, está en habilitación: la pausamos hasta tenerla sobre un proveedor de IA con contrato para datos de salud. Cuando vuelva, redactará una nota SOAP a partir de tus apuntes, pulirá la redacción, resumirá la nota y extraerá diagnósticos, tratamientos, medicamentos y alergias para que los confirmes. Propone; el profesional revisa y firma. Mientras tanto, las notas clínicas funcionan igual, sin IA.",
  publicado: "2026-10-11",
  actualizado: "2026-10-19",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué hará Patty dentro de Esmalia?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**Patty está en habilitación.** Hoy no redacta, no resume ni lee mensajes: la pausamos hasta tenerla sobre un proveedor de IA con contrato de tratamiento de datos de salud. El editor de notas clínicas funciona igual, sin IA. Abajo está lo que hará cuando vuelva y con qué límites.",
        },
        {
          tipo: "p",
          texto:
            "Patty es el nombre de la IA de Esmalia. Trabajará en dos lugares: el editor de notas clínicas y los mensajes de WhatsApp que llegan al número conectado de la clínica (que también está en habilitación con Meta). En la interfaz, lo que hizo Patty se ve en color violeta, y ese color no significa otra cosa.",
        },
        {
          tipo: "tabla",
          columnas: ["Acción", "Qué recibe", "Qué devuelve"],
          filas: [
            [
              "Redactar nota SOAP",
              "Tus apuntes, un contexto breve del paciente y la plantilla, si elegiste una",
              "Una nota en Subjetivo, Objetivo, Análisis y Plan. Lo que falta queda como “no consignado”.",
            ],
            [
              "Pulir",
              "La nota escrita",
              "La misma nota con mejor redacción y ortografía, sin hechos nuevos.",
            ],
            [
              "Resumir",
              "La nota",
              "Un párrafo de hasta 80 palabras y tres puntos: hallazgos, procedimiento y próximo paso.",
            ],
            [
              "Estructurar",
              "La nota",
              "Diagnósticos, tratamientos, medicamentos y alergias, con pieza FDI y nivel de confianza, para confirmarlos uno por uno.",
            ],
            [
              "Leer pedidos de hora",
              "Un mensaje de WhatsApp de hasta 500 caracteres y la fecha de hoy en la clínica",
              "Si el paciente pide, mueve o cancela una hora, para qué día y en qué franja.",
            ],
          ],
          nota: "El contexto del paciente lleva tramo de edad, etiquetas, última visita y los últimos eventos de su ficha. Nunca nombre, documento, teléfono ni email: Esmalia los quita del texto antes de enviarlo.",
        },
      ],
    },
    {
      h2: "¿Cuáles son los límites de Patty?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**No firma.** El texto de Patty aparece en el editor como borrador. Se guarda cuando tú guardas, y firmar es de doctores y administración. La versión queda marcada como asistida por IA.",
            "**No le escribe a pacientes.** No existe un camino por el que Patty mande un mensaje. Todo WhatsApp lo dispara una persona.",
            "**No mueve la agenda.** Si lee que un paciente pide hora con una fecha clara, deja una solicitud pendiente en la agenda, igual que las reglas. Mover o cancelar solo genera un aviso al equipo. Nunca confirma una cita.",
            "**No diagnostica.** Sus instrucciones le prohíben inventar datos, dar diagnósticos definitivos o prescribir. Redacta a partir de lo que registró el profesional y pone un código clínico solo si aparece escrito en la nota.",
            "**Lo que extrae no vale hasta que lo confirmas.** Cada diagnóstico o alergia estructurada queda sin confirmar; lo validas o lo borras.",
            "**Queda registro.** Cada uso de la IA en una nota se anota en la auditoría de esa nota, y ese registro lo escribe la base de datos.",
          ],
        },
      ],
    },
    {
      h2: "¿Por qué las reglas leen primero los mensajes de WhatsApp?",
      bloques: [
        {
          tipo: "p",
          texto:
            "La mayoría de los mensajes de pacientes son cortos y previsibles, del tipo “quiero hora para el jueves en la tarde”. Esmalia los lee con reglas fijas, que no cuestan nada y responden siempre igual. Patty entrará solo cuando las reglas no puedan leer el mensaje con confianza, por ejemplo si es largo o ambiguo. Si Patty tampoco está segura, no hará nada y el mensaje quedará para que lo lea una persona. Hoy, con Patty en habilitación, ese mensaje llega directo al equipo.",
        },
        {
          tipo: "p",
          texto:
            "La razón es que los dos errores no cuestan lo mismo. Un mensaje que queda en la bandeja se resuelve leyéndolo. Una solicitud de hora que el paciente nunca pidió hace que alguien de la clínica pierda tiempo llamándolo. Cuando la lectura viene de Patty, el aviso al equipo empieza con “Patty leyó:”, para que se sepa quién la interpretó. Más sobre este circuito en [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
        },
      ],
    },
    {
      h2: "¿Qué datos ve Patty y adónde van?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Hoy ninguno: con Patty en habilitación, Esmalia no envía nada a un proveedor de IA. Cuando vuelva, lo hará a un proveedor con contrato de tratamiento de datos, región definida y sin uso de los datos para entrenar modelos, y solo con lo que la tarea necesita: tus apuntes o la nota y el contexto breve del paciente, sin nombre, documento, teléfono ni email. Para leer un pedido de hora, el texto del mensaje y la fecha. En las notas, solo los roles clínicos podrán usar Patty: propietario, administración, doctores y asistentes. Más sobre el manejo de datos en [datos y seguridad](/docs/datos-y-seguridad), y qué preguntarle a cualquier proveedor de IA en [IA en odontología](/guias/ia-en-odontologia).",
        },
      ],
    },
    {
      h2: "¿En qué plan está Patty?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Cuando vuelva, las funciones de notas estarán en la [ficha clínica](/funciones/ficha-clinica), que viene en todos los planes desde Solo (US$29 al mes), sin costo extra. La lectura de WhatsApp necesitará además el número de la clínica conectado a Meta. Mientras Patty está en habilitación, el editor lo dice y el mensaje de WhatsApp llega al equipo con el aviso de siempre. Revisa los [precios](/precios).",
        },
      ],
    },
    {
      h2: "¿Qué no hace?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**Patty propone, no decide.** No firma notas, no le escribe a ningún paciente, no confirma, mueve ni cancela citas y no toma decisiones clínicas. No reemplaza tu criterio: revisa siempre lo que redacta antes de guardar. Tampoco funciona sin internet, porque corre en el servidor.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Patty puede hacer diagnósticos?",
      a: "No. Redacta, pule, resume y ordena lo que tú registraste. Tiene prohibido dar diagnósticos definitivos o prescripciones, y lo que estructura queda sin confirmar hasta que lo validas.",
    },
    {
      q: "¿Patty confirma citas por WhatsApp?",
      a: "No. Puede leer que un paciente pide, mueve o cancela una hora y avisarle al equipo. Lo más que hace es dejar una solicitud pendiente en la agenda cuando el paciente pide hora con una fecha clara. Confirmar es del profesional.",
    },
    {
      q: "¿Lo que escribe Patty se guarda solo?",
      a: "No. El texto aparece en el editor con el aviso “Revisa y ajusta antes de guardar”. Se guarda cuando tú guardas, como una versión nueva marcada como asistida por IA.",
    },
    {
      q: "¿Qué pasa si Patty extrae mal un diagnóstico?",
      a: "Lo borras o no lo confirmas. Los campos extraídos por IA quedan pendientes hasta que alguien los valida, y cada confirmación o borrado queda en la auditoría de la nota.",
    },
    {
      q: "¿Qué modelo de IA usa Patty?",
      a: "Hoy ninguno: Patty está en habilitación. Volverá sobre un proveedor con contrato de tratamiento de datos de salud, región definida y sin entrenamiento con tus datos. El modelo cambia cómo se escribe el texto, no los límites: esos están en el código de Esmalia.",
    },
  ],
  relacionados: [
    "/funciones/ficha-clinica",
    "/funciones/recordatorios-whatsapp",
    "/funciones/odontograma",
    "/guias/ia-en-odontologia",
  ],
  enUnaLinea:
    "Patty, la IA de Esmalia (en habilitación): redactará notas SOAP y resumirá la nota clínica. No firma ni decide.",
};
