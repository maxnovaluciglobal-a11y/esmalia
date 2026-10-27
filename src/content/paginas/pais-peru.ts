import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "pais",
  path: "/software-dental-peru",
  titulo: "Software dental en Perú: precio y alcance | Esmalia",
  descripcion:
    "Software para consultorio dental en Perú: agenda en hora de Lima, soles (PEN) y WhatsApp. Desde US$19,99/mes (aprox. S/ 70). 14 días gratis.",
  kicker: "Perú",
  h1: "Software dental para consultorios y clínicas del Perú",
  resumen:
    "Esmalia es un software dental que un consultorio peruano configura al darse de alta: queda en soles y en hora de Lima. Cuesta US$19,99 al mes para un profesional o US$49,99 hasta tres, unos S/ 70 y S/ 180 de referencia, cobrados en dólares. No emite boletas ni facturas electrónicas de SUNAT.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué queda configurado cuando creas un consultorio en Perú?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El alta pide los datos de la clínica, la sucursal con sus unidades o boxes, las especialidades y el equipo. En el primer paso eliges el país. Al elegir Perú, Esmalia fija la moneda y la zona horaria, y las usa en todo el sistema.",
        },
        {
          tipo: "tabla",
          columnas: ["Dato", "Valor para Perú", "Para qué sirve"],
          filas: [
            ["Moneda", "PEN (soles), con céntimos", "Cobros, saldos, presupuestos y caja en soles"],
            [
              "Zona horaria",
              "America/Lima",
              "Agenda, recordatorios y reportes en hora local, no en la del servidor",
            ],
            [
              "Identificación fiscal",
              "Campo opcional y libre",
              "Puedes anotar el RUC del consultorio; Esmalia no lo usa para emitir comprobantes",
            ],
            [
              "Especialidades",
              "Odontología general, endodoncia, ortodoncia y otras",
              "Color y duración por defecto de cada cita en la agenda",
            ],
          ],
          nota: "La moneda sale de la clínica, no de cada cobro: un pago no puede quedar registrado en otra moneda por error.",
        },
      ],
    },
    {
      h2: "¿Cuánto cuesta en soles?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El cobro es en dólares, a través de Stripe. El precio en soles es una **referencia aproximada**: usa un tipo de cambio cargado a mano (unos S/ 3,70 por dólar) y el monto final lo define tu banco o tu tarjeta.",
        },
        {
          tipo: "tabla",
          columnas: ["Plan", "Para quién", "Precio en USD", "Referencia en PEN"],
          filas: [
            ["Solo", "1 profesional", "US$19,99 al mes", "aprox. S/ 70"],
            ["Clínica", "Hasta 3 profesionales", "US$49,99 al mes", "aprox. S/ 180"],
            ["Red", "Varias sedes, desde 4 profesionales", "A medida", "Se cotiza"],
          ],
          nota: "14 días gratis, sin tarjeta. Las clínicas fundadoras pagan la mitad de su plan durante 12 meses; después, el precio de lista, avisado con 30 días de anticipación.",
        },
        {
          tipo: "p",
          texto:
            "Si al terminar la prueba no te suscribes, agenda, pacientes e historia clínica siguen abiertos. Finanzas, comisiones, inventario e informes se activan al suscribirte. El detalle está en [precios](/precios).",
        },
      ],
    },
    {
      h2: "¿Emite boletas o facturas electrónicas de SUNAT?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**No.** Esmalia no emite boletas, facturas ni recibos por honorarios electrónicos de SUNAT, ni ningún otro comprobante de pago. Registra cobros, saldos y medios de pago; el comprobante lo sigues emitiendo en SUNAT o con el sistema de facturación que ya uses. La facturación electrónica está en el roadmap, sin fecha comprometida.",
        },
        {
          tipo: "p",
          texto:
            "En la práctica: cobras en Esmalia, el pago descuenta el saldo del paciente y queda en la caja del día. Después emites el comprobante donde lo haces hoy. Preferimos decirlo aquí y no en la primera llamada.",
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
            "**Presupuestos** que se convierten en plan de tratamiento; cada pago descuenta el saldo.",
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
      h2: "¿Y la historia clínica según la norma peruana?",
      bloques: [
        {
          tipo: "p",
          texto:
            "La [Ley 30024](https://leyes.congreso.gob.pe/Documentos/Leyes/30024.pdf) crea el Registro Nacional de Historias Clínicas Electrónicas (RENHICE), que administra el Ministerio de Salud. La gestión de la historia clínica en los establecimientos se rige por la [NTS 139-MINSA/2018/DGAIN](https://busquedas.elperuano.pe/api/visor_html/1626125-1), aprobada por la Resolución Ministerial 214-2018/MINSA.",
        },
        {
          tipo: "p",
          texto:
            "Esmalia aporta lo que el código hace: las notas clínicas se versionan en vez de sobrescribirse, el historial de cambios lo escribe la base de datos y no la app, cada rol ve solo lo suyo y hay un respaldo diario cifrado. Hoy Esmalia no se conecta al RENHICE. Que la historia clínica cumpla la norma depende también de cómo la usa el consultorio; esta página no es asesoría legal. Más en [datos y seguridad](/docs/datos-y-seguridad).",
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
      q: "¿Qué software dental sirve para un consultorio en Perú?",
      a: "Uno que trabaje en soles, en hora de Lima y que recuerde las citas por WhatsApp. Esmalia hace eso desde US$19,99 al mes (aprox. S/ 70) para un profesional, con 14 días gratis y sin tarjeta.",
    },
    {
      q: "¿Esmalia emite boletas o facturas electrónicas de SUNAT?",
      a: "No. Esmalia no emite comprobantes de pago en Perú. Registra cobros y saldos; la boleta o factura la sigues emitiendo en SUNAT o con tu sistema de facturación.",
    },
    {
      q: "¿Me cobran en soles?",
      a: "No, el cobro es en dólares vía Stripe: US$19,99 o US$49,99 al mes. Los montos en soles son una referencia aproximada; el valor final depende del tipo de cambio de tu banco o tarjeta.",
    },
    {
      q: "¿Se conecta al RENHICE?",
      a: "No. Hoy Esmalia no envía historias clínicas al Registro Nacional de Historias Clínicas Electrónicas. Guarda la historia clínica del consultorio con versiones, permisos por rol y respaldo diario.",
    },
  ],
  fuentes: [
    {
      titulo:
        "Ley 30024, que crea el Registro Nacional de Historias Clínicas Electrónicas (Congreso de la República)",
      url: "https://leyes.congreso.gob.pe/Documentos/Leyes/30024.pdf",
    },
    {
      titulo:
        "RM 214-2018/MINSA, aprueba la NTS 139-MINSA/2018/DGAIN para la gestión de la historia clínica (El Peruano)",
      url: "https://busquedas.elperuano.pe/api/visor_html/1626125-1",
    },
  ],
  relacionados: [
    "/software-dental-mexico",
    "/software-dental-colombia",
    "/software-dental-chile",
    "/software-dental-argentina",
    "/funciones/recordatorios-whatsapp",
    "/funciones/sin-internet",
    "/para/clinica-dental",
  ],
  enUnaLinea:
    "Software dental para Perú: soles, hora de Lima, precio de referencia en PEN, cobro en USD y sin boletas ni facturas de SUNAT.",
};
