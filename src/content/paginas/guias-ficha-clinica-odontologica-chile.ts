import type { PaginaContenido } from "../tipos";

// BORRADOR: guía normativa. No se publica sin revisión de un odontólogo y,
// idealmente, de un abogado con experiencia en salud (ver tipos.ts, `revisor`).
// Normas verificadas en LeyChile el 2026-10-11.

export const pagina: PaginaContenido = {
  coleccion: "guias",
  path: "/guias/ficha-clinica-odontologica-chile",
  titulo: "Ficha clínica odontológica en Chile: qué exige | Esmalia",
  descripcion:
    "Qué debe tener la ficha clínica odontológica en Chile según la Ley 20.584 y el Decreto 41 del Minsal: contenido mínimo, conservación y quién accede.",
  kicker: "Guía",
  h1: "Ficha clínica odontológica en Chile: qué exige la ley",
  resumen:
    "En Chile la ficha clínica es obligatoria (Ley 20.584, art. 12) y el Decreto 41 del Minsal fija su contenido mínimo: identificación del paciente, datos de la ficha y del prestador, registro cronológico de cada atención y las decisiones del paciente, como consentimientos. Se conserva al menos 15 años y solo acceden las personas que la ley enumera.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  borrador: true,
  secciones: [
    {
      h2: "¿Qué normas regulan la ficha clínica en Chile?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Ley 20.584**, de derechos y deberes de los pacientes (2012). Los artículos 12 y 13 tratan la ficha clínica; el 14, el consentimiento informado. [Texto en LeyChile](https://www.bcn.cl/leychile/navegar?idNorma=1039348).",
            "**Decreto 41 de 2012 del Ministerio de Salud**, Reglamento sobre fichas clínicas. Publicado en el Diario Oficial el 15 de diciembre de 2012. Detalla contenido, almacenamiento, acceso, conservación y destrucción. [Texto en LeyChile](https://www.bcn.cl/leychile/navegar?idNorma=1046753).",
            "**Ley 19.628**, sobre protección de la vida privada: los datos de la ficha son datos sensibles (así lo dicen el art. 12 de la Ley 20.584 y el art. 2 del Decreto 41).",
          ],
        },
        {
          tipo: "p",
          texto:
            "Estas normas aplican a prestadores públicos y privados, institucionales e individuales (Decreto 41, art. 1). Un dentista que atiende solo en su consulta también está obligado.",
        },
        {
          tipo: "aviso",
          texto:
            "La Ley 21.668 (Diario Oficial del 28 de mayo de 2024) modificó los artículos 12 y 13 de la Ley 20.584 para exigir que la ficha sea interoperable, y le dio al Ministerio de Salud 18 meses para actualizar el reglamento. Antes de aplicar esta guía, revisa en LeyChile si el Decreto 41 ya fue modificado.",
        },
      ],
    },
    {
      h2: "¿Qué debe contener como mínimo?",
      bloques: [
        {
          tipo: "p",
          texto: "El artículo 6 del Decreto 41 enumera el contenido mínimo:",
        },
        {
          tipo: "tabla",
          columnas: ["Letra del art. 6", "Qué incluye"],
          filas: [
            [
              "a) Identificación del paciente",
              "Nombre completo, tipo y número de documento, sexo, fecha de nacimiento, domicilio, datos de contacto, ocupación, representante legal o apoderado, y sistema de salud al que pertenece.",
            ],
            [
              "b) Datos de la ficha y del prestador",
              "Número identificador de la ficha, fecha de creación, nombre o denominación completa del prestador y su RUN o RUT.",
            ],
            [
              "c) Registro de atenciones",
              "Registro cronológico y fechado de todas las atenciones: consultas, evolución clínica, indicaciones, procedimientos diagnósticos y terapéuticos, protocolos quirúrgicos, resultados de exámenes, interconsultas y derivaciones, entre otros.",
            ],
            [
              "d) Decisiones del paciente",
              "Consentimientos informados, rechazos de tratamiento, solicitudes de alta voluntaria y decisiones vinculadas a creencias religiosas, étnicas o culturales.",
            ],
          ],
          nota: "Resumen del artículo 6 del Decreto 41. Para la redacción exacta, consulta el texto oficial en LeyChile.",
        },
        {
          tipo: "p",
          texto:
            "Además, la ficha debe ser clara, legible y ordenada en forma secuencial (art. 5). En cada nueva atención hay que confirmar y actualizar los datos de identificación, y cada anotación debe identificar al profesional que atendió y llevar su firma (art. 7).",
        },
        {
          tipo: "p",
          texto:
            "El reglamento no tiene un capítulo propio para odontología. El odontograma, el plan de tratamiento y los presupuestos aceptados forman parte del registro de atenciones de la letra c, y el consentimiento de un procedimiento invasivo cae en la letra d.",
        },
      ],
    },
    {
      h2: "¿Puede ser una ficha electrónica?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Sí. La ficha puede llevarse en papel, en soporte electrónico o en otro formato (Ley 20.584, art. 12; Decreto 41, art. 2), siempre que los registros sean completos y se asegure el acceso, la conservación y la confidencialidad.",
        },
        {
          tipo: "p",
          texto:
            "Para la ficha electrónica, el artículo 8 del Decreto 41 pide respaldos y medidas de seguridad que mantengan la información completa, accesible, confidencial y auténtica. El artículo 9 pide registrar quién accede a cada ficha y cuándo, y limitar el acceso a quien lo necesita para atender.",
        },
      ],
    },
    {
      h2: "¿Quién puede acceder a la ficha?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Los terceros que no participan directamente en la atención no tienen acceso, incluido el personal administrativo del propio prestador (Ley 20.584, art. 13). La ley enumera quiénes pueden acceder:",
        },
        {
          tipo: "lista",
          items: [
            "El paciente, su representante legal o, si falleció, sus herederos.",
            "Un tercero autorizado por el paciente mediante poder simple ante notario (o firma electrónica avanzada, según la redacción vigente del art. 13).",
            "Los tribunales, cuando la información se relaciona con causas que conocen.",
            "Fiscales y abogados, con autorización previa del juez, cuando se vincula con sus investigaciones o defensas.",
            "El Instituto de Salud Pública, el Ministerio de Salud y la Superintendencia de Salud, en el ejercicio de sus facultades.",
            "Los profesionales que participan directamente en la atención del paciente, para la continuidad del tratamiento.",
            "La Superintendencia de Seguridad Social, las comisiones médicas de control y los profesionales que emiten licencias médicas, limitado a la condición que motiva la licencia.",
          ],
        },
      ],
    },
    {
      h2: "¿Cuánto tiempo hay que guardarla?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Al menos 15 años. La Ley 20.584 (art. 13) lo fija como piso, y el Decreto 41 (art. 11) precisa que el plazo se cuenta desde el último ingreso de información. El detalle, incluida la destrucción, está en la guía sobre [conservación de la ficha clínica en Chile](/guias/conservacion-ficha-clinica-chile).",
        },
      ],
    },
    {
      h2: "¿Cómo lo resuelve Esmalia?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "Ficha del paciente con odontograma FDI versionado: cada marca nueva se agrega como una versión y la anterior queda en el historial.",
            "Notas clínicas con revisión, y un registro de auditoría de cada nota que escribe la base de datos, no la aplicación.",
            "Consentimientos dentro de la ficha del paciente.",
            "Cada clínica tiene sus datos aislados a nivel de base de datos. Más detalle en [Datos y seguridad](/docs/datos-y-seguridad).",
            "Si dejas de pagar después de la prueba, la agenda, los pacientes y la ficha siguen abiertos.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Esmalia es una herramienta para llevar la ficha. Cumplir la norma sigue siendo responsabilidad del prestador: qué se anota, quién firma, a quién se le entrega una copia y cuánto se conserva.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Un dentista independiente tiene que llevar ficha clínica?",
      a: "Sí. El Decreto 41 se aplica a prestadores públicos y privados, institucionales e individuales (art. 1).",
    },
    {
      q: "¿Puedo entregarle una copia de la ficha al paciente?",
      a: "Sí. El paciente es uno de los que la ley autoriza a acceder (Ley 20.584, art. 13; Decreto 41, art. 10).",
    },
    {
      q: "¿La ficha electrónica tiene la misma validez que la de papel?",
      a: "La ley admite ambos soportes, siempre que se garantice el registro completo, el acceso, la conservación y la confidencialidad (Ley 20.584, art. 12).",
    },
  ],
  fuentes: [
    {
      titulo: "Ley 20.584, derechos y deberes de los pacientes (LeyChile, BCN)",
      url: "https://www.bcn.cl/leychile/navegar?idNorma=1039348",
    },
    {
      titulo:
        "Decreto 41 de 2012, Ministerio de Salud: Reglamento sobre fichas clínicas (LeyChile, BCN)",
      url: "https://www.bcn.cl/leychile/navegar?idNorma=1046753",
    },
    {
      titulo: "Superintendencia de Salud: Decreto N° 41",
      url: "https://www.superdesalud.gob.cl/normativa/decreto-n-41/",
    },
  ],
  relacionados: [
    "/guias/conservacion-ficha-clinica-chile",
    "/plantillas/consentimiento-informado-odontologico",
    "/funciones/ficha-clinica",
    "/funciones/odontograma",
    "/software-dental-chile",
  ],
  enUnaLinea:
    "Qué exigen la Ley 20.584 y el Decreto 41 del Minsal a la ficha clínica odontológica en Chile: contenido mínimo, formato, acceso y conservación.",
};
