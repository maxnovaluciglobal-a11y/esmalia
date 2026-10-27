// src/lib/access/navegacion.ts
//
// Navegación por trabajo, no por módulo (rediseño 06-oct-2026, panel 1a):
// destinos + Ajustes en vez de 34 entradas en 4 grupos. Ninguna ruta se
// movió ni se borró — los enlaces de emails y del resumen diario siguen
// vivos —: cada destino agrupa rutas existentes, que se muestran como
// pestañas arriba de la página.
//
// Ola 0 (UX-13, 21-oct-2026): Inventario y Laboratorios salen de Reportes y
// Pacientes a un destino propio, "Operación"; Medios de pago y WhatsApp viven
// solo en Ajustes; Presupuestos (lista de toda la clínica) es pestaña de Caja.
// Las URLs son las mismas de siempre.
//
// Es de presentación: el permiso real de cada pantalla sigue siendo su
// `beforeLoad` (y su par en el servidor). Por eso cada pestaña declara los
// MISMOS permisos que su ruta; si no coinciden, el nav ofrece una puerta que
// termina en /sin-acceso.
import {
  BarChart3,
  CalendarDays,
  MessagesSquare,
  Package,
  Sun,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import {
  hasPermission,
  rolDeSujeto,
  type Permission,
  type SujetoDePermisos,
} from "@/lib/access/access";
import { coincideTermino } from "@/lib/search";

export { coincideTermino, normalizarTexto } from "@/lib/search";

export type Pestana = {
  to: string;
  label: string;
  /** Basta con uno (igual que `requireAnyPermission`). */
  permisos: readonly Permission[];
  /** Otras palabras con las que alguien la busca en ⌘K ("cobrar" → Caja). */
  sinonimos?: readonly string[];
  /** Solo la ve el propietario (herramientas internas de email). */
  soloPropietario?: boolean;
};

export type Destino = {
  id: "hoy" | "agenda" | "pacientes" | "mensajes" | "caja" | "reportes" | "operacion";
  label: string;
  icon: LucideIcon;
  pestanas: readonly Pestana[];
};

export const DESTINOS: readonly Destino[] = [
  {
    id: "hoy",
    label: "Hoy",
    icon: Sun,
    pestanas: [
      {
        to: "/dashboard",
        label: "Hoy",
        permisos: ["dashboard:view"],
        sinonimos: ["inicio", "resumen del día"],
      },
    ],
  },
  {
    id: "agenda",
    label: "Agenda",
    icon: CalendarDays,
    pestanas: [
      { to: "/agenda", label: "Agenda", permisos: ["agenda:view"], sinonimos: ["citas", "turnos"] },
      { to: "/mi-agenda", label: "Solo yo", permisos: ["agenda:view"], sinonimos: ["mi agenda"] },
    ],
  },
  {
    id: "pacientes",
    label: "Pacientes",
    icon: Users,
    pestanas: [
      { to: "/pacientes", label: "Pacientes", permisos: ["patients:view"], sinonimos: ["fichas"] },
      { to: "/tratamientos", label: "Tratamientos", permisos: ["treatments:view"] },
      { to: "/ortodoncia", label: "Ortodoncia", permisos: ["clinical:write"] },
      {
        to: "/implantes",
        label: "Implantes",
        permisos: ["clinical:view"],
        sinonimos: ["lote", "retiro de lote", "implante", "fabricante"],
      },
      {
        to: "/fusionar-fichas",
        label: "Fichas duplicadas",
        permisos: ["patients:manage"],
        sinonimos: ["fusionar", "duplicados"],
      },
    ],
  },
  {
    id: "mensajes",
    label: "Mensajes",
    icon: MessagesSquare,
    pestanas: [
      {
        to: "/conversaciones",
        label: "Conversaciones",
        permisos: ["agenda:manage"],
        sinonimos: ["chat", "whatsapp"],
      },
      {
        to: "/recordatorios",
        label: "Recordatorios",
        permisos: ["agenda:manage"],
        sinonimos: ["avisos", "control periódico"],
      },
      // Ola 8 · frente B: seguimiento de pacientes y campañas.
      {
        to: "/seguimiento",
        label: "Seguimiento",
        permisos: ["agenda:manage"],
        sinonimos: [
          "tareas",
          "pendientes",
          "llamadas",
          "controles",
          "abandono",
          "tratamientos detenidos",
          "recall",
        ],
      },
      {
        to: "/campanas",
        label: "Campañas",
        permisos: ["settings:manage"],
        sinonimos: ["campaña", "difusión", "envío masivo", "reactivar pacientes", "quién volvió"],
      },
    ],
  },
  {
    // Presupuestos va acá y no en Pacientes: es plata por cobrar y la ve el
    // mismo público que la caja (finance:view lo tienen owner, admin y
    // contabilidad, y los tres manejan caja). En Pacientes sería una pestaña
    // que la mitad de los roles de ese destino no puede abrir. El presupuesto
    // de un paciente sigue en su ficha.
    id: "caja",
    label: "Caja",
    icon: Wallet,
    pestanas: [
      {
        to: "/cajas",
        label: "Caja del día",
        permisos: ["cash:manage"],
        sinonimos: ["cobrar", "cobro", "pago", "arqueo"],
      },
      {
        to: "/presupuestos",
        label: "Presupuestos",
        permisos: ["finance:view"],
        sinonimos: ["presupuesto", "cotización", "cotizaciones"],
      },
      {
        to: "/cuentas-por-cobrar",
        label: "Cuentas por cobrar",
        permisos: ["finance:view"],
        sinonimos: ["cuotas", "cobranza", "por cobrar"],
      },
      { to: "/gastos", label: "Gastos", permisos: ["finance:view"], sinonimos: ["egresos"] },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    icon: BarChart3,
    pestanas: [
      {
        to: "/finanzas",
        label: "Finanzas",
        permisos: ["finance:view"],
        sinonimos: ["ingresos", "producción"],
      },
      { to: "/morosidad", label: "Morosidad", permisos: ["finance:view"], sinonimos: ["deudas"] },
      { to: "/comisiones", label: "Comisiones", permisos: ["finance:view", "commission:view-own"] },
      {
        to: "/mi-desempeno",
        label: "Mi desempeño",
        permisos: ["finance:view", "commission:view-own"],
        sinonimos: ["desempeño", "mi comisión", "mis liquidaciones", "producción"],
      },
      { to: "/efectividad", label: "Efectividad", permisos: ["dashboard:view"] },
      {
        to: "/resultados-del-piloto",
        label: "Resultados del piloto",
        // Solo owner/admin: es la conversación de cierre del piloto (INF-14).
        permisos: ["settings:manage"],
        sinonimos: ["piloto", "resultados", "cierre del piloto"],
      },
    ],
  },
  {
    id: "operacion",
    label: "Operación",
    icon: Package,
    pestanas: [
      {
        to: "/inventario",
        label: "Inventario",
        permisos: ["inventory:view"],
        sinonimos: ["insumos", "stock", "materiales"],
      },
      {
        to: "/laboratorios",
        label: "Laboratorios",
        permisos: ["treatments:view"],
        sinonimos: ["laboratorio", "prótesis", "órdenes de laboratorio"],
      },
    ],
  },
];

export type ItemAjustes = Pestana & { detalle: string };
export type GrupoAjustes = { titulo: string; items: readonly ItemAjustes[] };

/** Índice de /ajustes, agrupado por tarea. */
export const AJUSTES: readonly GrupoAjustes[] = [
  {
    titulo: "Clínica",
    items: [
      {
        to: "/datos-de-la-clinica",
        label: "Datos de la clínica",
        detalle: "Nombre, datos tributarios, zona horaria y moneda",
        permisos: ["settings:manage"],
        sinonimos: ["clínica", "nombre", "razón social", "dirección", "rut", "giro", "boleta"],
      },
      {
        to: "/migracion",
        label: "Migración de datos",
        detalle: "Trae pacientes y citas desde otro sistema, por lotes",
        permisos: ["settings:manage"],
        sinonimos: ["importar", "migrar", "dentalink", "excel", "csv", "otro sistema"],
      },
      {
        to: "/sucursales",
        label: "Sucursales",
        detalle: "Sedes, dirección, teléfono y horarios",
        permisos: ["settings:manage"],
        sinonimos: ["sedes", "boxes", "dirección", "teléfono"],
      },
      {
        to: "/profesionales",
        label: "Profesionales",
        detalle: "Agenda, color y especialidad",
        permisos: ["settings:manage"],
        sinonimos: ["doctores", "dentistas"],
      },
      {
        to: "/estados-de-cita",
        label: "Estados y tipos de cita",
        detalle: "Etiquetas de la agenda y tipos de consulta",
        permisos: ["settings:manage"],
        sinonimos: ["tipos de cita", "tipo de consulta", "estados de cita"],
      },
      {
        to: "/configuracion-de-agenda",
        label: "Configuración de la agenda",
        detalle: "Intervalo, duración, sobrecupos, horario de atención y bloqueos",
        permisos: ["settings:manage"],
        sinonimos: [
          "bloqueos",
          "bloquear horario",
          "vacaciones",
          "horario de atención",
          "sobrecupos",
          "intervalo",
        ],
      },
      {
        to: "/reserva-en-linea",
        label: "Reserva en línea",
        detalle: "Link público para que tus pacientes reserven, widget para tu web y código QR",
        permisos: ["settings:manage"],
        sinonimos: ["reservar", "agendar en línea", "link de reserva", "widget", "qr", "web"],
      },
      {
        to: "/consentimientos",
        label: "Consentimientos",
        detalle: "Plantillas para firmar",
        permisos: ["settings:manage"],
      },
      {
        to: "/protocolos-clinicos",
        label: "Protocolos clínicos",
        detalle: "Pasos e indicaciones por procedimiento, para aplicar en la nota clínica",
        permisos: ["clinical:write"],
        sinonimos: ["protocolo", "indicaciones", "procedimiento", "pasos", "post operatorio"],
      },
      {
        to: "/plantillas-de-documentos",
        label: "Plantillas de documentos",
        detalle: "Certificados, reposos, derivaciones, informes, reembolsos y presupuestos",
        permisos: ["settings:manage"],
        sinonimos: [
          "certificado",
          "reposo",
          "derivación",
          "informe",
          "alta",
          "reembolso",
          "presupuesto",
        ],
      },
    ],
  },
  {
    titulo: "Equipo y acceso",
    items: [
      {
        to: "/equipo",
        label: "Equipo",
        detalle: "Invitar y quitar personas",
        permisos: ["team:view"],
        sinonimos: ["usuarios", "invitar"],
      },
      {
        to: "/permisos",
        label: "Permisos",
        detalle: "Qué puede hacer cada rol",
        permisos: ["team:manage"],
        sinonimos: ["roles"],
      },
      {
        to: "/compliance",
        label: "Auditoría y cumplimiento",
        detalle: "Historial de notas clínicas y lecturas de fichas",
        permisos: ["team:manage"],
        sinonimos: ["compliance", "registro"],
      },
      {
        to: "/derechos-de-pacientes",
        label: "Derechos de los pacientes",
        detalle: "Solicitudes sobre sus datos y su plazo legal",
        permisos: ["team:manage"],
        sinonimos: ["ley 21.719", "acceso", "rectificación", "supresión", "portabilidad", "arco"],
      },
      {
        to: "/incidentes-de-seguridad",
        label: "Incidentes de seguridad",
        detalle: "Registro de brechas de datos",
        permisos: ["team:manage"],
        sinonimos: ["brecha", "filtración", "vulneración", "incidente"],
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
        sinonimos: ["precios", "prestaciones"],
      },
      {
        to: "/convenios",
        label: "Convenios",
        detalle: "Seguros y descuentos",
        permisos: ["settings:manage"],
        sinonimos: ["seguros"],
      },
      {
        to: "/medios-de-pago",
        label: "Medios de pago",
        detalle: "Débito, crédito y retenciones",
        permisos: ["settings:manage"],
        sinonimos: ["tarjeta", "débito", "crédito"],
      },
      {
        to: "/suscripcion",
        label: "Suscripción",
        detalle: "Plan de Esmalia y facturación",
        permisos: ["settings:manage"],
        sinonimos: ["plan", "factura"],
      },
    ],
  },
  {
    titulo: "Mensajería",
    items: [
      {
        to: "/notificaciones-a-pacientes",
        label: "Notificaciones a pacientes",
        detalle: "Confirmación, recordatorio, formulario y encuesta por correo",
        permisos: ["settings:manage"],
        sinonimos: [
          "recordatorio automático",
          "confirmación",
          "encuesta",
          "nps",
          "reseña",
          "google",
          "formulario",
          "anamnesis",
          "correo",
        ],
      },
      {
        to: "/plantillas-de-mensajes",
        label: "Plantillas de mensajes",
        detalle: "Textos de la clínica para campañas por correo y mensajes, con datos del paciente",
        permisos: ["settings:manage"],
        sinonimos: ["plantilla", "texto", "variables", "mensaje de campaña"],
      },
      {
        to: "/whatsapp",
        label: "WhatsApp",
        detalle: "Número, plantillas y modo de envío",
        permisos: ["team:manage"],
      },
      {
        to: "/dominio-email",
        label: "Dominio de email",
        detalle: "DNS para enviar como tu clínica",
        permisos: ["team:manage"],
        soloPropietario: true,
      },
      {
        to: "/pruebas-email",
        label: "Pruebas de email",
        detalle: "Diagnóstico de envío",
        permisos: ["team:manage"],
        soloPropietario: true,
      },
      {
        to: "/sandbox-email",
        label: "Modo prueba de email",
        detalle: "Bloquear o redirigir envíos mientras configuras",
        permisos: ["team:manage"],
        soloPropietario: true,
      },
    ],
  },
  {
    titulo: "Personal",
    items: [
      {
        to: "/preferencias",
        label: "Preferencias",
        detalle: "Tus avisos, tu firma y la verificación en dos pasos",
        permisos: ["dashboard:view"],
        sinonimos: ["firma", "registro superintendencia"],
      },
    ],
  },
];

/** Herramientas internas de email: solo el propietario (UI y servidor). */
export const AJUSTES_SOLO_DUENO: readonly ItemAjustes[] = AJUSTES.flatMap((g) =>
  g.items.filter((i) => i.soloPropietario),
);

/** `sujeto`: el acceso del usuario (con ajustes por persona, EQU-01) o un rol. */
export function puedeVer(sujeto: SujetoDePermisos, p: Pestana): boolean {
  if (p.soloPropietario && rolDeSujeto(sujeto) !== "owner") return false;
  return p.permisos.some((perm) => hasPermission(sujeto, perm));
}

/** Destinos con al menos una pestaña visible, cada uno con solo las suyas. */
export function destinosVisibles(role: SujetoDePermisos): Destino[] {
  return DESTINOS.map((d) => ({
    ...d,
    pestanas: d.pestanas.filter((p) => puedeVer(role, p)),
  })).filter((d) => d.pestanas.length > 0);
}

export function ajustesVisibles(role: SujetoDePermisos): GrupoAjustes[] {
  return AJUSTES.map((g) => ({ ...g, items: g.items.filter((i) => puedeVer(role, i)) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Filtro del índice de Ajustes: por nombre, detalle, grupo o sinónimo. */
export function filtrarAjustes(grupos: readonly GrupoAjustes[], termino: string): GrupoAjustes[] {
  return grupos
    .map((g) => ({
      ...g,
      items: g.items.filter((i) =>
        coincideTermino(termino, i.label, i.detalle, g.titulo, ...(i.sinonimos ?? [])),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

/** Rutas que cuentan como "Ajustes" para marcar el ítem activo. */
export const RUTAS_AJUSTES: readonly string[] = [
  "/ajustes",
  ...AJUSTES.flatMap((g) => g.items.map((i) => i.to)),
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

/** Sub-página de Ajustes (todas menos el índice): lleva "← Ajustes". */
export function esSubpaginaDeAjustes(pathname: string): boolean {
  const ruta = pathname.replace(/\/+$/, "") || "/";
  return ruta !== "/ajustes" && esRutaDeAjustes(ruta);
}

export function pestanaActiva(pathname: string, p: Pestana): boolean {
  return coincide(pathname, p.to);
}
