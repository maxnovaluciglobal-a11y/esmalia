/**
 * Ruteo de proveedores de IA por uso (clínico vs agenda), bloqueo de Vertex y
 * Gemini para lo clínico, y timeout (IA-07).
 *
 * Test puro: sin red y sin base. `fetch` es un espía; las claves son falsas.
 */
import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConfigIaError,
  IaPausadaError,
  PROVEEDORES_PERMITIDOS,
  TimeoutIaError,
  estadoProveedorIa,
  gatewayChat,
  limpiarJson,
  olvidarTokenVertex,
  proveedorParaUso,
  resolverProveedorIa,
} from "@/lib/ai-gateway.server";

const VARS = [
  "AI_ENABLED",
  "AI_PROVIDER_CLINICO",
  "AI_PROVIDER_AGENDA",
  "AI_TIMEOUT_MS",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "GOOGLE_VERTEX_CREDENTIALS",
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_VERTEX_LOCATION",
  "VERTEX_MODEL",
] as const;

let guardadas: Record<string, string | undefined> = {};
let fetchSpy: ReturnType<typeof vi.fn>;

type Llamada = [string, RequestInit];
const llamada = (i: number) => fetchSpy.mock.calls[i] as unknown as Llamada;

function respuestaAnthropic(texto: string) {
  return new Response(JSON.stringify({ content: [{ type: "text", text: texto }] }), {
    status: 200,
  });
}
function respuestaOpenAi(texto: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content: texto } }] }), {
    status: 200,
  });
}

async function credencialesVertexFalsas() {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const json = {
    client_email: "patty-test@proyecto-falso.iam.gserviceaccount.com",
    private_key: await exportPKCS8(privateKey),
    project_id: "proyecto-falso",
    token_uri: "https://oauth2.googleapis.com/token",
  };
  return Buffer.from(JSON.stringify(json)).toString("base64");
}

beforeEach(() => {
  guardadas = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  process.env.AI_ENABLED = "true";
  fetchSpy = vi.fn(async () => {
    throw new Error("fetch no esperado");
  });
  vi.stubGlobal("fetch", fetchSpy);
  olvidarTokenVertex();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of VARS) {
    if (guardadas[k] === undefined) delete process.env[k];
    else process.env[k] = guardadas[k];
  }
});

describe("qué proveedor atiende cada uso", () => {
  it("por defecto los dos usos van a anthropic", () => {
    expect(proveedorParaUso("clinico")).toBe("anthropic");
    expect(proveedorParaUso("agenda")).toBe("anthropic");
  });

  it("vertex no está permitido para lo clínico, sí para agenda", () => {
    expect(PROVEEDORES_PERMITIDOS.clinico).not.toContain("vertex");
    expect(PROVEEDORES_PERMITIDOS.agenda).toContain("vertex");
  });

  it.each(["vertex", "VERTEX", " gemini "])(
    "AI_PROVIDER_CLINICO=%j lanza ConfigIaError (§20(e) / términos de Gemini)",
    (valor) => {
      process.env.AI_PROVIDER_CLINICO = valor;
      expect(() => proveedorParaUso("clinico")).toThrow(ConfigIaError);
      process.env.ANTHROPIC_API_KEY = "k";
      expect(() => resolverProveedorIa("clinico")).toThrow(ConfigIaError);
    },
  );

  it("gemini (AI Studio) tampoco se acepta para agenda", () => {
    process.env.AI_PROVIDER_AGENDA = "gemini";
    expect(() => proveedorParaUso("agenda")).toThrow(/AI Studio/);
  });

  it("un proveedor desconocido lanza ConfigIaError", () => {
    process.env.AI_PROVIDER_AGENDA = "lovable";
    expect(() => proveedorParaUso("agenda")).toThrow(ConfigIaError);
  });

  it("clínico bloqueado: gatewayChat lanza sin hacer ningún fetch", async () => {
    process.env.AI_PROVIDER_CLINICO = "vertex";
    process.env.GOOGLE_VERTEX_CREDENTIALS = await credencialesVertexFalsas();
    await expect(gatewayChat({ uso: "clinico", system: "s", user: "u" })).rejects.toBeInstanceOf(
      ConfigIaError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("apagada: ni siquiera valida la configuración (IaPausadaError primero)", async () => {
    process.env.AI_ENABLED = "false";
    process.env.AI_PROVIDER_CLINICO = "vertex";
    expect(resolverProveedorIa("clinico")).toBeNull();
    await expect(gatewayChat({ uso: "clinico", system: "s", user: "u" })).rejects.toBeInstanceOf(
      IaPausadaError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sin la clave del proveedor elegido: null, y gatewayChat explica qué falta", async () => {
    process.env.OPENAI_API_KEY = "k"; // clave de OTRO proveedor: no se usa en silencio
    expect(resolverProveedorIa("clinico")).toBeNull();
    await expect(gatewayChat({ uso: "clinico", system: "s", user: "u" })).rejects.toThrow(
      /anthropic/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("estadoProveedorIa no lanza con configuración inválida", () => {
    process.env.AI_PROVIDER_CLINICO = "vertex";
    expect(estadoProveedorIa("clinico")).toMatchObject({ configurado: false });
  });
});

describe("request por proveedor", () => {
  it("anthropic: Messages API nativa con x-api-key, versión y modelo Haiku por defecto", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    fetchSpy.mockResolvedValueOnce(respuestaAnthropic("nota SOAP"));
    await expect(
      gatewayChat({ uso: "clinico", system: "sistema", user: "apuntes", json: true }),
    ).resolves.toBe("nota SOAP");

    const [url, init] = llamada(0);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-anthropic");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined();
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system).toBe("sistema");
    expect(body.messages).toEqual([{ role: "user", content: "apuntes" }]);
    expect(body.response_format).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("anthropic: junta solo los bloques de texto e ignora los de thinking", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "" },
            { type: "text", text: "uno " },
            { type: "text", text: "dos" },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(gatewayChat({ uso: "agenda", system: "s", user: "u" })).resolves.toBe("uno dos");
  });

  it("anthropic: un refusal se convierte en error, no en texto vacío", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ stop_reason: "refusal", content: [] }), { status: 200 }),
    );
    await expect(gatewayChat({ uso: "clinico", system: "s", user: "u" })).rejects.toThrow(
      /declinó/,
    );
  });

  it("openai: chat completions con Bearer y response_format cuando se pide JSON", async () => {
    process.env.AI_PROVIDER_CLINICO = "openai";
    process.env.OPENAI_API_KEY = "test-openai";
    fetchSpy.mockResolvedValueOnce(respuestaOpenAi("{}"));
    await gatewayChat({ uso: "clinico", system: "s", user: "u", json: true });
    const [url, init] = llamada(0);
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-openai");
    expect(JSON.parse(String(init.body)).response_format).toEqual({ type: "json_object" });
  });

  it("vertex (agenda): token por JWT bearer y endpoint regional en southamerica-east1", async () => {
    process.env.AI_PROVIDER_AGENDA = "vertex";
    process.env.GOOGLE_VERTEX_CREDENTIALS = await credencialesVertexFalsas();
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-vertex", expires_in: 3600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(respuestaOpenAi('{"intencion":null}'))
      .mockResolvedValueOnce(respuestaOpenAi('{"intencion":null}'));

    await gatewayChat({ uso: "agenda", system: "s", user: "u", json: true });
    const [tokenUrl, tokenInit] = llamada(0);
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(tokenInit.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);

    const [url, init] = llamada(1);
    expect(url).toBe(
      "https://southamerica-east1-aiplatform.googleapis.com/v1/projects/proyecto-falso" +
        "/locations/southamerica-east1/endpoints/openapi/chat/completions",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-vertex");
    expect(JSON.parse(String(init.body)).model).toBe("google/gemini-2.5-flash");

    // Segunda llamada: reutiliza el token cacheado (no vuelve a pedirlo).
    await gatewayChat({ uso: "agenda", system: "s", user: "u" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(llamada(2)[0]).toContain("aiplatform.googleapis.com");
  });

  it("vertex: credenciales que no son JSON base64 dan ConfigIaError", () => {
    process.env.AI_PROVIDER_AGENDA = "vertex";
    process.env.GOOGLE_VERTEX_CREDENTIALS = "no-es-json";
    expect(() => resolverProveedorIa("agenda")).toThrow(ConfigIaError);
  });
});

describe("timeout (IA-07)", () => {
  it("corta la llamada con AbortController y lanza TimeoutIaError", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.AI_TIMEOUT_MS = "30";
    fetchSpy.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(gatewayChat({ uso: "clinico", system: "s", user: "u" })).rejects.toBeInstanceOf(
      TimeoutIaError,
    );
  });

  it("un error de red que no es timeout se propaga tal cual", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(gatewayChat({ uso: "clinico", system: "s", user: "u" })).rejects.toThrow(
      "fetch failed",
    );
  });
});

describe("limpiarJson", () => {
  it("quita cercos de Markdown alrededor del JSON", () => {
    expect(limpiarJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(limpiarJson('  {"a":1} ')).toBe('{"a":1}');
  });
});
