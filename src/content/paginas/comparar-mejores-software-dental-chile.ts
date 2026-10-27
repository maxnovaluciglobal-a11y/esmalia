import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "comparar",
  path: "/comparar/mejores-software-dental-chile",
  titulo: "Mejores software dental en Chile 2026 | Esmalia",
  descripcion:
    "Comparamos 8 software dentales en Chile: precio publicado, odontograma, WhatsApp, IA, uso sin internet, boleta o factura electrónica y prueba gratis.",
  kicker: "Comparativa",
  h1: "Mejores software dentales en Chile (2026)",
  resumen:
    "No hay un software dental que sea el mejor para todas las clínicas de Chile. Según su web, Dentalink tiene más de 15.000 clínicas y emite boleta electrónica si tu plan incluye el servicio. AgendaPro se ofrece para varios rubros, no solo dental. Doctocliq tiene plan gratis. Esmalia conviene si quieres WhatsApp revisado por tu equipo, IA para notas y trabajar sin internet.",
  publicado: "2026-10-11",
  actualizado: "2026-10-19",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Cómo armamos esta comparativa?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "Esmalia es nuestro producto. Relevamos estos datos el 11-oct-2026 en las webs oficiales y revisamos de nuevo Clinera, Dentidesk y Esmalia el 19-oct-2026. Si algo cambió, escríbenos a hola@esmalia.com y lo corregimos.",
        },
        {
          tipo: "p",
          texto:
            "Entramos a la web oficial de cada software y anotamos solo lo que publica. Si una función no aparece en su sitio, la tabla dice **no indica**: no significa que no exista, significa que no lo encontramos publicado. Si no muestran precio, dice **no publica**. Cada dato tiene su enlace en las fuentes al pie.",
        },
        {
          tipo: "p",
          texto:
            "Dejamos fuera a Medilink: su web lo presenta como software para todo tipo de centros de salud y su página de inicio no menciona odontograma. Si tu consulta es solo dental, en esta lista hay opciones más específicas. La comparación uno a uno está en [Esmalia vs Medilink](/comparar/esmalia-vs-medilink).",
        },
      ],
    },
    {
      h2: "¿Qué ofrece cada software dental en Chile?",
      bloques: [
        {
          tipo: "tabla",
          columnas: [
            "Software",
            "Precio publicado",
            "Odontograma",
            "WhatsApp",
            "IA",
            "Sin internet",
            "Boleta o factura electrónica",
            "Prueba gratis",
          ],
          filas: [
            [
              "Dentalink",
              "No publica (cotización)",
              "Sí, con periodontograma",
              "Sí: mensaje armado que se envía desde WhatsApp Web",
              "Sí: notas por voz, resumen clínico, rayos X, contact center",
              "No indica modo sin conexión; su web dice que funciona 100 % en la nube",
              "Sí, boleta electrónica si tu plan incluye el servicio",
              "No publica; demo o acceso de prueba con ventas",
            ],
            [
              "AgendaPro",
              "Desde $15.900/mes + IVA; ficha clínica desde Premium ($54.900 + IVA)",
              "Sí, como anexo de la ficha (página de México)",
              "Sí: 50 a 200 confirmaciones al mes según plan",
              'No indica como IA; ofrece Charly, "experto en marketing inteligente", desde $149.900/mes + IVA',
              "No indica",
              "Sí en plan Pro; como complemento desde 2 UF/mes + IVA",
              "Sí, 7 días",
            ],
            [
              "Doctocliq",
              "Gratis, US$19, US$29 y US$49 al mes (1 doctor por plan)",
              "Sí, con periodontograma",
              "Sí: recordatorios automáticos, 50 a 150 al mes según plan; gratis en planes semestrales y anuales",
              "Sí: Soyla IA, como complemento",
              "No indica modo sin conexión; su FAQ dice que requiere conexión a internet",
              "Complemento en Perú, México, Colombia, Ecuador y República Dominicana; no menciona Chile",
              "Sí, 7 días del plan Avanzado sin tarjeta, y plan gratis",
            ],
            [
              "Dentidesk",
              "No publica",
              "Sí",
              "WhatsApp automático anunciado como próximo",
              "No indica (tiene dictado por voz en el historial)",
              "No indica",
              "Sí: boletas y facturas integradas con el SII",
              "Sí, 15 días",
            ],
            [
              "Clinera",
              "US$279/mes (Vortex) o US$379/mes con marketing (Ecosistema), más USD 450 de implementación",
              "Sí, FDI por pieza y cara; su web aclara que no es periodontograma",
              "Sí, con la API oficial de WhatsApp Business",
              "Sí: agente AURA que responde y agenda por WhatsApp, Instagram y Facebook",
              "No indica",
              "Sí: DTE con Open Factura (SII)",
              "No indica; se contrata por videollamada",
            ],
            [
              "Reservo",
              "No publica (plan único según tamaño del centro)",
              "No indica",
              "No indica",
              "No indica",
              "No indica",
              "Sí, boleta electrónica",
              "Demo gratis",
            ],
            [
              "Dentalsoft",
              "No publica",
              "Sí",
              "No indica (solo soporte por WhatsApp)",
              "No indica",
              "No indica",
              "No indica",
              "No indica; ofrece demos por Google Meet",
            ],
            [
              "Esmalia",
              "US$19,99/mes (1 profesional), US$49,99/mes (hasta 3), Red a medida",
              "Sí, FDI versionado, con estado (existente o por realizar) y periodontograma",
              "Sí: recordatorios 48 h y 3 h; ninguno sale solo",
              "En habilitación: Patty, para notas SOAP y resúmenes",
              "Sí, sincroniza al volver la conexión",
              "No",
              "Sí, 14 días sin tarjeta",
            ],
          ],
          nota: "Datos relevados el 11-oct-2026 en las webs oficiales; Clinera, Dentidesk y Esmalia, revisados el 19-oct-2026. Precios de AgendaPro en pesos chilenos; los de Doctocliq, Clinera y Esmalia, en dólares.",
        },
      ],
    },
    {
      h2: "¿Cuál conviene según tu clínica?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Necesitas emitir boleta o factura desde el mismo sistema:** Dentalink (si tu plan lo incluye), Dentidesk, Clinera o AgendaPro Pro. Esmalia no lo hace.",
            "**Quieres probar sin pagar ni hablar con ventas:** Doctocliq tiene plan gratis; Esmalia da 14 días sin tarjeta; Dentidesk, 15 días; AgendaPro, 7.",
            "**Atiendes varios rubros (dental, estética, fisioterapia):** AgendaPro, que según su web ofrece el sistema a esos rubros y declara más de 30.000 negocios en Latinoamérica.",
            "**Quieres un asistente de IA que agende solo por WhatsApp:** Clinera o el contact center de Dentalink. Esmalia, a propósito, no le escribe solo a ningún paciente.",
            "**Se te corta internet en la clínica:** Esmalia sigue funcionando y sincroniza después. Doctocliq dice en su FAQ que requiere conexión a internet y Dentalink, que funciona 100 % en la nube. Las demás webs no mencionan un modo sin conexión; consúltalo con cada proveedor.",
          ],
        },
      ],
    },
    {
      h2: "¿En qué gana cada uno?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Dentalink:** según su web, más de 16 años, más de 15.000 clínicas y más de 20 países. Publica periodontograma, software para ortodoncia en su plan Titanium, conexión en línea con aseguradoras y ocho herramientas de IA.",
            "**AgendaPro:** precios de planes publicados en pesos, ficha clínica, pagos y facturación en un mismo lugar, y más de 30.000 negocios en Latinoamérica según su web.",
            "**Doctocliq:** el plan gratis y los precios públicos en dólares. Ofrece facturación electrónica como complemento en Perú, México, Ecuador y Colombia.",
            "**Dentidesk:** boletas y facturas integradas con el SII, fichas de especialidad (endodoncia, periodoncia, ortodoncia, cirugía ortognática) y 15 días de prueba. Ver [Esmalia vs Dentidesk](/comparar/esmalia-vs-dentidesk).",
            "**Clinera:** un agente de IA que responde y agenda por WhatsApp, Instagram y Facebook, odontograma FDI y emisión de DTE con Open Factura. Su plan Ecosistema suma campañas de marketing.",
            "**Reservo:** plan único con todas las funciones y usuarios ilimitados.",
            "**Dentalsoft:** odontograma en su plan DS Standard y demos guiadas por Google Meet.",
          ],
        },
      ],
    },
    {
      h2: "¿Cuándo conviene Esmalia?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Esmalia está pensada para consultorios de un profesional y clínicas de hasta tres. Conviene si quieres saber cuánto vas a pagar antes de hablar con nadie ([ver precios](/precios)), si tu internet falla y no quieres dejar de atender ([cómo funciona sin internet](/funciones/sin-internet)), o si prefieres que los recordatorios de WhatsApp los revise alguien de tu equipo antes de salir ([recordatorios por WhatsApp](/funciones/recordatorios-whatsapp)).",
        },
        {
          tipo: "p",
          texto:
            "Patty, la IA de Esmalia, está en habilitación: pasará tus apuntes a una nota SOAP y resumirá la nota clínica para la próxima consulta. La lectura de pedidos de hora por WhatsApp llegará con el número conectado. No firma notas, no le escribe a pacientes y no mueve la agenda. Más en [Patty IA](/funciones/patty-ia).",
        },
        {
          tipo: "aviso",
          texto:
            "Esmalia no emite boleta ni factura electrónica (DTE) en ningún país. Si eso es obligatorio para ti dentro del software, hoy te sirve más otra opción de esta tabla. Además, Esmalia está en etapa piloto: tiene menos trayectoria que Dentalink o AgendaPro. Esta tabla es solo de Chile, pero Esmalia también funciona en Perú, México, Colombia y Argentina.",
        },
      ],
    },
    {
      h2: "¿Qué revisar antes de elegir?",
      bloques: [
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "Pide el precio total por escrito: por profesional, por sede, complementos y costo de instalación.",
            "Pregunta qué plan trae ficha clínica, odontograma y WhatsApp. En algunos software no vienen en el plan de entrada.",
            "Confirma cuántos mensajes de WhatsApp incluye y cuánto cuestan los extra.",
            "Revisa si necesitas emitir boleta o factura desde el sistema o si ya lo haces aparte.",
            "Pregunta cómo sacas tus datos si te vas. En Esmalia los exportas tú mismo desde Ajustes en cualquier momento, en un ZIP con planillas CSV y los archivos del paciente, también antes de cerrar la cuenta ([FAQ](/faq)).",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Cuál es el mejor software dental en Chile?",
      a: "Depende de tu clínica. Dentalink declara más de 15.000 clínicas en su web y emite boleta electrónica si tu plan incluye el servicio. AgendaPro encaja si atiendes varios rubros. Doctocliq tiene plan gratis. Esmalia conviene a consultorios de 1 a 3 profesionales que quieren precio publicado, trabajo sin internet y WhatsApp revisado por su equipo.",
    },
    {
      q: "¿Qué software dental emite boleta electrónica en Chile?",
      a: "Según sus webs: Dentalink (si el plan incluye el servicio), Dentidesk (boletas y facturas integradas con el SII), Clinera (DTE con Open Factura), AgendaPro (plan Pro o complemento) y Reservo (boleta electrónica). Revisado el 11-oct-2026; Clinera y Dentidesk, el 19-oct-2026. Esmalia no emite DTE.",
    },
    {
      q: "¿Cuál es el software dental más barato en Chile?",
      a: "Doctocliq tiene un plan gratis limitado a 30 pacientes o citas al mes. Entre los planes pagos con precio publicado, AgendaPro parte en $15.900 + IVA sin ficha clínica, Doctocliq en US$19 y Esmalia en US$19,99 con ficha y odontograma incluidos.",
    },
    {
      q: "¿Qué software dental funciona sin internet?",
      a: "Esmalia sigue funcionando sin conexión y sincroniza cuando vuelve. Doctocliq dice en su FAQ que requiere conexión a internet; Dentalink dice que funciona 100 % en la nube. Las demás webs no mencionan un modo sin conexión (revisado el 11-oct-2026).",
    },
    {
      q: "¿Esmalia emite factura electrónica?",
      a: "No. Esmalia no emite boleta, factura ni ningún DTE. Si lo necesitas dentro del software, revisa Dentalink, Dentidesk o AgendaPro.",
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
    { titulo: "AgendaPro: planes Chile", url: "https://agendapro.com/cl/planes" },
    {
      titulo: "AgendaPro: software dental Chile",
      url: "https://agendapro.com/cl/dental/software-odontologico",
    },
    { titulo: "AgendaPro: Charly", url: "https://agendapro.com/cl/charly" },
    {
      titulo: "AgendaPro: software dental México (odontograma)",
      url: "https://agendapro.com/mx/dental/software-odontologico",
    },
    {
      titulo: "AgendaPro: crear cuenta (prueba de 7 días)",
      url: "https://agendapro.com/es/signup",
    },
    { titulo: "Doctocliq: inicio y preguntas frecuentes", url: "https://doctocliq.com" },
    { titulo: "Doctocliq: planes y precios", url: "https://www.doctocliq.com/planes-y-precios" },
    { titulo: "Dentidesk: inicio", url: "https://www.dentidesk.com" },
    { titulo: "Clinera: inicio", url: "https://clinera.io" },
    { titulo: "Clinera: planes", url: "https://clinera.io/planes" },
    { titulo: "Clinera: software dental", url: "https://clinera.io/software-dental" },
    {
      titulo: "Clinera: emite DTE con Open Factura",
      url: "https://clinera.io/blog/clinera-emite-dte-open-factura",
    },
    {
      titulo: "Dentidesk: odontograma, REMASEP e integraciones (13-ago-2026)",
      url: "https://www.dentidesk.com/dentidesk/detail/48",
    },
    { titulo: "Reservo: precios", url: "https://reservo.cl/precios/" },
    { titulo: "Dentalsoft: inicio", url: "https://www.dentalsoft.cl" },
    { titulo: "Medilink: inicio", url: "https://www.softwaremedilink.com" },
  ],
  relacionados: [
    "/alternativas/dentalink",
    "/comparar/esmalia-vs-dentalink",
    "/comparar/esmalia-vs-agendapro",
    "/comparar/esmalia-vs-doctocliq",
    "/comparar/esmalia-vs-dentidesk",
    "/comparar/esmalia-vs-medilink",
    "/software-dental-chile",
    "/precios",
  ],
  enUnaLinea:
    "Tabla con 8 software dentales en Chile: precio, odontograma, WhatsApp, IA, uso sin internet, boleta electrónica y prueba gratis.",
};
