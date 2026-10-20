import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "para",
  path: "/para/clinica-dental",
  titulo: "Software para clínica dental con equipo | Esmalia",
  descripcion:
    "Software para clínicas dentales de hasta 3 profesionales: roles por persona, comisiones, portal de pacientes y una agenda por profesional. US$69/mes.",
  kicker: "Para clínicas",
  h1: "Software para clínicas dentales con equipo",
  resumen:
    "Una clínica con varios profesionales necesita que cada persona vea solo lo suyo, que las comisiones se calculen sin planilla y que la agenda muestre a cada profesional por separado. El plan Clínica de Esmalia cubre eso para hasta 3 profesionales por US$69 al mes, con 14 días gratis y sin tarjeta.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué cambia cuando la clínica tiene equipo?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Con un solo dentista, el software es una agenda con fichas. Con tres profesionales, una recepcionista y alguien que lleva las cuentas aparecen preguntas nuevas: quién puede ver la historia clínica, cuánto le toca a cada profesional y cómo se reparte la agenda. El plan Clínica suma a lo del plan Solo tres cosas: **roles, comisiones y portal de pacientes**.",
        },
      ],
    },
    {
      h2: "¿Qué puede ver cada persona del equipo?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Cada persona entra con su usuario y un rol. El rol define qué ve y qué puede hacer, y no es solo la pantalla: la base de datos también lo verifica.",
        },
        {
          tipo: "tabla",
          columnas: ["Rol", "Qué hace", "Qué no ve"],
          filas: [
            ["Propietario", "Control total: clínica, equipo y suscripción", "Nada le queda oculto"],
            [
              "Administrador",
              "Gestiona clínica, equipo, agenda, pacientes y finanzas",
              "Nada le queda oculto",
            ],
            [
              "Doctor/a",
              "Agenda, pacientes, historia clínica y su propia comisión",
              "Finanzas de la clínica y comisiones de otros",
            ],
            [
              "Asistente dental",
              "Apoyo clínico: agenda y ficha básica del paciente",
              "Finanzas y caja",
            ],
            [
              "Recepción",
              "Agenda, contacto del paciente y caja del día",
              "Historia clínica y reportes financieros",
            ],
            ["Contabilidad", "Finanzas, caja y reversa de pagos mal cargados", "Historia clínica"],
          ],
          nota: "Quien administra puede simular otro rol para revisar qué ve esa persona, sin cambiar de usuario.",
        },
      ],
    },
    {
      h2: "¿Cómo se calculan las comisiones?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Cada profesional tiene su regla. Hay dos tipos, y la liquidación sale de los tratamientos realizados, no de una planilla aparte:",
        },
        {
          tipo: "lista",
          items: [
            "**Porcentaje sobre producción**: por ejemplo, el 40 % de lo que produjo en el período. El cálculo redondea, no trunca, para no perder pesos en contra del profesional.",
            "**Monto fijo por procedimiento**: un valor por cada procedimiento completado, sin importar el precio.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Cada dentista puede ver su propia liquidación, pero no la de sus colegas. Más detalle en [comisiones](/funciones/comisiones).",
        },
      ],
    },
    {
      h2: "¿Cómo funciona el portal de pacientes?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Le mandas al paciente un link por WhatsApp. Ahí ve sus próximas citas y puede pedir una nueva, sin crear cuenta ni descargar nada. Las solicitudes llegan a una bandeja dentro de la agenda y alguien de tu equipo las confirma: no se agendan solas.",
        },
        {
          tipo: "lista",
          items: [
            "El link vence solo, en general entre 7 y 14 días, así que si se reenvía deja de servir.",
            "Hay un tope de 3 solicitudes por paciente cada 24 horas.",
            "El portal no muestra historia clínica, odontograma ni pagos: solo lo necesario para agendar.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Durante la prueba gratis, el portal de pacientes y el WhatsApp conectado al número de la clínica se habilitan al agendar la llamada de puesta en marcha o al suscribirte. El envío manual de recordatorios funciona desde el primer día.",
        },
      ],
    },
    {
      h2: "¿Cómo se ven varias agendas a la vez?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Cada profesional tiene su columna en la agenda y su color, y cada sucursal sus boxes y su horario de atención. Puedes filtrar por profesional o ver el día completo de la clínica. Las especialidades definen la duración por defecto de cada cita: una endodoncia no ocupa el mismo bloque que un control.",
        },
        {
          tipo: "p",
          texto:
            "Los recordatorios por WhatsApp salen de la misma lista para toda la clínica: recepción los despacha con un toque, sin importar de qué profesional sea la cita. Más en [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
        },
      ],
    },
    {
      h2: "¿Qué plan te corresponde?",
      bloques: [
        {
          tipo: "tabla",
          columnas: ["Plan", "Profesionales", "Precio", "Suma"],
          filas: [
            [
              "Solo",
              "1",
              "US$29 al mes",
              "Agenda, ficha, WhatsApp, caja, presupuestos e importación CSV",
            ],
            [
              "Clínica",
              "Hasta 3",
              "US$69 al mes",
              "Todo lo de Solo, más roles, comisiones y portal de pacientes",
            ],
            [
              "Red",
              "Desde 4, varias sedes",
              "A medida",
              "Multisede, inventario, reportes por sede y migración acompañada",
            ],
          ],
          nota: "Cobro en dólares vía Stripe; el precio en moneda local que muestra la web es una referencia. Esmalia no emite facturas electrónicas en ningún país.",
        },
        {
          tipo: "p",
          texto:
            "Tienes 14 días gratis sin tarjeta. Si no te suscribes, agenda, pacientes y ficha siguen abiertos; finanzas, comisiones, inventario e informes se activan al suscribirte. Mira los [precios](/precios) o [entra a la demo](/demo).",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Qué software dental sirve para una clínica con 2 o 3 dentistas?",
      a: "Uno con roles por persona, comisiones por profesional y una agenda por profesional. Esmalia lo cubre con el plan Clínica: hasta 3 profesionales por US$69 al mes, con 14 días gratis y sin tarjeta.",
    },
    {
      q: "¿La recepcionista puede ver la historia clínica de los pacientes?",
      a: "No. En Esmalia el rol de recepción ve la agenda, los datos de contacto y la caja del día, pero no la historia clínica ni los reportes financieros. La base de datos también lo verifica.",
    },
    {
      q: "¿Cómo calcula Esmalia las comisiones de los dentistas?",
      a: "Con una regla por profesional: un porcentaje sobre lo que produjo o un monto fijo por procedimiento completado. Cada dentista ve su propia liquidación y no la de los demás.",
    },
    {
      q: "¿Los pacientes pueden pedir hora solos?",
      a: "Sí, con el portal de pacientes del plan Clínica. El paciente pide la hora desde un link y tu equipo la confirma en la agenda; nada se agenda sin revisión.",
    },
    {
      q: "¿Qué pasa si la clínica tiene más de 3 profesionales?",
      a: "Corresponde el plan Red, que se cotiza a medida e incluye multisede, inventario, reportes por sede y migración acompañada.",
    },
  ],
  relacionados: [
    "/para/dentista-independiente",
    "/funciones/comisiones",
    "/funciones/recordatorios-whatsapp",
    "/comparar/esmalia-vs-dentalink",
    "/plantillas/inventario-clinica-dental",
    "/software-dental-chile",
    "/precios",
  ],
  enUnaLinea:
    "Plan Clínica de Esmalia para hasta 3 profesionales: roles por persona, comisiones, portal de pacientes y agenda por profesional, a US$69 al mes.",
};
