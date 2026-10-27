// src/lib/ayuda/pantalla-actual.ts
//
// ¿En qué pantalla está la persona? (NAV-06, ONB-02, ONB-03). Puro: recibe
// el pathname del router y devuelve el id de la pantalla con ayuda, o null.
import type { PantallaId } from "@/content/ayuda/tipos";

/** Primer segmento de la ruta → pantalla. La ficha se distingue aparte. */
const POR_SEGMENTO: Readonly<Record<string, PantallaId>> = {
  dashboard: "hoy",
  agenda: "agenda",
  "configuracion-de-agenda": "agenda",
  "mi-agenda": "mi-agenda",
  pacientes: "pacientes",
  presupuestos: "presupuestos",
  caja: "caja",
  cajas: "caja",
  "cuentas-por-cobrar": "cuentas-por-cobrar",
  morosidad: "cuentas-por-cobrar",
  finanzas: "finanzas",
  informes: "informes",
  reportes: "informes",
  seguimiento: "seguimiento",
  campanas: "campanas",
  "plantillas-de-mensajes": "campanas",
  recordatorios: "recordatorios",
  conversaciones: "mensajes",
  mensajes: "mensajes",
  "reserva-en-linea": "reserva-en-linea",
  laboratorios: "laboratorios",
  inventario: "inventario",
  esterilizacion: "inventario",
  comisiones: "comisiones",
  "mi-desempeno": "comisiones",
  equipo: "equipo",
  permisos: "equipo",
  notificaciones: "notificaciones",
  ajustes: "ajustes",
};

export function pantallaDeRuta(pathname: string): PantallaId | null {
  const partes = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  const [primero, segundo] = partes;
  if (!primero) return null;
  if (primero === "pacientes" && segundo) return "ficha";
  return POR_SEGMENTO[primero] ?? null;
}

/**
 * A dónde lleva "Practicar en la pantalla" (Academia). La ficha no tiene
 * una ruta fija: lleva a Pacientes para elegir una.
 */
export const RUTA_DE_PANTALLA: Readonly<Record<PantallaId, string>> = {
  hoy: "/dashboard",
  agenda: "/agenda",
  "mi-agenda": "/mi-agenda",
  pacientes: "/pacientes",
  ficha: "/pacientes",
  presupuestos: "/presupuestos",
  caja: "/cajas",
  "cuentas-por-cobrar": "/cuentas-por-cobrar",
  finanzas: "/finanzas",
  informes: "/informes",
  seguimiento: "/seguimiento",
  campanas: "/campanas",
  recordatorios: "/recordatorios",
  mensajes: "/conversaciones",
  "reserva-en-linea": "/reserva-en-linea",
  laboratorios: "/laboratorios",
  inventario: "/inventario",
  comisiones: "/comisiones",
  equipo: "/equipo",
  notificaciones: "/notificaciones",
  ajustes: "/ajustes",
};
