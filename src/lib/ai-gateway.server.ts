/**
 * Capa de IA del servidor.
 *
 * ⛔ Interruptor general: `AI_ENABLED`. Patty está PAUSADA (auditoría 360,
 * IA-01/IA-03, docs/IA.md) y solo se llama a un modelo si `AI_ENABLED` vale
 * exactamente "true". Sin definir, vacía o con cualquier otro valor = apagada:
 * `gatewayChat` lanza `IaPausadaError` sin hacer ningún fetch, y
 * `resolverProveedorIa()` devuelve null aunque haya claves cargadas.
 *
 * Ruteo por USO (cada uso tiene su propio proveedor, porque los términos de
 * cada proveedor no permiten lo mismo):
 *
 *   - "clinico": redactar/resumir notas SOAP y extraer entidades clínicas
 *     (`clinical-notes.functions.ts`). Proveedor en `AI_PROVIDER_CLINICO`.
 *   - "agenda":  leer la intención de agenda de un WhatsApp
 *     (`intencion-de-agenda-ia.ts`). Proveedor en `AI_PROVIDER_AGENDA`.
 *
 * Proveedores:
 *
 *   - "anthropic" (por defecto en los dos usos): Claude API, Messages API
 *     nativa, `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, por defecto
 *     `claude-haiku-5-5`). Se usa la API nativa y no la capa compatible con
 *     OpenAI porque Anthropic documenta esa capa como pensada para pruebas,
 *     no para producción.
 *   - "vertex": Vertex AI (Google Cloud), endpoint compatible con OpenAI en
 *     `GOOGLE_VERTEX_LOCATION` (por defecto `southamerica-east1`), con una
 *     cuenta de servicio en `GOOGLE_VERTEX_CREDENTIALS` (JSON en base64).
 *     SOLO para "agenda": los Service Specific Terms de Google Cloud §20(e)
 *     prohíben usar sus servicios de IA generativa "for clinical purposes".
 *   - "openai": OpenAI, `OPENAI_API_KEY`.
 *
 * La API de Gemini de AI Studio ("gemini") ya no existe como proveedor: sus
 * términos excluyen la práctica clínica y el nivel gratuito entrena con los
 * datos (IA-01, IA-03). Configurarla da `ConfigIaError`.
 *
 * Todo texto de usuario pasa por `redactarPii` antes de salir (IA-02), y toda
 * llamada tiene timeout (IA-07, `AI_TIMEOUT_MS`, 20 s por defecto).
 */

import { SignJWT, importPKCS8 } from "jose";

import { redactarPii, type IdentificadoresConocidos } from "@/lib/ai/minimizacion";
import { MENSAJE_IA_PAUSADA } from "@/lib/ai/estado";

/** Error tipado: la IA está apagada por el interruptor `AI_ENABLED`. */
export class IaPausadaError extends Error {
  readonly code = "AI_DISABLED" as const;
  constructor() {
    super(MENSAJE_IA_PAUSADA);
    this.name = "IaPausadaError";
  }
}

/** Error tipado: la configuración de proveedores no está permitida o está incompleta. */
export class ConfigIaError extends Error {
  readonly code = "AI_CONFIG" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConfigIaError";
  }
}

/** Error tipado: el proveedor no respondió dentro del timeout (IA-07). */
export class TimeoutIaError extends Error {
  readonly code = "AI_TIMEOUT" as const;
  constructor(ms: number) {
    super(`La IA no respondió en ${Math.round(ms / 1000)} segundos. Intenta nuevamente.`);
    this.name = "TimeoutIaError";
  }
}

/** `true` solo si `AI_ENABLED` es exactamente "true" (se lee en runtime). */
export function iaHabilitada(): boolean {
  return process.env.AI_ENABLED?.trim().toLowerCase() === "true";
}

export type UsoIa = "clinico" | "agenda";
export type AiProvider = "anthropic" | "vertex" | "openai";

const PROVEEDORES: readonly AiProvider[] = ["anthropic", "vertex", "openai"];

/** Qué proveedor puede atender cada uso. Vertex queda fuera de lo clínico (§20(e)). */
export const PROVEEDORES_PERMITIDOS: Record<UsoIa, readonly AiProvider[]> = {
  clinico: ["anthropic", "openai"],
  agenda: ["anthropic", "vertex", "openai"],
};

const ENV_PROVEEDOR: Record<UsoIa, string> = {
  clinico: "AI_PROVIDER_CLINICO",
  agenda: "AI_PROVIDER_AGENDA",
};

const PROVEEDOR_POR_DEFECTO: Record<UsoIa, AiProvider> = {
  clinico: "anthropic",
  agenda: "anthropic",
};

const MODELO_POR_DEFECTO: Record<AiProvider, string> = {
  anthropic: "claude-haiku-5-5",
  vertex: "google/gemini-2.5-flash",
  openai: "gpt-4o-mini",
};

const UBICACION_VERTEX_POR_DEFECTO = "southamerica-east1";
const TIMEOUT_POR_DEFECTO_MS = 20_000;

type CredencialesVertex = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

export type ProviderConfig =
  | {
      provider: "anthropic";
      uso: UsoIa;
      url: string;
      model: string;
      apiKey: string;
    }
  | {
      provider: "openai";
      uso: UsoIa;
      url: string;
      model: string;
      apiKey: string;
    }
  | {
      provider: "vertex";
      uso: UsoIa;
      url: string;
      model: string;
      credenciales: CredencialesVertex;
    };

/** Lee el proveedor configurado para un uso y valida que esté permitido. Lanza `ConfigIaError`. */
export function proveedorParaUso(uso: UsoIa): AiProvider {
  const variable = ENV_PROVEEDOR[uso];
  const crudo = process.env[variable]?.trim().toLowerCase();
  const elegido = crudo ? crudo : PROVEEDOR_POR_DEFECTO[uso];

  if (elegido === "gemini") {
    throw new ConfigIaError(
      `${variable}=gemini no está permitido: la API de Gemini de AI Studio excluye la práctica ` +
        "clínica en sus términos. Para agenda usa vertex; para uso clínico, anthropic (docs/IA.md).",
    );
  }
  if (!PROVEEDORES.includes(elegido as AiProvider)) {
    throw new ConfigIaError(
      `${variable}="${elegido}" no es un proveedor conocido (anthropic | vertex | openai).`,
    );
  }
  const proveedor = elegido as AiProvider;
  if (!PROVEEDORES_PERMITIDOS[uso].includes(proveedor)) {
    throw new ConfigIaError(
      `${variable}=${proveedor} no está permitido para uso clínico: los términos de Google Cloud ` +
        "(Service Specific Terms §20(e)) prohíben usar su IA generativa con fines clínicos. " +
        "Usa anthropic (docs/IA.md).",
    );
  }
  return proveedor;
}

function decodificarCredencialesVertex(base64: string): CredencialesVertex {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    throw new ConfigIaError(
      "GOOGLE_VERTEX_CREDENTIALS no es un JSON de cuenta de servicio en base64.",
    );
  }
  const c = json as Partial<CredencialesVertex>;
  if (!c.client_email || !c.private_key) {
    throw new ConfigIaError("GOOGLE_VERTEX_CREDENTIALS no trae client_email y private_key.");
  }
  return c as CredencialesVertex;
}

/**
 * Proveedor para un uso, según las variables de entorno (se leen en runtime).
 * `null` si la IA está apagada o si falta la clave del proveedor elegido.
 * Lanza `ConfigIaError` si el proveedor elegido no está permitido para ese uso.
 */
export function resolverProveedorIa(uso: UsoIa, modelSolicitado?: string): ProviderConfig | null {
  if (!iaHabilitada()) return null;
  const provider = proveedorParaUso(uso);

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return {
      provider,
      uso,
      apiKey,
      url: "https://api.anthropic.com/v1/messages",
      model: modelSolicitado ?? process.env.ANTHROPIC_MODEL ?? MODELO_POR_DEFECTO.anthropic,
    };
  }

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    return {
      provider,
      uso,
      apiKey,
      url: "https://api.openai.com/v1/chat/completions",
      model: modelSolicitado ?? process.env.OPENAI_MODEL ?? MODELO_POR_DEFECTO.openai,
    };
  }

  // vertex (solo agenda: proveedorParaUso ya bloqueó el uso clínico)
  const crudo = process.env.GOOGLE_VERTEX_CREDENTIALS;
  if (!crudo) return null;
  const credenciales = decodificarCredencialesVertex(crudo);
  const proyecto = process.env.GOOGLE_VERTEX_PROJECT ?? credenciales.project_id;
  if (!proyecto) {
    throw new ConfigIaError("Falta GOOGLE_VERTEX_PROJECT (o project_id en las credenciales).");
  }
  const ubicacion = process.env.GOOGLE_VERTEX_LOCATION ?? UBICACION_VERTEX_POR_DEFECTO;
  return {
    provider,
    uso,
    credenciales,
    url:
      `https://${ubicacion}-aiplatform.googleapis.com/v1/projects/${proyecto}` +
      `/locations/${ubicacion}/endpoints/openapi/chat/completions`,
    model: modelSolicitado ?? process.env.VERTEX_MODEL ?? MODELO_POR_DEFECTO.vertex,
  };
}

/** Diagnóstico legible para la UI/configuración, sin exponer valores de claves. */
export function estadoProveedorIa(uso: UsoIa) {
  const habilitada = iaHabilitada();
  try {
    const cfg = resolverProveedorIa(uso);
    return cfg
      ? { habilitada, configurado: true as const, provider: cfg.provider, model: cfg.model }
      : { habilitada, configurado: false as const, provider: null, model: null };
  } catch {
    return { habilitada, configurado: false as const, provider: null, model: null };
  }
}

/** Milisegundos de timeout por llamada (IA-07). */
export function timeoutIaMs(): number {
  const n = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : TIMEOUT_POR_DEFECTO_MS;
}

/** `fetch` con corte por AbortController; el timeout se convierte en `TimeoutIaError`. */
async function fetchConTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new TimeoutIaError(ms);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Vertex: token de acceso desde la cuenta de servicio (JWT bearer) ──────

let tokenVertexEnCache: { token: string; venceEn: number; email: string } | null = null;

/** Solo para tests: olvida el token cacheado. */
export function olvidarTokenVertex() {
  tokenVertexEnCache = null;
}

async function tokenDeAccesoVertex(c: CredencialesVertex, ms: number): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  if (
    tokenVertexEnCache &&
    tokenVertexEnCache.email === c.client_email &&
    tokenVertexEnCache.venceEn - 60 > ahora
  ) {
    return tokenVertexEnCache.token;
  }
  const tokenUri = c.token_uri ?? "https://oauth2.googleapis.com/token";
  const clave = await importPKCS8(c.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(c.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + 3600)
    .sign(clave);

  const res = await fetchConTimeout(
    tokenUri,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    },
    ms,
  );
  if (!res.ok) {
    console.error("Vertex token error", res.status);
    throw new Error("La cuenta de servicio de Vertex AI fue rechazada. Revisa las credenciales.");
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Vertex AI no devolvió un token de acceso.");
  tokenVertexEnCache = {
    token: json.access_token,
    venceEn: ahora + (json.expires_in ?? 3600),
    email: c.client_email,
  };
  return json.access_token;
}

// ─── Armado del request por proveedor ─────────────────────────────────────

async function armarRequest(
  cfg: ProviderConfig,
  system: string,
  user: string,
  json: boolean,
  ms: number,
): Promise<RequestInit> {
  if (cfg.provider === "anthropic") {
    // Messages API nativa. `response_format` no existe acá: el JSON lo pide el
    // prompt y lo valida quien llama.
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 8192,
        // Tareas cortas y acotadas: esfuerzo bajo para no pasar el timeout.
        output_config: { effort: "low" },
        system,
        messages: [{ role: "user", content: user }],
      }),
    };
  }

  const bearer =
    cfg.provider === "vertex" ? await tokenDeAccesoVertex(cfg.credenciales, ms) : cfg.apiKey;
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({
      model: cfg.model,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  };
}

function textoDeLaRespuesta(cfg: ProviderConfig, body: unknown): string | undefined {
  if (cfg.provider === "anthropic") {
    const b = body as {
      stop_reason?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    if (b.stop_reason === "refusal") {
      throw new Error("La IA declinó procesar este texto.");
    }
    return (b.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("")
      .trim();
  }
  const b = body as { choices?: Array<{ message?: { content?: string } }> };
  return b.choices?.[0]?.message?.content?.trim();
}

/** Llamada mínima de chat, ruteada por uso. */
export async function gatewayChat(options: {
  uso: UsoIa;
  system: string;
  user: string;
  model?: string;
  json?: boolean;
  /** Datos conocidos del paciente a quitar del texto (además de los patrones genéricos). */
  identificadores?: IdentificadoresConocidos;
}): Promise<string> {
  // El interruptor va primero: apagada, no se resuelve proveedor ni se arma request.
  if (!iaHabilitada()) throw new IaPausadaError();
  const cfg = resolverProveedorIa(options.uso, options.model);
  if (!cfg) {
    throw new ConfigIaError(
      `No hay IA configurada para el uso "${options.uso}": falta la clave del proveedor ` +
        `(${proveedorParaUso(options.uso)}).`,
    );
  }

  // TODO(IA-06): cupo diario por clínica antes de llamar (ver docs/IA.md).
  const ms = timeoutIaMs();
  const user = redactarPii(options.user, options.identificadores);
  const init = await armarRequest(cfg, options.system, user, Boolean(options.json), ms);
  const res = await fetchConTimeout(cfg.url, init, ms);

  if (res.status === 401 || res.status === 403) {
    console.error("AI auth error", cfg.provider, res.status);
    throw new Error(
      `La clave de IA de ${cfg.provider} fue rechazada. Revisa la variable de entorno correspondiente.`,
    );
  }
  if (res.status === 429) {
    throw new Error("La IA está recibiendo muchas solicitudes. Intenta en unos segundos.");
  }
  if (res.status === 402) {
    throw new Error("Tu cuenta del proveedor de IA no tiene saldo disponible.");
  }
  if (!res.ok) {
    const detail = await res.text();
    console.error("AI provider error", cfg.provider, res.status, detail.slice(0, 500));
    throw new Error("No pudimos generar el texto con IA en este momento.");
  }

  const text = textoDeLaRespuesta(cfg, await res.json());
  if (!text) throw new Error("La IA devolvió una respuesta vacía.");
  return text;
}

/** Quita cercos de Markdown (```json … ```) que algunos modelos agregan alrededor del JSON. */
export function limpiarJson(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}
