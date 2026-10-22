/**
 * Verificación previa (preflight) de envíos de email.
 *
 * Antes de despachar nada se comprueban tres bloques:
 *  1. Conexión: dominio verificado, canal listo y política de sandbox coherente.
 *  2. Plantilla: existe, tiene asunto y cuerpo, y sus marcadores están declarados.
 *  3. Variables y destinatarios: no quedan `{{marcadores}}` sin resolver ni
 *     direcciones inválidas o completamente bloqueadas.
 *
 * Si algún control es `fail`, el envío no puede ejecutarse: `ejecutarPruebaEmail`
 * exige un preflight aprobado.
 */

import {
  puedeActivarProduccion,
  verificacionVigente,
  type DnsVerification,
} from "@/lib/messaging/dns-email";
import {
  isValidEmail,
  normalizeEmail,
  resolveEmailRecipient,
  type EmailSandboxConfig,
} from "@/lib/messaging/email-sandbox";
import {
  definicionPlantilla,
  extraerMarcadores,
  renderPlantilla,
  type EmailChannelStatus,
  type EmailTemplateData,
  type EmailTestTemplate,
} from "@/lib/messaging/email-test-log";

export type PreflightState = "pass" | "warn" | "fail";

export type PreflightGroup = "conexion" | "plantilla" | "variables";

export type PreflightCheck = {
  id: string;
  group: PreflightGroup;
  label: string;
  state: PreflightState;
  detail: string;
  /** Qué hacer para resolverlo, cuando aplica. */
  fix?: string;
};

export type PreflightReport = {
  checkedAt: string;
  durationMs: number;
  ok: boolean;
  checks: PreflightCheck[];
  /** Asunto y cuerpo ya renderizados, para previsualizar antes de enviar. */
  preview: { subject: string; body: string } | null;
  /** Resumen legible del bloqueo, vacío cuando `ok` es true. */
  motivoBloqueo: string;
};

export const GRUPO_LABEL: Record<PreflightGroup, string> = {
  conexion: "Conexión",
  plantilla: "Plantilla",
  variables: "Variables y destinatarios",
};

export type PreflightInput = {
  template: EmailTestTemplate;
  datos: EmailTemplateData;
  destinatarios: string[];
  config: EmailSandboxConfig;
  canal: EmailChannelStatus;
  verificacion: DnsVerification | null;
};

/* ------------------------------- Conexión ------------------------------- */

function checksConexion(input: PreflightInput): PreflightCheck[] {
  const { canal, verificacion, config } = input;
  const checks: PreflightCheck[] = [];

  const puerta = puedeActivarProduccion(verificacion);
  const dnsOk = verificacionVigente(verificacion);

  checks.push({
    id: "dns",
    group: "conexion",
    label: "Autenticación del dominio (SPF, DKIM, DMARC)",
    // En sandbox un DNS pendiente es un aviso; en producción bloquea.
    state: dnsOk ? "pass" : config.mode === "production" ? "fail" : "warn",
    detail: puerta.motivo,
    fix: dnsOk ? undefined : "Ejecuta el asistente en Dominio de email y vuelve a validar.",
  });

  checks.push({
    id: "canal",
    group: "conexion",
    label: "Canal de envío",
    state: canal.listo ? "pass" : "fail",
    detail: canal.listo ? "El canal de envío responde y acepta despachos." : canal.motivo,
    fix: canal.listo
      ? undefined
      : "Conecta el dominio de envío; hasta entonces ningún correo puede salir.",
  });

  const modoCoherente =
    config.mode === "sandbox" || (config.mode === "production" && puerta.permitido);
  checks.push({
    id: "modo",
    group: "conexion",
    label: "Política de envío",
    state: modoCoherente ? "pass" : "fail",
    detail:
      config.mode === "production"
        ? modoCoherente
          ? "Modo producción con dominio verificado vigente."
          : "Modo producción activo sin verificación DNS vigente."
        : "Modo prueba: los envíos reales quedan contenidos.",
    fix: modoCoherente ? undefined : "Vuelve al modo prueba o revalida el dominio antes de enviar.",
  });

  return checks;
}

/* ------------------------------- Plantilla ------------------------------ */

function checksPlantilla(input: PreflightInput): PreflightCheck[] {
  const def = definicionPlantilla(input.template);
  if (!def) {
    return [
      {
        id: "plantilla-existe",
        group: "plantilla",
        label: "Plantilla registrada",
        state: "fail",
        detail: `No existe ninguna plantilla con el identificador "${input.template}".`,
        fix: "Selecciona una plantilla del catálogo.",
      },
    ];
  }

  const checks: PreflightCheck[] = [
    {
      id: "plantilla-existe",
      group: "plantilla",
      label: "Plantilla registrada",
      state: "pass",
      detail: `${def.label} — ${def.descripcion}`,
    },
  ];

  const asuntoOk = def.asunto.trim().length > 0;
  const cuerpoOk = def.cuerpo.trim().length >= 20;
  checks.push({
    id: "plantilla-contenido",
    group: "plantilla",
    label: "Asunto y cuerpo",
    state: asuntoOk && cuerpoOk ? "pass" : "fail",
    detail:
      asuntoOk && cuerpoOk
        ? "La plantilla tiene asunto y cuerpo con contenido suficiente."
        : "La plantilla no tiene asunto o su cuerpo está prácticamente vacío.",
    fix: asuntoOk && cuerpoOk ? undefined : "Completa el contenido de la plantilla.",
  });

  const usados = new Set([...extraerMarcadores(def.asunto), ...extraerMarcadores(def.cuerpo)]);
  const declarados = new Set(def.variables.map((v) => v.clave));
  const noDeclarados = Array.from(usados).filter((c) => !declarados.has(c));
  const sinUsar = Array.from(declarados).filter((c) => !usados.has(c));

  checks.push({
    id: "plantilla-marcadores",
    group: "plantilla",
    label: "Marcadores declarados",
    state: noDeclarados.length > 0 ? "fail" : sinUsar.length > 0 ? "warn" : "pass",
    detail:
      noDeclarados.length > 0
        ? `La plantilla usa marcadores no declarados: ${noDeclarados.join(", ")}.`
        : sinUsar.length > 0
          ? `Variables declaradas que la plantilla no usa: ${sinUsar.join(", ")}.`
          : `${usados.size} marcador(es) coinciden con las variables declaradas.`,
    fix:
      noDeclarados.length > 0
        ? "Declara esas variables en la plantilla o corrige el marcador."
        : undefined,
  });

  return checks;
}

/* --------------------------- Variables y envío -------------------------- */

function checksVariables(input: PreflightInput): {
  checks: PreflightCheck[];
  preview: { subject: string; body: string } | null;
} {
  const def = definicionPlantilla(input.template);
  if (!def) return { checks: [], preview: null };

  const checks: PreflightCheck[] = [];

  const faltantes = def.variables
    .filter((v) => v.requerida && !(input.datos[v.clave] ?? "").trim())
    .map((v) => v.label);

  checks.push({
    id: "variables-requeridas",
    group: "variables",
    label: "Variables requeridas",
    state: faltantes.length === 0 ? "pass" : "fail",
    detail:
      faltantes.length === 0
        ? `Las ${def.variables.length} variable(s) de la plantilla tienen valor.`
        : `Faltan valores: ${faltantes.join(", ")}.`,
    fix: faltantes.length === 0 ? undefined : "Completa los campos antes de enviar.",
  });

  const subject = renderPlantilla(def.asunto, input.datos);
  const body = renderPlantilla(def.cuerpo, input.datos);
  const sinResolver = Array.from(
    new Set([...extraerMarcadores(subject), ...extraerMarcadores(body)]),
  );

  checks.push({
    id: "variables-render",
    group: "variables",
    label: "Render sin marcadores pendientes",
    state: sinResolver.length === 0 ? "pass" : "fail",
    detail:
      sinResolver.length === 0
        ? "El asunto y el cuerpo se renderizan por completo."
        : `Quedarían marcadores visibles en el correo: ${sinResolver.map((c) => `{{${c}}}`).join(", ")}.`,
    fix: sinResolver.length === 0 ? undefined : "Aporta un valor para cada marcador.",
  });

  const normalizados = input.destinatarios.map(normalizeEmail).filter(Boolean);
  const invalidos = normalizados.filter((d) => !isValidEmail(d));

  checks.push({
    id: "destinatarios-formato",
    group: "variables",
    label: "Destinatarios válidos",
    state: normalizados.length === 0 || invalidos.length > 0 ? "fail" : "pass",
    detail:
      normalizados.length === 0
        ? "No hay ningún destinatario de prueba."
        : invalidos.length > 0
          ? `Direcciones con formato inválido: ${invalidos.join(", ")}.`
          : `${normalizados.length} destinatario(s) con formato correcto.`,
    fix:
      normalizados.length === 0
        ? "Agrega al menos una dirección de prueba."
        : invalidos.length > 0
          ? "Corrige el formato de esas direcciones."
          : undefined,
  });

  const validos = normalizados.filter(isValidEmail);
  const decisiones = validos.map((d) => resolveEmailRecipient(d, input.config));
  const bloqueados = decisiones.filter((d) => d.action === "block").length;
  const todosBloqueados = validos.length > 0 && bloqueados === validos.length;

  checks.push({
    id: "destinatarios-sandbox",
    group: "variables",
    label: "Reglas del modo prueba aplicadas",
    state: todosBloqueados ? "fail" : bloqueados > 0 ? "warn" : "pass",
    detail: todosBloqueados
      ? "El modo prueba bloquearía todos los destinatarios: no saldría ningún correo."
      : bloqueados > 0
        ? `${bloqueados} de ${validos.length} destinatario(s) quedarían bloqueados por el modo prueba.`
        : "Todos los destinatarios pasan las reglas del modo prueba.",
    fix: todosBloqueados
      ? "Activa la redirección o agrega las direcciones a la lista permitida."
      : undefined,
  });

  return { checks, preview: { subject, body } };
}

/* ------------------------------- Preflight ------------------------------ */

export function ejecutarPreflight(input: PreflightInput): PreflightReport {
  const inicio = Date.now();
  const variables = checksVariables(input);
  const checks = [...checksConexion(input), ...checksPlantilla(input), ...variables.checks];

  const fallidos = checks.filter((c) => c.state === "fail");

  return {
    checkedAt: new Date(inicio).toISOString(),
    durationMs: Date.now() - inicio,
    ok: fallidos.length === 0,
    checks,
    preview: variables.preview,
    motivoBloqueo: fallidos.length
      ? `${fallidos.length} control(es) fallaron: ${fallidos.map((c) => c.label).join("; ")}.`
      : "",
  };
}

/** Preflight vigente durante esta sesión de trabajo (evita enviar con datos viejos). */
export const PREFLIGHT_VIGENCIA_MS = 10 * 60 * 1000;

export function preflightVigente(report: PreflightReport | null): boolean {
  if (!report || !report.ok) return false;
  return Date.now() - new Date(report.checkedAt).getTime() < PREFLIGHT_VIGENCIA_MS;
}
