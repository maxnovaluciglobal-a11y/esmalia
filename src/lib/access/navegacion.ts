// src/lib/access/navegacion.ts
//
// Navegación por trabajo, no por módulo (rediseño 06-oct-2026, panel 1a):
// seis destinos + Ajustes en vez de 34 entradas en 4 grupos. Ninguna ruta se
// movió ni se borró — los enlaces de emails y del resumen diario siguen
// vivos —: cada destino agrupa rutas existentes, que se muestran como
// pestañas arriba de la página.
//
// Es de presentación: el permiso real de cada pantalla sigue siendo su
// `beforeLoad` (y su par en el servidor). Por eso cada pestaña declara los
// MISMOS permisos que su ruta; si no coinciden, el nav ofrece una puerta que
// termina en /sin-acceso.
import {
  BarChart3,
  CalendarDays,
  MessagesSquare,
  Sun,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { hasPermission, type ClinicRole, type Permission } from "@/lib/access/access";

export type Pestana = {
  to: string;
  label: string;
  /** Basta con uno (igual que `requireAnyPermission`). */
  permisos: readonly Permission[];
};

export type Destino = {
  id: "hoy" | "agenda" | "pacientes" | "mensajes" | "caja" | "reportes";
  label: string;
  icon: LucideIcon;
  pestanas: readonly Pestana[];
};

export const DESTINOS: readonly Destino[] = [
  {
    id: "hoy",
    label: "Hoy",
    icon: Sun,
    pestanas: [{ to: "/dashboard", label: "Hoy", permisos: ["dashboard:view"] }],
  },
  {
    id: "agenda",
    label: "Agenda",
    icon: CalendarDays,
    pestanas: [
      { to: "/agenda", label: "Agenda", permisos: ["agenda:view"] },
      { to: "/mi-agenda", label: "Solo yo", permisos: ["agenda:view"] },
    ],
  },
  {
    id: "pacientes",
    label: "Pacientes",
    icon: Users,
    pestanas: [
      { to: "/pacientes", label: "Pacientes", permisos: ["patients:view"] },
      { to: "/tratamientos", label: "Tratamientos", permisos: ["treatments:view"] },
      { to: "/ortodoncia", label: "Ortodoncia", permisos: ["clinical:write"] },
      { to: "/laboratorios", label: "Laboratorios", permisos: ["treatments:view"] },
      { to: "/fusionar-fichas", label: "Fichas duplicadas", permisos: ["patients:manage"] },
    ],
  },
  {
    id: "mensajes",
    label: "Mensajes",
    icon: MessagesSquare,
    pestanas: [
      { to: "/conversaciones", label: "Conversaciones", permisos: ["agenda:manage"] },
      { to: "/recordatorios", label: "Recordatorios", permisos: ["agenda:manage"] },
      { to: "/whatsapp", label: "WhatsApp", permisos: ["team:manage"] },
    ],
  },
  {
    id: "caja",
    label: "Caja",
    icon: Wallet,
    pestanas: [
      { to: "/cajas", label: "Caja del día", permisos: ["cash:manage"] },
      { to: "/gastos", label: "Gastos", permisos: ["finance:view"] },
      { to: "/medios-de-pago", label: "Medios de pago", permisos: ["settings:manage"] },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    icon: BarChart3,
    pestanas: [
      { to: "/finanzas", label: "Finanzas", permisos: ["finance:view"] },
      { to: "/morosidad", label: "Morosidad", permisos: ["finance:view"] },
      { to: "/comisiones", label: "Comisiones", permisos: ["finance:view", "commission:view-own"] },
      { to: "/efectividad", label: "Efectividad", permisos: ["dashboard:view"] },
      { to: "/inventario", label: "Inventario", permisos: ["inventory:view"] },
    ],
  },
];

export type GrupoAjustes = { titulo: string; items: readonly (Pestana & { detalle: string })[] };

/** Índice de /ajustes. `soloDueno` = herramientas de email, solo para owner. */
export const AJUSTES: readonly GrupoAjustes[] = [
  {
    titulo: "Equipo y acceso",
    items: [
      {
        to: "/equipo",
        label: "Equipo",
        detalle: "Invitar y quitar personas",
        permisos: ["team:view"],
      },
      {
        to: "/permisos",
        label: "Permisos",
        detalle: "Qué puede hacer cada rol",
        permisos: ["team:manage"],
      },
      {
        to: "/compliance",
        label: "Compliance",
        detalle: "Auditoría y cumplimiento",
        permisos: ["team:manage"],
      },
    ],
  },
  {
    titulo: "Clínica",
    items: [
      {
        to: "/sucursales",
        label: "Sucursales",
        detalle: "Sedes, horarios y zona horaria",
        permisos: ["settings:manage"],
      },
      {
        to: "/profesionales",
        label: "Profesionales",
        detalle: "Agenda, color y especialidad",
        permisos: ["settings:manage"],
      },
      {
        to: "/estados-de-cita",
        label: "Estados de cita",
        detalle: "Etiquetas de la agenda",
        permisos: ["settings:manage"],
      },
      {
        to: "/consentimientos",
        label: "Consentimientos",
        detalle: "Plantillas para firmar",
        permisos: ["settings:manage"],
      },
      {
        to: "/onboarding",
        label: "Configuración inicial",
        detalle: "Datos básicos de la clínica",
        permisos: ["settings:manage"],
      },
    ],
  },
  {
    titulo: "Precios y cobro",
    items: [
      {
        to: "/aranceles",
        label: "Arancel de precios",
        detalle: "Prestaciones y valores",
        permisos: ["settings:manage"],
      },
      {
        to: "/convenios",
        label: "Convenios",
        detalle: "Seguros y descuentos",
        permisos: ["settings:manage"],
      },
      {
        to: "/medios-de-pago",
        label: "Medios de pago",
        detalle: "Débito, crédito y retenciones",
        permisos: ["settings:manage"],
      },
      {
        to: "/suscripcion",
        label: "Suscripción",
        detalle: "Plan de Esmalia y facturación",
        permisos: ["settings:manage"],
      },
    ],
  },
  {
    titulo: "Personal",
    items: [
      {
        to: "/preferencias",
        label: "Preferencias",
        detalle: "Tus avisos y la verificación en dos pasos",
        permisos: ["dashboard:view"],
      },
    ],
  },
];

export const AJUSTES_SOLO_DUENO: readonly (Pestana & { detalle: string })[] = [
  {
    to: "/dominio-email",
    label: "Dominio de email",
    detalle: "DNS para enviar como tu clínica",
    permisos: ["team:manage"],
  },
  {
    to: "/pruebas-email",
    label: "Pruebas de email",
    detalle: "Diagnóstico de envío",
    permisos: ["team:manage"],
  },
  {
    to: "/sandbox-email",
    label: "Sandbox de email",
    detalle: "Vista previa de plantillas",
    permisos: ["team:manage"],
  },
];

export function puedeVer(role: ClinicRole | null | undefined, p: Pestana): boolean {
  return p.permisos.some((perm) => hasPermission(role ?? null, perm));
}

/** Destinos con al menos una pestaña visible, cada uno con solo las suyas. */
export function destinosVisibles(role: ClinicRole | null | undefined): Destino[] {
  return DESTINOS.map((d) => ({
    ...d,
    pestanas: d.pestanas.filter((p) => puedeVer(role, p)),
  })).filter((d) => d.pestanas.length > 0);
}

export function ajustesVisibles(role: ClinicRole | null | undefined): GrupoAjustes[] {
  const grupos = AJUSTES.map((g) => ({ ...g, items: g.items.filter((i) => puedeVer(role, i)) }));
  if (role === "owner")
    grupos.push({ titulo: "Avanzado (solo dueño)", items: [...AJUSTES_SOLO_DUENO] });
  return grupos.filter((g) => g.items.length > 0);
}

/** Rutas que cuentan como "Ajustes" para marcar el ítem activo. */
export const RUTAS_AJUSTES: readonly string[] = [
  "/ajustes",
  ...AJUSTES.flatMap((g) => g.items.map((i) => i.to)).filter((to) => to !== "/medios-de-pago"),
  ...AJUSTES_SOLO_DUENO.map((i) => i.to),
];

function coincide(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Destino al que pertenece la ruta actual (null = Ajustes u otra). */
export function destinoDeRuta(pathname: string, destinos: readonly Destino[]): Destino | null {
  if (coincide(pathname, "/mensajes")) return destinos.find((d) => d.id === "mensajes") ?? null;
  if (coincide(pathname, "/reportes")) return destinos.find((d) => d.id === "reportes") ?? null;
  return destinos.find((d) => d.pestanas.some((p) => coincide(pathname, p.to))) ?? null;
}

export function esRutaDeAjustes(pathname: string): boolean {
  return RUTAS_AJUSTES.some((to) => coincide(pathname, to));
}

export function pestanaActiva(pathname: string, p: Pestana): boolean {
  return coincide(pathname, p.to);
}
