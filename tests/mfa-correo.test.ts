import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  correoCodigoMfa,
  enmascararCorreo,
  huellaCodigoMfaCorreo,
  metodosDisponibles,
  motivoCorreoNoDisponible,
  resumenAlEntrar,
  sessionIdDeToken,
} from "@/lib/auth/mfa-correo";
import { ESCRITURA_EXENTA } from "@/lib/solo-lectura";

// SEG-01, código por correo: lógica pura (la de la base está en
// `mfa-correo-db.test.ts`).

const U = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const S2 = "33333333-3333-4333-8333-333333333333";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.firma`;
}

describe("huella del código", () => {
  it("es sha256 hex y depende de usuario, sesión y código", async () => {
    const h = await huellaCodigoMfaCorreo(U, S1, "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("123456");
    expect(await huellaCodigoMfaCorreo(U, S1, "123456")).toBe(h);
    expect(await huellaCodigoMfaCorreo(U, S2, "123456")).not.toBe(h);
    expect(await huellaCodigoMfaCorreo(S2, S1, "123456")).not.toBe(h);
    expect(await huellaCodigoMfaCorreo(U, S1, "123457")).not.toBe(h);
  });
});

describe("enmascararCorreo", () => {
  it("deja ver solo el comienzo y el dominio", () => {
    expect(enmascararCorreo("walter@gmail.com")).toBe("wa•••@gmail.com");
    expect(enmascararCorreo("ab@x.cl")).toBe("a•••@x.cl");
    expect(enmascararCorreo("sin-arroba")).toBeNull();
    expect(enmascararCorreo(null)).toBeNull();
  });
});

describe("motivoCorreoNoDisponible", () => {
  const base = {
    envioConfigurado: true,
    email: "dra@clinica.cl",
    emailConfirmado: true,
    esDemo: false,
  };
  it("disponible con envío configurado y correo real confirmado", () => {
    expect(motivoCorreoNoDisponible(base)).toBeNull();
  });
  it("explica cada caso en que no se ofrece", () => {
    expect(motivoCorreoNoDisponible({ ...base, esDemo: true })).toBe("demo");
    expect(motivoCorreoNoDisponible({ ...base, envioConfigurado: false })).toBe("sin_configurar");
    expect(motivoCorreoNoDisponible({ ...base, email: "" })).toBe("sin_correo");
    expect(motivoCorreoNoDisponible({ ...base, emailConfirmado: false })).toBe(
      "correo_sin_confirmar",
    );
    expect(motivoCorreoNoDisponible({ ...base, email: "x@example.com" })).toBe("correo_reservado");
    expect(motivoCorreoNoDisponible({ ...base, email: "x@clinica.test" })).toBe("correo_reservado");
  });
});

describe("métodos al entrar", () => {
  it("ofrece primero el preferido", () => {
    expect(
      metodosDisponibles({ tieneTotp: true, correoActivo: true, metodoPreferido: "email" }),
    ).toEqual(["email", "totp"]);
    expect(
      metodosDisponibles({ tieneTotp: true, correoActivo: true, metodoPreferido: "totp" }),
    ).toEqual(["totp", "email"]);
    expect(
      metodosDisponibles({ tieneTotp: false, correoActivo: true, metodoPreferido: "totp" }),
    ).toEqual(["email"]);
    expect(
      metodosDisponibles({ tieneTotp: false, correoActivo: false, metodoPreferido: "totp" }),
    ).toEqual([]);
  });

  it("el resumen dice qué se pide y a dónde llega el correo", () => {
    const correo = "wa•••@gmail.com";
    expect(
      resumenAlEntrar({ tieneTotp: false, correoActivo: false, metodoPreferido: "totp" }, correo),
    ).toBe("Al entrar te pedimos solo tu contraseña.");
    expect(
      resumenAlEntrar({ tieneTotp: false, correoActivo: true, metodoPreferido: "email" }, correo),
    ).toContain(correo);
    const ambos = resumenAlEntrar(
      { tieneTotp: true, correoActivo: true, metodoPreferido: "totp" },
      correo,
    );
    expect(ambos.indexOf("app autenticadora")).toBeLessThan(ambos.indexOf(correo));
  });
});

describe("sessionIdDeToken", () => {
  it("lee el session_id del payload y descarta lo que no es uuid", () => {
    expect(sessionIdDeToken(jwt({ session_id: S1 }))).toBe(S1);
    expect(sessionIdDeToken(jwt({ session_id: "otra-cosa" }))).toBeNull();
    expect(sessionIdDeToken("no.es.jwt")).toBeNull();
    expect(sessionIdDeToken(null)).toBeNull();
  });
});

describe("correo con el código", () => {
  it("lleva el código, la vigencia y el aviso de no compartirlo", () => {
    const c = correoCodigoMfa({
      appUrl: "https://esmalia.com",
      codigo: "123456",
      proposito: "login",
    });
    expect(c.subject).toContain("123 456");
    expect(c.text).toContain("10 minutos");
    expect(c.text).toContain("no lo compartas");
  });
});

describe("server functions del segundo paso", () => {
  const fuente = readFileSync(
    path.resolve(__dirname, "../src/lib/auth/mfa-correo.functions.ts"),
    "utf8",
  );

  it("las POST están exentas del modo solo lectura (seguridad de la cuenta)", () => {
    for (const nombre of [
      "enviarCodigoPorCorreo",
      "verificarCodigoPorCorreo",
      "configurarSegundoPaso",
      "autorizarInscripcionApp",
    ]) {
      expect(ESCRITURA_EXENTA[nombre], nombre).toMatch(/SEG-01/);
    }
  });

  it("nunca loguean el código ni reciben una dirección de correo del cliente", () => {
    expect(fuente).not.toMatch(/console\.[a-z]+\([^)]*codigo/);
    expect(fuente).not.toMatch(/\b(email|to|correo)\s*:\s*z\./);
    expect(fuente).toContain("claims.session_id");
  });
});
