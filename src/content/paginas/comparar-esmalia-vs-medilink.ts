import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "comparar",
  path: "/comparar/esmalia-vs-medilink",
  titulo: "Esmalia vs Medilink: comparativa 2026 | Esmalia",
  descripcion:
    "Medilink es un software médico para todas las especialidades; Esmalia, uno dental. Comparamos precio, odontograma, WhatsApp, IA, boleta y uso sin internet.",
  kicker: "Comparativa",
  h1: "Esmalia vs Medilink: ¿cuál conviene a una clínica dental?",
  resumen:
    "Medilink se presenta como software para todas las especialidades médicas, con más de 15.000 clientes según su web; emite boletas desde el plan Pro y no publica precios. Su web no menciona odontograma. Esmalia es solo dental: odontograma FDI con periodontograma, precio publicado (US$29 o US$69 al mes) y uso sin internet. No emite boleta ni factura.",
  publicado: "2026-10-19",
  actualizado: "2026-10-19",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿En qué se diferencian Esmalia y Medilink?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "Esmalia es nuestro producto. Relevamos los datos de Medilink el 19-oct-2026 en su web oficial (inicio, planes y preguntas frecuentes); si algo cambió, escríbenos a hola@esmalia.com y lo corregimos.",
        },
        {
          tipo: "p",
          texto:
            "Medilink es un software médico general: su FAQ dice que está diseñado para cubrir la gestión de todas las especialidades médicas, y su web tiene páginas para kinesiología, psicología, nutrición, oftalmología, estética y otras. No encontramos una página de odontología ni la palabra odontograma en su inicio, sus planes o su FAQ. En el pie de su web aparece en la misma familia de marcas que Dentalink, el software dental del grupo. Esmalia está hecha solo para odontología y apunta a consultorios de 1 a 3 profesionales.",
        },
        {
          tipo: "tabla",
          columnas: ["", "Medilink", "Esmalia"],
          filas: [
            [
              "Precio",
              "No publica; según su FAQ depende del plan (Esencial, Pro o Titanium) y de la cantidad de profesionales o sillones",
              "US$29/mes (1 profesional), US$69/mes (hasta 3), Red a medida",
            ],
            [
              "Prueba gratis",
              "No publica; demo por videollamada con un asesor",
              "14 días sin tarjeta",
            ],
            [
              "Para quién",
              "Todo tipo de centros de salud y especialidades médicas",
              "Solo clínicas dentales",
            ],
            [
              "Odontograma",
              "No lo menciona en inicio, planes ni FAQ",
              "Sí: FDI versionado, con estado (existente o por realizar) y periodontograma",
            ],
            [
              "WhatsApp",
              "Recordatorios por WhatsApp gestionados en todos los planes; confirmaciones de citas como adicional; su FAQ dice que el envío es ilimitado",
              "Recordatorios 48 h y 3 h que envía tu equipo en modo manual; número propio vía Meta en habilitación; ninguno sale solo",
            ],
            [
              "IA",
              "Notas clínicas con IA, resumen clínico y Contralor IA incluidos; Contact Center IA y Reportes IA como adicionales",
              "Patty (en habilitación): notas SOAP y resumen de la nota; no le escribe sola a pacientes",
            ],
            [
              "Consentimientos y recetas",
              "Consentimientos informados y recetas con vademécum; firma electrónica como adicional",
              "8 plantillas de consentimiento para revisar y adaptar, firma en pantalla y recetas con PDF imprimible",
            ],
            [
              "Boleta o factura electrónica",
              "Emisión de boletas e integración con facturadores electrónicos desde el plan Pro",
              "No",
            ],
            [
              "Sin internet",
              "Su FAQ dice que funciona 100 % online, mientras haya navegador y conexión a internet",
              "Sí, sincroniza al volver la conexión",
            ],
            [
              "Tus datos si te vas",
              "Su FAQ dice que, si das de baja el servicio, la información generada se devuelve al cliente",
              "Descargas todo en un ZIP desde Ajustes cuando quieras, sin pedirlo a nadie",
            ],
            [
              "Trayectoria",
              "Según su web: más de 16 años, más de 15.000 clientes y más de 20 países",
              "Lanzado en 2026; Chile, Perú, México, Colombia y Argentina",
            ],
          ],
          nota: "Datos de Medilink tomados de softwaremedilink.com (inicio, /planes y /preguntas-frecuentes) el 19-oct-2026.",
        },
      ],
    },
    {
      h2: "¿En qué gana Medilink?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Varias especialidades en un mismo sistema.** Si tu centro combina odontología con kinesiología, nutrición o psicología, Medilink está pensado para eso. Esmalia es solo dental.",
            "**Boleta y facturación.** Desde el plan Pro emite boletas y se integra con facturadores electrónicos. Esmalia no emite boleta ni factura en ningún país.",
            "**Telemedicina.** Viene incluida en todos sus planes. Esmalia no tiene telemedicina.",
            "**Más herramientas de IA.** Notas clínicas con IA, resumen clínico y Contralor IA incluidos, y un contact center que atiende WhatsApp y llamadas como adicional.",
            "**Módulos de gestión.** Remuneraciones, flujo de caja, email marketing, encuestas, laboratorios y exámenes según el plan, y más de 80 reportes descargables. Sobre el inventario, su página de planes no coincide: la tarjeta del plan Pro lo incluye y la tabla comparativa lo deja solo en Titanium.",
            "**Trayectoria.** Más de 16 años y más de 15.000 clientes, según su web.",
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
            "**Tu clínica es solo dental.** El odontograma FDI registra varias condiciones por pieza, con su estado (existente o por realizar), y en la misma pestaña está el periodontograma. Ver [odontograma](/funciones/odontograma).",
            "**Quieres saber cuánto pagas antes de hablar con nadie.** US$29 al mes para un profesional y US$69 para hasta tres, en [precios](/precios). El cobro es en dólares por Stripe.",
            "**Se te corta internet.** Agenda, fichas, cobros y odontograma siguen funcionando y se sincronizan al volver la conexión. Ver [sin internet](/funciones/sin-internet).",
            "**Quieres que tu equipo revise cada WhatsApp.** Esmalia arma los recordatorios y alguien de tu clínica los envía. Ver [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
            "**Quieres poder irte cuando quieras.** Desde Ajustes descargas un ZIP con pacientes, citas, notas clínicas con todas sus versiones, odontograma con historial, presupuestos, pagos y consentimientos, más los archivos del paciente.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Esmalia no emite boleta ni factura, no tiene telemedicina y no es para centros con varias especialidades médicas. Además, está en etapa piloto: tiene mucha menos trayectoria que Medilink.",
        },
      ],
    },
    {
      h2: "¿Y si buscas el software dental del mismo grupo?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Si te gusta cómo trabaja Medilink pero tu clínica es dental, compara también con Dentalink, que aparece en la misma familia de marcas en el pie de la web de Medilink. Lo tenemos en [Esmalia vs Dentalink](/comparar/esmalia-vs-dentalink) y en [alternativas a Dentalink](/alternativas/dentalink).",
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
            "¿El software trae odontograma y periodontograma, o tendrás que pedirlo como ficha personalizada?",
            "¿Cuánto pagarás al mes con tus profesionales, sillones y adicionales?",
            "¿Necesitas emitir boleta desde el software o ya lo haces con otro sistema?",
            "¿Qué pasa con la atención si se corta internet en la clínica?",
            "¿Puedes descargar todos tus datos tú mismo, o tienes que pedirlos?",
          ],
        },
        {
          tipo: "p",
          texto:
            "Puedes ver Esmalia por dentro en la [demo](/demo), con datos de prueba y sin tarjeta.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Medilink sirve para clínicas dentales?",
      a: "Medilink se presenta como software para todas las especialidades médicas. Al 19-oct-2026 su inicio, su página de planes y su FAQ no mencionan odontograma. Para odontología, el mismo grupo ofrece Dentalink. Esmalia es solo dental.",
    },
    {
      q: "¿Cuánto cuesta Medilink?",
      a: "Medilink no publica precios en su web al 19-oct-2026. Según su FAQ, la tarifa depende del plan (Esencial, Pro o Titanium) y de la cantidad de profesionales o sillones. Esmalia cuesta US$29 al mes para un profesional y US$69 para hasta tres.",
    },
    {
      q: "¿Medilink funciona sin internet?",
      a: "Su FAQ dice que funciona 100 % online, mientras haya navegador y conexión a internet. Esmalia sigue funcionando sin conexión y sincroniza cuando vuelve; WhatsApp sí necesita conexión.",
    },
    {
      q: "¿Esmalia emite boleta como Medilink?",
      a: "No. Esmalia no emite boleta, factura ni ningún documento tributario. Medilink emite boletas e integra facturadores electrónicos desde su plan Pro.",
    },
  ],
  fuentes: [
    { titulo: "Medilink: inicio", url: "https://www.softwaremedilink.com/" },
    { titulo: "Medilink: planes", url: "https://www.softwaremedilink.com/planes" },
    {
      titulo: "Medilink: preguntas frecuentes",
      url: "https://www.softwaremedilink.com/preguntas-frecuentes",
    },
    {
      titulo: "Medilink: inteligencia artificial",
      url: "https://www.softwaremedilink.com/inteligencia-artificial",
    },
  ],
  relacionados: [
    "/comparar/esmalia-vs-dentalink",
    "/alternativas/dentalink",
    "/comparar/mejores-software-dental-chile",
    "/funciones/odontograma",
    "/funciones/sin-internet",
    "/guias/ia-en-odontologia",
    "/precios",
  ],
  enUnaLinea:
    "Esmalia frente a Medilink, un software médico para todas las especialidades: odontograma, precio, WhatsApp, IA, boleta y uso sin internet.",
};
