/**
 * Modo sandbox de email.
 *
 * Durante el periodo de validación, ningún email debe llegar a un destinatario
 * real. Este módulo es la única puerta por la que puede pasar un envío: cualquier
 * helper de envío debe llamar a `resolveEmailRecipient` antes de despachar.
 */

export type EmailSandboxMode = "sandbox" | "production";

export type EmailSandboxConfig = {
  /** `sandbox` bloquea o redirige todo; `production` deja pasar los envíos reales. */
  mode: EmailSandboxMode;
  /** Dirección a la que se redirigen todos los emails en sandbox. */
  redirectTo: string;
  /**
   * Direcciones de prueba que sí pueden recibir su email original en sandbox
   * (una por línea en la interfaz).
   */
  allowlist: string[];
  /**
   * Si está activo, un destinatario fuera de la allowlist se redirige a
   * `redirectTo`. Si está inactivo, el envío se bloquea por completo.
   */
  redirectEnabled: boolean;
  /** Antepone `[SANDBOX]` al asunto para distinguir los correos de prueba. */
  prefixSubject: boolean;
  /**
   * Número mínimo de emails de prueba entregados correctamente que se exigen
   * antes de permitir el cambio a producción.
   */
  minEntregasProduccion: number;
};

export const DEFAULT_EMAIL_SANDBOX: EmailSandboxConfig = {
  mode: "sandbox",
  redirectTo: "",
  allowlist: [],
  redirectEnabled: true,
  prefixSubject: true,
  minEntregasProduccion: 3,
};

export const MAX_ENTREGAS_PRODUCCION = 50;

const STORAGE_KEY = "esmalia:email-sandbox";

export const SANDBOX_SUBJECT_PREFIX = "[SANDBOX]";

export function clampMinEntregas(valor: unknown): number {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n) || n < 0) return DEFAULT_EMAIL_SANDBOX.minEntregasProduccion;
  return Math.min(n, MAX_ENTREGAS_PRODUCCION);
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function parseAllowlist(texto: string): string[] {
  return Array.from(
    new Set(
      texto
        .split(/[\n,;]/)
        .map(normalizeEmail)
        .filter((linea) => linea.length > 0 && isValidEmail(linea)),
    ),
  );
}

/** Configuración guardada en el navegador de quien valida la entregabilidad. */
export function leerEmailSandbox(): EmailSandboxConfig {
  if (typeof window === "undefined") return DEFAULT_EMAIL_SANDBOX;
  try {
    const crudo = window.localStorage.getItem(STORAGE_KEY);
    if (!crudo) return DEFAULT_EMAIL_SANDBOX;
    const parsed = JSON.parse(crudo) as Partial<EmailSandboxConfig>;
    return {
      ...DEFAULT_EMAIL_SANDBOX,
      ...parsed,
      mode: parsed.mode === "production" ? "production" : "sandbox",
      allowlist: Array.isArray(parsed.allowlist)
        ? parsed.allowlist.map(normalizeEmail).filter(isValidEmail)
        : [],
      minEntregasProduccion: clampMinEntregas(parsed.minEntregasProduccion),
    };
  } catch {
    return DEFAULT_EMAIL_SANDBOX;
  }
}

export function guardarEmailSandbox(config: EmailSandboxConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export type EmailRecipientDecision =
  | { action: "send"; recipient: string; subjectPrefix: string; reason: string }
  | {
      action: "redirect";
      recipient: string;
      original: string;
      subjectPrefix: string;
      reason: string;
    }
  | { action: "block"; original: string; reason: string };

/**
 * Decide qué hacer con un destinatario según la configuración de sandbox.
 * Es la función que debe envolver cualquier envío real.
 */
export function resolveEmailRecipient(
  destinatario: string,
  config: EmailSandboxConfig = DEFAULT_EMAIL_SANDBOX,
): EmailRecipientDecision {
  const original = normalizeEmail(destinatario);

  if (config.mode === "production") {
    return {
      action: "send",
      recipient: original,
      subjectPrefix: "",
      reason: "Modo producción: el envío sale al destinatario real.",
    };
  }

  const prefix = config.prefixSubject ? `${SANDBOX_SUBJECT_PREFIX} ` : "";

  if (config.allowlist.includes(original)) {
    return {
      action: "send",
      recipient: original,
      subjectPrefix: prefix,
      reason: "Dirección de prueba en la lista permitida.",
    };
  }

  const redirect = normalizeEmail(config.redirectTo);
  if (config.redirectEnabled && isValidEmail(redirect)) {
    return {
      action: "redirect",
      recipient: redirect,
      original,
      subjectPrefix: prefix,
      reason:
        "Esta clínica todavía no tiene el email activado para pacientes reales: este mensaje se mandó a una dirección de prueba en su lugar.",
    };
  }

  return {
    action: "block",
    original,
    reason: config.redirectEnabled
      ? "Esta clínica todavía no tiene el email activado y no hay una dirección de prueba configurada. Avísale a soporte."
      : "Esta clínica todavía no tiene el email activado. Avísale a soporte.",
  };
}

/** Resumen legible del estado actual, para mostrar en la interfaz. */
export function resumenSandbox(config: EmailSandboxConfig) {
  if (config.mode === "production") {
    return {
      tono: "peligro" as const,
      titulo: "Producción activa",
      detalle: "Los emails salen a los destinatarios reales de la clínica.",
    };
  }
  if (config.redirectEnabled && isValidEmail(config.redirectTo)) {
    return {
      tono: "aviso" as const,
      titulo: "Modo prueba con redirección",
      detalle: `Todo se desvía a ${normalizeEmail(config.redirectTo)}, salvo ${config.allowlist.length} dirección(es) permitida(s).`,
    };
  }
  return {
    tono: "seguro" as const,
    titulo: "Modo prueba bloqueante",
    detalle:
      config.allowlist.length > 0
        ? `Solo reciben email las ${config.allowlist.length} dirección(es) de prueba; el resto se bloquea.`
        : "Ningún email sale del sistema.",
  };
}
