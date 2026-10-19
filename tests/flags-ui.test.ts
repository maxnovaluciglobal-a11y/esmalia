import { describe, expect, it } from "vitest";

import { DEMO_EMAIL } from "@/lib/demo-cuenta";
import { claveOverride, FLAGS_UI, nombreVariable, resolverFlag } from "@/lib/flags";

describe("flags de UI (A+)", () => {
  it("están apagados por defecto", () => {
    expect(resolverFlag({})).toBe(false);
    expect(resolverFlag({ env: undefined, dev: false, email: "dueno@clinica.cl" })).toBe(false);
  });

  it("la variable VITE_FLAG_* los enciende y los apaga", () => {
    expect(resolverFlag({ env: "true" })).toBe(true);
    expect(resolverFlag({ env: "1" })).toBe(true);
    expect(resolverFlag({ env: " TRUE " })).toBe(true);
    expect(resolverFlag({ env: "false" })).toBe(false);
    expect(resolverFlag({ env: "0" })).toBe(false);
    // Un valor raro no enciende nada.
    expect(resolverFlag({ env: "si" })).toBe(false);
  });

  it("una clínica real no puede encenderse un flag desde localStorage", () => {
    expect(resolverFlag({ override: "1", email: "dueno@clinica.cl" })).toBe(false);
    expect(resolverFlag({ override: "1" })).toBe(false);
    // Ni apagar uno que Vercel encendió.
    expect(resolverFlag({ env: "true", override: "0", email: "dueno@clinica.cl" })).toBe(true);
  });

  it("en desarrollo el override manda", () => {
    expect(resolverFlag({ dev: true, override: "1" })).toBe(true);
    expect(resolverFlag({ dev: true, env: "true", override: "0" })).toBe(false);
    // Sin override, en dev sigue la variable (apagado si no hay).
    expect(resolverFlag({ dev: true })).toBe(false);
  });

  it("la cuenta demo puede encenderlos (sin importar mayúsculas)", () => {
    expect(resolverFlag({ email: DEMO_EMAIL, override: "1" })).toBe(true);
    expect(resolverFlag({ email: ` ${DEMO_EMAIL.toUpperCase()} `, override: "1" })).toBe(true);
    expect(resolverFlag({ email: DEMO_EMAIL })).toBe(false);
  });

  it("nombres de variable y de clave son estables", () => {
    expect(nombreVariable("agenda-arrastre")).toBe("VITE_FLAG_AGENDA_ARRASTRE");
    expect(nombreVariable("ficha-sugerencia-presupuesto")).toBe(
      "VITE_FLAG_FICHA_SUGERENCIA_PRESUPUESTO",
    );
    expect(claveOverride("shell-v2")).toBe("esmalia:flag:shell-v2");
    expect(new Set(FLAGS_UI).size).toBe(FLAGS_UI.length);
  });

  it("cada flag lee su propia variable VITE_FLAG_* en flags.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fuente = readFileSync(path.resolve(__dirname, "../src/lib/flags.ts"), "utf8");
    for (const f of FLAGS_UI) expect(fuente).toContain(`env.${nombreVariable(f)}`);
  });
});
