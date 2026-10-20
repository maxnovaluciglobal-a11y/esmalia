import type { PaginaContenido } from "../tipos";

// Plantilla operativa (no clínico-legal): se publica sin revisor. Lo que dice
// del inventario de Esmalia sale de src/lib/clinic-operations/ y de
// src/routes/_authenticated/_clinic/inventario.tsx (20-oct-2026).

const filasEnBlanco = (n: number, columnas: number) =>
  Array.from({ length: n }, () => Array<string>(columnas).fill(""));

export const pagina: PaginaContenido = {
  coleccion: "plantillas",
  path: "/plantillas/inventario-clinica-dental",
  titulo: "Plantilla de inventario para clínica dental | Esmalia",
  descripcion:
    "Plantilla de inventario dental gratis para imprimir: maestro de insumos, registro de entradas y salidas con lote y vencimiento, y recuento físico.",
  kicker: "Plantillas",
  h1: "Plantilla de inventario para clínica dental",
  resumen:
    "Para controlar los insumos de una clínica dental bastan tres hojas: un maestro de insumos con su stock mínimo, un registro de entradas y salidas con lote y vencimiento, y un recuento físico periódico. Esta plantilla trae las tres para imprimir o copiar, más cómo calcular el stock mínimo y cómo evitar que se te venzan los materiales.",
  publicado: "2026-10-20",
  actualizado: "2026-10-20",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué hojas necesita un inventario dental?",
      bloques: [
        {
          tipo: "tabla",
          columnas: ["Hoja", "Para qué sirve", "Cuándo se usa"],
          filas: [
            [
              "Maestro de insumos",
              "Una fila por insumo: unidad, stock mínimo, proveedor, costo y dónde se guarda.",
              "Al crear un insumo nuevo o cambiar su mínimo o su costo.",
            ],
            [
              "Registro de movimientos",
              "Cada entrada (compra), salida (uso o descarte) o ajuste, con lote y vencimiento.",
              "Cada vez que algo entra o sale de la bodega.",
            ],
            [
              "Recuento físico",
              "Compara lo que dice la planilla con lo que hay en el estante.",
              "Con la frecuencia que definas, por ejemplo al cierre de cada mes.",
            ],
          ],
        },
        {
          tipo: "p",
          texto:
            "Usa el botón **Imprimir o guardar en PDF** de arriba: al imprimir se ocultan el menú, los botones y el resto del sitio. También puedes copiar las columnas a una hoja de cálculo.",
        },
      ],
    },
    {
      h2: "Hoja 1: maestro de insumos",
      bloques: [
        {
          tipo: "tabla",
          rellenable: true,
          columnas: [
            "Insumo",
            "Categoría",
            "Unidad",
            "Stock mínimo",
            "Stock actual",
            "Proveedor",
            "Costo unitario",
            "Ubicación",
          ],
          filas: filasEnBlanco(12, 8),
          nota: "Unidad: la que cuentas de verdad (caja, cartucho, jeringa, par). Si compras por caja y usas por unidad, elige una y escríbelo.",
        },
        {
          tipo: "p",
          texto: "Categorías habituales para ordenar el maestro (ajústalas a tu clínica):",
        },
        {
          tipo: "tabla",
          columnas: ["Categoría", "Ejemplos"],
          filas: [
            ["Anestesia", "Cartuchos de anestesia, agujas dentales"],
            ["Barrera y protección", "Guantes, mascarillas, baberos, campos, cubrecalzado"],
            ["Operatoria", "Resinas, adhesivo, ácido grabador, ionómero de vidrio"],
            ["Endodoncia", "Limas, conos de gutapercha y de papel, cemento sellador"],
            ["Impresión", "Alginato, siliconas, cubetas"],
            ["Desechables", "Eyectores, gasas, algodón, vasos"],
            [
              "Esterilización y limpieza",
              "Bolsas de esterilización, indicadores, desinfectante de superficies",
            ],
            ["Instrumental rotatorio", "Fresas"],
          ],
        },
      ],
    },
    {
      h2: "Hoja 2: registro de entradas y salidas",
      bloques: [
        {
          tipo: "tabla",
          rellenable: true,
          columnas: [
            "Fecha",
            "Insumo",
            "Tipo",
            "Cantidad",
            "Lote",
            "Vence",
            "Responsable",
            "Motivo",
          ],
          filas: filasEnBlanco(14, 8),
          nota: "Tipo: entrada (compra o devolución), salida (uso, descarte o vencido) o ajuste (corrección después de un recuento). Lote y vencimiento se anotan en cada entrada.",
        },
      ],
    },
    {
      h2: "Hoja 3: recuento físico",
      bloques: [
        {
          tipo: "tabla",
          rellenable: true,
          columnas: [
            "Insumo",
            "Unidad",
            "Según planilla",
            "Contado",
            "Diferencia",
            "Lote más próximo a vencer",
            "Contó",
          ],
          filas: filasEnBlanco(12, 7),
          nota: "Si la diferencia no es cero, registra un ajuste en la hoja 2 con el motivo, para que la planilla vuelva a coincidir con el estante.",
        },
      ],
    },
    {
      h2: "¿Cómo se calcula el stock mínimo de un insumo?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El stock mínimo es la cantidad que, cuando la alcanzas, te obliga a pedir. Tiene que alcanzar para cubrir lo que usas mientras llega el pedido, más un margen por si el proveedor se atrasa o tienes una semana con más pacientes:",
        },
        {
          tipo: "plantilla",
          titulo: "Fórmula",
          texto:
            "Stock mínimo = consumo por semana × semanas que tarda el proveedor en entregar + margen de seguridad",
        },
        {
          tipo: "p",
          texto:
            "Ejemplo con números redondos: si usas 20 cartuchos de anestesia por semana y el proveedor tarda una semana en entregar, necesitas 20 para cubrir la espera. Con un margen de media semana (10 cartuchos), el mínimo es 30. Revísalo cuando cambie tu ritmo de atención o tu proveedor.",
        },
      ],
    },
    {
      h2: "¿Cómo evitar que se te venzan los materiales?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Anota lote y vencimiento en cada entrada.** Sin ese dato no hay forma de saber qué vence primero.",
            "**Primero en vencer, primero en salir.** Deja adelante en el estante lo que vence antes y atrás lo que acaba de llegar.",
            "**Revisa cada mes lo que vence en los próximos 60 días** y úsalo primero o pide al proveedor un cambio si lo permite.",
            "**Registra los descartes como salida, con el motivo.** Así ves cuánto pierdes por vencimiento y ajustas cuánto compras.",
            "**Haz el recuento físico con regularidad.** Las diferencias pequeñas que nadie corrige terminan en un quiebre de stock en mitad de una atención.",
          ],
        },
      ],
    },
    {
      h2: "¿Y si llevas el inventario en Esmalia?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Esmalia tiene una pantalla de inventario que sigue la misma lógica de esta plantilla:",
        },
        {
          tipo: "lista",
          items: [
            "**Insumos** con unidad, stock mínimo opcional (con aviso cuando el stock llega al mínimo), costo unitario, notas y, si tienes varias sedes, sucursal.",
            "**Movimientos** de entrada, salida y ajuste, con lote y vencimiento opcionales, y un aviso de lotes que vencen en los próximos 60 días.",
            "**Conteo físico:** cargas lo que contaste y Esmalia ajusta el stock del sistema a lo contado.",
            "**Receta de insumos por prestación:** al marcar una línea del plan de tratamiento como realizada, se descuentan los insumos de su receta. Cada insumo puede ser de uso único, fraccionable o compartido, con un rendimiento esperado para reflejar la merma.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "El inventario está en el plan Red (varias sedes); revisa los [precios](/precios). Esmalia no hace pedidos a proveedores ni guarda el proveedor de cada insumo (puedes anotarlo en las notas), y el aviso de lotes por vencer no lleva la cuenta de cuánto queda de cada lote: es un recordatorio, no un control exacto por lote.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Cada cuánto conviene hacer un recuento físico?",
      a: "Con la frecuencia que puedas sostener. Al cierre de cada mes es un punto de partida común; si encuentras diferencias grandes, hazlo más seguido hasta que la planilla coincida con el estante.",
    },
    {
      q: "¿Qué insumos deberían tener stock mínimo?",
      a: "Los que, si faltan, te obligan a suspender una atención: anestesia, guantes, mascarillas, eyectores y los materiales de las prestaciones que más haces. Para lo que casi no usas, basta el recuento.",
    },
    {
      q: "¿Conviene llevar el inventario en papel o en una hoja de cálculo?",
      a: "En papel funciona si una sola persona lo lleva. Con más de una persona o más de una sede, una hoja de cálculo o un software evita versiones distintas de la misma planilla.",
    },
    {
      q: "¿Cómo anoto un insumo que se usa por fracciones, como gasas o algodón?",
      a: "Elige la unidad en la que lo compras y cuéntalo en el recuento, o registra salidas aproximadas por semana. Lo importante es que la unidad sea siempre la misma.",
    },
  ],
  relacionados: [
    "/plantillas/presupuesto-dental",
    "/funciones/presupuestos",
    "/para/clinica-dental",
    "/recursos/fugas-clinica-dental",
  ],
  enUnaLinea:
    "Plantilla gratis de inventario para clínica dental: maestro de insumos, entradas y salidas con lote y vencimiento, recuento físico y cálculo del stock mínimo.",
};
