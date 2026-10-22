import { describe, expect, it } from "vitest";

import { MENSAJE_GENERICO, mensajeDeError } from "@/lib/mensaje-error";

describe("mensajeDeError", () => {
  it("traduce la falta de red", () => {
    expect(mensajeDeError(new TypeError("Failed to fetch"))).toMatch(/Sin conexión/);
    expect(mensajeDeError(new Error("Load failed"))).toMatch(/Sin conexión/);
  });

  it("no muestra errores técnicos de la base", () => {
    expect(
      mensajeDeError(new Error('new row violates row-level security policy for table "x"')),
    ).toBe(MENSAJE_GENERICO);
    expect(mensajeDeError(new Error("Could not find the 'x' column (PGRST204)"))).toBe(
      MENSAJE_GENERICO,
    );
  });

  it("deja pasar los mensajes ya escritos para la persona", () => {
    expect(mensajeDeError(new Error("El paciente ya tiene una cita a esa hora."))).toBe(
      "El paciente ya tiene una cita a esa hora.",
    );
  });

  it("reescribe el bloqueo de la demo en tuteo", () => {
    expect(
      mensajeDeError(new Error("Esta es la clínica demo — de solo lectura. Creá tu clínica real")),
    ).toMatch(/^Esta es la clínica demo, de solo lectura\. Crea tu clínica/);
  });

  it("traduce los límites de envío de Supabase Auth", () => {
    for (const m of [
      "email rate limit exceeded",
      "Request rate limit reached",
      "For security purposes, you can only request this after 42 seconds.",
    ]) {
      expect(mensajeDeError(new Error(m))).toMatch(/^Hubo demasiados intentos seguidos/);
    }
  });

  it("usa el fallback cuando no hay mensaje", () => {
    expect(mensajeDeError(undefined, "No se pudo guardar")).toBe("No se pudo guardar");
  });

  it("muestra el mensaje de una validación de zod, no el JSON", () => {
    const zod = JSON.stringify(
      [{ code: "custom", message: "Link inválido.", path: ["token"] }],
      null,
      2,
    );
    expect(mensajeDeError(new Error(zod))).toBe("Link inválido.");
    expect(mensajeDeError(new Error("[no es json"))).toBe("[no es json");
  });
});
