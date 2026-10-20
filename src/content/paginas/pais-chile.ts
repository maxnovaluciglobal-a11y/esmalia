import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "pais",
  path: "/software-dental-chile",
  titulo: "Software dental en Chile: precio y alcance | Esmalia",
  descripcion:
    "Software dental para clínicas en Chile: agenda en hora de Santiago, pesos sin decimales y WhatsApp. Desde US$29/mes (aprox. $26.700). 14 días gratis.",
  kicker: "Chile",
  h1: "Software dental para clínicas en Chile",
  resumen:
    "Esmalia es un software dental que una clínica chilena configura en cuatro pasos: queda en pesos chilenos sin decimales y en hora de Santiago. Cuesta US$29 al mes para un profesional o US$69 hasta tres, unos $26.700 y $63.500 de referencia. No emite boleta ni factura electrónica del SII.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué queda configurado cuando creas una clínica en Chile?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El alta tiene cuatro pasos: clínica, sucursal y boxes, especialidades y equipo. En el primero eliges el país. Al elegir Chile, Esmalia fija dos cosas que después usa en todo el sistema: la moneda y la zona horaria.",
        },
        {
          tipo: "tabla",
          columnas: ["Dato", "Valor para Chile", "Para qué sirve"],
          filas: [
            [
              "Moneda",
              "CLP, sin decimales",
              "Cobros, saldos, presupuestos y caja en pesos enteros",
            ],
            [
              "Zona horaria",
              "America/Santiago",
              "Agenda, recordatorios y reportes en hora local, no en la del servidor",
            ],
            [
              "Feriados",
              "Los feriados públicos de Chile",
              "Al elegir la fecha de un turno, avisa si ese día es feriado",
            ],
            [
              "Identificación fiscal",
              "Campo opcional y libre",
              "Puedes anotar el RUT de la clínica; Esmalia no lo usa para emitir documentos",
            ],
            [
              "Especialidades",
              "Odontología general, endodoncia, ortodoncia y otras",
              "Color y duración por defecto de cada cita en la agenda",
            ],
          ],
          nota: "La moneda no se elige en cada cobro: sale de la clínica. Así un pago no puede quedar registrado en otra moneda por error.",
        },
        {
          tipo: "p",
          texto:
            "El peso chileno no usa decimales. Parece un detalle, pero un sistema que trata $45.000 como si tuviera centavos puede equivocarse por cien veces. Esmalia sabe qué monedas llevan decimales y cuáles no.",
        },
      ],
    },
    {
      h2: "¿Cuánto cuesta en pesos chilenos?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El cobro es en dólares, a través de Stripe. El precio en pesos es una **referencia aproximada**: usa un tipo de cambio cargado a mano (unos $920 por dólar) y el monto final lo define tu banco o tu tarjeta.",
        },
        {
          tipo: "tabla",
          columnas: ["Plan", "Para quién", "Precio en USD", "Referencia en CLP"],
          filas: [
            ["Solo", "1 profesional", "US$29 al mes", "aprox. $26.700"],
            ["Clínica", "Hasta 3 profesionales", "US$69 al mes", "aprox. $63.500"],
            ["Red", "Varias sedes, desde 4 profesionales", "A medida", "Se cotiza"],
          ],
          nota: "14 días gratis, sin tarjeta. Las clínicas fundadoras pagan la mitad de su plan durante 12 meses; después, el precio de lista, avisado con 30 días de anticipación.",
        },
        {
          tipo: "p",
          texto:
            "Si al terminar la prueba no te suscribes, agenda, pacientes y ficha clínica siguen abiertos. Finanzas, comisiones, inventario e informes se activan al suscribirte. El detalle está en [precios](/precios).",
        },
      ],
    },
    {
      h2: "¿Emite boleta o factura electrónica del SII?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**No.** Esmalia no emite boletas, boletas de honorarios ni facturas electrónicas del SII, ni ningún otro documento tributario. Registra cobros, saldos y medios de pago, pero la emisión sigue en el sitio del SII o en el facturador que ya uses. La facturación electrónica está en el roadmap, sin fecha comprometida.",
        },
        {
          tipo: "p",
          texto:
            "En la práctica: cobras en Esmalia, el pago descuenta el saldo del paciente y queda en la caja del día. Después emites el documento tributario donde lo haces hoy. Preferimos decirlo aquí y no en la primera llamada.",
        },
      ],
    },
    {
      h2: "¿Qué hace en el día a día de una clínica chilena?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Recordatorios por WhatsApp** 48 h y 3 h antes de cada cita. Esmalia arma la lista y alguien de tu equipo los envía con un toque. Ningún mensaje a pacientes sale solo. Más en [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
            "**Ficha clínica** con [odontograma FDI](/funciones/odontograma) versionado, notas clínicas con revisión y consentimientos.",
            "**Presupuestos** que se convierten en plan de tratamiento; cada pago descuenta el saldo.",
            "**Sin internet** sigues atendiendo: agenda, fichas, cobros y odontograma se guardan en el equipo y se sincronizan al volver la conexión. WhatsApp sí necesita conexión.",
            "**Importación de pacientes** desde una planilla CSV, en todos los planes.",
          ],
        },
        {
          tipo: "p",
          texto:
            'El RUT del paciente va en el campo de documento de su ficha. Si importas una planilla, la columna "rut" se reconoce sola y los pacientes con un documento repetido se saltan en vez de duplicarse. Hoy Esmalia no valida el dígito verificador, así que conviene revisarlo al cargarlo.',
        },
      ],
    },
    {
      h2: "¿Y la ficha clínica según la ley chilena?",
      bloques: [
        {
          tipo: "p",
          texto:
            "La [Ley 20.584](https://www.bcn.cl/leychile/navegar?idNorma=1039348) regula los derechos y deberes de los pacientes, y entre otras cosas la ficha clínica. Esmalia te da las herramientas para llevarla en orden: notas versionadas, un historial de cambios que escribe la base de datos y no la app, permisos por rol para que recepción no vea la historia clínica, y respaldo diario cifrado.",
        },
        {
          tipo: "p",
          texto:
            "Eso no reemplaza tu criterio ni una asesoría legal: cumplir la norma depende de cómo la clínica usa el sistema. Cómo se guardan los datos está en [datos y seguridad](/docs/datos-y-seguridad).",
        },
      ],
    },
    {
      h2: "¿Cómo lo pruebas?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Puedes [entrar a la demo](/demo) con nombre y email, sin tarjeta ni contraseña, o crear tu clínica y usar los 14 días gratis. Si vienes de otro sistema, revisa la [comparativa de software dental en Chile](/comparar/mejores-software-dental-chile).",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Qué software dental sirve para una clínica chica en Chile?",
      a: "Uno que trabaje en pesos sin decimales, en hora de Santiago y que recuerde las citas por WhatsApp. Esmalia hace eso desde US$29 al mes (aprox. $26.700) para un profesional, con 14 días gratis y sin tarjeta.",
    },
    {
      q: "¿Esmalia emite boletas de honorarios o facturas del SII?",
      a: "No. Esmalia no emite ningún documento tributario en Chile. Registra cobros y saldos; la boleta o factura la sigues emitiendo en el SII o en tu facturador.",
    },
    {
      q: "¿Me cobran en pesos chilenos?",
      a: "No, el cobro es en dólares vía Stripe: US$29 o US$69 al mes. Los montos en pesos que ves en la web son una referencia aproximada; el valor final depende del tipo de cambio de tu banco.",
    },
    {
      q: "¿La agenda y los recordatorios usan la hora de Chile?",
      a: "Sí. Una clínica creada en Chile queda en la zona America/Santiago, y la agenda, los recordatorios y los reportes se calculan con esa hora local.",
    },
    {
      q: "¿Valida el RUT de los pacientes?",
      a: "Hoy no valida el dígito verificador. El RUT se guarda en el campo de documento de la ficha y, al importar una planilla, sirve para no duplicar pacientes que ya existen.",
    },
  ],
  fuentes: [
    {
      titulo:
        "Ley 20.584, derechos y deberes de las personas en su atención de salud (BCN LeyChile)",
      url: "https://www.bcn.cl/leychile/navegar?idNorma=1039348",
    },
  ],
  relacionados: [
    "/comparar/mejores-software-dental-chile",
    "/software-dental-argentina",
    "/para/dentista-independiente",
    "/para/clinica-dental",
    "/software-dental-latam",
    "/precios",
  ],
  enUnaLinea:
    "Software dental para clínicas en Chile: CLP sin decimales, hora de Santiago, precio de referencia en pesos y sin boleta ni factura del SII.",
};
