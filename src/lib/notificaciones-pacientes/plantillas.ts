/**
 * Correos automáticos al paciente (Ola 7 · frente B): plantillas puras con el
 * diseño compartido (`src/lib/email/layout.ts`, respaldo Georgia).
 *
 * Lo que estos correos NUNCA llevan: datos clínicos. Ni el tratamiento ni el
 * motivo de la cita: solo cuándo, con quién y dónde. Si va al tutor, se dice
 * de quién es la cita.
 */
import { p, pTenue, renderCorreo, type Bloque, type CorreoRenderizado } from "@/lib/email/layout";
import { primerNombre } from "@/lib/documentos/correo";
import { fechaLarga, hora } from "@/lib/formato-fecha";

export interface DatosDeLaCita {
  appUrl: string;
  clinica: string;
  zona: string;
  startsAt: string;
  profesional: string | null;
  sucursal: string | null;
  direccion: string | null;
  /** Nombre completo del paciente. */
  paciente: string;
  /** A quién se le escribe: el paciente o su tutor (menor de edad). */
  para: "paciente" | "tutor";
  nombreTutor: string | null;
  /** Página de la cita del frente A (`/mi-cita/:token`); null si no está disponible. */
  enlaceGestion: string | null;
  /** MKT-07: link del formulario antes de la cita, si va en este correo. */
  enlaceFormulario: string | null;
  bajaUrl: string;
}

function saludo(d: Pick<DatosDeLaCita, "para" | "nombreTutor" | "paciente">): Bloque {
  const nombre = primerNombre(d.para === "tutor" ? d.nombreTutor : d.paciente);
  return p(nombre ? `Hola, ${nombre}:` : "Hola:");
}

/** "tu cita" o "la cita de Ana". */
function deQuien(d: Pick<DatosDeLaCita, "para" | "paciente">): string {
  if (d.para === "tutor") {
    const nombre = primerNombre(d.paciente);
    return nombre ? `la cita de ${nombre}` : "la cita";
  }
  return "tu cita";
}

function tablaDeLaCita(d: DatosDeLaCita): Bloque {
  const filas: { etiqueta: string; valor: string; nota?: string }[] = [
    { etiqueta: "Día", valor: fechaLarga(d.startsAt, d.zona) },
    { etiqueta: "Hora", valor: hora(d.startsAt, d.zona) },
  ];
  if (d.profesional) filas.push({ etiqueta: "Profesional", valor: d.profesional });
  if (d.sucursal || d.direccion) {
    filas.push({
      etiqueta: "Dónde",
      valor: d.sucursal ?? d.clinica,
      ...(d.direccion ? { nota: d.direccion } : {}),
    });
  }
  return { tipo: "tabla", filas };
}

function accionesDeLaCita(d: DatosDeLaCita): Bloque[] {
  if (!d.enlaceGestion) {
    return [pTenue("Si no puedes venir, avísale a la clínica por el canal de siempre.")];
  }
  return [
    {
      tipo: "botones",
      principal: { texto: "Confirmar asistencia", href: d.enlaceGestion },
      secundario: { texto: "Cancelar o reagendar", href: d.enlaceGestion },
    },
  ];
}

function bloqueFormulario(d: DatosDeLaCita): Bloque[] {
  if (!d.enlaceFormulario) return [];
  return [
    {
      tipo: "recuadro",
      titulo: "Antes de la cita",
      partes: [
        d.para === "tutor"
          ? "Actualiza los datos de contacto y responde un breve cuestionario de salud del paciente. Toma unos 3 minutos y ayuda a que la atención sea más segura."
          : "Actualiza tus datos de contacto y responde un breve cuestionario de salud. Toma unos 3 minutos y ayuda a que la atención sea más segura.",
      ],
      enlace: { texto: "Completar el formulario", href: d.enlaceFormulario },
    },
  ];
}

function pie(d: Pick<DatosDeLaCita, "clinica" | "bajaUrl" | "para">) {
  return {
    motivo:
      d.para === "tutor"
        ? `Recibes este correo como tutor de un paciente de ${d.clinica}, que usa Esmalia para su agenda. El contenido es responsabilidad de la clínica.`
        : `Recibes este correo porque tienes una cita en ${d.clinica}, que usa Esmalia para su agenda. El contenido es responsabilidad de la clínica.`,
    bajaUrl: d.bajaUrl,
    bajaTexto: `No quiero recibir más correos de ${d.clinica}`,
  };
}

/** REC-03: confirmación al agendar. */
export function correoConfirmacion(d: DatosDeLaCita): CorreoRenderizado {
  const cuando = `${fechaLarga(d.startsAt, d.zona)} a las ${hora(d.startsAt, d.zona)}`;
  const quien = deQuien(d);
  return renderCorreo({
    appUrl: d.appUrl,
    asunto:
      d.para === "tutor"
        ? `${quien.charAt(0).toUpperCase()}${quien.slice(1)} en ${d.clinica} está agendada`
        : `Tu cita en ${d.clinica} está agendada`,
    preencabezado: `${cuando}.`,
    titulo: d.para === "tutor" ? "Cita agendada" : "Tu cita está agendada",
    bajada: d.clinica,
    bloques: [
      saludo(d),
      p(`${d.clinica} agendó ${quien}. Estos son los datos:`),
      tablaDeLaCita(d),
      ...accionesDeLaCita(d),
      ...bloqueFormulario(d),
    ],
    pie: pie(d),
  });
}

/** REC-02: recordatorio N horas antes. */
export function correoRecordatorio(d: DatosDeLaCita & { horasAntes: number }): CorreoRenderizado {
  const cuando = `${fechaLarga(d.startsAt, d.zona)} a las ${hora(d.startsAt, d.zona)}`;
  const quien = deQuien(d);
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: `Recordatorio: ${quien} en ${d.clinica}, ${cuando}`,
    preencabezado: `${d.clinica} te espera el ${cuando}.`,
    titulo: d.para === "tutor" ? "Recordatorio de la cita" : "Recordatorio de tu cita",
    bajada: d.clinica,
    bloques: [
      saludo(d),
      p(`Te recordamos ${quien} en ${d.clinica}:`),
      tablaDeLaCita(d),
      ...accionesDeLaCita(d),
      ...bloqueFormulario(d),
      pTenue("Si llegas unos minutos antes, la atención empieza a la hora."),
    ],
    pie: pie(d),
  });
}

export interface DatosDeLaEncuesta {
  appUrl: string;
  clinica: string;
  zona: string;
  startsAt: string;
  paciente: string;
  para: "paciente" | "tutor";
  nombreTutor: string | null;
  enlaceEncuesta: string;
  bajaUrl: string;
}

/** MKT-08: encuesta NPS después de la cita. */
export function correoEncuesta(d: DatosDeLaEncuesta): CorreoRenderizado {
  const nombrePaciente = primerNombre(d.paciente);
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: `¿Cómo fue la visita a ${d.clinica}?`,
    preencabezado: "Son dos preguntas y toma menos de un minuto.",
    titulo: "¿Cómo fue la visita?",
    bajada: d.clinica,
    bloques: [
      saludo(d),
      p(
        d.para === "tutor" && nombrePaciente
          ? `Gracias por acompañar a ${nombrePaciente} a ${d.clinica} el ${fechaLarga(d.startsAt, d.zona)}.`
          : `Gracias por venir a ${d.clinica} el ${fechaLarga(d.startsAt, d.zona)}.`,
      ),
      p(
        "¿Qué tan probable es que recomiendes la clínica a un familiar o a un amigo? Tu respuesta llega a la clínica y la ayuda a mejorar.",
      ),
      { tipo: "boton", texto: "Responder la encuesta", href: d.enlaceEncuesta },
      pTenue("Son dos preguntas y toma menos de un minuto. El link vale 14 días."),
    ],
    pie: {
      motivo:
        d.para === "tutor"
          ? `Recibes este correo como tutor de un paciente de ${d.clinica}, que usa Esmalia para su gestión.`
          : `Recibes este correo porque te atendiste en ${d.clinica}, que usa Esmalia para su gestión.`,
      bajaUrl: d.bajaUrl,
      bajaTexto: `No quiero recibir más correos de ${d.clinica}`,
    },
  });
}

/** URL pública del formulario antes de la cita. */
export function urlFormulario(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/formulario/${token}`;
}

/** URL pública de la encuesta. */
export function urlEncuesta(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/encuesta/${token}`;
}
