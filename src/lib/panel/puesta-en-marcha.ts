// src/lib/panel/puesta-en-marcha.ts
//
// NAV-02 (Ola 12): avance de la puesta en marcha. Reemplaza al checklist
// "Activa tu clínica" de Hoy (25-sep-2026), que tenía cinco pasos y solo lo
// veía el propietario. Ahora son los pasos de configuración inicial que
// hacen falta para trabajar de verdad con Esmalia, cada uno calculado con
// datos reales de la base (ver `puesta-en-marcha.functions.ts`) y con un
// enlace al lugar donde se hace. Lo ven quienes pueden configurar la clínica
// (settings:manage: propietario y administrador), en Hoy y como una línea en
// el menú lateral. Se oculta cuando todo está hecho o cuando alguien lo
// descarta (queda guardado en la clínica, `clinics.setup_guide_dismissed_at`).
//
// Piezas puras: se prueban sin base ni navegador (`tests/puesta-en-marcha.test.ts`).
import type { Permission, SujetoDePermisos } from "@/lib/access/access";
import { hasPermission } from "@/lib/access/access";

/** Hechos de la base que deciden cada paso. */
export type DatosPuestaEnMarcha = {
  /** Razón social y RUT (o identificador tributario) cargados. */
  datosDeLaClinica: boolean;
  /** Al menos una sucursal con horario por día. */
  horariosDeSucursal: boolean;
  /** Al menos un profesional con su horario de atención. */
  horariosDeProfesionales: boolean;
  /** Personas en la clínica además de quien la creó. */
  integrantes: number;
  /** Prestaciones activas con precio. */
  prestacionesConPrecio: number;
  /** Pacientes activos (no archivados). */
  pacientes: number;
  /** Lote de pacientes importado y no revertido. */
  importoPacientes: boolean;
  /** Alguna cita en la agenda (cualquier fecha). */
  hayCitas: boolean;
  /** Reserva en línea encendida. */
  reservaEnLinea: boolean;
  /** Confirmación o recordatorio por correo encendido. */
  correosAPacientes: boolean;
  /** La llamada de puesta en marcha ya no hace falta (agendada o suscrita). */
  llamadaHecha: boolean;
  /** Cuándo se descartó el indicador (null = nunca). */
  descartadoAt: string | null;
};

export type IdPaso =
  | "datos"
  | "sucursales"
  | "profesionales"
  | "equipo"
  | "arancel"
  | "pacientes"
  | "primera-cita"
  | "reserva"
  | "correos"
  | "llamada";

export type PasoPuestaEnMarcha = {
  id: IdPaso;
  label: string;
  /** Qué se hace en ese paso, en una línea. */
  detalle: string;
  hecho: boolean;
  /** Pantalla donde se hace. La llamada no tiene: es un enlace externo. */
  to: string | null;
  cta: string;
  /** Permiso de la ruta destino (su `beforeLoad`): sin él no se ofrece el enlace. */
  permiso: Permission | null;
};

/**
 * Umbral para dar por "cargados" los pacientes sin importación: con una o dos
 * fichas de prueba la clínica todavía no trabaja con Esmalia.
 */
export const PACIENTES_PARA_DAR_POR_CARGADOS = 10;

export function pasosDePuestaEnMarcha(d: DatosPuestaEnMarcha): PasoPuestaEnMarcha[] {
  return [
    {
      id: "datos",
      label: "Completa los datos de la clínica",
      detalle: "Razón social y RUT, para tus documentos y presupuestos",
      hecho: d.datosDeLaClinica,
      to: "/datos-de-la-clinica",
      cta: "Completar",
      permiso: "settings:manage",
    },
    {
      id: "sucursales",
      label: "Revisa sucursales y horarios",
      detalle: "Qué días y a qué hora atiende cada sede",
      hecho: d.horariosDeSucursal,
      to: "/sucursales",
      cta: "Revisar",
      permiso: "settings:manage",
    },
    {
      id: "profesionales",
      label: "Define el horario de cada profesional",
      detalle: "La agenda y la reserva en línea ofrecen solo esas horas",
      hecho: d.horariosDeProfesionales,
      to: "/profesionales",
      cta: "Definir",
      permiso: "settings:manage",
    },
    {
      id: "equipo",
      label: "Invita a tu equipo",
      detalle: "Cada persona entra con su rol y sus permisos",
      hecho: d.integrantes > 1,
      to: "/equipo",
      cta: "Invitar",
      permiso: "team:view",
    },
    {
      id: "arancel",
      label: "Carga tu arancel de precios",
      detalle: "Las prestaciones y sus valores, para presupuestar y cobrar",
      hecho: d.prestacionesConPrecio > 0,
      to: "/aranceles",
      cta: "Cargar",
      permiso: "settings:manage",
    },
    {
      id: "pacientes",
      label: "Importa tus pacientes",
      detalle: "Desde otro sistema o una planilla, con vista previa y reversa",
      hecho: d.importoPacientes || d.pacientes >= PACIENTES_PARA_DAR_POR_CARGADOS,
      to: "/migracion",
      cta: "Importar",
      permiso: "settings:manage",
    },
    {
      id: "primera-cita",
      label: "Agenda la primera cita",
      detalle: "Desde la agenda o con “Nueva cita” en el buscador",
      hecho: d.hayCitas,
      to: "/agenda",
      cta: "Ir a la agenda",
      permiso: "agenda:view",
    },
    {
      id: "reserva",
      label: "Activa la reserva en línea",
      detalle: "Un link para que tus pacientes pidan hora solos",
      hecho: d.reservaEnLinea,
      to: "/reserva-en-linea",
      cta: "Activar",
      permiso: "settings:manage",
    },
    {
      id: "correos",
      label: "Enciende los correos a pacientes",
      detalle: "Confirmación y recordatorio de la cita por correo",
      hecho: d.correosAPacientes,
      to: "/notificaciones-a-pacientes",
      cta: "Encender",
      permiso: "settings:manage",
    },
    {
      // CS-02: WhatsApp, portal y efectividad se activan con la llamada (o
      // suscribiéndose). Estar acá evita descubrirlo al chocar con el candado.
      id: "llamada",
      label: "Haz la llamada de puesta en marcha",
      detalle: "Activa WhatsApp y el portal de pacientes",
      hecho: d.llamadaHecha,
      to: null,
      cta: "Agendar",
      permiso: null,
    },
  ];
}

export type Avance = {
  hechos: number;
  total: number;
  /** 0-100, redondeado hacia abajo (nunca dice 100 % si falta algo). */
  porcentaje: number;
  completo: boolean;
  /** Primer paso pendiente (el que se sugiere hacer ahora). */
  siguiente: PasoPuestaEnMarcha | null;
};

export function avanceDe(pasos: readonly PasoPuestaEnMarcha[]): Avance {
  const hechos = pasos.filter((p) => p.hecho).length;
  const total = pasos.length;
  return {
    hechos,
    total,
    porcentaje: total === 0 ? 100 : Math.floor((hechos / total) * 100),
    completo: hechos === total,
    siguiente: pasos.find((p) => !p.hecho) ?? null,
  };
}

/** Quién ve el avance: quien puede configurar la clínica, fuera de la demo. */
export function puedeVerPuestaEnMarcha(
  sujeto: SujetoDePermisos,
  clinica: { isDemo: boolean } | null | undefined,
): boolean {
  if (!clinica || clinica.isDemo) return false;
  return hasPermission(sujeto, "settings:manage");
}

/** Se muestra si hay algo pendiente y nadie lo descartó. */
export function mostrarPuestaEnMarcha(datos: DatosPuestaEnMarcha | null | undefined): boolean {
  if (!datos || datos.descartadoAt) return false;
  return !avanceDe(pasosDePuestaEnMarcha(datos)).completo;
}

/** El enlace de un paso solo si quien mira puede abrir esa pantalla. */
export function enlaceDelPaso(sujeto: SujetoDePermisos, paso: PasoPuestaEnMarcha): string | null {
  if (!paso.to || !paso.permiso) return null;
  return hasPermission(sujeto, paso.permiso) ? paso.to : null;
}
