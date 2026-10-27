// src/content/ayuda/puesta-en-marcha.ts
//
// ONB-01: un video por paso del checklist "Activa tu clínica" (Hoy). Los
// pasos y su avance viven en el dashboard; acá solo el texto corto y el
// video de cada uno, por id estable.
import type { Video } from "@/content/ayuda/tipos";

export type IdPasoPuestaEnMarcha =
  | "crear-clinica"
  | "invitar-equipo"
  | "cargar-pacientes"
  | "primera-cita"
  | "llamada-puesta-en-marcha";

export type AyudaPaso = { titulo: string; texto: string; video: Video };

export const AYUDA_PUESTA_EN_MARCHA: Readonly<Record<IdPasoPuestaEnMarcha, AyudaPaso>> = {
  "crear-clinica": {
    titulo: "Crear la clínica",
    texto:
      "Ya está hecho al registrarte. En Ajustes → Datos de la clínica completas nombre, dirección y datos tributarios.",
    video: {
      estado: "pendiente",
      duracion: "1 min",
      guion: "Completar Datos de la clínica: nombre, dirección, zona horaria y datos tributarios.",
    },
  },
  "invitar-equipo": {
    titulo: "Invitar al equipo",
    texto:
      "En Equipo y permisos invitas a cada persona con su correo y su rol. Cada rol ve solo lo suyo.",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Invitar a una recepcionista y a un profesional, explicando qué ve cada rol.",
    },
  },
  "cargar-pacientes": {
    titulo: "Importar o cargar pacientes",
    texto:
      "Crea pacientes uno a uno en Pacientes o importa tu base desde CSV o Excel (Ajustes → Migración de datos), con vista previa y reversa del lote.",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Crear un paciente a mano y luego importar un CSV con la vista previa, el mapeo de columnas y la reversa del lote.",
    },
  },
  "primera-cita": {
    titulo: "Agendar la primera cita",
    texto: "En la agenda, «Nueva cita» (o la tecla N): paciente, profesional, tipo y duración.",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Agendar la primera cita desde la agenda y verla en Hoy.",
    },
  },
  "llamada-puesta-en-marcha": {
    titulo: "Hacer la puesta en marcha",
    texto:
      "Una llamada corta con el equipo de Esmalia que activa WhatsApp, el portal de pacientes y efectividad.",
    video: {
      estado: "pendiente",
      duracion: "1 min",
      guion:
        "Walter explica qué se hace en la llamada de puesta en marcha, cuánto dura y qué queda activado al final.",
    },
  },
};
