import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { analizarPlantilla, renderPlantilla } from "@/lib/documentos/motor";
import { esTipoDeDocumento } from "@/lib/documentos/tipos";
import { CAMPOS, PREFIJO_CAMPO, contextoDeEjemplo } from "@/lib/documentos/variables";

/**
 * DOC-02 y MKT-04: las plantillas base que siembra la migración
 * 20261025100100 tienen que poder emitirse con el motor tal cual. Este test
 * lee el SQL (sin base) y valida cada texto: si alguien agrega una variable
 * que el motor no conoce, o cambia el nombre de una en el catálogo, falla
 * acá y no en la ficha de un paciente.
 */

const SQL = readFileSync(
  new URL(
    "../supabase/migrations/20261025100100_plantillas_de_documentos_base.sql",
    import.meta.url,
  ),
  "utf8",
);

type Semilla = { seedKey: string; kind: string; title: string; body: string };

function semillas(): Semilla[] {
  const re =
    /\(\s*'([a-z-]+)',\s*'([a-z_]+)',\s*'([^']+)',\s*'(?:[^']|'')*',\s*\$t\$([\s\S]*?)\$t\$\s*\)/g;
  return [...SQL.matchAll(re)].map((m) => ({ seedKey: m[1], kind: m[2], title: m[3], body: m[4] }));
}

// Formas de voseo frecuentes (la lista completa vive en tuteo-neutro.test.ts,
// que no lee las migraciones).
const VOSEO =
  /(?<!\p{L})(?:podés|tenés|querés|consultá|firmá|revisá|completá|llamá|avisá)(?!\p{L})/iu;

describe("plantillas base de documentos", () => {
  const todas = semillas();

  it("siembra las siete plantillas del brief", () => {
    expect(todas.map((s) => s.seedKey)).toEqual([
      "certificado-atencion",
      "reposo",
      "derivacion",
      "alta",
      "informe",
      "consentimiento-simple",
      "reembolso-seguro",
    ]);
    for (const s of todas) expect(esTipoDeDocumento(s.kind), s.seedKey).toBe(true);
  });

  it.each(semillas().map((s) => [s.seedKey, s] as const))(
    "%s: solo usa variables que el motor conoce",
    (_k, s) => {
      const a = analizarPlantilla(s.body);
      expect(a.problemas).toEqual([]);
      expect(a.desconocidas).toEqual([]);
    },
  );

  it.each(semillas().map((s) => [s.seedKey, s] as const))(
    "%s: sus campos están en el catálogo (se piden con etiqueta y tipo)",
    (_k, s) => {
      const conocidos = new Set(CAMPOS.map((c) => c.nombre));
      for (const c of analizarPlantilla(s.body).campos) expect(conocidos.has(c), c).toBe(true);
    },
  );

  it.each(semillas().map((s) => [s.seedKey, s] as const))(
    "%s: con datos completos no le falta nada",
    (_k, s) => {
      const r = renderPlantilla(s.body, contextoDeEjemplo());
      expect(r.faltantes).toEqual([]);
      expect(r.bloques[0]).toMatchObject({ tipo: "titulo", nivel: 1 });
    },
  );

  it("están en tuteo neutro y en español de Chile", () => {
    for (const s of todas) expect(s.body, s.seedKey).not.toMatch(VOSEO);
  });

  it("el formulario de reembolso trae la tabla, el total y los datos tributarios", () => {
    const r = todas.find((s) => s.seedKey === "reembolso-seguro")!;
    for (const v of [
      "reembolso.prestaciones",
      "reembolso.total_pagado",
      "clinica.razon_social",
      "clinica.rut",
      "clinica.giro",
      `${PREFIJO_CAMPO}periodo_desde`,
      `${PREFIJO_CAMPO}periodo_hasta`,
    ]) {
      expect(analizarPlantilla(r.body).variables).toContain(v);
    }
  });

  it("el certificado de reposo aclara que no reemplaza la licencia médica", () => {
    const r = todas.find((s) => s.seedKey === "reposo")!;
    expect(r.body).toContain("no reemplaza la licencia médica");
  });
});
