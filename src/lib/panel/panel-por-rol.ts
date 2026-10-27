import {
  hasPermission,
  rolDeSujeto,
  type ClinicRole,
  type Permission,
  type SujetoDePermisos,
} from "@/lib/access/access";

/**
 * Panel de Hoy por rol (Ola 11 · PAN-03, PAN-04, PAN-06, PAN-07, PAN-08).
 *
 * Puro y sin contexto: decide QUÉ ve cada rol (perfil, bloques y alertas) a
 * partir del acceso del usuario (rol + permisos efectivos del #181, o el rol
 * simulado). Los datos los arma la base (`panel_de_hoy`, migración
 * 20261107200000), que aplica el mismo criterio con el rol real: esto es solo
 * la puerta de la pantalla (regla 15).
 */

/** Cómo se arma Hoy para cada rol. */
export type PerfilDePanel =
  /** Propietario y administración: caja, cobros, ocupación, presupuestos. */
  | "direccion"
  /** Doctor/a: su día, sus pendientes clínicos, su desempeño. */
  | "profesional"
  /** Recepción y coordinación: confirmaciones, reservas, llegadas, cobros. */
  | "recepcion"
  /** Técnico/a dental: órdenes de laboratorio e insumos. */
  | "laboratorio"
  /** Contabilidad: cobros y presupuestos, sin agenda. */
  | "contabilidad"
  /** Asistente dental: el día de la clínica y los insumos. */
  | "asistente";

export const PERFIL_POR_ROL: Record<ClinicRole, PerfilDePanel> = {
  owner: "direccion",
  admin: "direccion",
  coordinator: "recepcion",
  dentist: "profesional",
  assistant: "asistente",
  reception: "recepcion",
  accounting: "contabilidad",
  lab_technician: "laboratorio",
};

export function perfilDePanel(sujeto: SujetoDePermisos): PerfilDePanel | null {
  const rol = rolDeSujeto(sujeto);
  return rol ? PERFIL_POR_ROL[rol] : null;
}

// ─── Alertas accionables (PAN-03) ──────────────────────────────────────────

export const TIPOS_DE_ALERTA = [
  "cajas_sin_cerrar",
  "reservas_por_aceptar",
  "citas_por_confirmar",
  "laboratorio_atrasado",
  "stock_bajo",
  "controles_vencidos",
  "cuotas_vencidas",
  "notas_sin_firmar",
  "revisiones_pedidas",
  "mensajes_sin_responder",
  "avisos_por_despachar",
  "saldo_pacientes_hoy",
] as const;

export type TipoAlerta = (typeof TIPOS_DE_ALERTA)[number];

export type Gravedad = "urgente" | "atencion" | "aviso";

export interface DefinicionAlerta {
  /** Permiso que exige ver la alerta: el mismo que la pantalla de destino. */
  permiso: Permission;
  /** Perfiles a los que les sirve (a otros no se les muestra aunque puedan). */
  perfiles: readonly PerfilDePanel[];
  gravedad: Gravedad;
  /** Título según la cantidad. */
  titulo: (n: number) => string;
  detalle: string;
  cta: string;
  /** Destino. `#…` = un bloque de la misma pantalla. */
  enlace: string;
  /** Búsqueda del destino (rutas con search validado). */
  busqueda?: Record<string, string | number>;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** Búsqueda base de la agenda (todas sus claves validadas). */
const BUSQUEDA_AGENDA = { q: "", fecha: "", sucursal: "", profesional: "", estado: "", page: 1 };

const TODOS: readonly PerfilDePanel[] = [
  "direccion",
  "profesional",
  "recepcion",
  "laboratorio",
  "contabilidad",
  "asistente",
];

export const ALERTAS: Record<TipoAlerta, DefinicionAlerta> = {
  cajas_sin_cerrar: {
    permiso: "cash:manage",
    perfiles: ["direccion", "recepcion", "contabilidad"],
    gravedad: "urgente",
    titulo: (n) => `${n} ${plural(n, "caja abierta", "cajas abiertas")} de un día anterior`,
    detalle: "Ciérrala con su arqueo antes de cobrar hoy",
    cta: "Cerrar",
    enlace: "/cajas",
  },
  reservas_por_aceptar: {
    permiso: "agenda:manage",
    perfiles: ["direccion", "recepcion"],
    gravedad: "urgente",
    titulo: (n) => `${n} ${plural(n, "reserva en línea", "reservas en línea")} por aceptar`,
    detalle: "El paciente eligió la hora; falta que la clínica la acepte",
    cta: "Aceptar",
    enlace: "#reservas-en-linea",
  },
  citas_por_confirmar: {
    permiso: "agenda:manage",
    perfiles: ["direccion", "recepcion"],
    gravedad: "atencion",
    titulo: (n) => `${n} ${plural(n, "cita sin confirmar", "citas sin confirmar")}`,
    detalle: "Hoy y los próximos 2 días",
    cta: "Confirmar",
    enlace: "/recordatorios",
  },
  laboratorio_atrasado: {
    permiso: "treatments:view",
    perfiles: ["direccion", "profesional", "recepcion", "laboratorio"],
    gravedad: "urgente",
    titulo: (n) =>
      `${n} ${plural(n, "orden de laboratorio atrasada", "órdenes de laboratorio atrasadas")}`,
    detalle: "Pasó la fecha de entrega y todavía no llega",
    cta: "Revisar",
    enlace: "/laboratorios",
  },
  stock_bajo: {
    permiso: "inventory:view",
    perfiles: ["direccion", "laboratorio", "asistente"],
    gravedad: "atencion",
    titulo: (n) => `${n} ${plural(n, "insumo bajo el mínimo", "insumos bajo el mínimo")}`,
    detalle: "Conviene reponer antes de que falte en el box",
    cta: "Ver insumos",
    enlace: "/inventario",
  },
  controles_vencidos: {
    permiso: "agenda:manage",
    perfiles: ["direccion", "profesional", "recepcion"],
    gravedad: "atencion",
    titulo: (n) => `${n} ${plural(n, "control vencido", "controles vencidos")}`,
    detalle: "Pacientes que debían volver y no tienen hora",
    cta: "Llamar",
    enlace: "/seguimiento",
  },
  cuotas_vencidas: {
    permiso: "finance:view",
    perfiles: ["direccion", "recepcion", "contabilidad"],
    gravedad: "atencion",
    titulo: (n) =>
      `${n} ${plural(n, "cuota de membresía vencida", "cuotas de membresía vencidas")}`,
    detalle: "El periodo ya empezó y la cuota no está pagada",
    cta: "Cobrar",
    enlace: "/membresias",
  },
  notas_sin_firmar: {
    permiso: "clinical:write",
    perfiles: ["direccion", "profesional"],
    gravedad: "atencion",
    titulo: (n) => `${n} ${plural(n, "nota clínica sin firmar", "notas clínicas sin firmar")}`,
    detalle: "Tus borradores: la ficha queda completa al firmarlos",
    cta: "Firmar",
    enlace: "#pendientes-clinicos",
  },
  revisiones_pedidas: {
    permiso: "clinical:write",
    perfiles: ["direccion", "profesional"],
    gravedad: "atencion",
    titulo: (n) => `${n} ${plural(n, "nota espera", "notas esperan")} tu revisión`,
    detalle: "Te pidieron revisar antes de firmar",
    cta: "Revisar",
    enlace: "/notificaciones",
  },
  mensajes_sin_responder: {
    permiso: "agenda:manage",
    perfiles: ["direccion", "recepcion"],
    gravedad: "atencion",
    titulo: (n) => `${n} ${plural(n, "mensaje sin responder", "mensajes sin responder")}`,
    detalle: "Pacientes que escribieron por WhatsApp",
    cta: "Responder",
    enlace: "/conversaciones",
  },
  avisos_por_despachar: {
    permiso: "agenda:manage",
    perfiles: ["direccion", "recepcion"],
    gravedad: "aviso",
    titulo: (n) => `${n} ${plural(n, "aviso para despachar", "avisos para despachar")}`,
    detalle: "Recordatorios, controles y presupuestos. Nada sale solo",
    cta: "Avisar",
    enlace: "/recordatorios",
  },
  saldo_pacientes_hoy: {
    permiso: "finance:view",
    perfiles: ["direccion", "recepcion", "contabilidad"],
    gravedad: "aviso",
    titulo: (n) =>
      `${n} ${plural(n, "paciente de hoy tiene saldo", "pacientes de hoy tienen saldo")}`,
    detalle: "Cobrar antes de que pasen al box",
    cta: "Ver",
    enlace: "/morosidad",
  },
};

// Coherencia: la agenda con el filtro de estado sirve de destino alternativo.
export const BUSQUEDA_RESERVAS = { ...BUSQUEDA_AGENDA, estado: "tentativa" };

const ORDEN_GRAVEDAD: Record<Gravedad, number> = { urgente: 0, atencion: 1, aviso: 2 };

/** ¿Este sujeto puede y le sirve ver esta alerta? */
export function puedeVerAlerta(sujeto: SujetoDePermisos, tipo: TipoAlerta): boolean {
  const def = ALERTAS[tipo];
  const perfil = perfilDePanel(sujeto);
  if (!perfil || !def.perfiles.includes(perfil)) return false;
  return hasPermission(sujeto, def.permiso);
}

/** Tipos de alerta que ve cada sujeto (en el orden del catálogo). */
export function alertasDelSujeto(sujeto: SujetoDePermisos): TipoAlerta[] {
  return TIPOS_DE_ALERTA.filter((t) => puedeVerAlerta(sujeto, t));
}

export interface AlertaVisible {
  tipo: TipoAlerta;
  n: number;
  gravedad: Gravedad;
  titulo: string;
  detalle: string;
  cta: string;
  enlace: string;
}

/**
 * De los conteos (lo que trajo la base + lo que ya tenía Hoy) a la lista que
 * se muestra: solo lo que el sujeto puede ver, solo lo que tiene algo (n > 0),
 * las urgentes primero y, a igual gravedad, la más numerosa.
 * Un conteo `null`/`undefined` (no se pudo pedir) no se muestra: no se
 * fabrica un cero ni se inventa una alerta (regla 11).
 */
export function alertasVisibles(
  sujeto: SujetoDePermisos,
  conteos: Partial<Record<TipoAlerta, number | null | undefined>>,
): AlertaVisible[] {
  return alertasDelSujeto(sujeto)
    .flatMap((tipo): AlertaVisible[] => {
      const n = conteos[tipo];
      if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return [];
      const def = ALERTAS[tipo];
      return [
        {
          tipo,
          n,
          gravedad: def.gravedad,
          titulo: def.titulo(n),
          detalle: def.detalle,
          cta: def.cta,
          enlace: def.enlace,
        },
      ];
    })
    .sort(
      (a, b) =>
        ORDEN_GRAVEDAD[a.gravedad] - ORDEN_GRAVEDAD[b.gravedad] ||
        b.n - a.n ||
        TIPOS_DE_ALERTA.indexOf(a.tipo) - TIPOS_DE_ALERTA.indexOf(b.tipo),
    );
}

// ─── Bloques por rol (PAN-04, PAN-06, PAN-07, PAN-08) ──────────────────────

export const BLOQUES = [
  /** PAN-04 · dirección: cajas abiertas y cobrado (con finance:view). */
  "caja",
  /** PAN-04 · dirección: ocupación de las horas declaradas de hoy. */
  "ocupacion",
  /** PAN-04 · dirección y contabilidad: presupuestos abiertos y aceptados (dinero). */
  "presupuestos",
  /** PAN-06 · profesional: sus citas de hoy. */
  "mi-dia",
  /** PAN-06 · profesional: notas sin firmar y revisiones. */
  "pendientes-clinicos",
  /** PAN-06 · profesional: atendidas del mes y enlace a Mi desempeño. */
  "mi-desempeno",
  /** PAN-07 · recepción: reservas en línea por aceptar. */
  "reservas-en-linea",
  /** PAN-07 · recepción: quién llega y quién está en sala. */
  "llegadas",
  /** PAN-07 · recepción: estado de su caja (sin montos si no ve finanzas). */
  "cobros",
  /** PAN-08 · laboratorio: órdenes abiertas, atrasadas y por recibir. */
  "laboratorio",
  /** REC-10 · insumos bajo el mínimo. */
  "insumos",
] as const;

export type Bloque = (typeof BLOQUES)[number];

const BLOQUES_POR_PERFIL: Record<PerfilDePanel, readonly Bloque[]> = {
  direccion: ["caja", "ocupacion", "presupuestos", "laboratorio", "insumos"],
  profesional: ["mi-dia", "pendientes-clinicos", "mi-desempeno", "laboratorio"],
  recepcion: ["reservas-en-linea", "llegadas", "cobros", "presupuestos"],
  laboratorio: ["laboratorio", "insumos"],
  contabilidad: ["caja", "presupuestos"],
  asistente: ["insumos"],
};

/** Permiso que exige cada bloque (el par en el servidor lo aplica la base). */
const PERMISO_DE_BLOQUE: Record<Bloque, Permission> = {
  caja: "cash:manage",
  ocupacion: "agenda:view",
  presupuestos: "finance:view",
  "mi-dia": "agenda:view",
  "pendientes-clinicos": "clinical:write",
  "mi-desempeno": "commission:view-own",
  "reservas-en-linea": "agenda:manage",
  llegadas: "agenda:view",
  cobros: "cash:manage",
  laboratorio: "treatments:view",
  insumos: "inventory:view",
};

/** Bloques de Hoy para este sujeto, en orden. */
export function bloquesDelPanel(sujeto: SujetoDePermisos): Bloque[] {
  const perfil = perfilDePanel(sujeto);
  if (!perfil) return [];
  return BLOQUES_POR_PERFIL[perfil].filter((b) => hasPermission(sujeto, PERMISO_DE_BLOQUE[b]));
}

/** ¿El bloque muestra montos? (solo con finance:view). */
export function bloqueMuestraDinero(sujeto: SujetoDePermisos, bloque: Bloque): boolean {
  if (!hasPermission(sujeto, "finance:view")) return false;
  return bloque === "caja" || bloque === "presupuestos" || bloque === "cobros";
}

// ─── Respuesta de `panel_de_hoy` ───────────────────────────────────────────

export interface ReservaPorAceptar {
  id: string;
  pacienteId: string;
  paciente: string | null;
  profesionalId: string;
  tratamiento: string;
  inicio: string;
}

export interface OrdenDeLaboratorio {
  id: string;
  pacienteId: string;
  paciente: string | null;
  descripcion: string;
  laboratorio: string | null;
  estado: string;
  vence: string | null;
  atrasada: boolean;
}

export interface InsumoBajo {
  id: string;
  nombre: string;
  unidad: string;
  actual: number;
  minimo: number;
}

export interface NotaSinFirmar {
  id: string;
  pacienteId: string;
  paciente: string | null;
  titulo: string;
  creada: string;
}

export interface PanelDeHoy {
  hoy: string;
  alertas: Partial<Record<TipoAlerta, number>>;
  reservas: ReservaPorAceptar[] | null;
  laboratorio: {
    atrasadas: number;
    enCurso: number;
    porRecibirSemana: number;
    ordenes: OrdenDeLaboratorio[];
  } | null;
  stockBajo: InsumoBajo[] | null;
  cajas: { abiertas: number; miaAbiertaDesde: string | null } | null;
  presupuestos: {
    abiertos: number;
    abiertosCents: number;
    porVencer: number;
    aceptadosMes: number;
    aceptadosMesCents: number;
  } | null;
  notasSinFirmar: NotaSinFirmar[] | null;
  desempenoPropio: { atendidasMes: number; ausentesMes: number } | null;
}

type Json = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const txt = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const lista = (v: unknown): Json[] | null => (Array.isArray(v) ? (v as Json[]) : null);
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

/** Normaliza el jsonb de `panel_de_hoy` (secciones ausentes = null). */
export function mapearPanelDeHoy(raw: unknown): PanelDeHoy {
  const r = obj(raw) ?? {};
  const alertasRaw = obj(r.alertas) ?? {};
  const alertas: Partial<Record<TipoAlerta, number>> = {};
  for (const t of TIPOS_DE_ALERTA) {
    if (t in alertasRaw && alertasRaw[t] !== null) alertas[t] = num(alertasRaw[t]);
  }
  const lab = obj(r.laboratorio);
  const cajas = obj(r.cajas);
  const pres = obj(r.presupuestos);
  const des = obj(r.desempeno_propio);
  return {
    hoy: txt(r.hoy) ?? "",
    alertas,
    reservas:
      lista(r.reservas)?.map((x) => ({
        id: String(x.id),
        pacienteId: String(x.paciente_id),
        paciente: txt(x.paciente),
        profesionalId: String(x.profesional_id),
        tratamiento: txt(x.tratamiento) ?? "",
        inicio: String(x.inicio),
      })) ?? null,
    laboratorio: lab
      ? {
          atrasadas: num(lab.atrasadas),
          enCurso: num(lab.en_curso),
          porRecibirSemana: num(lab.por_recibir_semana),
          ordenes: (lista(lab.ordenes) ?? []).map((o) => ({
            id: String(o.id),
            pacienteId: String(o.paciente_id),
            paciente: txt(o.paciente),
            descripcion: txt(o.descripcion) ?? "",
            laboratorio: txt(o.laboratorio),
            estado: String(o.estado),
            vence: txt(o.vence),
            atrasada: o.atrasada === true,
          })),
        }
      : null,
    stockBajo:
      lista(r.stock_bajo)?.map((i) => ({
        id: String(i.id),
        nombre: txt(i.nombre) ?? "",
        unidad: txt(i.unidad) ?? "",
        actual: num(i.actual),
        minimo: num(i.minimo),
      })) ?? null,
    cajas: cajas
      ? { abiertas: num(cajas.abiertas), miaAbiertaDesde: txt(cajas.mia_abierta_desde) }
      : null,
    presupuestos: pres
      ? {
          abiertos: num(pres.abiertos),
          abiertosCents: num(pres.abiertos_cents),
          porVencer: num(pres.por_vencer),
          aceptadosMes: num(pres.aceptados_mes),
          aceptadosMesCents: num(pres.aceptados_mes_cents),
        }
      : null,
    notasSinFirmar:
      lista(r.notas_sin_firmar)?.map((n) => ({
        id: String(n.id),
        pacienteId: String(n.paciente_id),
        paciente: txt(n.paciente),
        titulo: txt(n.titulo) ?? "",
        creada: String(n.creada),
      })) ?? null,
    desempenoPropio: des
      ? { atendidasMes: num(des.atendidas_mes), ausentesMes: num(des.ausentes_mes) }
      : null,
  };
}
