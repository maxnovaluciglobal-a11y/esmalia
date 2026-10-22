// UX-06 (Ola 0): Equipo y Permisos muestran nombres, no claves técnicas.
// Lógica pura: no toca Postgres.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/lib/access/access";
import { PERMISSION_LABELS, etiquetaPermiso } from "@/lib/access/permisos-etiquetas";

describe("etiquetas de permisos", () => {
  it("todo permiso de la matriz tiene etiqueta", () => {
    for (const p of PERMISSIONS) {
      expect(PERMISSION_LABELS[p], p).toBeTruthy();
      expect(etiquetaPermiso(p)).toBe(PERMISSION_LABELS[p]);
    }
  });

  it("no sobran etiquetas de permisos que ya no existen", () => {
    expect(Object.keys(PERMISSION_LABELS).sort()).toEqual([...PERMISSIONS].sort());
  });

  it("ninguna etiqueta es la clave técnica ni un anglicismo", () => {
    for (const p of PERMISSIONS) {
      const etiqueta = PERMISSION_LABELS[p];
      expect(etiqueta).not.toContain(":");
      expect(etiqueta.toLowerCase()).not.toContain("dashboard");
    }
  });

  it("las etiquetas no se repiten", () => {
    const valores = Object.values(PERMISSION_LABELS);
    expect(new Set(valores).size).toBe(valores.length);
  });

  it("Equipo y Permisos ya no pintan la clave técnica", () => {
    const equipo = readFileSync("src/routes/_authenticated/_clinic/equipo.tsx", "utf8");
    const matriz = readFileSync("src/components/permissions-matrix.tsx", "utf8");
    expect(equipo).toContain("PERMISSION_LABELS[p]");
    expect(matriz).not.toMatch(/>\s*\{permiso\}\s*</);
  });
});
