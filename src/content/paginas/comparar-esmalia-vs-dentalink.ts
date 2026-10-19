import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "comparar",
  path: "/comparar/esmalia-vs-dentalink",
  titulo: "Esmalia vs Dentalink: comparativa 2026 | Esmalia",
  descripcion:
    "Esmalia vs Dentalink: precio, odontograma, WhatsApp, IA, uso sin internet y boleta electrónica. En qué gana cada uno y cuándo conviene cuál.",
  kicker: "Comparativa",
  h1: "Esmalia vs Dentalink: ¿cuál conviene a tu clínica?",
  resumen:
    "Según su web, Dentalink tiene más de 16 años y más de 15.000 clínicas, y emite boleta electrónica si tu plan incluye el servicio; su precio se cotiza. Esmalia publica su precio (US$29 o US$69 al mes), da 14 días sin tarjeta, sigue funcionando sin internet y no envía WhatsApp sin que tu equipo lo revise. No emite boleta ni factura.",
  publicado: "2026-10-11",
  actualizado: "2026-10-19",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿En qué se diferencian Esmalia y Dentalink?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "Esmalia es nuestro producto. Relevamos los datos de Dentalink el 11-oct-2026 en sus webs oficiales; los de Esmalia están al 19-oct-2026. Si algo cambió, escríbenos a hola@esmalia.com y lo corregimos.",
        },
        {
          tipo: "p",
          texto:
            "Los dos son software dentales en la web, con agenda, ficha clínica, odontograma y presupuestos. La diferencia está en el tamaño, en cómo cobran y en algunas decisiones de producto. Dentalink declara más de 16 años y más de 15.000 clínicas. Esmalia es más chica, está en etapa piloto y apunta a consultorios de 1 a 3 profesionales.",
        },
        {
          tipo: "tabla",
          columnas: ["", "Dentalink", "Esmalia"],
          filas: [
            [
              "Precio",
              "No publica; planes Esencial, Pro y Titanium a cotizar",
              "US$29/mes (1 profesional), US$69/mes (hasta 3), Red a medida",
            ],
            [
              "Prueba gratis",
              "No publica; demo o acceso de prueba con ventas",
              "14 días sin tarjeta",
            ],
            [
              "Odontograma",
              "Sí, con periodontograma",
              "Sí, FDI versionado, con estado (existente o por realizar) y periodontograma",
            ],
            [
              "WhatsApp",
              "Arma el mensaje y se envía desde WhatsApp Web; contact center con IA para automatizar",
              "Recordatorios 48 h y 3 h en modo manual; número propio vía Meta en habilitación; ninguno sale solo",
            ],
            [
              "IA",
              "Notas por voz, resumen clínico, simulador de sonrisas, rayos X, reportes, contact center",
              "Patty (en habilitación): notas SOAP, resumen de la nota y lectura de pedidos de hora por WhatsApp",
            ],
            [
              "Sin internet",
              "Su web dice que funciona 100 % en la nube; no menciona modo sin conexión",
              "Sí, sincroniza al volver la conexión",
            ],
            [
              "Boleta o factura electrónica",
              "Sí, boleta electrónica si tu plan incluye el servicio",
              "No",
            ],
            [
              "Aseguradoras",
              "Conexión en línea con aseguradoras",
              "Sin conexión en línea con aseguradoras",
            ],
            [
              "Trayectoria",
              "Según su web: más de 16 años, más de 15.000 clínicas, más de 20 países",
              "Lanzado en 2026; Chile, Perú, México, Colombia y Argentina",
            ],
          ],
          nota: "Datos de Dentalink tomados de su web y su centro de ayuda el 11-oct-2026.",
        },
      ],
    },
    {
      h2: "¿En qué gana Dentalink?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Facturación.** Emite boleta electrónica desde el sistema, siempre que tu plan incluya el servicio. Si tu contador te pide que salga todo del mismo software, este punto pesa mucho.",
            "**Trayectoria y escala.** Más de 16 años y más de 15.000 clínicas, según su web.",
            "**Herramientas de IA.** Su web publica ocho, entre ellas análisis de rayos X, simulador de sonrisas, reportes que responden preguntas y un contact center que atiende WhatsApp y teléfono.",
            "**Módulos de gestión.** Multicentro, comisiones, gastos e inventario en el plan Pro; ortodoncia, encuestas y campañas por email en Titanium.",
            "**Aseguradoras.** Su web publica conexión en línea con aseguradoras; Esmalia no la ofrece.",
          ],
        },
      ],
    },
    {
      h2: "¿Cuándo conviene Esmalia?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Quieres saber cuánto pagas antes de hablar con nadie.** El precio está en [precios](/precios): US$29 al mes para un profesional, US$69 para hasta tres. El cobro es en dólares por Stripe y quienes entran ahora conservan el precio mientras sean clientes.",
            "**Tu internet falla.** Con Esmalia sigues viendo la agenda y las fichas, cobrando y marcando el odontograma sin conexión. Todo se sincroniza solo cuando vuelve. Ver [sin internet](/funciones/sin-internet).",
            "**Prefieres que la IA proponga y tú decidas.** Patty, hoy en habilitación, pasará tus apuntes a una nota SOAP y resumirá la nota anterior, pero no firma, no le escribe a pacientes y no mueve la agenda. Ver [Patty IA](/funciones/patty-ia).",
            "**Quieres WhatsApp sin depender de WhatsApp Web abierto.** Esmalia trabaja en modo manual desde el primer día y, si conectas tu número a Meta, envía desde tu propio número. En los dos modos, alguien de tu clínica dispara el mensaje. Ver [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
            "**Quieres poder llevarte todo cuando quieras.** Desde Ajustes descargas un ZIP con pacientes, citas, notas con todas sus versiones, odontograma con historial, presupuestos, pagos y consentimientos, más los archivos del paciente.",
            "**Quieres seguir viendo tus datos aunque no pagues.** Si no te suscribes después de la prueba, la agenda, los pacientes y la ficha siguen abiertos. Finanzas, comisiones, inventario e informes se activan al suscribirte.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Esmalia no emite boleta ni factura electrónica en ningún país. Si la necesitas dentro del software, hoy Dentalink te sirve mejor en ese punto.",
        },
      ],
    },
    {
      h2: "¿Cómo funciona el WhatsApp en cada uno?",
      bloques: [
        {
          tipo: "p",
          texto:
            "En Dentalink, según su centro de ayuda, el administrador configura un mensaje, inicias sesión en WhatsApp Web con el número de la clínica y, desde la agenda del día, el sistema te lleva al chat con el mensaje listo para enviar. Si quieres automatizarlo, ofrece un contact center con IA que atiende WhatsApp y teléfono.",
        },
        {
          tipo: "p",
          texto:
            "En Esmalia, la pantalla de recordatorios junta las citas que necesitan aviso 48 h y 3 h antes. En modo manual, cada mensaje se abre en WhatsApp con el texto escrito y tú presionas enviar. Con tu número conectado a Meta, los mensajes salen desde tu número con plantillas aprobadas, pero igual los despacha tu equipo. Si un paciente responde BAJA o STOP, deja de recibir mensajes de seguimiento. Detalle en [docs de WhatsApp](/docs/whatsapp).",
        },
      ],
    },
    {
      h2: "¿Qué preguntar antes de decidir?",
      bloques: [
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "¿Cuánto pagarás al mes con tus profesionales y sedes, con todos los complementos?",
            "¿Necesitas emitir boleta desde el software o ya lo haces con otro sistema?",
            "¿Cuántas veces al mes se te corta internet en la clínica?",
            "¿Quién va a enviar los recordatorios y desde qué número?",
            "¿Cómo te llevas tus datos si un día cambias de sistema?",
          ],
        },
        {
          tipo: "p",
          texto:
            "Puedes ver Esmalia por dentro en la [demo](/demo), con datos de prueba, sin tarjeta ni contraseña.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Es mejor Esmalia o Dentalink?",
      a: "Depende de tu clínica. Dentalink tiene más trayectoria según su web, emite boleta electrónica si tu plan la incluye y publica ocho herramientas de IA. Esmalia conviene a consultorios de 1 a 3 profesionales que quieren precio publicado, trabajar sin internet y WhatsApp revisado por su equipo.",
    },
    {
      q: "¿Cuánto cuesta Dentalink?",
      a: "Dentalink no publica precios en su web al 11-oct-2026. Tiene planes Esencial, Pro y Titanium y pide cotizar con su equipo de ventas.",
    },
    {
      q: "¿Esmalia emite boleta electrónica como Dentalink?",
      a: "No. Esmalia no emite boleta, factura ni ningún DTE. Dentalink sí emite boleta electrónica si tu plan incluye el servicio.",
    },
    {
      q: "¿Dentalink funciona sin internet?",
      a: "Su web dice que funciona 100 % en la nube y que una conexión estable de 2 Mbps es suficiente; no menciona un modo sin conexión (revisado el 11-oct-2026). Esmalia sigue funcionando sin internet y sincroniza cuando vuelve la conexión; WhatsApp sí necesita conexión.",
    },
  ],
  fuentes: [
    { titulo: "Dentalink: inicio", url: "https://www.softwaredentalink.com/" },
    { titulo: "Dentalink: planes", url: "https://www.softwaredentalink.com/planes" },
    {
      titulo: "Dentalink: inteligencia artificial",
      url: "https://www.softwaredentalink.com/inteligencia-artificial",
    },
    {
      titulo: "Dentalink: emite tus boletas electrónicas",
      url: "https://intercom.help/softwaredentalink/es/articles/9493502-emite-tus-boletas-electronicas",
    },
    {
      titulo: "Dentalink: cómo notificar cita por WhatsApp",
      url: "https://intercom.help/softwaredentalink/es/articles/9493137-como-notificar-cita-por-whatsapp",
    },
  ],
  relacionados: [
    "/alternativas/dentalink",
    "/comparar/mejores-software-dental-chile",
    "/funciones/sin-internet",
    "/funciones/patty-ia",
    "/funciones/recordatorios-whatsapp",
    "/precios",
  ],
  enUnaLinea:
    "Esmalia frente a Dentalink: precio, WhatsApp, IA, uso sin internet, boleta electrónica y en qué gana cada uno.",
};
