export const CLINIC_ROLES = [
  "owner",
  "admin",
  /** EQU-02 (Ola 10): coordinación de la operación diaria. En la base hereda
   * lo que permiten recepción y contabilidad (`has_clinic_role`), nunca la
   * historia clínica. */
  "coordinator",
  "dentist",
  "assistant",
  "reception",
  "accounting",
  /** EQU-02 (Ola 10): técnico/a dental de laboratorio. Órdenes de laboratorio
   * e inventario, sin historia clínica ni pagos. */
  "lab_technician",
] as const;

export type ClinicRole = (typeof CLINIC_ROLES)[number];

export const ROLE_LABELS: Record<ClinicRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  coordinator: "Coordinación",
  dentist: "Doctor/a",
  assistant: "Asistente dental",
  reception: "Recepción",
  accounting: "Contabilidad",
  lab_technician: "Técnico/a dental",
};

export const ROLE_DESCRIPTIONS: Record<ClinicRole, string> = {
  owner: "Control total de la clínica, equipo y facturación.",
  admin: "Gestiona clínica, equipo, agenda y pacientes.",
  coordinator:
    "Lleva la operación diaria: agenda, pacientes, caja y finanzas, sin historia clínica ni gestión del equipo.",
  dentist: "Agenda, pacientes e historia clínica de sus tratamientos.",
  assistant: "Apoyo clínico: ve agenda y ficha básica del paciente.",
  reception: "Agenda, contacto y datos administrativos del paciente.",
  accounting: "Indicadores, tratamientos y finanzas, sin historia clínica.",
  lab_technician:
    "Laboratorio: órdenes de laboratorio, inventario y agenda, sin historia clínica ni pagos.",
};

export const PERMISSIONS = [
  "dashboard:view",
  "agenda:view",
  "agenda:manage",
  "patients:view",
  "patients:manage",
  "clinical:view",
  "clinical:write",
  "treatments:view",
  "finance:view",
  /** Abrir/cerrar caja y hacer el arqueo del turno — separado de
   * `finance:view` porque reception maneja caja a diario y no tiene (ni
   * debería tener) visibilidad de los reportes financieros completos. */
  "cash:manage",
  /** Reversar un pago mal cargado. Más restrictivo que `cash:manage` a
   * propósito: cualquiera que cobra puede abrir/cerrar caja, pero deshacer
   * un cobro ya registrado queda para quien audita las finanzas. */
  "payments:reverse",
  "inventory:view",
  "inventory:manage",
  "team:view",
  "team:manage",
  "settings:manage",
  /** Ver la propia liquidación de comisiones (no la de otros profesionales).
   * ux-3 de la auditoría 360 v2: un dentist no tiene `finance:view`, pero
   * debe poder ver su propia comisión en /comisiones. */
  "commission:view-own",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<ClinicRole, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [...PERMISSIONS],
  // Recepción + contabilidad (lo mismo que le abre la base vía has_clinic_role).
  coordinator: [
    "dashboard:view",
    "agenda:view",
    "agenda:manage",
    "patients:view",
    "patients:manage",
    "treatments:view",
    "finance:view",
    "cash:manage",
    "payments:reverse",
    "inventory:view",
    "team:view",
  ],
  dentist: [
    "dashboard:view",
    "agenda:view",
    "agenda:manage",
    "patients:view",
    "patients:manage",
    "clinical:view",
    "clinical:write",
    "treatments:view",
    "inventory:view",
    "team:view",
    "commission:view-own",
  ],
  assistant: [
    "dashboard:view",
    "agenda:view",
    "patients:view",
    "treatments:view",
    "inventory:view",
  ],
  reception: [
    "dashboard:view",
    "agenda:view",
    "agenda:manage",
    "patients:view",
    "patients:manage",
    "treatments:view",
    "inventory:view",
    "team:view",
    "cash:manage",
  ],
  accounting: [
    "dashboard:view",
    "patients:view",
    "treatments:view",
    "finance:view",
    "team:view",
    "cash:manage",
    "payments:reverse",
  ],
  lab_technician: [
    "dashboard:view",
    "agenda:view",
    "patients:view",
    "treatments:view",
    "inventory:view",
  ],
};

export function permissionsForRole(role: ClinicRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * A quién se le pregunta un permiso: un rol suelto (la matriz por rol, ej. la
 * tabla de Permisos o "¿este integrante puede agendar?") o el acceso del
 * usuario, que trae sus permisos efectivos con los ajustes por persona
 * (EQU-01). Con el acceso, manda `permissions`; sin ella, el rol.
 */
export type SujetoDePermisos =
  | ClinicRole
  | null
  | undefined
  | { role: ClinicRole | null; permissions?: readonly Permission[] | null };

export function hasPermission(sujeto: SujetoDePermisos, permission: Permission) {
  if (!sujeto) return false;
  if (typeof sujeto === "string") return permissionsForRole(sujeto).includes(permission);
  if (sujeto.permissions) return sujeto.permissions.includes(permission);
  return sujeto.role ? permissionsForRole(sujeto.role).includes(permission) : false;
}

/** Rol de un sujeto (para las puertas que miran el rol y no un permiso). */
export function rolDeSujeto(sujeto: SujetoDePermisos): ClinicRole | null {
  if (!sujeto) return null;
  return typeof sujeto === "string" ? sujeto : sujeto.role;
}

// ─── EQU-01 · Ajustes de permisos por persona ──────────────────────────────
//
// Además del rol, a cada integrante se le puede dar o quitar un permiso
// puntual de la matriz. Reglas duras (CLAUDE.md, regla 2), que valen también
// en la base (`ajuste_de_permiso_admitido` y el trigger
// `validar_ajuste_de_permiso`, migración 20261106300200):
// - la historia clínica solo la ven owner/admin/dentist/assistant: un ajuste
//   nunca se la abre a recepción, contabilidad, coordinación ni laboratorio;
// - los pagos nunca quedan en manos de asistente dental;
// - un ajuste no abre lo que la base no le deja al rol: se puede DAR solo lo
//   que las políticas ya permiten a ese rol (la pantalla solo lo muestra) y se
//   puede QUITAR solo lo que una política restrictiva hace cumplir.
// `tests/permisos-por-persona.test.ts` y `tests/permisos-por-persona-db.test.ts`
// comparan este catálogo con el de la base, combinación por combinación.

export type EfectoAjuste = "grant" | "revoke";
export type AjustePermiso = { permission: Permission; effect: EfectoAjuste };

/** Regla 2: los únicos roles que pueden ver o escribir historia clínica. */
export const ROLES_CON_HISTORIA_CLINICA: readonly ClinicRole[] = [
  "owner",
  "admin",
  "dentist",
  "assistant",
];
export const PERMISOS_CLINICOS: readonly Permission[] = ["clinical:view", "clinical:write"];
/** Regla 2: dinero que asistente dental nunca maneja. */
export const PERMISOS_DE_PAGOS: readonly Permission[] = [
  "finance:view",
  "cash:manage",
  "payments:reverse",
];

type ReglaDeAjuste =
  { otorgable: readonly ClinicRole[]; revocable: readonly ClinicRole[] } | { motivo: string };

const MOTIVO_BASE = "Es la base del rol: sin esto la persona no puede trabajar en Esmalia.";
const MOTIVO_FINANZAS =
  "Por ahora se define solo por el rol: los ajustes de finanzas, caja y comisiones llegan con esas pantallas.";
const MOTIVO_GESTION =
  "Solo propietario y administración. Para darlo, cambia el rol a Administrador.";

/**
 * Qué se puede ajustar por persona. `otorgable`: roles a los que se les puede
 * dar el permiso (no lo traen por rol y la base ya se los permite).
 * `revocable`: roles a los que se les puede quitar (lo traen por rol y hay
 * una política restrictiva que lo hace cumplir en la base).
 */
export const AJUSTES_POR_PERMISO: Record<Permission, ReglaDeAjuste> = {
  "dashboard:view": { motivo: MOTIVO_BASE },
  "agenda:view": { otorgable: ["accounting"], revocable: [] },
  "agenda:manage": { otorgable: [], revocable: ["admin", "coordinator", "dentist", "reception"] },
  "patients:view": { motivo: MOTIVO_BASE },
  "patients:manage": {
    otorgable: [],
    revocable: ["admin", "coordinator", "dentist", "reception"],
  },
  "clinical:view": { otorgable: ["assistant"], revocable: ["admin", "dentist"] },
  "clinical:write": { otorgable: ["assistant"], revocable: ["admin", "dentist"] },
  "treatments:view": { motivo: MOTIVO_BASE },
  "finance:view": { motivo: MOTIVO_FINANZAS },
  "cash:manage": { motivo: MOTIVO_FINANZAS },
  "payments:reverse": { motivo: MOTIVO_FINANZAS },
  "inventory:view": { otorgable: [], revocable: [] },
  "inventory:manage": {
    motivo: "Crear y editar insumos queda para propietario y administración.",
  },
  "team:view": { otorgable: ["assistant", "lab_technician"], revocable: [] },
  "team:manage": { motivo: MOTIVO_GESTION },
  "settings:manage": { motivo: MOTIVO_GESTION },
  "commission:view-own": { motivo: MOTIVO_FINANZAS },
};

/**
 * ¿Se admite este ajuste para este rol? Puro y sin contexto: lo usan la
 * pantalla, el servidor y (en espejo SQL) la base. Primero las reglas duras,
 * después el catálogo.
 */
export function ajusteAdmitido(
  role: ClinicRole,
  permission: Permission,
  effect: EfectoAjuste,
): boolean {
  if (role === "owner") return false;
  const delRol = permissionsForRole(role).includes(permission);
  if (effect === "grant") {
    if (delRol) return false;
    if (PERMISOS_CLINICOS.includes(permission) && !ROLES_CON_HISTORIA_CLINICA.includes(role)) {
      return false;
    }
    if (PERMISOS_DE_PAGOS.includes(permission) && role === "assistant") return false;
  } else if (!delRol) {
    return false;
  }
  const regla = AJUSTES_POR_PERMISO[permission];
  if ("motivo" in regla) return false;
  return (effect === "grant" ? regla.otorgable : regla.revocable).includes(role);
}

/**
 * Por qué NO se puede ajustar este permiso a este rol (para mostrar el
 * control deshabilitado con su motivo). null = se puede.
 */
export function motivoSinAjuste(role: ClinicRole, permission: Permission): string | null {
  if (role === "owner") return "El propietario tiene acceso completo: no se ajusta por persona.";
  const delRol = permissionsForRole(role).includes(permission);
  if (ajusteAdmitido(role, permission, delRol ? "revoke" : "grant")) return null;
  if (
    !delRol &&
    PERMISOS_CLINICOS.includes(permission) &&
    !ROLES_CON_HISTORIA_CLINICA.includes(role)
  ) {
    return "La historia clínica solo la ven propietario, administración, profesionales y asistentes.";
  }
  if (!delRol && PERMISOS_DE_PAGOS.includes(permission) && role === "assistant") {
    return "Asistente dental no maneja pagos ni finanzas.";
  }
  const regla = AJUSTES_POR_PERMISO[permission];
  if ("motivo" in regla) return regla.motivo;
  return delRol
    ? "Viene con el rol y no se puede quitar por persona: para eso, cambia el rol."
    : `El rol ${ROLE_LABELS[role]} no tiene este acceso en la base de datos: para darlo, cambia el rol.`;
}

/**
 * Permisos efectivos de un integrante: los de su rol, más lo que se le dio,
 * menos lo que se le quitó. Los ajustes que ya no corresponden a su rol (por
 * ejemplo, después de un cambio de rol) se ignoran. Escribir historia clínica
 * exige verla: sin `clinical:view`, `clinical:write` no cuenta.
 */
export function permisosEfectivos(
  role: ClinicRole | null | undefined,
  ajustes: readonly AjustePermiso[] = [],
): Permission[] {
  if (!role) return [];
  const set = new Set<Permission>(permissionsForRole(role));
  for (const a of ajustes) {
    if (!ajusteAdmitido(role, a.permission, a.effect)) continue;
    if (a.effect === "grant") set.add(a.permission);
    else set.delete(a.permission);
  }
  if (!set.has("clinical:view")) set.delete("clinical:write");
  return PERMISSIONS.filter((p) => set.has(p));
}

/** Solo los ajustes que siguen vigentes para el rol actual del integrante. */
export function ajustesVigentes(
  role: ClinicRole,
  ajustes: readonly AjustePermiso[],
): AjustePermiso[] {
  return ajustes.filter((a) => ajusteAdmitido(role, a.permission, a.effect));
}

/** Normaliza filas de `clinic_member_permission_overrides` (descarta lo desconocido). */
export function ajustesDesdeFilas(
  filas: readonly { permission: string; effect: string }[] | null | undefined,
): AjustePermiso[] {
  return (filas ?? []).flatMap((f) =>
    (PERMISSIONS as readonly string[]).includes(f.permission) &&
    (f.effect === "grant" || f.effect === "revoke")
      ? [{ permission: f.permission as Permission, effect: f.effect }]
      : [],
  );
}

// ─── EQU-03 · Profesión del integrante ─────────────────────────────────────

/** Profesiones de un equipo dental en Chile. Espejo del check
 * `clinic_members_profession_check` (migración 20261106300200). */
export const PROFESIONES = [
  "odontologo_general",
  "odontologo_especialista",
  "asistente_dental",
  "tecnico_dental",
  "recepcion",
  "coordinacion",
  "administracion",
  "contabilidad",
  "otra",
] as const;

export type Profesion = (typeof PROFESIONES)[number];

export const PROFESION_LABELS: Record<Profesion, string> = {
  odontologo_general: "Odontólogo/a general",
  odontologo_especialista: "Odontólogo/a especialista",
  asistente_dental: "Asistente dental (TENS)",
  tecnico_dental: "Técnico/a dental de laboratorio",
  recepcion: "Recepción",
  coordinacion: "Coordinación clínica",
  administracion: "Administración",
  contabilidad: "Contabilidad",
  otra: "Otra",
};

/** Profesión sugerida al invitar con un rol (se puede cambiar). */
export const PROFESION_SUGERIDA: Record<ClinicRole, Profesion | null> = {
  owner: null,
  admin: "administracion",
  coordinator: "coordinacion",
  dentist: "odontologo_general",
  assistant: "asistente_dental",
  reception: "recepcion",
  accounting: "contabilidad",
  lab_technician: "tecnico_dental",
};

export function isProfesion(value: string | null | undefined): value is Profesion {
  return !!value && (PROFESIONES as readonly string[]).includes(value);
}

/** Etiqueta legible de una profesión; null si no está cargada. */
export function etiquetaProfesion(value: string | null | undefined): string | null {
  return isProfesion(value) ? PROFESION_LABELS[value] : null;
}

export function isClinicRole(value: string): value is ClinicRole {
  return (CLINIC_ROLES as readonly string[]).includes(value);
}

/** Query key de getMyAccess — compartida entre el route loader y cualquier
 * UI que necesite invalidarla después de escribir (ej. cambiar de clínica
 * activa, ver clinic-switcher.tsx). Cambia poquísimo, y sin esto no se abre
 * ninguna pantalla. */
export const ACCESS_QUERY_KEY = ["my-access"] as const;

export type ClinicAccess = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  /** Todas las clínicas de las que el usuario es miembro (para el selector
   * de clínica activa). Casi siempre 1 elemento — el switcher solo se
   * muestra con 2+. */
  memberships: { clinicId: string; clinicName: string }[];
  clinic: {
    id: string;
    name: string;
    onboardingCompleted: boolean;
    /** IANA timezone (ej. "America/Santiago"). Fallback a Santiago si la clínica no lo tiene seteado. */
    timezone: string;
    /** Código de país ISO-3166 alpha-2 (ej. "CL"). Usado para feriados públicos (Nager.Date). */
    country: string;
    /** Clínica demo pública: solo lectura a nivel de trigger, ver migración 20260815180000. */
    isDemo: boolean;
    /** Moneda ISO 4217 de la clínica (ej. "CLP"). Usar con formatMoney/toCents/fromCents. */
    currency: string;
    /** Cuándo se agendó/hizo la llamada de puesta en marcha (null = no agendó todavía).
     * Ver `requiereLlamadaOSuscripcion` en billing.ts. */
    onboardingCallAt: string | null;
  } | null;
  /** Rol vigente en la interfaz: el real, o el simulado si el admin activó la simulación. */
  role: ClinicRole | null;
  /** Rol real del usuario en la clínica (autoritativo, el que aplica en RLS). */
  realRole?: ClinicRole | null;
  /** Rol simulado activo (solo interfaz). */
  simulatedRole?: ClinicRole | null;
  /** EQU-01: permisos efectivos (rol + ajustes por persona). Con simulación
   * de rol, los del rol simulado sin ajustes. Ausente = se usa el rol. */
  permissions?: Permission[];
  /** EQU-01: ajustes vigentes del usuario en la clínica activa. */
  ajustes?: AjustePermiso[];
  /** EQU-03: profesión del usuario en la clínica activa. */
  profession?: Profesion | null;
  /** `professionals.id` vinculado a este usuario en la clínica activa, si
   * existe (via `professionals.user_id`). null = el usuario no tiene ficha
   * de profesional (ej. reception/accounting) o no está vinculada todavía. */
  myProfessionalId?: string | null;
};

export type ClinicMember = {
  id: string;
  userId: string;
  role: ClinicRole;
  /** EQU-03: profesión (null = sin cargar). */
  profession: Profesion | null;
  /** EQU-01: ajustes por persona vigentes para su rol. */
  ajustes: AjustePermiso[];
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};
