import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "pais",
  path: "/software-dental-colombia",
  titulo: "Software dental en Colombia: precio y alcance | Esmalia",
  descripcion:
    "Software para consultorio odontológico en Colombia: agenda en hora de Bogotá, pesos COP sin decimales y WhatsApp. Desde US$29/mes (aprox. $89.300).",
  kicker: "Colombia",
  h1: "Software odontológico para consultorios y clínicas de Colombia",
  resumen:
    "Esmalia es un software odontológico que un consultorio colombiano configura al darse de alta: queda en pesos colombianos sin decimales y en hora de Bogotá. Cuesta US$29 al mes para un profesional o US$69 hasta tres, unos $89.300 y $213.000 de referencia, cobrados en dólares. No emite factura electrónica de la DIAN.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué queda configurado cuando creas un consultorio en Colombia?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El alta pide los datos de la clínica, la sucursal con sus unidades o boxes, las especialidades y el equipo. En el primer paso eliges el país. Al elegir Colombia, Esmalia fija la moneda y la zona horaria, y las usa en todo el sistema.",
        },
        {
          tipo: "tabla",
          columnas: ["Dato", "Valor para Colombia", "Para qué sirve"],
          filas: [
            [
              "Moneda",
              "COP, sin decimales",
              "Cobros, saldos, presupuestos y caja en pesos enteros",
            ],
            [
              "Zona horaria",
              "America/Bogota",
              "Agenda, recordatorios y reportes en hora local, no en la del servidor",
            ],
            [
              "Identificación fiscal",
              "Campo opcional y libre",
              "Puedes anotar el NIT del consultorio; Esmalia no lo usa para facturar",
            ],
            [
              "Especialidades",
              "Odontología general, endodoncia, ortodoncia y otras",
              "Color y duración por defecto de cada cita en la agenda",
            ],
          ],
          nota: "La moneda sale de la clínica, no de cada cobro: un pago no puede quedar registrado en otra moneda por error.",
        },
        {
          tipo: "p",
          texto:
            "En un consultorio colombiano nadie cobra centavos. Esmalia trata el peso colombiano como moneda sin decimales, así que $120.000 se guarda y se muestra como $120.000, sin redondeos raros en la caja.",
        },
      ],
    },
    {
      h2: "¿Cuánto cuesta en pesos colombianos?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El cobro es en dólares, a través de Stripe. El precio en pesos es una **referencia aproximada**: usa un tipo de cambio cargado a mano (unos $3.080 por dólar) y el monto final lo define tu banco o tu tarjeta.",
        },
        {
          tipo: "tabla",
          columnas: ["Plan", "Para quién", "Precio en USD", "Referencia en COP"],
          filas: [
            ["Solo", "1 profesional", "US$29 al mes", "aprox. $89.300"],
            ["Clínica", "Hasta 3 profesionales", "US$69 al mes", "aprox. $213.000"],
            ["Red", "Varias sedes, desde 4 profesionales", "A medida", "Se cotiza"],
          ],
          nota: "14 días gratis, sin tarjeta. Quienes entran en esta etapa conservan el precio de su plan mientras sean clientes.",
        },
        {
          tipo: "p",
          texto:
            "Si al terminar la prueba no te suscribes, agenda, pacientes e historia clínica siguen abiertos. Finanzas, comisiones, inventario e informes se activan al suscribirte. El detalle está en [precios](/precios).",
        },
      ],
    },
    {
      h2: "¿Emite factura electrónica de la DIAN?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**No.** Esmalia no emite facturas electrónicas de la DIAN ni ningún otro documento tributario. Registra cobros, saldos y medios de pago; la factura la sigues emitiendo con el facturador o la solución de la DIAN que ya uses. La facturación electrónica está en el roadmap, sin fecha comprometida.",
        },
        {
          tipo: "p",
          texto:
            "En la práctica: cobras en Esmalia, el pago descuenta el saldo del paciente y queda en la caja del día. Después emites la factura donde lo haces hoy. Preferimos decirlo aquí y no en la primera llamada.",
        },
      ],
    },
    {
      h2: "¿Qué hace en el día a día de un consultorio?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Recordatorios por WhatsApp** 48 h y 3 h antes de cada cita. Esmalia arma la lista y alguien del consultorio envía cada mensaje con un toque. Ningún mensaje a pacientes sale solo. Más en [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
            "**Historia clínica** con odontograma FDI versionado, notas clínicas con revisión y consentimientos.",
            "**Presupuestos** que se convierten en plan de tratamiento; cada abono descuenta el saldo.",
            "**Sin internet** sigues atendiendo: agenda, historias, cobros y odontograma se guardan en el equipo y se sincronizan al volver la conexión. WhatsApp sí necesita conexión. Detalle en [sin internet](/funciones/sin-internet).",
            "**Importación de pacientes** desde una planilla CSV, en todos los planes.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Sobre WhatsApp, lo que funciona hoy es el modo manual: Esmalia abre WhatsApp con el mensaje ya escrito y tú lo envías. El modo con el número del consultorio conectado a Meta está en habilitación. Los dos modos están explicados en [la documentación de WhatsApp](/docs/whatsapp).",
        },
        {
          tipo: "p",
          texto:
            "Patty, la IA de Esmalia, está en habilitación: trabajará en las notas clínicas, pasando tus apuntes a una nota SOAP y resumiendo la nota. La nota la firma el profesional, no Patty.",
        },
      ],
    },
    {
      h2: "¿Y la historia clínica según la norma colombiana?",
      bloques: [
        {
          tipo: "p",
          texto:
            "La [Resolución 1995 de 1999](https://normograma.supersalud.gov.co/compilacion/docs/resolucion_minsalud_r1995_99.htm) del Ministerio de Salud fija las normas para el manejo de la historia clínica. La [Ley 2015 de 2020](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=105472) crea la historia clínica electrónica interoperable, que se reglamenta por separado.",
        },
        {
          tipo: "p",
          texto:
            "Esmalia aporta lo que el código hace: las notas clínicas se versionan en vez de sobrescribirse, el historial de cambios lo escribe la base de datos y no la app, cada rol ve solo lo suyo y hay un respaldo diario cifrado. Hoy Esmalia no se conecta a la plataforma nacional de interoperabilidad. Que la historia clínica cumpla la norma depende también de cómo la usa el consultorio; esta página no es asesoría legal. Más en [datos y seguridad](/docs/datos-y-seguridad).",
        },
      ],
    },
    {
      h2: "¿Cómo lo pruebas?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Puedes [entrar a la demo](/demo) con nombre y email, sin tarjeta ni contraseña, o crear tu consultorio y usar los 14 días gratis. Si tienes dudas antes de empezar, revisa las [preguntas frecuentes](/faq).",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Qué software odontológico sirve para un consultorio en Colombia?",
      a: "Uno que trabaje en pesos sin decimales, en hora de Bogotá y que recuerde las citas por WhatsApp. Esmalia hace eso desde US$29 al mes (aprox. $89.300) para un profesional, con 14 días gratis y sin tarjeta.",
    },
    {
      q: "¿Esmalia emite factura electrónica de la DIAN?",
      a: "No. Esmalia no emite documentos tributarios en Colombia. Registra cobros y saldos; la factura la sigues emitiendo con tu facturador o en la DIAN.",
    },
    {
      q: "¿Me cobran en pesos colombianos?",
      a: "No, el cobro es en dólares vía Stripe: US$29 o US$69 al mes. Los montos en pesos son una referencia aproximada; el valor final depende del tipo de cambio de tu banco o tarjeta.",
    },
    {
      q: "¿Se conecta a la historia clínica electrónica interoperable?",
      a: "No. Hoy Esmalia no envía datos a la plataforma nacional de interoperabilidad de la Ley 2015 de 2020. Guarda la historia clínica del consultorio con versiones, permisos por rol y respaldo diario.",
    },
  ],
  fuentes: [
    {
      titulo:
        "Resolución 1995 de 1999, normas para el manejo de la historia clínica (normograma Supersalud)",
      url: "https://normograma.supersalud.gov.co/compilacion/docs/resolucion_minsalud_r1995_99.htm",
    },
    {
      titulo:
        "Ley 2015 de 2020, historia clínica electrónica interoperable (Gestor Normativo, Función Pública)",
      url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=105472",
    },
  ],
  relacionados: [
    "/software-dental-mexico",
    "/software-dental-peru",
    "/software-dental-chile",
    "/software-dental-argentina",
    "/funciones/recordatorios-whatsapp",
    "/funciones/sin-internet",
    "/para/clinica-dental",
  ],
  enUnaLinea:
    "Software odontológico para Colombia: COP sin decimales, hora de Bogotá, precio de referencia en pesos, cobro en USD y sin factura electrónica DIAN.",
};
