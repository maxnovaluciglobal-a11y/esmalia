import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "pais",
  path: "/software-dental-argentina",
  titulo: "Software odontológico en Argentina | Esmalia",
  descripcion:
    "Software odontológico para consultorios y clínicas de Argentina: turnos en hora local, pesos con centavos, WhatsApp e historia clínica. Desde US$29/mes.",
  kicker: "Argentina",
  h1: "Software odontológico para consultorios y clínicas de Argentina",
  resumen:
    "Esmalia es un software odontológico que un consultorio argentino configura en cuatro pasos: queda en pesos argentinos con centavos y en hora de Buenos Aires. Cuesta US$29 al mes para un profesional o US$69 hasta tres, cobrados en dólares. No emite facturas electrónicas de ARCA.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué queda configurado cuando creas un consultorio en Argentina?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El alta tiene cuatro pasos: clínica, sucursal y boxes, especialidades y equipo. En el primero eliges el país. Al elegir Argentina, Esmalia fija la moneda y la zona horaria, y las usa en todo el sistema.",
        },
        {
          tipo: "tabla",
          columnas: ["Dato", "Valor para Argentina", "Para qué sirve"],
          filas: [
            [
              "Moneda",
              "ARS, con centavos",
              "Cobros, saldos, presupuestos y caja en pesos, sin redondeos que descuadren",
            ],
            [
              "Zona horaria",
              "America/Argentina/Buenos_Aires",
              "Turnos, recordatorios y reportes en hora local, no en la del servidor",
            ],
            [
              "Feriados",
              "Los feriados públicos de Argentina",
              "Al elegir la fecha de un turno, avisa si ese día es feriado",
            ],
            [
              "Identificación fiscal",
              "Campo opcional y libre",
              "Puedes anotar el CUIT; Esmalia no lo usa para emitir comprobantes",
            ],
          ],
          nota: "La moneda sale de la clínica, no de cada cobro: un pago no puede quedar registrado en otra moneda por error.",
        },
      ],
    },
    {
      h2: "¿Cuánto cuesta en Argentina?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El cobro es en dólares, a través de Stripe. A diferencia de Chile, México, Colombia o Perú, **la web no muestra un precio de referencia en pesos argentinos**: no hay un tipo de cambio de referencia que podamos mantener a mano con honestidad. Lo que pagas lo define el tipo de cambio que aplique tu banco o tarjeta.",
        },
        {
          tipo: "tabla",
          columnas: ["Plan", "Para quién", "Precio"],
          filas: [
            ["Solo", "1 profesional", "US$29 al mes"],
            ["Clínica", "Hasta 3 profesionales", "US$69 al mes"],
            ["Red", "Varias sedes, desde 4 profesionales", "A medida"],
          ],
          nota: "14 días gratis, sin tarjeta. Las clínicas fundadoras pagan la mitad de su plan durante 12 meses; después, el precio de lista, avisado con 30 días de anticipación.",
        },
        {
          tipo: "p",
          texto:
            "Si al terminar la prueba no te suscribes, la agenda, los pacientes y la historia clínica siguen abiertos. Finanzas, comisiones, inventario e informes se activan al suscribirte. Más en [precios](/precios).",
        },
      ],
    },
    {
      h2: "¿Emite factura electrónica de ARCA (ex AFIP)?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**No.** Esmalia no emite facturas ni comprobantes electrónicos de ARCA, ni ningún otro documento tributario. Registra cobros, saldos y medios de pago; el comprobante lo sigues emitiendo en ARCA o en el sistema de facturación que ya uses. La facturación electrónica está en el roadmap, sin fecha comprometida.",
        },
        {
          tipo: "p",
          texto:
            "Con obras sociales y prepagas pasa algo parecido. Esmalia registra convenios: qué parte de cada tratamiento cubre el convenio y qué parte le toca al paciente, para que el saldo sea el real. Lo que no hace es facturarle a la obra social ni presentar liquidaciones.",
        },
      ],
    },
    {
      h2: "¿Qué hace en el día a día de un consultorio?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Recordatorios de turno por WhatsApp** 48 h y 3 h antes. Esmalia arma la lista y alguien del consultorio los envía con un toque. Ningún mensaje a pacientes sale solo. Más en [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
            "**Historia clínica** con [odontograma FDI](/funciones/odontograma) versionado, notas clínicas con revisión y consentimientos.",
            "**Presupuestos** que se convierten en plan de tratamiento; cada pago descuenta el saldo del paciente.",
            "**Sin internet** sigues atendiendo y todo se sincroniza al volver la conexión. Mandar WhatsApp sí necesita conexión. Detalle en [sin internet](/funciones/sin-internet).",
            "**Importación de pacientes** desde una planilla CSV, en todos los planes.",
          ],
        },
      ],
    },
    {
      h2: "¿Y la historia clínica según la Ley 26.529?",
      bloques: [
        {
          tipo: "p",
          texto:
            "La [Ley 26.529](https://servicios.infoleg.gob.ar/infolegInternet/anexos/160000-164999/160432/norma.htm) de derechos del paciente dedica un capítulo a la historia clínica y admite llevarla en formato informatizado, siempre que se preserve su integridad y autenticidad.",
        },
        {
          tipo: "p",
          texto:
            "En ese terreno Esmalia aporta lo que el código hace: las notas clínicas se versionan en vez de sobrescribirse, el historial de cambios lo escribe la base de datos y no la app, cada rol ve solo lo suyo y hay un respaldo diario cifrado. Que la historia clínica cumpla la norma depende también de cómo la usa el consultorio; esta página no es asesoría legal. Más en [datos y seguridad](/docs/datos-y-seguridad).",
        },
      ],
    },
    {
      h2: "¿Cómo lo pruebas?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Puedes [entrar a la demo](/demo) con nombre y email, sin tarjeta ni contraseña, o crear tu consultorio y usar los 14 días gratis. Si atiendes solo, mira la página para [dentistas independientes](/para/dentista-independiente).",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Qué software odontológico sirve para un consultorio en Argentina?",
      a: "Uno que trabaje en pesos con centavos, en hora de Buenos Aires y que recuerde los turnos por WhatsApp. Esmalia hace eso desde US$29 al mes para un profesional, con 14 días gratis y sin tarjeta.",
    },
    {
      q: "¿Esmalia factura electrónicamente con ARCA o AFIP?",
      a: "No. Esmalia no emite comprobantes electrónicos en Argentina. Registra cobros y saldos; la factura la sigues emitiendo en ARCA o en tu sistema de facturación.",
    },
    {
      q: "¿Cuánto sale en pesos argentinos?",
      a: "El precio es en dólares: US$29 o US$69 al mes, cobrados por Stripe. Esmalia no publica un precio en pesos argentinos; el monto final depende del tipo de cambio de tu banco o tarjeta.",
    },
    {
      q: "¿Sirve para obras sociales y prepagas?",
      a: "Puedes registrar convenios y la parte que cubre cada uno, así el saldo del paciente es el real. Esmalia no factura a la obra social ni presenta liquidaciones.",
    },
  ],
  fuentes: [
    {
      titulo:
        "Ley 26.529, derechos del paciente, historia clínica y consentimiento informado (Infoleg)",
      url: "https://servicios.infoleg.gob.ar/infolegInternet/anexos/160000-164999/160432/norma.htm",
    },
  ],
  relacionados: [
    "/software-dental-chile",
    "/para/dentista-independiente",
    "/para/clinica-dental",
    "/funciones/ficha-clinica",
    "/software-dental-latam",
    "/precios",
  ],
  enUnaLinea:
    "Software odontológico para Argentina: ARS con centavos, hora de Buenos Aires, cobro en USD y sin facturación electrónica de ARCA.",
};
