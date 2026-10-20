import type { PaginaContenido } from "../tipos";

// Hub de IA (plan SEO/GEO, semanas 9 a 13). Todo lo que dice de Esmalia sale
// de docs/IA.md, src/lib/ai/ y funciones-patty-ia.ts al 20-oct-2026: Patty
// está pausada (AI_ENABLED apagado) y acá se cuenta en futuro. Si Patty
// vuelve, esta página se actualiza junto con las que lista docs/IA.md.

export const pagina: PaginaContenido = {
  coleccion: "guias",
  path: "/guias/ia-en-odontologia",
  titulo: "IA en odontología: cómo la usa Esmalia | Esmalia",
  descripcion:
    "Cómo usa Esmalia la inteligencia artificial en la clínica dental: dónde entra Patty, por qué está en habilitación, qué datos ve y qué preguntar antes de usar IA.",
  kicker: "Guías",
  h1: "IA en odontología: cómo la usa Esmalia y qué preguntar antes de usarla",
  resumen:
    "Esmalia usa IA en un solo lugar: Patty, que redactará notas clínicas a partir de tus apuntes y leerá los pedidos de hora que las reglas no entienden. Hoy Patty está en habilitación: no envía ningún dato a un modelo hasta tenerla sobre un proveedor con contrato para datos de salud. Agenda, recordatorios, odontograma, presupuestos y cobros funcionan sin IA.",
  publicado: "2026-10-20",
  actualizado: "2026-10-20",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Dónde usa IA Esmalia?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**Patty está en habilitación.** Hoy no redacta, no resume ni lee mensajes, y Esmalia no le envía nada a un proveedor de IA. La pausamos hasta tenerla sobre un proveedor con contrato de tratamiento de datos de salud. Lo que sigue describe cómo va a trabajar cuando vuelva.",
        },
        {
          tipo: "tabla",
          columnas: ["Parte de Esmalia", "¿Usa IA?", "Estado hoy"],
          filas: [
            [
              "Notas clínicas: redactar en formato SOAP, pulir, resumir y estructurar",
              "Sí: Patty",
              "En habilitación. El editor de notas funciona igual, sin IA.",
            ],
            [
              "Respuestas de pacientes por WhatsApp",
              "Primero reglas fijas; Patty solo si las reglas no alcanzan",
              "Reglas activas. Patty en habilitación, y la conexión del número con Meta también.",
            ],
            ["Agenda y recordatorios", "No", "Activo. Los arma Esmalia y los envía tu equipo."],
            ["Odontograma y periodontograma", "No", "Activo."],
            ["Presupuestos, cobros, caja y comisiones", "No", "Activo."],
          ],
          nota: "Fuente: el código de Esmalia al 20-oct-2026. Ninguna otra parte del producto llama a un modelo de IA.",
        },
      ],
    },
    {
      h2: "¿Qué hará Patty cuando vuelva?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Redactar una nota SOAP** a partir de tus apuntes. Lo que falte queda como “no consignado”, en vez de inventarlo.",
            "**Pulir** la redacción y la ortografía de una nota, sin agregar hechos.",
            "**Resumir** la nota en un párrafo corto para la próxima consulta.",
            "**Estructurar** diagnósticos, tratamientos, medicamentos y alergias, que quedan sin confirmar hasta que alguien los valida.",
            "**Leer pedidos de hora** por WhatsApp que las reglas no entienden con confianza, y dejar una solicitud pendiente o un aviso para el equipo.",
          ],
        },
        {
          tipo: "p",
          texto:
            "El detalle de cada acción, qué recibe y qué devuelve, está en [Patty, la IA de Esmalia](/funciones/patty-ia).",
        },
      ],
    },
    {
      h2: "¿Qué reglas sigue la IA de Esmalia?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Propone, no decide.** El texto de Patty aparece como borrador en el editor. Se guarda cuando tú guardas, y la versión queda marcada como asistida por IA. Firmar es de los profesionales.",
            "**No le escribe a pacientes.** No existe un camino por el que la IA envíe un mensaje. Todo WhatsApp lo dispara una persona.",
            "**No confirma, mueve ni cancela citas.** Como mucho deja una solicitud pendiente o un aviso al equipo.",
            "**No diagnostica ni prescribe.** Trabaja sobre lo que registró el profesional y no da diagnósticos definitivos.",
            "**Ve lo mínimo.** Antes de enviar el texto, Esmalia le quita el nombre, el documento, el teléfono y el email del paciente. El contexto lleva un tramo de edad (por ejemplo, 40-49 años), no la edad exacta.",
            "**Deja registro.** Cada uso de la IA en una nota queda en la auditoría de esa nota, y ese registro lo escribe la base de datos.",
            "**Solo roles clínicos.** En las notas, solo propietario, administración, doctores y asistentes podrán usarla.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "**Un límite que conviene conocer:** el filtro quita los datos del paciente de la ficha y cualquier email, RUT, CURP o número largo escrito a mano, pero no reconoce el nombre de un tercero escrito en los apuntes (por ejemplo, “vino con su hija Ana”). Escribe los apuntes sin nombres de terceros.",
        },
      ],
    },
    {
      h2: "¿Por qué Patty está en habilitación?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Porque las notas clínicas son datos de salud, y no queremos que salgan de Esmalia hacia un proveedor de IA que no tenga un contrato que los cubra. Antes de volver a encenderla, el proveedor tiene que cumplir cuatro condiciones: contrato de tratamiento de datos de salud, región definida, sin uso de los datos para entrenar modelos (confirmado por contrato) y revisión legal del uso. Además, la vamos a probar con casos inventados, nunca con datos reales de pacientes.",
        },
        {
          tipo: "p",
          texto:
            "Mientras tanto, nada cambia en tu trabajo diario: escribes, guardas y firmas las notas igual que siempre, y los mensajes de WhatsApp que las reglas no entienden llegan directo a tu equipo.",
        },
      ],
    },
    {
      h2: "¿Qué preguntar antes de usar IA en tu clínica dental?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Sirve para Esmalia y para cualquier otro software o asistente de IA. Si el proveedor no puede contestar alguna, es una señal.",
        },
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "¿Qué datos del paciente se envían al modelo? ¿Van el nombre, el documento o el teléfono?",
            "¿Quién es el proveedor del modelo y hay un contrato de tratamiento de datos que cubra datos de salud?",
            "¿Usan tus datos o los de tus pacientes para entrenar modelos?",
            "¿En qué región se procesan los datos?",
            "¿La IA puede escribirle a un paciente, confirmar una cita o cambiar la agenda sin que una persona lo apruebe?",
            "¿Lo que redacta la IA se guarda solo o queda como borrador hasta que lo revisas?",
            "¿Queda registro de qué hizo la IA, en qué nota y cuándo?",
            "¿Se puede apagar, y qué pasa con tu trabajo si se apaga?",
          ],
        },
        {
          tipo: "p",
          texto:
            "Nuestras respuestas están en esta página, en [Patty, la IA de Esmalia](/funciones/patty-ia) y en [datos y seguridad](/docs/datos-y-seguridad). El acuerdo de tratamiento de datos está en el [DPA](/dpa).",
        },
      ],
    },
    {
      h2: "¿Qué no hace la IA de Esmalia?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "No analiza radiografías ni fotos, no diagnostica, no prescribe, no firma notas, no le escribe a pacientes y no mueve la agenda. Tampoco funciona sin internet, porque corre en el servidor. Y hoy, mientras está en habilitación, no hace nada: el resto de Esmalia funciona sin ella.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Esmalia tiene inteligencia artificial?",
      a: "Sí, se llama Patty, pero está en habilitación: hoy no está activa. Cuando vuelva, redactará y resumirá notas clínicas y leerá pedidos de hora por WhatsApp que las reglas no entienden. El resto de Esmalia funciona sin IA.",
    },
    {
      q: "¿La IA de Esmalia ve los datos de mis pacientes?",
      a: "Hoy no ve nada, porque está pausada. Cuando vuelva, recibirá solo lo que la tarea necesita: tus apuntes o la nota y un contexto breve, sin nombre, documento, teléfono ni email del paciente.",
    },
    {
      q: "¿Puedo usar Esmalia sin la IA?",
      a: "Sí. Hoy todas las clínicas la usan así. Agenda, ficha clínica, odontograma, presupuestos, cobros y recordatorios no dependen de la IA.",
    },
    {
      q: "¿La IA de Esmalia reemplaza al odontólogo?",
      a: "No. Propone borradores y extrae datos para que los confirmes. No diagnostica, no prescribe y no firma: la decisión clínica es siempre del profesional.",
    },
    {
      q: "¿Cuándo vuelve Patty?",
      a: "Cuando esté sobre un proveedor de IA con contrato para datos de salud, región definida y sin entrenamiento con tus datos, y haya pasado pruebas con casos inventados. No tiene fecha comprometida.",
    },
  ],
  relacionados: [
    "/funciones/patty-ia",
    "/funciones/ficha-clinica",
    "/funciones/recordatorios-whatsapp",
    "/docs/datos-y-seguridad",
  ],
  enUnaLinea:
    "Cómo usa Esmalia la IA (Patty, hoy en habilitación): dónde entra, qué datos ve, qué reglas sigue y qué preguntar antes de usar IA en una clínica dental.",
};
