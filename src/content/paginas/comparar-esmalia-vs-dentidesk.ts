import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "comparar",
  path: "/comparar/esmalia-vs-dentidesk",
  titulo: "Esmalia vs Dentidesk: comparativa 2026 | Esmalia",
  descripcion:
    "Esmalia vs Dentidesk: precio, prueba gratis, odontograma, boleta con el SII, WhatsApp, IA y uso sin internet. En qué gana cada uno y cuándo conviene cuál.",
  kicker: "Comparativa",
  h1: "Esmalia vs Dentidesk: ¿cuál conviene a tu clínica?",
  resumen:
    "Dentidesk es un software dental chileno que emite boletas y facturas integradas con el SII, da 15 días de prueba y tiene fichas de especialidad; no publica precios y su WhatsApp automático está anunciado como próximo. Esmalia publica su precio (US$29 o US$69 al mes), da 14 días sin tarjeta y sigue funcionando sin internet. No emite boleta ni factura.",
  publicado: "2026-10-19",
  actualizado: "2026-10-19",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿En qué se diferencian Esmalia y Dentidesk?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "Esmalia es nuestro producto. Relevamos los datos de Dentidesk el 19-oct-2026 en su web oficial (inicio, características, soluciones y noticias); si algo cambió, escríbenos a hola@esmalia.com y lo corregimos.",
        },
        {
          tipo: "p",
          texto:
            "Los dos son software dentales con agenda, ficha, odontograma, presupuestos, consentimientos y recetas. Dentidesk tiene su oficina en Santiago, fuerte integración tributaria con el SII y fichas para varias especialidades. Esmalia es más chica, está en etapa piloto y apunta a consultorios de 1 a 3 profesionales en cinco países.",
        },
        {
          tipo: "tabla",
          columnas: ["", "Dentidesk", "Esmalia"],
          filas: [
            [
              "Precio",
              "No publica; ofrece demo gratis con un asesor",
              "US$29/mes (1 profesional), US$69/mes (hasta 3), Red a medida",
            ],
            ["Prueba gratis", "15 días con acceso completo", "14 días sin tarjeta"],
            [
              "Odontograma",
              "Sí, con nomenclatura chilena, internacional o universal; fichas de disfunción, endodoncia, periodoncia, cirugía ortognática y ortodoncia",
              "Sí: FDI versionado, con varias condiciones por pieza, estado (existente o por realizar) y periodontograma",
            ],
            [
              "Boleta o factura electrónica",
              "Sí: boletas y facturas integradas con el SII; integración con Alegra para República Dominicana",
              "No",
            ],
            [
              "WhatsApp",
              "Correo de confirmación un día antes; WhatsApp automático anunciado como próximo (noticia del 13-ago-2026)",
              "Recordatorios 48 h y 3 h que envía tu equipo en modo manual; número propio vía Meta en habilitación",
            ],
            [
              "IA",
              "Dictado por voz en el historial clínico (noticia del 30-abr-2026)",
              "Patty (en habilitación): notas SOAP y resumen de la nota; no le escribe sola a pacientes",
            ],
            [
              "Consentimientos",
              "Librería de consentimientos y documentos; firma digital de consentimientos destacada en su inicio; consentimiento automático anunciado como próximo",
              "8 plantillas de consentimiento para revisar y adaptar, con firma en pantalla y registro de quién informó y quién firmó",
            ],
            [
              "Recetas",
              "Sí, con plantillas de recetas",
              "Sí: recetas que no se editan una vez emitidas, con PDF imprimible y aviso de alergias",
            ],
            [
              "Sin internet",
              "Su web no menciona un modo sin conexión",
              "Sí, sincroniza al volver la conexión",
            ],
            [
              "App móvil",
              "Sí, en App Store y Google Play",
              "No está en las tiendas; se instala desde el navegador",
            ],
            [
              "Migración",
              "Su equipo te ayuda a migrar la información de tu clínica",
              "Importación de pacientes por CSV en todos los planes; migración acompañada en el plan Red",
            ],
          ],
          nota: "Datos de Dentidesk tomados de dentidesk.com el 19-oct-2026. El enlace a su FAQ (en Freshdesk) no cargaba ese día.",
        },
      ],
    },
    {
      h2: "¿En qué gana Dentidesk?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Boletas y facturas con el SII.** Las emite desde la plataforma, según su web. Si tu contador te pide que todo salga del mismo sistema, este punto pesa mucho. Esmalia no emite boleta ni factura en ningún país.",
            "**Fichas de especialidad.** Publica fichas de disfunción, endodoncia, periodoncia, cirugía ortognática y ortodoncia, además de interconsultas y derivaciones.",
            "**Más días de prueba.** 15 días con acceso completo, frente a los 14 de Esmalia.",
            "**App en las tiendas.** Tiene app en App Store y Google Play.",
            "**Gestión y reportes.** Insumos y stock, más de 20 tipos de reportes financieros y administrativos, liquidaciones por producción, multisucursal y el informe REMASEP para el Ministerio de Salud.",
            "**Migración con su equipo.** Su web ofrece migrar los datos de tu clínica con acompañamiento.",
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
            "**Quieres saber cuánto pagas antes de hablar con nadie.** US$29 al mes para un profesional y US$69 para hasta tres, en [precios](/precios). El cobro es en dólares por Stripe.",
            "**Quieres recordatorios por WhatsApp desde el primer día.** Esmalia arma los avisos 48 h y 3 h antes y alguien de tu clínica los envía con un toque. Ver [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
            "**Se te corta internet.** Agenda, fichas, cobros y odontograma siguen funcionando y se sincronizan al volver la conexión. Ver [sin internet](/funciones/sin-internet).",
            "**Atiendes fuera de Chile.** Esmalia funciona en Chile, Perú, México, Colombia y Argentina, con la moneda y la zona horaria de tu país.",
            "**Quieres poder llevarte todo cuando quieras.** Desde Ajustes descargas un ZIP con pacientes, citas, notas con todas sus versiones, odontograma con historial, presupuestos, pagos y consentimientos, más los archivos del paciente.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Esmalia no emite boleta ni factura electrónica, no tiene app en las tiendas y no publica fichas de especialidad como las de Dentidesk. Si emites boletas con el SII desde tu software, hoy Dentidesk te sirve mejor en ese punto. Esmalia, además, está en etapa piloto.",
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
            "¿Cuánto pagarás al mes con tus profesionales, sucursales y servicios adicionales, como la firma digital?",
            "¿Necesitas emitir boleta desde el software o ya lo haces con otro sistema?",
            "¿Cómo vas a enviar los recordatorios por WhatsApp hoy, no cuando llegue la próxima versión?",
            "¿Qué pasa con la atención si se corta internet en la clínica?",
            "¿Cómo te llevas tus datos si un día cambias de sistema?",
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
      q: "¿Es mejor Esmalia o Dentidesk?",
      a: "Depende de tu clínica. Dentidesk emite boletas y facturas con el SII, tiene fichas de especialidad y app en las tiendas. Esmalia conviene a consultorios de 1 a 3 profesionales que quieren precio publicado, recordatorios por WhatsApp desde el primer día y trabajar sin internet.",
    },
    {
      q: "¿Cuánto cuesta Dentidesk?",
      a: "Dentidesk no publica precios en su web al 19-oct-2026. Ofrece una prueba gratis de 15 días y demos con un asesor.",
    },
    {
      q: "¿Dentidesk envía recordatorios por WhatsApp?",
      a: "Su web publica correos de confirmación un día antes de la cita. En una noticia del 13-ago-2026 anunció el WhatsApp automático como una de sus próximas integraciones. Esmalia arma recordatorios 48 h y 3 h antes que tu equipo envía desde WhatsApp.",
    },
    {
      q: "¿Esmalia emite boleta como Dentidesk?",
      a: "No. Esmalia no emite boleta, factura ni ningún documento tributario. Dentidesk sí emite boletas y facturas integradas con el SII.",
    },
  ],
  fuentes: [
    { titulo: "Dentidesk: inicio", url: "https://www.dentidesk.com/" },
    { titulo: "Dentidesk: características", url: "https://www.dentidesk.com/dentidesk/feature" },
    { titulo: "Dentidesk: soluciones", url: "https://www.dentidesk.com/dentidesk/solution" },
    {
      titulo: "Dentidesk: dictado por voz (30-abr-2026)",
      url: "https://www.dentidesk.com/dentidesk/detail/45",
    },
    {
      titulo: "Dentidesk: integración con Alegra (14-may-2026)",
      url: "https://www.dentidesk.com/dentidesk/detail/47",
    },
    {
      titulo: "Dentidesk: odontograma, REMASEP e integraciones (13-ago-2026)",
      url: "https://www.dentidesk.com/dentidesk/detail/48",
    },
  ],
  relacionados: [
    "/comparar/mejores-software-dental-chile",
    "/alternativas/dentalink",
    "/comparar/esmalia-vs-dentalink",
    "/funciones/recordatorios-whatsapp",
    "/funciones/sin-internet",
    "/precios",
  ],
  enUnaLinea:
    "Esmalia frente a Dentidesk: precio, prueba gratis, odontograma, boleta con el SII, WhatsApp, IA y uso sin internet.",
};
