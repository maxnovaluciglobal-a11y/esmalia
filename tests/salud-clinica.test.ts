import { describe, expect, it } from "vitest";

import {
  hace,
  horasConLlamadaPendiente,
  semaforoDeSalud,
  type InsumosSalud,
} from "@/lib/admin/salud-clinica";

// Semáforo de salud de las clínicas piloto (CS-09). Puro.
const AHORA = new Date("2026-10-20T15:00:00Z");
const dias = (n: number) => new Date(AHORA.getTime() - n * 86_400_000).toISOString();

const base: InsumosSalud = {
  createdAt: dias(20),
  citasUltimos7Dias: 12,
  usuariosActivos7Dias: 2,
  ultimoLoginDueno: dias(1),
};

describe("semaforoDeSalud", () => {
  it("verde: 10+ citas en 7 días y 2+ usuarios activos", () => {
    expect(semaforoDeSalud(base, AHORA)).toBe("verde");
  });

  it("amarillo: pocas citas o un solo usuario", () => {
    expect(semaforoDeSalud({ ...base, citasUltimos7Dias: 9 }, AHORA)).toBe("amarillo");
    expect(semaforoDeSalud({ ...base, usuariosActivos7Dias: 1 }, AHORA)).toBe("amarillo");
    expect(semaforoDeSalud({ ...base, citasUltimos7Dias: 1 }, AHORA)).toBe("amarillo");
  });

  it("rojo: 0 citas en 7 días", () => {
    expect(semaforoDeSalud({ ...base, citasUltimos7Dias: 0 }, AHORA)).toBe("rojo");
  });

  it("rojo: el dueño no entra hace 5 días o más, o nunca entró", () => {
    expect(semaforoDeSalud({ ...base, ultimoLoginDueno: dias(4.9) }, AHORA)).toBe("verde");
    expect(semaforoDeSalud({ ...base, ultimoLoginDueno: dias(5) }, AHORA)).toBe("rojo");
    expect(semaforoDeSalud({ ...base, ultimoLoginDueno: null }, AHORA)).toBe("rojo");
  });

  it("nueva: con menos de 3 días no se califica (ni un rojo injusto)", () => {
    const nueva = { ...base, createdAt: dias(2), citasUltimos7Dias: 0, ultimoLoginDueno: null };
    expect(semaforoDeSalud(nueva, AHORA)).toBe("nueva");
    expect(semaforoDeSalud({ ...nueva, createdAt: dias(3) }, AHORA)).toBe("rojo");
  });
});

describe("horasConLlamadaPendiente", () => {
  const pendiente = { createdAt: dias(2), onboardingCallAt: null, suscrita: false };

  it("avisa pasadas 24 h sin llamada ni suscripción", () => {
    expect(horasConLlamadaPendiente(pendiente, AHORA)).toBe(48);
  });

  it("no avisa antes de 24 h", () => {
    expect(horasConLlamadaPendiente({ ...pendiente, createdAt: dias(0.5) }, AHORA)).toBeNull();
  });

  it("no avisa si ya hubo llamada o ya se suscribió", () => {
    expect(horasConLlamadaPendiente({ ...pendiente, onboardingCallAt: dias(1) }, AHORA)).toBeNull();
    expect(horasConLlamadaPendiente({ ...pendiente, suscrita: true }, AHORA)).toBeNull();
  });
});

describe("hace", () => {
  it("formatea horas y días, y 'nunca' sin fecha", () => {
    expect(hace(null, AHORA)).toBe("nunca");
    expect(hace(new Date(AHORA.getTime() - 20 * 60_000).toISOString(), AHORA)).toBe(
      "hace menos de 1 h",
    );
    expect(hace(new Date(AHORA.getTime() - 5 * 3_600_000).toISOString(), AHORA)).toBe("hace 5 h");
    expect(hace(dias(3), AHORA)).toBe("hace 3 d");
  });
});
