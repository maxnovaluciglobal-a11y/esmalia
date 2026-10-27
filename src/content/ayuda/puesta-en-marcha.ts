// src/content/ayuda/puesta-en-marcha.ts
//
// ONB-01: un video por paso de la puesta en marcha (tarjeta de Hoy, NAV-02).
// Los pasos y su avance viven en `src/lib/panel/puesta-en-marcha.ts`; acá
// solo el texto corto y el video de cada uno, con el mismo id.
import type { Video } from "@/content/ayuda/tipos";
import type { IdPaso } from "@/lib/panel/puesta-en-marcha";

export type AyudaPaso = { titulo: string; texto: string; video: Video };

export const AYUDA_PUESTA_EN_MARCHA: Readonly<Record<IdPaso, AyudaPaso>> = {
  datos: {
    titulo: "Completa los datos de la clínica",
    texto:
      "En Ajustes → Datos de la clínica cargas razón social, RUT y dirección: salen en tus documentos y presupuestos.",
    video: {
      estado: "pendiente",
      duracion: "1 min",
      guion:
        "Completar Datos de la clínica: razón social, RUT, dirección y logo en los documentos.",
    },
  },
  sucursales: {
    titulo: "Revisa sucursales y horarios",
    texto: "En Sucursales defines qué días y a qué hora atiende cada sede, y sus boxes.",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Editar el horario de una sucursal y crear un box.",
    },
  },
  profesionales: {
    titulo: "Define el horario de cada profesional",
    texto:
      "En Profesionales cargas el horario de cada uno por sucursal. La agenda y la reserva en línea ofrecen solo esas horas.",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Definir el horario de un profesional en dos sucursales y verlo reflejado en la agenda.",
    },
  },
  equipo: {
    titulo: "Invita a tu equipo",
    texto:
      "En Equipo y permisos invitas a cada persona con su correo y su rol. Cada rol ve solo lo suyo.",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Invitar a una recepcionista y a un profesional, explicando qué ve cada rol.",
    },
  },
  arancel: {
    titulo: "Carga tu arancel de precios",
    texto:
      "En Aranceles cargas tus prestaciones con su precio (o importas una planilla). Sirve para presupuestar y cobrar.",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Cargar tres prestaciones con precio y duración, y realinear precios con vista previa.",
    },
  },
  pacientes: {
    titulo: "Importa tus pacientes",
    texto:
      "En Migración de datos importas pacientes y citas desde CSV o Excel, con vista previa y reversa del lote completo.",
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Importar un CSV de pacientes: vista previa, mapeo de columnas, confirmación y reversa del lote.",
    },
  },
  "primera-cita": {
    titulo: "Agenda la primera cita",
    texto: "En la agenda, «Nueva cita» (o la tecla N): paciente, profesional, tipo y duración.",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Agendar la primera cita desde la agenda y verla en Hoy.",
    },
  },
  reserva: {
    titulo: "Activa la reserva en línea",
    texto:
      "En Reserva en línea defines las reglas, la enciendes y compartes el enlace. Cada reserva entra por confirmar.",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Configurar reglas, encender la reserva y mostrar cómo llega una reserva por confirmar.",
    },
  },
  correos: {
    titulo: "Enciende los correos a pacientes",
    texto:
      "En Notificaciones a pacientes enciendes la confirmación y el recordatorio por correo. Todo viene apagado.",
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Encender confirmación y recordatorio por correo y explicar el modo de prueba del correo.",
    },
  },
  llamada: {
    titulo: "Haz la llamada de puesta en marcha",
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
