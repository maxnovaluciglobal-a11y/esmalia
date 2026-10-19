import type { PaginaContenido } from "../tipos";

// BORRADOR: guía normativa. No se publica sin revisión profesional (ver
// tipos.ts, `revisor`). Artículos verificados en LeyChile el 2026-10-11:
// Decreto 41/2012 art. 11 (plazo) y art. 12 (destrucción); Ley 20.584 art. 13.

export const pagina: PaginaContenido = {
  coleccion: "guias",
  path: "/guias/conservacion-ficha-clinica-chile",
  titulo: "Cuánto conservar la ficha clínica en Chile | Esmalia",
  descripcion:
    "En Chile la ficha clínica se guarda al menos 15 años desde la última anotación (Decreto 41, art. 11). Qué dice la norma, cómo destruirla y qué revisar.",
  kicker: "Guía",
  h1: "¿Cuánto tiempo hay que conservar la ficha clínica en Chile?",
  resumen:
    "El Decreto 41 de 2012 del Minsal (art. 11) obliga a conservar la ficha clínica por un mínimo de 15 años, contados desde el último ingreso de información. La Ley 20.584 (art. 13) repite el piso de 15 años. Vencido el plazo, se puede destruir por un método seguro y dejando acta notarial si eres prestador privado.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  borrador: true,
  secciones: [
    {
      h2: "¿Qué plazo fija la norma?",
      bloques: [
        {
          tipo: "tabla",
          columnas: ["Norma", "Qué dice", "Desde cuándo se cuenta"],
          filas: [
            [
              "[Ley 20.584, art. 13](https://www.bcn.cl/leychile/navegar?idNorma=1039348)",
              "El prestador debe conservar la ficha clínica por un período de al menos quince años.",
              "La ley no lo precisa.",
            ],
            [
              "[Decreto 41 de 2012, art. 11](https://www.bcn.cl/leychile/navegar?idNorma=1046753)",
              "Las fichas se conservan, con un acceso adecuado, durante el plazo mínimo de quince años.",
              "Desde el último ingreso de información en la ficha.",
            ],
          ],
          nota: "Paráfrasis de los artículos. Para la redacción exacta, consulta LeyChile.",
        },
        {
          tipo: "p",
          texto:
            "En la práctica: si un paciente se atendió por última vez en marzo de 2026, su ficha completa se guarda por lo menos hasta marzo de 2041. Cada nueva anotación corre el plazo.",
        },
        {
          tipo: "p",
          texto:
            "Quince años es un mínimo. Nada impide guardarla más tiempo, y en algunos casos puede convenir (por ejemplo, si hay un reclamo o un juicio en curso). Eso lo decide el prestador con su asesor.",
        },
      ],
    },
    {
      h2: "¿Qué pasa cuando vence el plazo?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El artículo 12 del Decreto 41 permite eliminar la ficha cumplido el plazo, con condiciones:",
        },
        {
          tipo: "lista",
          items: [
            "La destrucción debe hacerse por un método seguro, que impida recuperar la información.",
            "Hay que levantar un acta que deje constancia de la destrucción.",
            "En un prestador público, la destrucción se dispone por resolución. En un prestador privado, el acta se hace ante notario.",
            "La obligación de confidencialidad sobre lo que contenía la ficha sigue vigente después de destruirla.",
          ],
        },
      ],
    },
    {
      h2: "¿Quién fiscaliza?",
      bloques: [
        {
          tipo: "p",
          texto:
            "La Superintendencia de Salud, a través de su Intendencia de Prestadores (Decreto 41, art. 13).",
        },
      ],
    },
    {
      h2: "¿Y si la ficha es electrónica?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El plazo es el mismo. El artículo 8 del Decreto 41 pide además respaldos y medidas de seguridad para que la ficha electrónica siga completa, accesible, confidencial y auténtica durante todo ese tiempo.",
        },
        {
          tipo: "p",
          texto:
            "Si cambias de software, el plazo no se reinicia ni se suspende. Antes de dejar un sistema, exporta las fichas y verifica que las puedes abrir. Si dejas de usar un proveedor, pregúntale por escrito cuánto tiempo conserva tus datos y en qué formato te los entrega.",
        },
        {
          tipo: "aviso",
          texto:
            "La Ley 21.668 (2024) modificó los artículos 12 y 13 de la Ley 20.584 y encargó al Ministerio de Salud actualizar el reglamento. Antes de aplicar esta guía, revisa en LeyChile si el Decreto 41 cambió.",
        },
      ],
    },
    {
      h2: "¿Qué hace Esmalia con tus fichas?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "El odontograma y las notas clínicas guardan versiones: una corrección agrega una versión nueva y no borra la anterior.",
            "Si no te suscribes después de la prueba de 14 días, la agenda, los pacientes y la ficha siguen abiertos.",
            // TODO(export): cuando exista "Exportar todo" en Ajustes, volver a prometer la exportación desde la app.
            "Antes de cerrar tu cuenta puedes pedirnos todos los datos de tu clínica: te los entregamos en formato estándar dentro de 72 horas.",
            "La base de datos se respalda todos los días. Detalle en [Datos y seguridad](/docs/datos-y-seguridad).",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Conservar la ficha por el plazo legal es responsabilidad del prestador, no del software. Si cierras tu cuenta en cualquier sistema, la copia exportada pasa a ser tu respaldo durante el resto del plazo.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Los 15 años se cuentan desde la primera atención?",
      a: "No. Según el Decreto 41 (art. 11), se cuentan desde el último ingreso de información en la ficha.",
    },
    {
      q: "¿Puedo botar las fichas de papel cuando las digitalizo?",
      a: "La norma no lo resuelve de forma expresa en los artículos citados. Consúltalo con un abogado antes de destruir originales.",
    },
    {
      q: "¿Qué pasa si destruyo una ficha antes de tiempo?",
      a: "Incumples la Ley 20.584 y el Decreto 41, que fiscaliza la Superintendencia de Salud.",
    },
  ],
  fuentes: [
    {
      titulo:
        "Decreto 41 de 2012, Ministerio de Salud: Reglamento sobre fichas clínicas (LeyChile, BCN)",
      url: "https://www.bcn.cl/leychile/navegar?idNorma=1046753",
    },
    {
      titulo: "Ley 20.584, derechos y deberes de los pacientes (LeyChile, BCN)",
      url: "https://www.bcn.cl/leychile/navegar?idNorma=1039348",
    },
    {
      titulo: "Superintendencia de Salud: Decreto N° 41",
      url: "https://www.superdesalud.gob.cl/normativa/decreto-n-41/",
    },
  ],
  relacionados: [
    "/guias/ficha-clinica-odontologica-chile",
    "/funciones/ficha-clinica",
    "/docs/datos-y-seguridad",
    "/software-dental-chile",
  ],
  enUnaLinea:
    "Plazo de conservación de la ficha clínica en Chile: 15 años desde la última anotación (Decreto 41, art. 11), y cómo se destruye después.",
};
