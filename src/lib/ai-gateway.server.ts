/**
 * Capa de IA del servidor.
 *
 * ⛔ Interruptor general: `AI_ENABLED`. Patty está PAUSADA (auditoría 360,
 * IA-01/IA-03, docs/IA.md) y solo se llama a un modelo si `AI_ENABLED` vale
 * exactamente "true". Sin definir, vacía o con cualquier otro valor = apagada:
 * `gatewayChat` lanza `IaPausadaError` sin hacer ningún fetch, y
 * `resolverProveedorIa()` devuelve null aunque haya claves cargadas.
 *
 * Con el interruptor prendido, requiere una API key propia:
 *
 *   1. GEMINI_API_KEY   → Google AI (endpoint compatible con OpenAI)
 *   2. OPENAI_API_KEY   → OpenAI
 *
 * Se puede forzar el proveedor con AI_PROVIDER=gemini|openai y el modelo con
 * AI_MODEL (o GEMINI_MODEL / OPENAI_MODEL).
 *
 * Todo texto de usuario pasa por `redactarPii` antes de salir (IA-02).
 */

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

/** `true` solo si `AI_ENABLED` es exactamente "true" (se lee en runtime). */
export function iaHabilitada(): boolean {
  return process.env.AI_ENABLED?.trim().toLowerCase() === "true";
}

export type AiProvider = "gemini" | "openai";

type ProviderConfig = {
  provider: AiProvider;
  apiKey: string;
  url: string;
  headers: Record<string, string>;
  model: string;
};

const DEFAULTS: Record<AiProvider, string> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
};

/** Normaliza un id con prefijo de vendor (`vendor/modelo`) a un modelo directo. */
function sinPrefijo(model: string) {
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

/** Proveedor disponible según las variables de entorno (se lee en runtime). */
export function resolverProveedorIa(modelSolicitado?: string): ProviderConfig | null {
  if (!iaHabilitada()) return null;
  const forzado = process.env.AI_PROVIDER as AiProvider | undefined;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const modelEnv = process.env.AI_MODEL;

  const usar = (p: AiProvider): ProviderConfig | null => {
    if (p === "gemini" && geminiKey) {
      return {
        provider: "gemini",
        apiKey: geminiKey,
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        headers: { Authorization: `Bearer ${geminiKey}` },
        model: sinPrefijo(
          process.env.GEMINI_MODEL ?? modelEnv ?? modelSolicitado ?? DEFAULTS.gemini,
        ),
      };
    }
    if (p === "openai" && openaiKey) {
      return {
        provider: "openai",
        apiKey: openaiKey,
        url: "https://api.openai.com/v1/chat/completions",
        headers: { Authorization: `Bearer ${openaiKey}` },
        model: sinPrefijo(process.env.OPENAI_MODEL ?? modelEnv ?? DEFAULTS.openai),
      };
    }
    return null;
  };

  if (forzado) return usar(forzado);
  return usar("gemini") ?? usar("openai");
}

/** Diagnóstico legible para la UI/configuración, sin exponer valores de claves. */
export function estadoProveedorIa() {
  const habilitada = iaHabilitada();
  const cfg = resolverProveedorIa();
  return cfg
    ? { habilitada, configurado: true as const, provider: cfg.provider, model: cfg.model }
    : { habilitada, configurado: false as const, provider: null, model: null };
}

/** Llamada mínima de chat completions, agnóstica del proveedor. */
export async function gatewayChat(options: {
  system: string;
  user: string;
  model?: string;
  json?: boolean;
  /** Datos conocidos del paciente a quitar del texto (además de los patrones genéricos). */
  identificadores?: IdentificadoresConocidos;
}): Promise<string> {
  // El interruptor va primero: apagada, no se resuelve proveedor ni se arma request.
  if (!iaHabilitada()) throw new IaPausadaError();
  const cfg = resolverProveedorIa(options.model);
  if (!cfg) {
    throw new Error("No hay IA configurada. Define GEMINI_API_KEY o OPENAI_API_KEY.");
  }

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...cfg.headers,
    },
    body: JSON.stringify({
      model: cfg.model,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: redactarPii(options.user, options.identificadores) },
      ],
    }),
  });

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
    console.error("AI provider error", cfg.provider, res.status, detail);
    throw new Error("No pudimos generar el texto con IA en este momento.");
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("La IA devolvió una respuesta vacía.");
  return text;
}
