// Test puro (fetch simulado, sin red ni base): Numverify solo por HTTPS y
// la clave nunca en los logs (OPS-03 / LEG-02).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validatePhoneNumber } from "@/lib/patients/phoneValidation";

const CLAVE = "clave-de-prueba-123";

describe("validatePhoneNumber", () => {
  const envOriginal = process.env.NUMVERIFY_API_KEY;
  let errores: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.NUMVERIFY_API_KEY = CLAVE;
    errores = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    errores.mockRestore();
    if (envOriginal === undefined) delete process.env.NUMVERIFY_API_KEY;
    else process.env.NUMVERIFY_API_KEY = envOriginal;
  });

  function logs(): string {
    return errores.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
  }

  it("llama a Numverify por HTTPS, nunca por HTTP", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ valid: true })));
    vi.stubGlobal("fetch", fetchMock);

    expect(await validatePhoneNumber("+56912345678")).toBe(true);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url.startsWith("https://apilayer.net/api/validate?")).toBe(true);
    expect(url).not.toMatch(/^http:/);
  });

  it("si apilayer rechaza HTTPS devuelve null y no reintenta por HTTP", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 105, type: "https_access_restricted", info: "..." },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await validatePhoneNumber("+56912345678")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs()).toContain("https_access_restricted");
    expect(logs()).not.toContain(CLAVE);
  });

  it("un error de red no deja la clave en el log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        throw new Error(`fetch failed for ${url}`);
      }),
    );

    expect(await validatePhoneNumber("+56912345678")).toBeNull();
    expect(logs()).not.toContain(CLAVE);
    expect(logs()).not.toContain("912345678");
  });

  it("sin clave no llama a nadie", async () => {
    delete process.env.NUMVERIFY_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await validatePhoneNumber("+56912345678")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
