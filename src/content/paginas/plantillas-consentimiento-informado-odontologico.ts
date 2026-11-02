import type { PaginaContenido } from "../tipos";

// BORRADOR: plantilla clínico-legal. No se publica sin revisión de un
// odontólogo y, idealmente, de un abogado (ver tipos.ts, `revisor`).
// Requisitos de forma verificados el 2026-10-11: Ley 20.584 art. 14 (Chile)
// y Ley 26.529 arts. 5-7 (Argentina).

export const pagina: PaginaContenido = {
  coleccion: "plantillas",
  path: "/plantillas/consentimiento-informado-odontologico",
  titulo: "Consentimiento informado odontológico: plantilla | Esmalia",
  descripcion:
    "Plantilla de consentimiento informado odontológico con sus secciones: procedimiento, riesgos, alternativas, costos y firma. Adáptala con un profesional.",
  kicker: "Plantillas",
  h1: "Plantilla de consentimiento informado odontológico",
  resumen:
    "Un consentimiento informado odontológico explica en lenguaje simple el procedimiento, para qué sirve, sus riesgos, las alternativas y qué pasa si no se hace, y deja la firma del paciente. En Chile (Ley 20.584) y Argentina (Ley 26.529) debe ser escrito para procedimientos invasivos. Esta plantilla es genérica: adáptala con un profesional.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  borrador: true,
  secciones: [
    {
      h2: "¿Cuándo tiene que ser escrito?",
      bloques: [
        {
          tipo: "tabla",
          columnas: ["País", "Norma", "Cuándo va por escrito"],
          filas: [
            [
              "Chile",
              "[Ley 20.584, art. 14](https://www.bcn.cl/leychile/navegar?idNorma=1039348)",
              "Por regla es verbal. Va por escrito en intervenciones quirúrgicas, procedimientos diagnósticos y terapéuticos invasivos y, en general, procedimientos que conlleven un riesgo relevante y conocido para la salud.",
            ],
            [
              "Argentina",
              "[Ley 26.529, arts. 5 a 7](https://servicios.infoleg.gob.ar/infolegInternet/anexos/160000-164999/160432/texact.htm)",
              "Por regla es verbal. Va por escrito y firmado en internación, intervención quirúrgica, procedimientos diagnósticos y terapéuticos invasivos, procedimientos que la reglamentación determine como de riesgo, y revocación.",
            ],
          ],
          nota: "Para Perú, México y Colombia revisa la norma local con tu asesor: esta plantilla no la cubre.",
        },
        {
          tipo: "p",
          texto:
            "En Chile, la firma del paciente en el documento explicativo hace presumir que recibió la información (Ley 20.584, art. 14). En Argentina, la ley define qué información debe recibir el paciente antes de consentir (Ley 26.529, art. 5).",
        },
        {
          tipo: "aviso",
          texto:
            "Esta plantilla es una estructura, no un documento listo para firmar. Los riesgos, las alternativas y los cuidados de cada procedimiento los redacta el profesional tratante. Antes de usarla, que la revise un odontólogo y, si puedes, un abogado de tu país.",
        },
      ],
    },
    {
      h2: "¿Qué secciones debe tener?",
      bloques: [
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "Identificación de la clínica, del profesional y del paciente (y de su representante, si corresponde).",
            "Diagnóstico y procedimiento propuesto, en lenguaje simple.",
            "Objetivo y beneficios esperados.",
            "Riesgos y molestias frecuentes, y riesgos poco frecuentes pero graves.",
            "Alternativas, incluida la de no tratarse, y sus consecuencias.",
            "Anestesia, medicamentos o materiales relevantes.",
            "Cuidados posteriores y señales de alarma.",
            "Costo y forma de pago, si aplica.",
            "Declaración del paciente y derecho a revocar.",
            "Firmas y fecha.",
          ],
        },
      ],
    },
    {
      h2: "Plantilla para copiar",
      bloques: [
        {
          tipo: "plantilla",
          titulo: "1. Identificación",
          texto:
            "Clínica: {clinica}. Dirección: {direccion}.\nProfesional tratante: {profesional}. Registro profesional: {registro}.\nPaciente: {nombre}. Documento de identidad: {documento}. Fecha de nacimiento: {fecha_nacimiento}.\nRepresentante legal (si el paciente es menor de edad o no puede consentir): {representante}. Documento: {documento_representante}.",
        },
        {
          tipo: "plantilla",
          titulo: "2. Diagnóstico y procedimiento",
          texto:
            "Diagnóstico: {diagnostico}.\nProcedimiento propuesto: {procedimiento}.\nPiezas dentales involucradas (notación FDI): {piezas}.\nNúmero estimado de sesiones: {sesiones}.\nEn palabras simples, el procedimiento consiste en: {explicacion_simple}.",
        },
        {
          tipo: "plantilla",
          titulo: "3. Objetivo y beneficios",
          texto:
            "El objetivo de este procedimiento es {objetivo}. Los beneficios esperados son: {beneficios}.",
        },
        {
          tipo: "plantilla",
          titulo: "4. Riesgos",
          texto:
            "Como todo procedimiento, este tiene riesgos. Los más frecuentes son: {riesgos_frecuentes}.\nLos poco frecuentes pero importantes son: {riesgos_graves}.\nRiesgos propios de mi situación de salud, según me explicó el profesional: {riesgos_personales}.",
        },
        {
          tipo: "plantilla",
          titulo: "5. Alternativas",
          texto:
            "Las alternativas a este procedimiento son: {alternativas}.\nSi decido no tratarme, las consecuencias posibles son: {consecuencias_no_tratar}.",
        },
        {
          tipo: "plantilla",
          titulo: "6. Anestesia y medicamentos",
          texto:
            "Para este procedimiento se usará: {anestesia_medicamentos}.\nDeclaro haber informado al profesional mis alergias, enfermedades, medicamentos que tomo y si estoy o podría estar embarazada: {declaracion_salud}.",
        },
        {
          tipo: "plantilla",
          titulo: "7. Cuidados posteriores",
          texto:
            "Después del procedimiento debo seguir estas indicaciones: {indicaciones}.\nDebo consultar de inmediato si presento: {senales_alarma}.\nTeléfono de contacto de la clínica: {telefono}.",
        },
        {
          tipo: "plantilla",
          titulo: "8. Costo",
          texto:
            "El costo estimado del tratamiento es {monto}, según el presupuesto N° {presupuesto}. Si durante el tratamiento surge la necesidad de un procedimiento distinto, se me informará antes y se pedirá mi consentimiento.",
        },
        {
          tipo: "plantilla",
          titulo: "9. Declaración del paciente",
          texto:
            "Declaro que el profesional me explicó en lenguaje claro el procedimiento, sus beneficios, riesgos y alternativas, y las consecuencias de no realizarlo. Pude hacer preguntas y me las respondieron. Entiendo que puedo revocar este consentimiento en cualquier momento antes del procedimiento, sin expresar causa.\nEn consecuencia, [ ] acepto  [ ] rechazo  el procedimiento descrito.",
        },
        {
          tipo: "plantilla",
          titulo: "10. Firmas",
          texto:
            "Lugar y fecha: {ciudad}, {fecha}.\n\nFirma del paciente o representante: ____________________\nNombre: {nombre}\n\nFirma del profesional: ____________________\nNombre: {profesional}\n\nRevocación (completar solo si el paciente retira su consentimiento):\nFecha: ________  Firma: ____________________",
        },
      ],
    },
    {
      h2: "¿Cómo se guarda el consentimiento?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Forma parte de la ficha o historia clínica. En Chile, el Decreto 41 incluye los consentimientos en el contenido mínimo de la ficha (art. 6, letra d); en Argentina, la Ley 26.529 los incluye en la historia clínica (art. 16). Se conservan con ella por el mismo plazo.",
        },
        {
          tipo: "p",
          texto:
            "En Esmalia, los consentimientos se registran dentro de la ficha del paciente, junto al odontograma y las notas clínicas. Más detalle en [ficha clínica](/funciones/ficha-clinica).",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Sirve un consentimiento genérico para todos los tratamientos?",
      a: "No conviene. Los riesgos y las alternativas cambian según el procedimiento. Usa una estructura común y completa el contenido de cada procedimiento con el profesional tratante.",
    },
    {
      q: "¿Quién firma si el paciente es menor de edad?",
      a: "Su representante legal. En Chile, la Ley 20.584 reconoce además el derecho del menor a ser oído según su madurez (art. 14). Revisa la norma de tu país con tu asesor.",
    },
    {
      q: "¿El paciente puede arrepentirse después de firmar?",
      a: "En Argentina la ley prevé la revocación y exige que quede por escrito (Ley 26.529, art. 7). En Chile, la Ley 20.584 reconoce el derecho a otorgar o denegar el consentimiento (art. 14); confirma con tu asesor cómo documentar un retiro.",
    },
  ],
  fuentes: [
    {
      titulo: "Ley 20.584, derechos y deberes de los pacientes, art. 14 (LeyChile, BCN)",
      url: "https://www.bcn.cl/leychile/navegar?idNorma=1039348",
    },
    {
      titulo: "Decreto 41 de 2012, Reglamento sobre fichas clínicas, art. 6 (LeyChile, BCN)",
      url: "https://www.bcn.cl/leychile/navegar?idNorma=1046753",
    },
    {
      titulo: "Ley 26.529, texto actualizado, arts. 5 a 7 y 16 (Infoleg)",
      url: "https://servicios.infoleg.gob.ar/infolegInternet/anexos/160000-164999/160432/texact.htm",
    },
  ],
  relacionados: [
    "/guias/ficha-clinica-odontologica-chile",
    "/guias/historia-clinica-odontologica-argentina",
    "/funciones/ficha-clinica",
    "/funciones/odontograma",
  ],
  enUnaLinea:
    "Plantilla genérica de consentimiento informado odontológico con 10 secciones para copiar y adaptar con un profesional, con los requisitos de Chile y Argentina.",
};
