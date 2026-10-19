// src/lib/auth/mfa.ts
//
// Verificación en dos pasos (TOTP de Supabase Auth) — hallazgo SEG-01 de la
// auditoría 360 (18-oct-2026): 0 de 5 usuarios tenía MFA, incluido el staff
// de `/admin`, que ve todas las clínicas.
//
// Lógica pura, sin red ni Supabase, para poder fijarla con tests
// (`tests/mfa-gate.test.ts`). Quién la usa:
// - `requireEsmaliaStaffEmail` (servidor): el staff de plataforma necesita
//   una sesión `aal2`. Es la frontera real: el claim `aal` sale del JWT ya
//   verificado por `getClaims` en `requireSupabaseAuth`.
// - `_authenticated/route.tsx` (cliente): si la cuenta tiene un factor
//   verificado y la sesión sigue en `aal1`, manda a `/auth/verificar`.
// - `AvisoMfaRecomendado` (cliente): aviso a los owners sin factor.
//
// Niveles (NIST 800-63): `aal1` = solo contraseña o Google; `aal2` = además
// un código TOTP verificado en esta sesión.

export type NivelAal = "aal1" | "aal2";

/** Lee el claim `aal` de un JWT (o el `currentLevel`/`nextLevel` de
 *  `getAuthenticatorAssuranceLevel`). Cualquier otra cosa es `null`: un valor
 *  desconocido nunca cuenta como `aal2`. */
export function nivelAal(valor: unknown): NivelAal | null {
  return valor === "aal1" || valor === "aal2" ? valor : null;
}

export type NivelesDeSesion = {
  currentLevel: string | null;
  nextLevel: string | null;
};

/** `true` cuando la cuenta tiene un factor verificado (por eso `nextLevel` es
 *  `aal2`) y la sesión todavía no lo usó. Es el caso "pedir el código". */
export function necesitaDesafioMfa(niveles: NivelesDeSesion | null | undefined): boolean {
  if (!niveles) return false;
  return nivelAal(niveles.currentLevel) === "aal1" && nivelAal(niveles.nextLevel) === "aal2";
}

/** `true` si la cuenta tiene al menos un factor verificado. Supabase sube
 *  `nextLevel` a `aal2` exactamente en ese caso. */
export function tieneFactorVerificado(niveles: NivelesDeSesion | null | undefined): boolean {
  return nivelAal(niveles?.nextLevel) === "aal2";
}

// ---------------------------------------------------------------------------
// Staff de plataforma (`/admin`, allowlist `ESMALIA_STAFF_EMAILS`)
// ---------------------------------------------------------------------------

export const MENSAJE_SIN_PERMISOS = "No tienes permisos.";
export const MENSAJE_STAFF_REQUIERE_MFA =
  "Para entrar al panel interno necesitas la verificación en dos pasos. Actívala y vuelve a intentar.";

export function listaDeStaff(valorEnv: string | undefined): string[] {
  return (valorEnv ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export type ResultadoAccesoStaff =
  { ok: true; email: string } | { ok: false; motivo: "sin_permiso" | "requiere_mfa" };

/**
 * Decide si un usuario entra a `/admin`. Orden deliberado: primero la
 * allowlist y después el nivel, para que a quien no es staff no se le diga
 * nada sobre el MFA (solo "No tienes permisos").
 */
export function evaluarAccesoStaff(input: {
  email: string | null | undefined;
  emailConfirmado: boolean;
  permitidos: readonly string[];
  aal: unknown;
}): ResultadoAccesoStaff {
  const email = input.email?.trim().toLowerCase();
  if (!email || !input.emailConfirmado || !input.permitidos.includes(email)) {
    return { ok: false, motivo: "sin_permiso" };
  }
  if (nivelAal(input.aal) !== "aal2") {
    return { ok: false, motivo: "requiere_mfa" };
  }
  return { ok: true, email };
}

// ---------------------------------------------------------------------------
// Política por rol de clínica
// ---------------------------------------------------------------------------

export type PoliticaMfa = "obligatoria" | "recomendada" | "opcional";

/**
 * Hoy el MFA es OBLIGATORIO solo para el staff de plataforma (arriba). Para
 * el owner de una clínica es RECOMENDADO: se le muestra un aviso visible,
 * sin bloquear. Pasarlo a obligatorio está descrito en
 * `docs/MFA.md` (cambiar este valor solo no alcanza: hace falta el chequeo
 * en servidor/RLS).
 */
export function politicaMfaDeRol(rol: string | null | undefined): PoliticaMfa {
  return rol === "owner" ? "recomendada" : "opcional";
}

/** Aviso "activa la verificación en dos pasos" en la app de clínica. Nunca a
 *  la cuenta de la demo: es compartida, y un factor ahí dejaría afuera a
 *  todos los demás visitantes. */
export function debeMostrarAvisoMfa(input: {
  rolReal: string | null | undefined;
  tieneFactor: boolean;
  esDemo: boolean;
}): boolean {
  if (input.esDemo || input.tieneFactor) return false;
  return politicaMfaDeRol(input.rolReal) !== "opcional";
}

// ---------------------------------------------------------------------------
// Código TOTP
// ---------------------------------------------------------------------------

/** Acepta "123 456", "123-456" o "123456" (lo que pegan desde la app del
 *  teléfono) y devuelve los 6 dígitos, o `null` si no es un código válido. */
export function normalizarCodigoTotp(entrada: string): string | null {
  const limpio = entrada.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(limpio) ? limpio : null;
}

type FactorMinimo = { id: string; factor_type: string; status: string };

/** Factores TOTP que quedaron a medio inscribir (alguien abrió el QR y no
 *  terminó). Se limpian antes de inscribir uno nuevo. */
export function factoresTotpSinVerificar<T extends FactorMinimo>(factores: readonly T[]): T[] {
  return factores.filter((f) => f.factor_type === "totp" && f.status !== "verified");
}

export function factoresTotpVerificados<T extends FactorMinimo>(factores: readonly T[]): T[] {
  return factores.filter((f) => f.factor_type === "totp" && f.status === "verified");
}
