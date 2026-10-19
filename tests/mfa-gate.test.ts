// Verificación en dos pasos (SEG-01). Tests puros: ni red ni base. El gate
// del staff se prueba con un `supabaseAdmin` falso (solo `getUserById`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireEsmaliaStaffEmail } from "@/lib/admin/staff-gate";
import {
  debeMostrarAvisoMfa,
  evaluarAccesoStaff,
  factoresTotpSinVerificar,
  factoresTotpVerificados,
  listaDeStaff,
  MENSAJE_SIN_PERMISOS,
  MENSAJE_STAFF_REQUIERE_MFA,
  necesitaDesafioMfa,
  nivelAal,
  normalizarCodigoTotp,
  politicaMfaDeRol,
  sesionReciente,
  tieneFactorVerificado,
  ultimoInicioDeSesion,
} from "@/lib/auth/mfa";

describe("nivelAal", () => {
  it("solo reconoce aal1 y aal2", () => {
    expect(nivelAal("aal1")).toBe("aal1");
    expect(nivelAal("aal2")).toBe("aal2");
    expect(nivelAal("AAL2")).toBeNull();
    expect(nivelAal("aal3")).toBeNull();
    expect(nivelAal(undefined)).toBeNull();
    expect(nivelAal(2)).toBeNull();
  });
});

describe("necesitaDesafioMfa (redirige a /auth/verificar)", () => {
  it("pide el código con factor verificado y sesión aal1", () => {
    expect(necesitaDesafioMfa({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
  });
  it("no lo pide si la sesión ya es aal2", () => {
    expect(necesitaDesafioMfa({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
  });
  it("no lo pide si la cuenta no tiene factor", () => {
    expect(necesitaDesafioMfa({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
  });
  it("sin sesión o sin datos no redirige (de eso se encarga el login)", () => {
    expect(necesitaDesafioMfa(null)).toBe(false);
    expect(necesitaDesafioMfa({ currentLevel: null, nextLevel: null })).toBe(false);
  });
});

describe("tieneFactorVerificado", () => {
  it("es nextLevel === aal2", () => {
    expect(tieneFactorVerificado({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
    expect(tieneFactorVerificado({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
    expect(tieneFactorVerificado(undefined)).toBe(false);
  });
});

describe("evaluarAccesoStaff", () => {
  const permitidos = listaDeStaff(" Staff@Esmalia.com , otro@esmalia.com ,, ");

  it("parsea la allowlist en minúsculas y sin vacíos", () => {
    expect(permitidos).toEqual(["staff@esmalia.com", "otro@esmalia.com"]);
    expect(listaDeStaff(undefined)).toEqual([]);
  });

  it("staff con email confirmado y aal2 entra", () => {
    expect(
      evaluarAccesoStaff({
        email: "STAFF@esmalia.com",
        emailConfirmado: true,
        permitidos,
        aal: "aal2",
      }),
    ).toEqual({ ok: true, email: "staff@esmalia.com" });
  });

  it("staff con solo contraseña (aal1) queda afuera por MFA", () => {
    expect(
      evaluarAccesoStaff({
        email: "staff@esmalia.com",
        emailConfirmado: true,
        permitidos,
        aal: "aal1",
      }),
    ).toEqual({ ok: false, motivo: "requiere_mfa" });
  });

  it("un claim aal ausente o raro no cuenta como aal2", () => {
    for (const aal of [undefined, null, "", "aal3", "AAL2"]) {
      expect(
        evaluarAccesoStaff({ email: "staff@esmalia.com", emailConfirmado: true, permitidos, aal }),
      ).toEqual({ ok: false, motivo: "requiere_mfa" });
    }
  });

  it("a quien no es staff no se le menciona el MFA, aunque tenga aal2", () => {
    expect(
      evaluarAccesoStaff({
        email: "dueno@clinica.cl",
        emailConfirmado: true,
        permitidos,
        aal: "aal2",
      }),
    ).toEqual({ ok: false, motivo: "sin_permiso" });
    expect(
      evaluarAccesoStaff({
        email: "dueno@clinica.cl",
        emailConfirmado: true,
        permitidos,
        aal: "aal1",
      }),
    ).toEqual({ ok: false, motivo: "sin_permiso" });
  });

  it("email sin confirmar no entra aunque esté en la lista y tenga aal2", () => {
    expect(
      evaluarAccesoStaff({
        email: "staff@esmalia.com",
        emailConfirmado: false,
        permitidos,
        aal: "aal2",
      }),
    ).toEqual({ ok: false, motivo: "sin_permiso" });
  });

  it("sin email o con la lista vacía nadie entra", () => {
    expect(
      evaluarAccesoStaff({ email: null, emailConfirmado: true, permitidos, aal: "aal2" }),
    ).toEqual({ ok: false, motivo: "sin_permiso" });
    expect(
      evaluarAccesoStaff({
        email: "staff@esmalia.com",
        emailConfirmado: true,
        permitidos: [],
        aal: "aal2",
      }),
    ).toEqual({ ok: false, motivo: "sin_permiso" });
  });
});

describe("requireEsmaliaStaffEmail (servidor, con supabaseAdmin falso)", () => {
  const envOriginal = process.env.ESMALIA_STAFF_EMAILS;
  beforeEach(() => {
    process.env.ESMALIA_STAFF_EMAILS = "staff@esmalia.com";
  });
  afterEach(() => {
    process.env.ESMALIA_STAFF_EMAILS = envOriginal;
  });

  function adminFalso(user: { email?: string; email_confirmed_at?: string | null } | null) {
    const getUserById = vi.fn().mockResolvedValue({ data: { user }, error: null });
    return {
      admin: { auth: { admin: { getUserById } } } as unknown as Parameters<
        typeof requireEsmaliaStaffEmail
      >[0],
      getUserById,
    };
  }

  const confirmado = { email: "staff@esmalia.com", email_confirmed_at: "2026-10-01T00:00:00Z" };

  it("devuelve el email con aal2", async () => {
    const { admin, getUserById } = adminFalso(confirmado);
    await expect(requireEsmaliaStaffEmail(admin, "u1", { aal: "aal2" })).resolves.toBe(
      "staff@esmalia.com",
    );
    expect(getUserById).toHaveBeenCalledWith("u1");
  });

  it("rechaza aal1 con el mensaje de MFA", async () => {
    const { admin } = adminFalso(confirmado);
    await expect(requireEsmaliaStaffEmail(admin, "u1", { aal: "aal1" })).rejects.toThrow(
      MENSAJE_STAFF_REQUIERE_MFA,
    );
  });

  it("rechaza claims sin aal", async () => {
    const { admin } = adminFalso(confirmado);
    await expect(requireEsmaliaStaffEmail(admin, "u1", {})).rejects.toThrow(
      MENSAJE_STAFF_REQUIERE_MFA,
    );
  });

  it("a quien no es staff le dice solo 'No tienes permisos.'", async () => {
    const { admin } = adminFalso({ email: "otro@x.com", email_confirmed_at: "2026-10-01" });
    await expect(requireEsmaliaStaffEmail(admin, "u2", { aal: "aal1" })).rejects.toThrow(
      MENSAJE_SIN_PERMISOS,
    );
  });

  it("usuario inexistente: sin permisos", async () => {
    const { admin } = adminFalso(null);
    await expect(requireEsmaliaStaffEmail(admin, "u3", { aal: "aal2" })).rejects.toThrow(
      MENSAJE_SIN_PERMISOS,
    );
  });
});

describe("política por rol y aviso al owner", () => {
  it("owner: recomendada; el resto: opcional", () => {
    expect(politicaMfaDeRol("owner")).toBe("recomendada");
    for (const rol of ["admin", "dentist", "assistant", "reception", "accounting", null]) {
      expect(politicaMfaDeRol(rol)).toBe("opcional");
    }
  });

  it("muestra el aviso al owner sin factor", () => {
    expect(debeMostrarAvisoMfa({ rolReal: "owner", tieneFactor: false, esDemo: false })).toBe(true);
  });
  it("no lo muestra si ya tiene factor", () => {
    expect(debeMostrarAvisoMfa({ rolReal: "owner", tieneFactor: true, esDemo: false })).toBe(false);
  });
  it("nunca en la demo (cuenta compartida)", () => {
    expect(debeMostrarAvisoMfa({ rolReal: "owner", tieneFactor: false, esDemo: true })).toBe(false);
  });
  it("no a roles donde es opcional", () => {
    expect(debeMostrarAvisoMfa({ rolReal: "dentist", tieneFactor: false, esDemo: false })).toBe(
      false,
    );
  });
});

describe("normalizarCodigoTotp", () => {
  it("acepta 6 dígitos con espacios o guion", () => {
    expect(normalizarCodigoTotp("123456")).toBe("123456");
    expect(normalizarCodigoTotp(" 123 456 ")).toBe("123456");
    expect(normalizarCodigoTotp("123-456")).toBe("123456");
  });
  it("rechaza largo distinto o letras", () => {
    expect(normalizarCodigoTotp("12345")).toBeNull();
    expect(normalizarCodigoTotp("1234567")).toBeNull();
    expect(normalizarCodigoTotp("12a456")).toBeNull();
    expect(normalizarCodigoTotp("")).toBeNull();
  });
});

describe("filtros de factores", () => {
  const factores = [
    { id: "a", factor_type: "totp", status: "verified" },
    { id: "b", factor_type: "totp", status: "unverified" },
    { id: "c", factor_type: "phone", status: "unverified" },
    { id: "d", factor_type: "webauthn", status: "verified" },
  ];
  it("separa TOTP verificados de los abandonados, sin tocar otros tipos", () => {
    expect(factoresTotpVerificados(factores).map((f) => f.id)).toEqual(["a"]);
    expect(factoresTotpSinVerificar(factores).map((f) => f.id)).toEqual(["b"]);
  });
});

describe("sesión reciente para inscribir un factor", () => {
  const ahora = Date.UTC(2026, 9, 19, 12, 0, 0);
  const haceMin = (m: number) => Math.floor((ahora - m * 60_000) / 1000);

  it("toma el método más reciente del amr", () => {
    expect(
      ultimoInicioDeSesion([
        { method: "password", timestamp: haceMin(30) },
        { method: "oauth", timestamp: haceMin(2) },
      ]),
    ).toBe(haceMin(2));
  });

  it("acepta un inicio de sesión de hace menos de 10 minutos", () => {
    expect(sesionReciente([{ method: "password", timestamp: haceMin(3) }], ahora)).toBe(true);
    expect(sesionReciente([{ method: "password", timestamp: haceMin(10) }], ahora)).toBe(true);
  });

  it("rechaza una sesión vieja (refrescada, pero de login antiguo)", () => {
    expect(sesionReciente([{ method: "password", timestamp: haceMin(11) }], ahora)).toBe(false);
    expect(sesionReciente([{ method: "oauth", timestamp: haceMin(60 * 24) }], ahora)).toBe(false);
  });

  it("sin fechas (amr en formato string[]) o vacío: no es reciente", () => {
    expect(sesionReciente(["password"], ahora)).toBe(false);
    expect(sesionReciente([], ahora)).toBe(false);
    expect(sesionReciente(undefined, ahora)).toBe(false);
  });

  it("una fecha muy en el futuro no cuenta", () => {
    expect(sesionReciente([{ method: "password", timestamp: haceMin(-30) }], ahora)).toBe(false);
  });
});
