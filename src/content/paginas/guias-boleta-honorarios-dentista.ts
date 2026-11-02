import type { PaginaContenido } from "../tipos";

// BORRADOR: guía tributaria. No se publica sin revisión de un contador
// (ver tipos.ts, `revisor`). Tasa 2026 verificada en sii.cl el 2026-10-11.

export const pagina: PaginaContenido = {
  coleccion: "guias",
  path: "/guias/boleta-honorarios-dentista",
  titulo: "Boleta de honorarios para dentistas en Chile | Esmalia",
  descripcion:
    "Cómo emite boleta de honorarios un dentista en Chile en 2026: retención de 15,25%, quién retiene, cuándo pagas tú el PPM y qué hace (y no hace) Esmalia.",
  kicker: "Guía",
  h1: "Boleta de honorarios para dentistas en Chile (2026)",
  resumen:
    "En 2026 la retención de la boleta de honorarios es 15,25%, según el SII. Si te paga una empresa o una clínica con contabilidad, ella retiene y paga. Si te paga un paciente persona natural, emites sin retención y tú pagas ese 15,25% como PPM en el Formulario 29. Esmalia no emite boletas.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  borrador: true,
  secciones: [
    {
      h2: "¿Cuál es la retención de la boleta de honorarios en 2026?",
      bloques: [
        {
          tipo: "p",
          texto:
            "**15,25%.** El SII lo informó el 26 de diciembre de 2025 y rige desde el 1 de enero de 2026. La tasa sube cada año hasta llegar a 17% en 2028.",
        },
        {
          tipo: "tabla",
          columnas: ["Año", "Retención"],
          filas: [
            ["2025", "14,5%"],
            ["2026", "15,25%"],
            ["2027", "16%"],
            ["2028", "17%"],
          ],
          nota: "Fuente: SII, sección Boletas de honorarios. Verifica la tasa del año en curso en sii.cl antes de emitir.",
        },
        {
          tipo: "p",
          texto:
            "Ejemplo del SII: una boleta de $1.000.000 bruto tiene una retención de $152.500 y deja un líquido de $847.500.",
        },
      ],
    },
    {
      h2: "¿Quién retiene: la clínica, el paciente o tú?",
      bloques: [
        {
          tipo: "tabla",
          columnas: ["Quién te paga", "Qué marcas al emitir", "Quién paga el impuesto"],
          filas: [
            [
              "Una clínica o empresa obligada a llevar contabilidad",
              "Con retención",
              "La clínica retiene el 15,25% y lo entera en su Formulario 29. Tú no declaras nada mensual por esa boleta.",
            ],
            [
              "Un paciente persona natural",
              "Sin retención",
              "Tú. Declaras y pagas el 15,25% como pago provisional mensual (PPM) en tu Formulario 29.",
            ],
          ],
        },
        {
          tipo: "p",
          texto:
            "El caso típico de un dentista que arrienda un box o trabaja en una clínica: la clínica le paga sus honorarios y retiene. El caso típico del que atiende en su propia consulta: el paciente le paga directo y el dentista paga el PPM.",
        },
        {
          tipo: "p",
          texto:
            "El Formulario 29 vence el día 20 del mes siguiente. Desde 2020 se declara solo por internet.",
        },
      ],
    },
    {
      h2: "¿Cuándo hay que emitir la boleta?",
      bloques: [
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "Haz el inicio de actividades en segunda categoría en sii.cl. El SII pide hacerlo dentro de los dos meses siguientes al primer acto.",
            "Emite la boleta de honorarios electrónica en el momento en que te pagan el servicio.",
            "Elige si la emites con o sin retención, según quién te pagó.",
            "Si fue sin retención, declara y paga el PPM en el Formulario 29 del mes siguiente.",
            "En la Operación Renta de abril se cruzan las retenciones y los PPM con tu impuesto anual: puede resultar devolución o pago.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "El SII informa además una retención adicional de 3% ligada a la devolución del Préstamo Solidario de la Ley 21.242. Confirma si te aplica en sii.cl o con tu contador.",
        },
      ],
    },
    {
      h2: "¿Esmalia emite boletas de honorarios?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "No. Esmalia no emite boletas de honorarios, facturas electrónicas ni ningún documento tributario (DTE) en ningún país. La boleta se emite en sii.cl o con el sistema que use tu contador.",
        },
        {
          tipo: "p",
          texto: "Lo que sí te ayuda a tener a mano para emitir:",
        },
        {
          tipo: "lista",
          items: [
            "Cada pago queda registrado y descuenta el saldo del paciente, así sabes cuánto te pagó cada uno y cuándo.",
            "En el plan Clínica, las comisiones por profesional muestran cuánto le corresponde a cada dentista, que es la base de la boleta que emite a la clínica.",
            "Las finanzas y las comisiones se activan con la suscripción. Mira los planes en [precios](/precios).",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Tengo que emitir boleta si el paciente me paga en efectivo?",
      a: "Sí. La boleta se emite al recibir el pago del servicio, sin importar el medio de pago.",
    },
    {
      q: "¿Qué pasa si emito sin retención y no pago el PPM?",
      a: "Quedas con una deuda con el SII que se ajusta en la Operación Renta, más los recargos que correspondan. Revísalo con tu contador.",
    },
    {
      q: "¿Puedo emitir boletas desde Esmalia?",
      a: "No. Esmalia no emite documentos tributarios. Registra los pagos y saldos para que tengas el dato a mano al emitir en sii.cl.",
    },
  ],
  fuentes: [
    {
      titulo: "SII: Boletas de honorarios, retención 2026",
      url: "https://www.sii.cl/destacados/boletas_honorarios/index.html",
    },
    {
      titulo: "SII: noticia del 26-12-2025 sobre el alza de la retención a 15,25%",
      url: "https://www.sii.cl/noticias/2025/261225noti01smn.htm",
    },
    {
      titulo: "SII: ¿Al emitir una boleta de honorarios electrónica hay que declarar PPM?",
      url: "https://www.sii.cl/preguntas_frecuentes/boleta_honorario_electr/001_120_0889.htm",
    },
    {
      titulo: "SII: retención adicional de 3% (Ley 21.242)",
      url: "https://www.sii.cl/preguntas_frecuentes/boleta_honorario_electr/001_120_7745.htm",
    },
    {
      titulo: "SII: Boleta de honorarios para nuevos contribuyentes",
      url: "https://www.sii.cl/ayudas/nuevos_contribuyentes/boleta-honorarios.html",
    },
  ],
  relacionados: [
    "/para/dentista-independiente",
    "/funciones/comisiones",
    "/software-dental-chile",
    "/precios",
  ],
  enUnaLinea:
    "Boleta de honorarios para dentistas en Chile en 2026: retención de 15,25%, quién retiene, cuándo pagas el PPM y por qué Esmalia no emite boletas.",
};
