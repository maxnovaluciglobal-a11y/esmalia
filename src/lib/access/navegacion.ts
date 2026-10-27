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
//
// Ola 12 (NAV-01, menú final): con todas las pantallas de las olas 7-11 ya
// hechas, los destinos se ordenan en tres grupos — Día a día, Clínica y
// Gestión — y la plata se separa en dos destinos: Caja (lo que entra y se
// cobra en el mostrador) y Finanzas (vista general, gastos, morosidad y
// comisiones). Reportes queda para lo que se mira y se compara (informes,
// efectividad, mi desempeño). Hoy suma el centro de notificaciones (NAV-11).
// Ajustes se reagrupa por tema y cada sub-página lleva migas
// (Ajustes › tema). Las URLs siguen siendo las mismas: nada se redirige
// porque nada cambió de dirección; los hubs `/mensajes` y `/reportes`
// siguen llevando a la primera pestaña visible (`destinoDeHub`).
//
// Es de presentación: el permiso real de cada pantalla sigue siendo su
// `beforeLoad` (y su par en el servidor). Por eso cada pestaña declara los
// MISMOS permisos que su ruta; si no coinciden, el nav ofrece una puerta que
// termina en /sin-acceso (lo vigila `tests/navegacion.test.ts`).
import {
  BarChart3,
  CalendarDays,
  Landmark,
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
import { coincideTermino, normalizarTexto } from "@/lib/search";

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

export type IdDestino =
  "hoy" | "agenda" | "mensajes" | "caja" | "pacientes" | "operacion" | "finanzas" | "reportes";

export type IdGrupoNav = "dia" | "clinica" | "gestion";

export type Destino = {
  id: IdDestino;
  label: string;
  icon: LucideIcon;
  grupo: IdGrupoNav;
  pestanas: readonly Pestana[];
};

/** Grupos del menú, en orden. El título se muestra como encabezado chico. */
export const GRUPOS_NAV: readonly { id: IdGrupoNav; titulo: string }[] = [
  { id: "dia", titulo: "Día a día" },
  { id: "clinica", titulo: "Clínica" },
  { id: "gestion", titulo: "Gestión" },
];

export const DESTINOS: readonly Destino[] = [
  // ─── Día a día ─────────────────────────────────────────────────────────
  {
    id: "hoy",
    label: "Hoy",
    icon: Sun,
    grupo: "dia",
    pestanas: [
      {
        to: "/dashboard",
        label: "Hoy",
        permisos: ["dashboard:view"],
        sinonimos: ["inicio", "resumen del día", "puesta en marcha"],
      },
      // NAV-11 (Ola 11): centro de notificaciones. Antes solo se llegaba
      // desde la campana.
      {
        to: "/notificaciones",
        label: "Notificaciones",
        permisos: ["dashboard:view"],
        sinonimos: ["avisos", "campana", "alertas"],
      },
    ],
  },
  {
    id: "agenda",
    label: "Agenda",
    icon: CalendarDays,
    grupo: "dia",
    pestanas: [
      { to: "/agenda", label: "Agenda", permisos: ["agenda:view"], sinonimos: ["citas", "turnos"] },
      { to: "/mi-agenda", label: "Solo yo", permisos: ["agenda:view"], sinonimos: ["mi agenda"] },
    ],
  },
  {
    id: "mensajes",
    label: "Mensajes",
    icon: MessagesSquare,
    grupo: "dia",
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
    // Lo que se cobra y se debe cobrar. Presupuestos va acá y no en
    // Pacientes: es plata por cobrar y la ve el mismo público que la caja
    // (finance:view lo tienen owner, admin, coordinación y contabilidad, y
    // todos manejan caja). El presupuesto de un paciente sigue en su ficha.
    id: "caja",
    label: "Caja",
    icon: Wallet,
    grupo: "dia",
    pestanas: [
      {
        to: "/cajas",
        label: "Caja del día",
        permisos: ["cash:manage"],
        sinonimos: ["cobrar", "cobro", "pago", "arqueo", "traspaso", "retiro"],
      },
      {
        to: "/presupuestos",
        label: "Presupuestos",
        permisos: ["finance:view"],
        sinonimos: ["presupuesto", "cotización", "cotizaciones", "paquetes"],
      },
      {
        to: "/cuentas-por-cobrar",
        label: "Cuentas por cobrar",
        permisos: ["finance:view"],
        sinonimos: ["cuotas", "cobranza", "por cobrar"],
      },
      {
        to: "/membresias",
        label: "Membresías",
        permisos: ["cash:manage"],
        sinonimos: ["membresía", "plan de membresía", "suscripción del paciente", "cuota mensual"],
      },
    ],
  },
  // ─── Clínica ───────────────────────────────────────────────────────────
  {
    id: "pacientes",
    label: "Pacientes",
    icon: Users,
    grupo: "clinica",
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
    id: "operacion",
    label: "Operación",
    icon: Package,
    grupo: "clinica",
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
  // ─── Gestión ───────────────────────────────────────────────────────────
  {
    // Lo que cuesta y lo que deja la clínica. Comisiones va acá porque es
    // una liquidación (plata que se paga); un profesional sin finance:view
    // la ve igual porque su ruta admite commission:view-own (solo la suya).
    id: "finanzas",
    label: "Finanzas",
    icon: Landmark,
    grupo: "gestion",
    pestanas: [
      {
        to: "/finanzas",
        label: "Vista general",
        permisos: ["finance:view"],
        sinonimos: ["finanzas", "ingresos", "producción", "venta real", "folios", "boletas"],
      },
      { to: "/morosidad", label: "Morosidad", permisos: ["finance:view"], sinonimos: ["deudas"] },
      { to: "/gastos", label: "Gastos", permisos: ["finance:view"], sinonimos: ["egresos"] },
      {
        to: "/gastos-fijos",
        label: "Gastos fijos",
        permisos: ["finance:view"],
        sinonimos: ["arriendo", "sueldos", "servicios", "gasto recurrente", "gasto mensual"],
      },
      {
        to: "/comisiones",
        label: "Comisiones",
        permisos: ["finance:view", "commission:view-own"],
        sinonimos: ["liquidación", "liquidaciones"],
      },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    icon: BarChart3,
    grupo: "gestion",
    pestanas: [
      {
        to: "/informes",
        label: "Informes",
        permisos: ["dashboard:view"],
        sinonimos: [
          "informe",
          "estadísticas",
          "comparar períodos",
          "ocupación",
          "mapa de calor",
          "box",
          "embudo",
          "ausentismo",
          "sucursales",
          "constructor de informes",
        ],
      },
      { to: "/efectividad", label: "Efectividad", permisos: ["dashboard:view"] },
      {
        to: "/mi-desempeno",
        label: "Mi desempeño",
        permisos: ["finance:view", "commission:view-own"],
        sinonimos: ["desempeño", "mi comisión", "mis liquidaciones", "producción"],
      },
      {
        to: "/resultados-del-piloto",
        label: "Resultados del piloto",
        // Solo owner/admin: es la conversación de cierre del piloto (INF-14).
        permisos: ["settings:manage"],
        sinonimos: ["piloto", "resultados", "cierre del piloto"],
      },
    ],
  },
];

export type ItemAjustes = Pestana & { detalle: string };
export type GrupoAjustes = { titulo: string; items: readonly ItemAjustes[] };

/** Índice de /ajustes, agrupado por tema (NAV-01). */
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
        to: "/sucursales",
        label: "Sucursales",
        detalle: "Sedes, dirección, teléfono y horarios",
        permisos: ["settings:manage"],
        sinonimos: ["sedes", "boxes", "dirección", "teléfono", "horario"],
      },
      {
        to: "/profesionales",
        label: "Profesionales",
        detalle: "Agenda, color, especialidad y si atiende pacientes",
        permisos: ["settings:manage"],
        sinonimos: ["doctores", "dentistas", "horario del profesional"],
      },
      {
        to: "/migracion",
        label: "Migración de datos",
        detalle: "Trae pacientes y citas desde otro sistema, por lotes",
        permisos: ["settings:manage"],
        sinonimos: ["importar", "migrar", "dentalink", "excel", "csv", "otro sistema"],
      },
    ],
  },
  {
    titulo: "Agenda y reservas",
    items: [
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
        to: "/estados-de-cita",
        label: "Estados y tipos de cita",
        detalle: "Etiquetas de la agenda y tipos de consulta",
        permisos: ["settings:manage"],
        sinonimos: ["tipos de cita", "tipo de consulta", "estados de cita"],
      },
      {
        to: "/reserva-en-linea",
        label: "Reserva en línea",
        detalle: "Link público para que tus pacientes reserven, widget para tu web y código QR",
        permisos: ["settings:manage"],
        sinonimos: ["reservar", "agendar en línea", "link de reserva", "widget", "qr", "web"],
      },
    ],
  },
  {
    titulo: "Atención clínica",
    items: [
      {
        to: "/protocolos-clinicos",
        label: "Protocolos clínicos",
        detalle: "Pasos e indicaciones por procedimiento, para aplicar en la nota clínica",
        permisos: ["clinical:write"],
        sinonimos: ["protocolo", "indicaciones", "procedimiento", "pasos", "post operatorio"],
      },
      {
        to: "/consentimientos",
        label: "Consentimientos",
        detalle: "Plantillas para firmar",
        permisos: ["settings:manage"],
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
    titulo: "Precios y cobro",
    items: [
      {
        to: "/aranceles",
        label: "Arancel de precios",
        detalle: "Prestaciones y valores",
        permisos: ["settings:manage"],
        sinonimos: ["precios", "prestaciones", "arancel"],
      },
      {
        to: "/convenios",
        label: "Convenios",
        detalle: "Seguros y descuentos",
        permisos: ["settings:manage"],
        sinonimos: ["seguros"],
      },
      {
        to: "/empresas-con-convenio",
        label: "Empresas con convenio",
        detalle: "Descuento a trabajadores y descuento por planilla",
        permisos: ["finance:view"],
        sinonimos: ["empresa", "planilla", "descuento por planilla", "convenio de empresa"],
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
    titulo: "Mensajes a pacientes",
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
    titulo: "Equipo y seguridad",
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
        detalle: "Qué puede hacer cada rol y cada persona",
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

/**
 * Rutas de la app de la clínica que NO están en el menú, cada una con su
 * motivo. `tests/navegacion.test.ts` recorre `src/routes/_authenticated/_clinic`
 * y falla si aparece una pantalla que no está ni en el menú ni acá.
 */
export const RUTAS_FUERA_DEL_MENU: Readonly<Record<string, string>> = {
  "/ajustes": "Índice de Ajustes: es la entrada del pie del menú.",
  "/mensajes": "Hub: redirige a la primera pestaña visible de Mensajes.",
  "/reportes": "Hub: redirige a la primera pestaña visible de Reportes.",
  "/pacientes/$pacienteId": "Ficha de un paciente: se abre desde Pacientes, la agenda o ⌘K.",
  "/presupuestos/$presupuestoId": "Detalle de un presupuesto: se abre desde la lista o la ficha.",
  "/presupuestos/paquetes": "Paquetes de prestaciones: se abre desde Presupuestos.",
  "/documentos/$documentoId": "Documento emitido: se abre desde la ficha del paciente.",
  // Ola 12 · frente A: la ayuda se abre desde el botón de ayuda (barra
  // superior) y desde Ayuda al pie del menú, no es un destino del día a día.
  "/ayuda": "Centro de ayuda (ONB-10): botón de ayuda y Ayuda al pie del menú.",
  "/ayuda/academia": "Academia por rol (ONB-04): botón de ayuda y Ayuda al pie del menú.",
  "/ayuda/novedades": "Novedades (NAV-10): botón de ayuda y Ayuda al pie del menú.",
  "/ayuda/pantalla/$pantalla": "Ayuda de una pantalla (ONB-02): se abre desde el botón de ayuda.",
};

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

/** Destinos visibles agrupados (sin grupos vacíos), en el orden del menú. */
export function gruposVisibles(
  destinos: readonly Destino[],
): { id: IdGrupoNav; titulo: string; destinos: Destino[] }[] {
  return GRUPOS_NAV.map((g) => ({
    ...g,
    destinos: destinos.filter((d) => d.grupo === g.id),
  })).filter((g) => g.destinos.length > 0);
}

/**
 * Adónde lleva un hub (`/mensajes`, `/reportes`): la primera pestaña que el
 * usuario puede abrir, o /sin-acceso si no tiene ninguna.
 */
export function destinoDeHub(sujeto: SujetoDePermisos, id: IdDestino): string {
  const destino = destinosVisibles(sujeto).find((d) => d.id === id);
  return destino?.pestanas[0]?.to ?? "/sin-acceso";
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

/** Sub-página de Ajustes (todas menos el índice): lleva las migas. */
export function esSubpaginaDeAjustes(pathname: string): boolean {
  const ruta = pathname.replace(/\/+$/, "") || "/";
  return ruta !== "/ajustes" && esRutaDeAjustes(ruta);
}

/** Id del grupo en el índice de Ajustes (ancla de las migas). */
export function idDeGrupoAjustes(titulo: string): string {
  return `ajustes-${normalizarTexto(titulo)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+$/, "")}`;
}

/** Migas de una sub-página de Ajustes: Ajustes › tema › página. */
export function migasDeAjustes(
  pathname: string,
): { grupo: string; ancla: string; pagina: string } | null {
  if (!esSubpaginaDeAjustes(pathname)) return null;
  const ruta = pathname.replace(/\/+$/, "");
  for (const g of AJUSTES) {
    const item = g.items.find((i) => coincide(ruta, i.to));
    if (item) return { grupo: g.titulo, ancla: idDeGrupoAjustes(g.titulo), pagina: item.label };
  }
  return null;
}

export function pestanaActiva(pathname: string, p: Pestana): boolean {
  return coincide(pathname, p.to);
}
