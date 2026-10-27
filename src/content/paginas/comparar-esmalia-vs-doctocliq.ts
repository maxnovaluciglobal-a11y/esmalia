import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "comparar",
  path: "/comparar/esmalia-vs-doctocliq",
  titulo: "Esmalia vs Doctocliq: comparativa 2026 | Esmalia",
  descripcion:
    "Doctocliq tiene plan gratis y su primer plan pago cuesta US$19; Esmalia, US$19,99. Comparamos qué incluye cada uno: WhatsApp, IA, factura, sedes y uso sin internet.",
  kicker: "Comparativa",
  h1: "Esmalia vs Doctocliq: ¿qué te llevas por lo que pagas?",
  resumen:
    "Doctocliq parte más barato y tiene plan gratis: US$19, US$29 o US$49 al mes, con recordatorios automáticos y, según su web, factura electrónica como complemento en Perú, México, Ecuador y Colombia. Esmalia cuesta US$19,99 para un profesional y US$49,99 para hasta tres, funciona sin internet y deja que tu equipo revise cada WhatsApp. No factura.",
  publicado: "2026-10-11",
  actualizado: "2026-10-19",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Cuánto cuesta cada uno?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "Esmalia es nuestro producto. Relevamos los datos de Doctocliq el 11-oct-2026 en sus webs oficiales; los de Esmalia están al 19-oct-2026. Si algo cambió, escríbenos a hola@esmalia.com y lo corregimos.",
        },
        {
          tipo: "p",
          texto:
            "Si solo miras el precio de entrada, Doctocliq tiene un plan gratis y su primer plan pago cuesta US$19, casi lo mismo que Esmalia Solo (US$19,99). Con el plan gratis no vamos a competir. Lo útil es mirar qué trae cada plan y qué se cobra aparte.",
        },
        {
          tipo: "tabla",
          columnas: ["Plan", "Precio mensual", "Profesionales", "Lo que destaca"],
          filas: [
            [
              "Doctocliq Gratis",
              "US$0",
              "1 doctor",
              "30 pacientes o citas al mes, sin recordatorios por WhatsApp",
            ],
            [
              "Doctocliq Individual",
              "US$19",
              "1 doctor",
              "50 pacientes o citas al mes, 50 recordatorios por WhatsApp",
            ],
            [
              "Doctocliq Básico",
              "US$29",
              "1 doctor",
              "Pacientes ilimitados, 100 recordatorios; sedes, factura e IA como complementos",
            ],
            [
              "Doctocliq Avanzado",
              "US$49",
              "1 doctor",
              "Suma inventario y caja; recordatorios: 100 en su tabla y 150 en la tarjeta del plan",
            ],
            [
              "Esmalia Solo",
              "US$19,99",
              "1 profesional",
              "Agenda, ficha clínica, odontograma, recordatorios por WhatsApp, caja, presupuestos, importación por CSV",
            ],
            [
              "Esmalia Clínica",
              "US$49,99",
              "Hasta 3",
              "Todo lo de Solo, más comisiones, roles y portal de pacientes",
            ],
            [
              "Esmalia Red",
              "A medida",
              "Varias sedes",
              "Multisede, inventario, reportes por sede, migración acompañada",
            ],
          ],
          nota: 'Doctocliq, según su web al 11-oct-2026: todos los planes permiten 8 usuarios gratis (administrativos o temporales); el costo de un doctor adicional figura como "según contratación"; los recordatorios de WhatsApp gratis aplican a planes semestrales y anuales; los precios incluyen impuestos solo en Perú y México.',
        },
      ],
    },
    {
      h2: "¿Qué incluye cada uno, más allá del precio?",
      bloques: [
        {
          tipo: "tabla",
          columnas: ["", "Doctocliq", "Esmalia"],
          filas: [
            [
              "Odontograma",
              "Sí, con periodontograma",
              "Sí, FDI versionado, con estado (existente o por realizar) y periodontograma",
            ],
            [
              "WhatsApp",
              "Recordatorios automáticos con cupo mensual (gratis en planes semestrales y anuales); su inicio menciona también correo y SMS",
              "Recordatorios 48 h y 3 h que despacha tu equipo en modo manual; número propio vía Meta en habilitación",
            ],
            [
              "IA",
              "Soyla IA responde WhatsApp y agenda; complemento en contrato semestral o anual",
              "Patty (en habilitación): notas SOAP y resumen de la nota; no escribe sola",
            ],
            [
              "Sin internet",
              "Su FAQ dice que funciona en la nube y requiere conexión a internet",
              "Sí, sincroniza al volver la conexión",
            ],
            [
              "Factura electrónica",
              "Complemento en Perú, México, Ecuador y Colombia (su tabla suma República Dominicana)",
              "No, en ningún país",
            ],
            ["App móvil", "App para iOS y Android", "Se instala desde el navegador"],
            [
              "Prueba gratis",
              "7 días del plan Avanzado, sin tarjeta, y plan gratis",
              "14 días sin tarjeta",
            ],
            [
              "Alcance",
              "Según su web: más de 4.000 doctores, más de 20 países",
              "Lanzado en 2026; 5 países",
            ],
          ],
        },
      ],
    },
    {
      h2: "¿En qué gana Doctocliq?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Precio de entrada y plan gratis.** Para empezar sin pagar o con US$19, no hay nada igual en Esmalia.",
            "**Factura electrónica en Perú, México, Ecuador y Colombia.** Como complemento, según su web. Esmalia no factura en ningún país.",
            "**Recordatorios automáticos.** Si quieres que el sistema envíe sin que nadie toque nada, Doctocliq los ofrece dentro de su cupo mensual.",
            "**App en las tiendas.** Tiene app para iOS y Android.",
            "**Usuarios administrativos gratis.** Ocho por cuenta, en todos los planes.",
            "**Base de usuarios.** Más de 4.000 doctores en más de 20 países, según su web.",
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
            "**Son 2 o 3 profesionales.** El plan Clínica cubre hasta tres por US$49,99 al mes, con comisiones por profesional, roles y portal de pacientes. Ver [comisiones](/funciones/comisiones).",
            "**Se te corta internet.** Esmalia sigue funcionando: agenda, fichas, cobros y odontograma se guardan en el equipo y se sincronizan solos. Doctocliq dice en su FAQ que requiere conexión a internet. Ver [sin internet](/funciones/sin-internet).",
            "**Prefieres revisar antes de que un mensaje salga.** En Esmalia ningún WhatsApp a pacientes sale solo, y no hay cupo de recordatorios por plan. Ver [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
            "**Quieres IA para la parte clínica.** Patty, hoy en habilitación, pasará tus apuntes a una nota SOAP y resumirá la nota anterior para la próxima consulta. No firma notas ni le escribe a pacientes. Ver [Patty IA](/funciones/patty-ia).",
            "**Quieres poder llevarte todo cuando quieras.** Desde Ajustes descargas un ZIP con pacientes, citas, notas con todas sus versiones, odontograma con historial, presupuestos, pagos y consentimientos, más los archivos del paciente.",
            "**Quieres probar más tiempo.** Son 14 días sin tarjeta, y si después no te suscribes, la agenda, los pacientes y la ficha siguen abiertos.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Si estás en Perú, México, Ecuador o Colombia y necesitas emitir factura electrónica desde el software, Doctocliq te la ofrece como complemento y Esmalia no. Para Chile, la web de Doctocliq no menciona facturación electrónica y Esmalia no la ofrece.",
        },
      ],
    },
    {
      h2: "¿Cómo elegir entre los dos?",
      bloques: [
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "Si eres un solo dentista y el presupuesto manda, empieza por el plan gratis o el de US$19 de Doctocliq.",
            "Si necesitas factura electrónica en Perú, México, Ecuador o Colombia, Doctocliq.",
            "Si son 2 o 3 profesionales, compara el costo total en Doctocliq con el plan Clínica de Esmalia a US$49,99.",
            "Si tu internet es inestable o quieres revisar cada WhatsApp antes de que salga, prueba Esmalia o entra a la [demo](/demo).",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Cuánto cuesta Doctocliq?",
      a: "Según su web al 11-oct-2026: plan Gratis, Individual US$19, Básico US$29 y Avanzado US$49 al mes, cada uno con un usuario doctor. Sedes, factura electrónica e IA se venden como complementos.",
    },
    {
      q: "¿Es mejor Doctocliq o Esmalia?",
      a: "Doctocliq encaja mejor si quieres el precio más bajo, un plan gratis o factura electrónica en Perú, México, Ecuador o Colombia. Esmalia conviene si son hasta 3 profesionales, si tu internet falla o si prefieres revisar cada WhatsApp antes de enviarlo.",
    },
    {
      q: "¿Doctocliq funciona sin internet?",
      a: "Su FAQ dice que funciona en la nube y requiere conexión a internet. Esmalia sigue funcionando sin conexión y sincroniza cuando vuelve; WhatsApp sí necesita internet.",
    },
    {
      q: "¿Doctocliq emite factura electrónica en Chile?",
      a: "Su web indica facturación electrónica según la normativa de Perú, México, Ecuador y Colombia; no menciona Chile (revisado el 11-oct-2026). Esmalia no emite factura en ningún país.",
    },
  ],
  fuentes: [
    { titulo: "Doctocliq: inicio y preguntas frecuentes", url: "https://doctocliq.com" },
    { titulo: "Doctocliq: planes y precios", url: "https://www.doctocliq.com/planes-y-precios" },
  ],
  relacionados: [
    "/comparar/mejores-software-dental-chile",
    "/comparar/esmalia-vs-agendapro",
    "/alternativas/dentalink",
    "/para/dentista-independiente",
    "/funciones/sin-internet",
    "/precios",
  ],
  enUnaLinea:
    "Doctocliq frente a Esmalia: qué trae cada plan, qué se cobra aparte, factura electrónica, WhatsApp y uso sin internet.",
};
