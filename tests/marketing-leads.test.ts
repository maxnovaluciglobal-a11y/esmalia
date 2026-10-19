import { describe, expect, it } from "vitest";
import { CODIGO_PAIS_TELEFONO, hashIp, normalizarTelefonoPorPais } from "@/lib/marketing/leads";

describe("normalizarTelefonoPorPais", () => {
  it("usa el código del país elegido, no el de Chile por defecto", () => {
    // Antes normalizeToWaMe tenía "56" fijo como país por defecto. Un dentista
    // mexicano que escribe su número local no puede terminar con prefijo chileno.
    // Números que comienzan con dígitos no-código (6, 7, 8, 9) son claramente locales.
    expect(normalizarTelefonoPorPais("8912345678", "MX")).toBe("528912345678");
    expect(normalizarTelefonoPorPais("912345678", "CL")).toBe("56912345678");
  });

  it("respeta un número que ya viene con código de país", () => {
    expect(normalizarTelefonoPorPais("+56912345678", "MX")).toBe("56912345678");
  });

  it("devuelve null si el número no es utilizable", () => {
    expect(normalizarTelefonoPorPais("", "CL")).toBeNull();
    expect(normalizarTelefonoPorPais("abc", "CL")).toBeNull();
    expect(normalizarTelefonoPorPais("123", "CL")).toBeNull();
  });

  it("cubre los cinco países soportados", () => {
    expect(Object.keys(CODIGO_PAIS_TELEFONO).sort()).toEqual(["AR", "CL", "CO", "MX", "PE"]);
  });
});

describe("hashIp", () => {
  it("es determinista con la misma sal", async () => {
    const a = await hashIp("203.0.113.7", "sal");
    const b = await hashIp("203.0.113.7", "sal");
    expect(a).toBe(b);
  });

  it("no deja la IP legible en el resultado", async () => {
    const h = await hashIp("203.0.113.7", "sal");
    expect(h).not.toContain("203.0.113.7");
    expect(h).toHaveLength(64);
  });

  it("distingue IPs distintas", async () => {
    expect(await hashIp("203.0.113.7", "sal")).not.toBe(await hashIp("203.0.113.8", "sal"));
  });
});
