import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "funciones",
  path: "/funciones/comisiones",
  titulo: "Comisiones de odontólogos por producción | Esmalia",
  descripcion:
    "Liquida comisiones de odontólogos: porcentaje o monto fijo por procedimiento realizado, cierre de período congelado y vista propia por profesional.",
  kicker: "Funciones",
  h1: "Comisiones de odontólogos calculadas sobre la producción",
  resumen:
    "En Esmalia cada profesional tiene una regla de comisión: un porcentaje sobre su producción o un monto fijo por procedimiento. La producción es la suma de los tratamientos marcados como realizados en el período. Al cerrar el período, los montos quedan congelados, se avisa por email a cada profesional con email cargado y luego se marca como pagado.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Cómo calcula Esmalia la comisión de cada profesional?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Cada profesional tiene una regla, que se configura en la pantalla Profesionales. Hay dos tipos:",
        },
        {
          tipo: "tabla",
          columnas: ["Regla", "Cómo se calcula", "Ejemplo"],
          filas: [
            [
              "Porcentaje sobre producción",
              "Producción del período por el porcentaje, con hasta dos decimales. Se redondea, no se trunca, para no perder centavos en contra del profesional.",
              "35 % sobre $2.000.000 de producción = $700.000",
            ],
            [
              "Monto fijo por procedimiento",
              "Un monto por cada procedimiento realizado, sin importar su precio.",
              "$15.000 por 12 procedimientos = $180.000",
            ],
            [
              "Sin regla",
              "No se calcula nada y la pantalla avisa cuántos profesionales están sin regla.",
              "No aplica",
            ],
          ],
          nota: "Ejemplos ilustrativos en pesos chilenos. La moneda es la de tu clínica.",
        },
      ],
    },
    {
      h2: "¿Qué cuenta como producción?",
      bloques: [
        {
          tipo: "p",
          texto:
            "La producción es la suma del precio de las líneas del plan de tratamiento marcadas como Realizado, según la fecha en que se marcaron, dentro del rango que elijas. Es el precio de la línea con el descuento ya aplicado, el mismo que viene del [presupuesto aceptado](/funciones/presupuestos), e incluye la parte que cubre el convenio si lo hay. Por defecto el rango va del primer día del mes hasta hoy.",
        },
      ],
    },
    {
      h2: "¿Qué significa cerrar un período de comisiones?",
      bloques: [
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "Eliges el rango y presionas Cerrar período. Esmalia pide confirmación.",
            "Para cada profesional con regla se congelan la producción, la cantidad de procedimientos, la regla y el monto de ese momento.",
            "Desde ahí, editar la regla no cambia lo ya liquidado, y el mismo rango no se puede cerrar dos veces.",
            "Cada profesional con email cargado recibe un aviso con el período y su monto. Si el envío falla, queda anotado el motivo.",
            "Cuando pagas, marcas la liquidación como pagada y queda la fecha.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Cerrar períodos y marcar pagos es solo para propietario y administración. Un cierre no se deshace desde la pantalla: corregirlo requiere una corrección manual de soporte.",
        },
      ],
    },
    {
      h2: "¿Quién ve las comisiones?",
      bloques: [
        {
          tipo: "tabla",
          columnas: ["Rol", "Qué ve", "Qué puede hacer"],
          filas: [
            ["Propietario y administración", "Todas las líneas", "Cerrar períodos y marcar pagado"],
            ["Contabilidad", "Todas las líneas", "Solo consultar"],
            ["Doctor/a", "Solo su propia línea, como Mi comisión", "Solo consultar"],
            ["Recepción y asistentes", "Nada", "No aplica"],
          ],
        },
        {
          tipo: "p",
          texto:
            "Que un doctor vea solo lo suyo no depende de la pantalla: el servidor recorta el reporte a su propia ficha de profesional aunque se pida otra cosa. Para eso, su usuario tiene que estar vinculado a su ficha en Profesionales.",
        },
      ],
    },
    {
      h2: "¿Para quién es y en qué plan está?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Para clínicas donde atiende más de un profesional y alguien tiene que calcular a fin de mes cuánto le toca a cada uno. Las comisiones vienen en el plan Clínica (US$49,99 al mes, hasta 3 profesionales) y en Red, para varias sedes. Si la prueba de 14 días termina sin suscripción, la pantalla de comisiones se activa al suscribirte; la agenda y las fichas siguen abiertas. Revisa los [precios](/precios) o entra a la [demo](/demo).",
        },
      ],
    },
    {
      h2: "¿Qué no hace?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**Calcula sobre lo realizado, no sobre lo cobrado.** Un tratamiento marcado como realizado cuenta aunque el paciente no lo haya pagado. Tampoco descuenta costos de laboratorio ni insumos, y la regla es una por profesional: no hay porcentajes distintos por tipo de prestación. Esmalia no transfiere el dinero ni emite boletas de honorarios o retenciones: registra cuánto corresponde y cuándo se pagó.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Puedo pagar la comisión sobre lo cobrado en vez de lo realizado?",
      a: "Hoy no. La base del cálculo es la producción: las líneas del plan de tratamiento marcadas como Realizado en el período, estén cobradas o no.",
    },
    {
      q: "¿Puedo tener un porcentaje distinto para cada tratamiento?",
      a: "No. Cada profesional tiene una sola regla: un porcentaje sobre su producción o un monto fijo por procedimiento.",
    },
    {
      q: "¿Un dentista puede ver cuánto ganan sus colegas?",
      a: "No. Con rol de doctor/a ve solo su propia comisión, y el servidor lo exige aunque se intente pedir el reporte completo.",
    },
    {
      q: "¿Qué pasa si cambio la regla de comisión a mitad de mes?",
      a: "Los períodos abiertos se calculan con la regla vigente. Los períodos cerrados no cambian: guardan la regla y el monto del momento del cierre.",
    },
    {
      q: "¿Esmalia descuenta el costo de laboratorio de la comisión?",
      a: "No. Las prestaciones pueden tener un costo de laboratorio cargado en el arancel, pero el cálculo de la comisión no lo usa.",
    },
  ],
  relacionados: ["/funciones/presupuestos", "/para/clinica-dental", "/funciones/ficha-clinica"],
  enUnaLinea:
    "Comisiones por profesional sobre la producción realizada: porcentaje o monto fijo, cierre congelado y aviso por email.",
};
