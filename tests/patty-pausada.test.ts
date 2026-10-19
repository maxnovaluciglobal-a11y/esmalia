/**
 * Patty pausada (auditoría 360: IA-01..IA-04, LEG-01, SEG-04).
 *
 * Test puro: sin red y sin base. `fetch` se reemplaza por un espía; si algo
 * intentara llamar a Gemini/OpenAI con el interruptor apagado, el espía lo
 * registra y el test falla.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IaPausadaError,
  gatewayChat,
  iaHabilitada,
  resolverProveedorIa,
} from "@/lib/ai-gateway.server";
import { CODIGO_IA_PAUSADA, MENSAJE_IA_PAUSADA, esErrorIaPausada } from "@/lib/ai/estado";
import { construirContextoPaciente, rangoEtario, redactarPii } from "@/lib/ai/minimizacion";
import {
  ROTULO_IA_SIN_VALIDAR,
  esSugerenciaIaSinValidar,
  lineaEntidadPdf,
} from "@/lib/clinical/note-pdf";
import type { ClinicalNoteEntity } from "@/lib/clinical/clinical-notes";
import { interpretarConIA } from "@/lib/messaging/intencion-de-agenda-ia";

const VARS = ["AI_ENABLED", "GEMINI_API_KEY", "OPENAI_API_KEY", "AI_PROVIDER"] as const;
let guardadas: Record<string, string | undefined> = {};
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  guardadas = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  // Claves falsas cargadas: el interruptor tiene que frenar AUNQUE haya claves.
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  fetchSpy = vi.fn(async () => {
    throw new Error("fetch no debería llamarse en este test");
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of VARS) {
    if (guardadas[k] === undefined) delete process.env[k];
    else process.env[k] = guardadas[k];
  }
});

describe("interruptor AI_ENABLED", () => {
  it.each([undefined, "", "false", "0", "1", "yes", "TRUE "])(
    "AI_ENABLED=%j deja a Patty apagada salvo 'true' exacto",
    (valor) => {
      if (valor === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = valor;
      // "TRUE " (con espacio y mayúsculas) se normaliza: es la única excepción tolerada.
      expect(iaHabilitada()).toBe(valor === "TRUE ");
    },
  );

  it("sin definir: gatewayChat lanza IaPausadaError y no hace ningún fetch", async () => {
    const promesa = gatewayChat({ system: "s", user: "u" });
    await expect(promesa).rejects.toBeInstanceOf(IaPausadaError);
    await expect(gatewayChat({ system: "s", user: "u" })).rejects.toMatchObject({
      code: CODIGO_IA_PAUSADA,
      message: MENSAJE_IA_PAUSADA,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("apagada: resolverProveedorIa devuelve null aunque haya claves", () => {
    process.env.AI_ENABLED = "false";
    expect(resolverProveedorIa()).toBeNull();
  });

  it("apagada: la lectura de WhatsApp devuelve null sin llamar al modelo", async () => {
    const r = await interpretarConIA("hola, ¿me pueden mover la hora al martes?", new Date());
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("el error se reconoce aunque llegue serializado (solo el mensaje)", () => {
    expect(esErrorIaPausada(new IaPausadaError())).toBe(true);
    expect(esErrorIaPausada({ message: MENSAJE_IA_PAUSADA })).toBe(true);
    expect(esErrorIaPausada(new Error("otra cosa"))).toBe(false);
  });

  it("prendida: recién ahí sale el request (con fetch simulado)", async () => {
    process.env.AI_ENABLED = "true";
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
      }),
    );
    await expect(gatewayChat({ system: "s", user: "u" })).resolves.toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("minimización: ninguna PII directa sale hacia el modelo", () => {
  const paciente = {
    nombre: "María José Pérez Soto",
    documento: "12.345.678-5",
    telefono: "+56 9 8765 4321",
    email: "maria.perez@correo.cl",
    edad: 47,
    etiquetas: ["bruxismo"],
    ultimaVisita: "12 oct 2026",
    timeline: [{ fecha: "2026-10-12", titulo: "Control", detalle: "sensibilidad 36" }],
  };

  it("el contexto no lleva nombre ni edad exacta, sí el tramo etario", () => {
    const ctx = construirContextoPaciente(paciente);
    expect(ctx).not.toContain("María");
    expect(ctx).not.toContain("Pérez");
    expect(ctx).not.toMatch(/\b47\b/);
    expect(ctx).toContain("40-49 años");
    expect(ctx).toContain("bruxismo");
    expect(ctx).toContain("2026-10-12"); // las fechas clínicas se conservan
  });

  it("rangoEtario: tramos de 10, menores y sin dato", () => {
    expect(rangoEtario(47)).toBe("40-49 años");
    expect(rangoEtario(30)).toBe("30-39 años");
    expect(rangoEtario(9)).toBe("menor de 18 años");
    expect(rangoEtario(85)).toBe("80 años o más");
    expect(rangoEtario(0)).toBeNull(); // 0 = sin fecha de nacimiento
    expect(rangoEtario(null)).toBeNull();
  });

  it("redactarPii quita nombre, RUT, teléfono y email, y deja las fechas", () => {
    const texto =
      "María refiere dolor. Pérez Soto, RUT 12.345.678-5, tel +56 9 8765 4321, " +
      "mail maria.perez@correo.cl. Control 2026-10-20 y 15/11/2026, pieza 36.";
    const limpio = redactarPii(texto, {
      nombres: [paciente.nombre],
      valores: [paciente.documento, paciente.telefono, paciente.email],
    });
    for (const pii of ["María", "Pérez", "Soto", "12.345.678-5", "8765", "maria.perez", "@"]) {
      expect(limpio).not.toContain(pii);
    }
    expect(limpio).toContain("2026-10-20");
    expect(limpio).toContain("15/11/2026");
    expect(limpio).toContain("pieza 36");
  });

  it("sin datos conocidos, los patrones genéricos igual atrapan PII escrita a mano", () => {
    const limpio = redactarPii(
      "Escríbanme al 987654321 o a juan@ejemplo.com, mi RUT es 9.876.543-K. CURP GODE561231HDFRRN09",
    );
    expect(limpio).not.toMatch(/987654321|juan@ejemplo\.com|9\.876\.543-K|GODE561231/);
  });

  it("gatewayChat (prendida) manda el texto ya redactado: el payload no lleva PII", async () => {
    process.env.AI_ENABLED = "true";
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
      }),
    );
    await gatewayChat({
      system: "sistema",
      user: `Contexto del paciente:\n${construirContextoPaciente(paciente)}\n\nApuntes:\nMaría José Pérez Soto, tel ${paciente.telefono}, ${paciente.email}, RUT ${paciente.documento}. Dolor 36.`,
      identificadores: {
        nombres: [paciente.nombre],
        valores: [paciente.documento, paciente.telefono, paciente.email],
      },
    });
    const body = String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    for (const pii of ["María", "Pérez", "12.345.678-5", "8765 4321", "maria.perez", "47 años"]) {
      expect(body).not.toContain(pii);
    }
    expect(body).toContain("Dolor 36");
  });

  it("guardia: notas-clinicas.tsx no arma el contexto con el nombre ni la edad exacta", () => {
    const fuente = readFileSync(
      path.resolve(__dirname, "../src/components/notas-clinicas.tsx"),
      "utf8",
    );
    const inicio = fuente.indexOf("const contextoPaciente");
    expect(inicio).toBeGreaterThan(-1);
    const bloque = fuente.slice(inicio, fuente.indexOf(");", inicio));
    expect(bloque).toContain("construirContextoPaciente");
    expect(bloque).not.toMatch(/paciente\.(nombre|documento|telefono|email)/);
    expect(fuente).not.toMatch(/Paciente: \$\{paciente\.nombre\}/);
  });
});

describe("PDF clínico: lo que propuso la IA y nadie validó se rotula", () => {
  const base: ClinicalNoteEntity = {
    id: "e1",
    noteId: "n1",
    kind: "allergy",
    term: "Penicilina",
    code: null,
    tooth: null,
    quantity: null,
    dosage: null,
    severity: "severa",
    status: null,
    notes: null,
    confidence: 0.6,
    aiGenerated: true,
    confirmed: false,
    createdAt: "2026-10-19T00:00:00Z",
  };

  it("IA sin validar: lleva el rótulo", () => {
    expect(esSugerenciaIaSinValidar(base)).toBe(true);
    expect(lineaEntidadPdf(base)).toBe(`• Penicilina (severa · ${ROTULO_IA_SIN_VALIDAR})`);
  });

  it("IA validada por el profesional: 'validado', sin rótulo de IA", () => {
    const linea = lineaEntidadPdf({ ...base, confirmed: true });
    expect(linea).toContain("validado");
    expect(linea).not.toContain(ROTULO_IA_SIN_VALIDAR);
  });

  it("cargada a mano: sin rótulo", () => {
    expect(lineaEntidadPdf({ ...base, aiGenerated: false })).not.toContain(ROTULO_IA_SIN_VALIDAR);
  });
});
