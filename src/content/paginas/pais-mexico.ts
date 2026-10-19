import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "pais",
  path: "/software-dental-mexico",
  titulo: "Software dental en México: precio y alcance | Esmalia",
  descripcion:
    "Software para consultorio dental en México: agenda en hora de Ciudad de México, pesos MXN y WhatsApp. Desde US$29/mes (aprox. $490). 14 días gratis.",
  kicker: "México",
  h1: "Software para consultorio dental en México",
  resumen:
    "Esmalia es un software dental que un consultorio en México configura al darse de alta: queda en pesos mexicanos y en hora de Ciudad de México. Cuesta US$29 al mes para un profesional o US$69 hasta tres, unos $490 y $1.200 MXN de referencia, cobrados en dólares. No emite CFDI.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué queda configurado cuando creas un consultorio en México?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El alta pide los datos de la clínica, la sucursal con sus sillones o boxes, las especialidades y el equipo. En el primer paso eliges el país. Al elegir México, Esmalia fija la moneda y la zona horaria, y las usa en todo el sistema.",
        },
        {
          tipo: "tabla",
          columnas: ["Dato", "Valor para México", "Para qué sirve"],
          filas: [
            [
              "Moneda",
              "MXN, con centavos",
              "Cobros, saldos, presupuestos y caja en pesos mexicanos",
            ],
            [
              "Zona horaria",
              "America/Mexico_City",
              "Agenda, recordatorios y reportes en hora local, no en la del servidor",
            ],
            [
              "Identificación fiscal",
              "Campo opcional y libre",
              "Puedes anotar el RFC del consultorio; Esmalia no lo usa para facturar",
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
            "Al elegir México, la zona que queda es la de Ciudad de México. Si tu consultorio está en otra zona del país, como Tijuana o Cancún, tenlo en cuenta desde el alta: la agenda y los recordatorios se calculan con la hora de la clínica.",
        },
      ],
    },
    {
      h2: "¿Cuánto cuesta en pesos mexicanos?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El cobro es en dólares, a través de Stripe. El precio en pesos es una **referencia aproximada**: usa un tipo de cambio cargado a mano (unos $17 por dólar) y el monto final lo define tu banco o tu tarjeta.",
        },
        {
          tipo: "tabla",
          columnas: ["Plan", "Para quién", "Precio en USD", "Referencia en MXN"],
          filas: [
            ["Solo", "1 profesional", "US$29 al mes", "aprox. $490"],
            ["Clínica", "Hasta 3 profesionales", "US$69 al mes", "aprox. $1.200"],
            ["Red", "Varias sedes, desde 4 profesionales", "A medida", "Se cotiza"],
          ],
          nota: "14 días gratis, sin tarjeta. Quienes entran en esta etapa conservan el precio de su plan mientras sean clientes.",
        },
        {
          tipo: "p",
          texto:
            "Si al terminar la prueba no te suscribes, agenda, pacientes y ficha clínica siguen abiertos. Finanzas, comisiones, inventario e informes se activan al suscribirte. El detalle está en [precios](/precios).",
        },
      ],
    },
    {
      h2: "¿Emite factura electrónica (CFDI)?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**No.** Esmalia no emite ni timbra CFDI, ni ningún otro comprobante fiscal. Registra cobros, saldos y medios de pago, pero la factura la sigues emitiendo en el portal del SAT o con el proveedor de facturación que ya uses. La facturación electrónica está en el roadmap, sin fecha comprometida.",
        },
        {
          tipo: "p",
          texto:
            "En la práctica: cobras en Esmalia, el pago descuenta el saldo del paciente y queda en la caja del día. Si el paciente pide factura, la emites donde lo haces hoy. Preferimos decirlo aquí y no en la primera llamada.",
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
            "**Expediente del paciente** con odontograma FDI versionado, notas clínicas con revisión y consentimientos.",
            "**Presupuestos** que se convierten en plan de tratamiento; cada pago descuenta el saldo.",
            "**Sin internet** sigues atendiendo: agenda, fichas, cobros y odontograma se guardan en el equipo y se sincronizan al volver la conexión. WhatsApp sí necesita conexión. Detalle en [sin internet](/funciones/sin-internet).",
            "**Importación de pacientes** desde una planilla CSV, en todos los planes.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Sobre WhatsApp, lo que funciona hoy es el modo manual: Esmalia abre WhatsApp con el mensaje ya escrito y tú lo envías. El modo con el número del consultorio conectado a Meta está en habilitación. Cómo funcionan los dos está en [la documentación de WhatsApp](/docs/whatsapp).",
        },
        {
          tipo: "p",
          texto:
            "Patty, la IA de Esmalia, está en habilitación: trabajará en las notas clínicas, pasando tus apuntes a una nota SOAP y resumiendo la nota. La nota la firma el profesional, no Patty.",
        },
      ],
    },
    {
      h2: "¿Y el expediente clínico según las NOM?",
      bloques: [
        {
          tipo: "p",
          texto:
            "En México, la [NOM-004-SSA3-2012](https://dof.gob.mx/nota_detalle.php?codigo=5272787&fecha=15/10/2012) regula el expediente clínico, y la [NOM-013-SSA2-2015](https://dof.gob.mx/nota_detalle.php?codigo=5462039&fecha=23/11/2016) trata la prevención y control de enfermedades bucales. Las dos están publicadas en el Diario Oficial de la Federación.",
        },
        {
          tipo: "p",
          texto:
            "Esmalia aporta lo que el código hace: las notas clínicas se versionan en vez de sobrescribirse, el historial de cambios lo escribe la base de datos y no la app, cada rol ve solo lo suyo y hay un respaldo diario cifrado. Que el expediente cumpla las normas depende también de cómo lo usa el consultorio; esta página no es asesoría legal. Más en [datos y seguridad](/docs/datos-y-seguridad).",
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
      q: "¿Qué software para consultorio dental sirve en México?",
      a: "Uno que trabaje en pesos mexicanos, en la hora de tu ciudad y que recuerde las citas por WhatsApp. Esmalia hace eso desde US$29 al mes (aprox. $490 MXN) para un profesional, con 14 días gratis y sin tarjeta.",
    },
    {
      q: "¿Esmalia emite CFDI?",
      a: "No. Esmalia no emite ni timbra CFDI. Registra cobros y saldos; la factura la sigues emitiendo en el SAT o con tu proveedor de facturación.",
    },
    {
      q: "¿Me cobran en pesos mexicanos?",
      a: "No, el cobro es en dólares vía Stripe: US$29 o US$69 al mes. Los montos en pesos son una referencia aproximada; el valor final depende del tipo de cambio de tu banco o tarjeta.",
    },
    {
      q: "¿Los recordatorios por WhatsApp salen solos?",
      a: "No. Esmalia arma la lista 48 h y 3 h antes de cada cita y alguien del consultorio envía cada mensaje con un toque. Hoy funciona el modo manual; el número conectado a Meta está en habilitación.",
    },
  ],
  fuentes: [
    {
      titulo: "NOM-004-SSA3-2012, del expediente clínico (Diario Oficial de la Federación)",
      url: "https://dof.gob.mx/nota_detalle.php?codigo=5272787&fecha=15/10/2012",
    },
    {
      titulo:
        "NOM-013-SSA2-2015, para la prevención y control de enfermedades bucales (Diario Oficial de la Federación)",
      url: "https://dof.gob.mx/nota_detalle.php?codigo=5462039&fecha=23/11/2016",
    },
  ],
  relacionados: [
    "/software-dental-colombia",
    "/software-dental-peru",
    "/software-dental-chile",
    "/software-dental-argentina",
    "/funciones/recordatorios-whatsapp",
    "/funciones/sin-internet",
    "/para/clinica-dental",
  ],
  enUnaLinea:
    "Software dental para consultorios en México: MXN, hora de Ciudad de México, precio de referencia en pesos, cobro en USD y sin CFDI.",
};
