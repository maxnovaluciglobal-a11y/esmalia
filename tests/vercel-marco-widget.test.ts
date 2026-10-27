/**
 * Bloque 5 · Widget de reserva embebido. `vercel.json` manda
 * `X-Frame-Options: SAMEORIGIN` a todo salvo a `/reservar/*`, donde la CSP
 * `frame-ancestors` de `src/router.tsx` decide quién puede embeber. Mientras
 * el header estático siga ahí, el navegador bloquea el iframe de las clínicas.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { frameAncestorsPara } from "@/router";

type Regla = { source: string; headers: { key: string; value: string }[] };
const reglas: Regla[] = JSON.parse(readFileSync("vercel.json", "utf8")).headers;

function cabecerasDe(ruta: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of reglas) {
    // Vercel compila `source` con path-to-regexp; para estas reglas alcanza
    // con tratarlo como expresión regular anclada.
    if (new RegExp(`^${r.source}$`).test(ruta)) {
      for (const h of r.headers) out.set(h.key, h.value);
    }
  }
  return out;
}

describe("X-Frame-Options en vercel.json", () => {
  it("la reserva en línea no lo lleva (lo gobierna frame-ancestors)", () => {
    for (const ruta of ["/reservar/clinica-demo", "/reservar/clinica-demo/dra-paz"]) {
      expect(cabecerasDe(ruta).has("X-Frame-Options"), ruta).toBe(false);
      expect(frameAncestorsPara(ruta)).toContain("https:");
    }
  });

  it("el resto de la app sigue protegida contra marcos ajenos", () => {
    for (const ruta of [
      "/",
      "/auth",
      "/agenda",
      "/pacientes/abc",
      "/mi-cita/abc",
      "/portal/xyz",
      "/reservas",
      "/reserva-en-linea",
      "/api/health",
    ]) {
      expect(cabecerasDe(ruta).get("X-Frame-Options"), ruta).toBe("SAMEORIGIN");
      expect(frameAncestorsPara(ruta), ruta).toBe("frame-ancestors 'self'");
    }
  });

  it("la reserva conserva los demás headers de seguridad", () => {
    const h = cabecerasDe("/reservar/clinica-demo");
    expect(h.get("Strict-Transport-Security")).toContain("max-age");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBeTruthy();
    expect(h.get("Permissions-Policy")).toBeTruthy();
  });
});
