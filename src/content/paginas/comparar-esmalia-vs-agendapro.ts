import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "comparar",
  path: "/comparar/esmalia-vs-agendapro",
  titulo: "Esmalia vs AgendaPro para clínicas dentales | Esmalia",
  descripcion:
    "AgendaPro es una agenda para muchos rubros; Esmalia es un software clínico dental. Comparamos ficha clínica, odontograma, WhatsApp, factura y precio.",
  kicker: "Comparativa",
  h1: "Esmalia vs AgendaPro: agenda multi-rubro o software dental",
  resumen:
    "AgendaPro es un sistema de agenda y gestión que se ofrece para varios rubros, con pagos y facturación; en Chile la ficha clínica viene desde el plan Premium ($54.900 + IVA) y la factura electrónica en Pro o como complemento. Esmalia es solo dental: ficha, odontograma FDI y WhatsApp desde US$29 al mes, funciona sin internet, pero no emite factura.",
  publicado: "2026-10-11",
  actualizado: "2026-10-19",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué diferencia hay entre AgendaPro y Esmalia?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "Esmalia es nuestro producto. Relevamos los datos de AgendaPro el 11-oct-2026 en sus webs oficiales; los de Esmalia están al 19-oct-2026. Si algo cambió, escríbenos a hola@esmalia.com y lo corregimos.",
        },
        {
          tipo: "p",
          texto:
            "AgendaPro se presenta en su web como sistema de agenda y gestión para salones de belleza, barberías, spas, centros de estética, fisioterapia, psicología, nutrición, podología y clínicas dentales. Según su página de planes para Chile, más de 30.000 negocios en Latinoamérica lo usan. Tiene una página específica para clínicas dentales; su página de planes de Chile no distingue por rubro y la ficha clínica aparece desde el plan Premium.",
        },
        {
          tipo: "p",
          texto:
            "Esmalia está hecha solo para odontología. La ficha del paciente es el centro: odontograma FDI versionado, notas clínicas con revisión, consentimientos, presupuestos que se vuelven plan de tratamiento y pagos que descuentan el saldo del paciente. No sirve para una peluquería ni para un gimnasio, y no lo intenta.",
        },
      ],
    },
    {
      h2: "¿Qué plan de AgendaPro trae ficha clínica?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Es la pregunta clave para una clínica dental. En la tabla de planes de AgendaPro Chile, la **ficha clínica personalizada no está incluida** en Individual ni en Básico. Aparece desde Premium:",
        },
        {
          tipo: "tabla",
          columnas: [
            "Plan AgendaPro (Chile)",
            "Precio mensual",
            "Profesionales",
            "Ficha clínica",
            "Confirmaciones por WhatsApp",
            "Facturación electrónica",
          ],
          filas: [
            ["Individual", "$15.900 + IVA", "1", "No incluida", "50", "No incluida"],
            ["Básico", "$34.900 + IVA", "2 a 20", "No incluida", "50", "No incluida"],
            ["Premium", "$54.900 + IVA", "2 a 20", "Incluida", "100", "No incluida"],
            ["Pro", "$249.900 + IVA", "2 a 20", "Incluida", "200", "Incluida"],
          ],
          nota: "Fuente: agendapro.com/cl/planes, 11-oct-2026. WhatsApp adicional desde $5.000/mes + IVA por 50 mensajes; facturación electrónica como complemento desde 2 UF/mes + IVA por RUT.",
        },
        {
          tipo: "p",
          texto:
            "Sobre el odontograma: la página dental de AgendaPro para México dice que puedes anexar un odontograma a la ficha; la de Chile no lo detalla. Si es clave para ti, pide verlo funcionando en la demo.",
        },
      ],
    },
    {
      h2: "¿Cómo se comparan punto por punto?",
      bloques: [
        {
          tipo: "tabla",
          columnas: ["", "AgendaPro", "Esmalia"],
          filas: [
            [
              "Para quién",
              "Según su web, varios rubros: belleza, estética, salud y dental",
              "Solo clínicas dentales",
            ],
            [
              "Precio con ficha clínica",
              "Desde $54.900 + IVA al mes (Premium)",
              "US$29/mes (1 profesional) o US$69/mes (hasta 3), con ficha desde el plan Solo",
            ],
            [
              "Odontograma",
              "Mencionado en su página de México",
              "Sí, FDI versionado, con estado (existente o por realizar)",
            ],
            [
              "WhatsApp",
              "Confirmaciones incluidas por cupo; extra se paga aparte",
              "Recordatorios 48 h y 3 h que envía tu equipo en modo manual (el número propio vía Meta está en habilitación)",
            ],
            [
              "IA",
              'Su web no lo presenta como IA; ofrece Charly, "experto en marketing inteligente", desde $149.900/mes + IVA',
              "Patty (en habilitación): notas SOAP y resumen de la nota; la lectura de pedidos de hora llegará con el número conectado",
            ],
            [
              "Sin internet",
              "Su web no menciona modo sin conexión",
              "Sí, sincroniza al volver la conexión",
            ],
            ["Factura electrónica", "Sí, en Pro o como complemento", "No"],
            ["Prueba gratis", "7 días", "14 días sin tarjeta"],
          ],
        },
      ],
    },
    {
      h2: "¿En qué gana AgendaPro?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Facturación integrada.** Emite factura electrónica en el plan Pro o como complemento, y boleta de honorarios desde 1 UF al mes + IVA. Esmalia no factura.",
            "**Equipos grandes.** Sus planes Básico, Premium y Pro cubren de 2 a 20 profesionales. Esmalia Clínica llega hasta 3; más allá es el plan Red, a medida.",
            "**Varios rubros en un mismo sistema.** Si tu centro combina odontología con estética o fisioterapia, una sola agenda para todo puede servirte.",
            "**Escala y certificaciones.** Más de 30.000 negocios según su web, y su página dental de Chile indica certificación CENS e integración con FONASA.",
            "**Precios en pesos.** Publica sus planes de Chile en CLP; algunos complementos, como la facturación, se cobran en UF.",
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
            "**Eres una clínica solo dental de 1 a 3 profesionales.** La ficha clínica, el odontograma y los presupuestos vienen desde el plan de US$29, sin subir de plan. Ver [ficha clínica](/funciones/ficha-clinica) y [odontograma](/funciones/odontograma).",
            "**Quieres que los recordatorios no dependan de un cupo.** Los planes de Esmalia no fijan un cupo de recordatorios. En modo manual, cada mensaje se abre en tu propio WhatsApp con el texto listo y tu equipo lo envía. Ver [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
            "**Necesitas atender aunque se corte internet.** Agenda, fichas, cobros y odontograma siguen funcionando y se sincronizan solos. Ver [sin internet](/funciones/sin-internet).",
            "**Quieres IA clínica, no de marketing.** Patty, hoy en habilitación, te ayudará con la nota SOAP y el resumen de la consulta anterior. No firma ni le escribe a pacientes. Ver [Patty IA](/funciones/patty-ia).",
            "**Quieres poder llevarte todo cuando quieras.** Desde Ajustes descargas un ZIP con pacientes, citas, notas con todas sus versiones, odontograma con historial, presupuestos, pagos y consentimientos, más los archivos del paciente.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Esmalia cobra en dólares (US$29 o US$69 al mes) por Stripe; el monto en pesos depende del tipo de cambio de tu banco. Y no emite boleta ni factura electrónica: si la necesitas dentro del sistema, AgendaPro Pro te la resuelve.",
        },
      ],
    },
    {
      h2: "¿Cómo decidir en 10 minutos?",
      bloques: [
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "Si atiendes más rubros que el dental, AgendaPro se ofrece para varios de ellos.",
            "Si tienes más de 3 profesionales y buscas precio publicado, AgendaPro publica planes de 2 a 20 profesionales.",
            "Si necesitas factura electrónica dentro del software, AgendaPro Pro o su complemento.",
            "Si eres solo dental, de 1 a 3 profesionales, y quieres ficha y odontograma desde el plan más barato, prueba Esmalia 14 días sin tarjeta o entra a la [demo](/demo).",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿AgendaPro sirve para una clínica dental?",
      a: "Sí, tiene páginas para clínicas dentales y ficha clínica personalizada. En Chile, la ficha clínica viene desde el plan Premium ($54.900 + IVA al mes según su web al 11-oct-2026).",
    },
    {
      q: "¿Qué es mejor para un dentista, AgendaPro o Esmalia?",
      a: "Si atiendes solo odontología con 1 a 3 profesionales, Esmalia trae ficha, odontograma y WhatsApp desde US$29 al mes y funciona sin internet. Si necesitas factura electrónica, varios rubros o más de 3 profesionales con precio publicado, AgendaPro puede encajar mejor.",
    },
    {
      q: "¿AgendaPro tiene odontograma?",
      a: "Su página dental de México menciona que puedes anexar un odontograma a la ficha; la página de Chile no lo detalla. Conviene verlo en una demo.",
    },
    {
      q: "¿Cuántos mensajes de WhatsApp incluye AgendaPro?",
      a: "Según su página de planes de Chile: 50 confirmaciones en Individual y Básico, 100 en Premium y 200 en Pro. Los extra se compran desde $5.000 + IVA por 50 mensajes al mes.",
    },
  ],
  fuentes: [
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
  ],
  relacionados: [
    "/comparar/mejores-software-dental-chile",
    "/comparar/esmalia-vs-dentalink",
    "/comparar/esmalia-vs-doctocliq",
    "/funciones/ficha-clinica",
    "/funciones/odontograma",
    "/precios",
  ],
  enUnaLinea:
    "AgendaPro frente a Esmalia: qué plan trae ficha clínica, WhatsApp por cupo, factura electrónica y precio para una clínica dental.",
};
