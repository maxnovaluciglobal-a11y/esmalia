import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "funciones",
  path: "/funciones/ficha-clinica",
  titulo: "Ficha clínica dental electrónica | Esmalia",
  descripcion:
    "Ficha clínica dental electrónica: notas versionadas con firma y revisión, odontograma FDI, anamnesis con alertas de alergia y consentimientos firmados.",
  kicker: "Funciones",
  h1: "Ficha clínica dental electrónica en Esmalia",
  resumen:
    "La ficha clínica de Esmalia reúne en un lugar los datos del paciente, la anamnesis, el odontograma, el periodontograma, las notas clínicas, los consentimientos firmados, radiografías e imágenes, presupuestos y mensajes. Cada nota guarda versiones que no se pueden sobrescribir, se firma, puede pasar por revisión de otro profesional y deja una auditoría que escribe la base de datos.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué guarda la ficha clínica de Esmalia?",
      bloques: [
        {
          tipo: "p",
          texto:
            "La ficha del paciente es el centro de Esmalia. Arriba van los datos de contacto, el convenio, el saldo y las alertas. Abajo, el contenido se ordena en pestañas:",
        },
        {
          tipo: "tabla",
          columnas: ["Pestaña", "Qué tiene"],
          filas: [
            ["Resumen", "Datos del paciente, saldo y línea de tiempo de visitas y eventos."],
            ["Odontograma", "Odontograma FDI versionado y periodontograma."],
            ["Notas", "Notas clínicas con versiones, firma, revisión y auditoría."],
            ["Finanzas", "Presupuestos, plan de tratamiento y pagos."],
            ["Documentos", "Consentimientos firmados, fotos clínicas y radiografías."],
            ["Mensajes", "Historial de mensajes con el paciente."],
          ],
        },
      ],
    },
    {
      h2: "¿Cómo funcionan las notas clínicas?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Plantillas por especialidad.** Ocho plantillas en formato SOAP para odontología general, endodoncia, periodoncia, ortodoncia, cirugía oral, odontopediatría y rehabilitación oral.",
            "**Versiones que no se pisan.** Cada guardado crea una versión nueva (v1, v2, v3). Puedes comparar dos versiones y volver a una anterior; la reversión queda como una versión nueva marcada como tal.",
            "**Firma.** Una nota firmada queda bloqueada para edición. Firmar y reabrir es solo para doctores y administración, y la base de datos repite esa regla.",
            "**Revisión.** Puedes pedirle a otro profesional que revise una nota. Quien revisa aprueba, comenta o pide cambios; si pide cambios, la nota vuelve a borrador.",
            "**Auditoría.** Crear, editar, firmar, reabrir, revisar o usar la IA queda registrado. Ese registro lo escriben triggers de la base de datos: la aplicación no puede insertar entradas a mano.",
            "**PDF.** Cada nota se exporta a PDF con sus versiones y su auditoría.",
          ],
        },
        {
          tipo: "p",
          texto:
            "[Patty, la IA de Esmalia](/funciones/patty-ia), hoy en habilitación, podrá pasar tus apuntes a una nota SOAP, pulirla o resumirla. La versión queda marcada como asistida por IA y la firma sigue siendo tuya.",
        },
      ],
    },
    {
      h2: "¿Qué guarda la anamnesis?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Alergias, medicación crónica, condiciones médicas y notas. Las alergias suben a la agenda como alerta, para que el dato de mayor riesgo llegue al sillón sin abrir la ficha. Si nadie cargó antecedentes, Esmalia dice que no hay datos, no que el paciente no tiene alergias: no inventa un negativo que nadie confirmó.",
        },
      ],
    },
    {
      h2: "¿Cómo se firman los consentimientos?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Eliges una plantilla de consentimiento, la ajustas si hace falta y el paciente firma en la pantalla con el dedo o el mouse. Queda guardado con el nombre de quien firma, la fecha y la hora, y se puede revocar después. Las fotos clínicas y las radiografías se suben a la misma pestaña y, en vez de borrarse, se archivan.",
        },
      ],
    },
    {
      h2: "¿Quién ve cada parte de la ficha?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Propietario, administración y doctores:** toda la ficha, incluida la historia clínica.",
            "**Recepción:** agenda, contacto y datos administrativos. No ve notas, odontograma ni documentos clínicos.",
            "**Contabilidad:** indicadores, tratamientos y finanzas, sin historia clínica.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Cada clínica tiene sus datos aislados en la base de datos (row-level security), no solo en la pantalla. Más en [datos y seguridad](/docs/datos-y-seguridad).",
        },
      ],
    },
    {
      h2: "¿En qué plan está la ficha clínica?",
      bloques: [
        {
          tipo: "p",
          texto:
            "En todos, desde Solo (US$19,99 al mes). La ficha clínica sigue abierta aunque la prueba de 14 días termine sin suscripción. Puedes traer tus pacientes desde una planilla CSV y, si te vas, exportar todos los datos de tu clínica desde Ajustes. Mírala por dentro en la [demo](/demo) o revisa los [precios](/precios).",
        },
      ],
    },
    {
      h2: "¿Qué no hace?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**Esmalia es el registro; las obligaciones legales siguen siendo de la clínica.** No certifica que tu ficha cumpla la norma de tu país. La firma del consentimiento es una firma dibujada en pantalla, no una firma electrónica avanzada. El portal de pacientes no muestra la historia clínica. Y las notas y el odontograma no se guardan en el disco del equipo: sin internet puedes escribir, pero si recargas la página no verás las notas anteriores hasta que vuelva la conexión.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Se puede editar una nota clínica firmada?",
      a: "No directamente. Un doctor o alguien de administración la reabre, se edita como borrador y se vuelve a firmar. La versión anterior no se pierde y la reapertura queda en la auditoría.",
    },
    {
      q: "¿Puedo importar los pacientes de mi software anterior?",
      a: "Sí. Esmalia importa pacientes y citas desde una planilla CSV en todos los planes. En el plan Red, para varias sedes, la migración es acompañada.",
    },
    {
      q: "¿Mis pacientes pueden ver su ficha clínica?",
      a: "No. El portal de pacientes sirve para ver y pedir citas; no muestra historia clínica, odontograma ni pagos.",
    },
    {
      q: "¿Dónde se guardan los datos de la ficha clínica?",
      a: "En Supabase, en la región de São Paulo, Brasil, con una copia diaria cifrada guardada fuera de la plataforma principal.",
    },
    {
      q: "¿La IA escribe sola en la ficha?",
      a: "No. Patty propone texto dentro del editor; nada se guarda hasta que lo guardas tú, y la firma es siempre de un profesional.",
    },
  ],
  relacionados: [
    "/funciones/odontograma",
    "/funciones/patty-ia",
    "/funciones/sin-internet",
    "/funciones/presupuestos",
  ],
  enUnaLinea:
    "Ficha clínica con notas versionadas, firma, revisión y auditoría, odontograma, anamnesis y consentimientos.",
};
