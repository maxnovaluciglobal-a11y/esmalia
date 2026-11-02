import type { PaginaContenido } from "../tipos";

// BORRADOR: guía normativa. No se publica sin revisión de un odontólogo y,
// idealmente, de un abogado (ver tipos.ts, `revisor`). Textos verificados el
// 2026-10-11 en Infoleg (Ley 26.529, texto actualizado) y en
// argentina.gob.ar (Ley 26.812 y Ley 27.706).

export const pagina: PaginaContenido = {
  coleccion: "guias",
  path: "/guias/historia-clinica-odontologica-argentina",
  titulo: "Historia clínica odontológica en Argentina | Esmalia",
  descripcion:
    "Qué exige la Ley 26.529 a la historia clínica odontológica en Argentina: registro de piezas (Ley 26.812), copia en 48 h y guarda de 10 años.",
  kicker: "Guía",
  h1: "Historia clínica odontológica en Argentina: qué dice la ley",
  resumen:
    "En Argentina la historia clínica la regula la Ley 26.529. Es obligatoria, cronológica, foliada y completa; el paciente es su titular y puede pedir copia, que se entrega en 48 horas. Desde la Ley 26.812, la odontológica debe identificar las piezas dentales en forma estandarizada. Se guarda al menos 10 años.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  borrador: true,
  secciones: [
    {
      h2: "¿Qué normas aplican?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Ley 26.529**, Derechos del Paciente en su relación con los profesionales e instituciones de la salud (Boletín Oficial del 20 de noviembre de 2009). El capítulo IV, artículos 12 a 21, trata la historia clínica. [Texto actualizado en Infoleg](https://servicios.infoleg.gob.ar/infolegInternet/anexos/160000-164999/160432/texact.htm).",
            "**Ley 26.812** (Boletín Oficial del 21 de enero de 2013). Sustituyó el artículo 15 de la Ley 26.529 y agregó el registro odontológico. [Texto en argentina.gob.ar](https://www.argentina.gob.ar/normativa/nacional/ley-26812-207587/texto).",
            "**Ley 26.742** (2012). Modificó los artículos sobre consentimiento informado (5, 6 y 7, entre otros).",
            "**Decreto 1089/2012**, que reglamenta la Ley 26.529.",
            "**Ley 27.706** (Boletín Oficial del 16 de marzo de 2023). Creó el Programa Federal Único de Informatización y Digitalización de las Historias Clínicas. [Texto en argentina.gob.ar](https://www.argentina.gob.ar/normativa/nacional/ley-27706-380710/texto).",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Son normas nacionales. Cada provincia puede tener adhesiones, reglamentaciones o plazos propios. Revisa la norma de tu jurisdicción antes de aplicar esta guía.",
        },
      ],
    },
    {
      h2: "¿Qué es la historia clínica según la ley?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El artículo 12 de la Ley 26.529 la define como el documento obligatorio, cronológico, foliado y completo en el que consta toda actuación realizada al paciente por profesionales y auxiliares de la salud.",
        },
        {
          tipo: "tabla",
          columnas: ["Artículo", "Qué establece"],
          filas: [
            [
              "Art. 13",
              "Se admite la historia clínica informatizada si se asegura su integridad, autenticidad, inalterabilidad, perdurabilidad y recuperabilidad.",
            ],
            [
              "Art. 14",
              "El paciente es el titular. Puede pedir una copia autenticada, que se entrega dentro de las 48 horas (salvo emergencia).",
            ],
            [
              "Art. 15",
              "Asientos obligatorios (texto de la Ley 26.812), incluido el registro odontológico.",
            ],
            [
              "Art. 16",
              "Forman parte de la historia los consentimientos, las hojas de indicaciones, los protocolos quirúrgicos y los estudios realizados, rechazados o abandonados.",
            ],
            [
              "Art. 17",
              "Es única en cada establecimiento e identifica al paciente con una clave uniforme que se le comunica.",
            ],
            [
              "Art. 18",
              "Es inviolable. El establecimiento o el profesional es depositario y la guarda dura al menos 10 años.",
            ],
            [
              "Art. 19",
              "Quiénes pueden pedirla: el paciente y su representante, el cónyuge o conviviente y los herederos forzosos (con autorización del paciente, salvo que no pueda darla), y los médicos con autorización del paciente.",
            ],
            ["Art. 20", "Ante la negativa o la demora, procede la acción directa de habeas data."],
            [
              "Art. 21",
              "El incumplimiento es falta grave, sin perjuicio de la responsabilidad civil o penal.",
            ],
          ],
          nota: "Paráfrasis del texto actualizado en Infoleg. Para la redacción exacta, consulta la fuente.",
        },
      ],
    },
    {
      h2: "¿Qué exige la Ley 26.812 a la historia odontológica?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El nuevo artículo 15, inciso f, dice que las historias clínicas odontológicas deben contener registros odontológicos que permitan identificar al paciente. Y agrega que ese registro, integrante de la historia clínica, debe individualizar las piezas dentales en forma estandarizada, **según el sistema dígito dos o binario**, con el sistema de marcación y colores que fije la reglamentación.",
        },
        {
          tipo: "p",
          texto:
            "El sistema dígito dos es la notación de dos dígitos de la FDI: el primer dígito indica el cuadrante y el segundo, la pieza (por ejemplo, 11 es el incisivo central superior derecho).",
        },
        {
          tipo: "aviso",
          texto:
            "Pendiente de revisión profesional: confirmar qué norma fija hoy el sistema de marcación y colores al que remite la Ley 26.812, y si hay criterios provinciales o de colegios odontológicos.",
        },
      ],
    },
    {
      h2: "¿Cuánto tiempo se guarda?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El artículo 18 fija un plazo mínimo de **10 años** de prescripción liberatoria de la responsabilidad contractual, contado desde la última actuación registrada. Los depositarios son los establecimientos y los profesionales titulares de consultorios privados.",
        },
        {
          tipo: "aviso",
          texto:
            "Pendiente de revisión profesional: confirmar si alguna norma posterior o provincial fija un plazo distinto para tu jurisdicción.",
        },
      ],
    },
    {
      h2: "¿Cuándo el consentimiento tiene que ser escrito?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Por regla es verbal. Según el artículo 7 de la Ley 26.529 (modificado por la Ley 26.742), debe ser escrito y firmado en casos como internación, intervenciones quirúrgicas, procedimientos diagnósticos y terapéuticos invasivos, procedimientos que la reglamentación determine como de riesgo, y la revocación. Hay una base para adaptar en la [plantilla de consentimiento informado odontológico](/plantillas/consentimiento-informado-odontologico).",
        },
      ],
    },
    {
      h2: "¿Cómo lo resuelve Esmalia?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "Odontograma con notación FDI de dos dígitos, versionado: cada cambio agrega una versión y la anterior queda en el historial.",
            "Notas clínicas con revisión y un registro de auditoría que escribe la base de datos, no la aplicación.",
            "Consentimientos dentro de la ficha del paciente.",
            "Clínicas en Argentina con moneda y huso horario del país.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "La historia clínica informatizada también debe ajustarse a la Ley 25.506 de firma digital (Decreto 1089/2012). Antes de elegir cualquier software, revisa con tu asesor cómo cubre ese punto. Cumplir la norma sigue siendo responsabilidad del profesional o del establecimiento.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿El paciente puede pedirme la historia clínica?",
      a: "Sí. Es su titular y puede pedir una copia autenticada, que se le entrega dentro de las 48 horas salvo emergencia (Ley 26.529, art. 14).",
    },
    {
      q: "¿Qué numeración dental exige la ley?",
      a: "La Ley 26.812 pide individualizar las piezas según el sistema dígito dos o binario, que es la notación de dos dígitos de la FDI.",
    },
    {
      q: "¿Puedo llevar la historia clínica en un software?",
      a: "Sí, si se asegura su integridad, autenticidad, inalterabilidad, perdurabilidad y recuperabilidad (Ley 26.529, art. 13).",
    },
  ],
  fuentes: [
    {
      titulo: "Ley 26.529, texto actualizado (Infoleg)",
      url: "https://servicios.infoleg.gob.ar/infolegInternet/anexos/160000-164999/160432/texact.htm",
    },
    {
      titulo: "Ley 26.812, texto original (argentina.gob.ar)",
      url: "https://www.argentina.gob.ar/normativa/nacional/ley-26812-207587/texto",
    },
    {
      titulo: "Ley 27.706, Programa Federal de Historias Clínicas (argentina.gob.ar)",
      url: "https://www.argentina.gob.ar/normativa/nacional/ley-27706-380710/texto",
    },
    {
      titulo: "Normas que modifican la Ley 26.529 (argentina.gob.ar)",
      url: "https://www.argentina.gob.ar/normativa/nacional/ley-26529-160432/normas-modifican",
    },
  ],
  relacionados: [
    "/software-dental-argentina",
    "/funciones/odontograma",
    "/funciones/ficha-clinica",
    "/plantillas/consentimiento-informado-odontologico",
  ],
  enUnaLinea:
    "Qué exigen las leyes 26.529 y 26.812 a la historia clínica odontológica en Argentina: contenido, registro de piezas, copia al paciente y guarda.",
};
