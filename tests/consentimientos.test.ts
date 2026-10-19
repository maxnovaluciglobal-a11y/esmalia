import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  esPiezaFdi,
  estadoPlantilla,
  firmantePorDefecto,
  leerPiezas,
  problemaParaFirmar,
} from "@/lib/clinical/consentimientos";

// Puro: funciones y lectura del archivo de migración, sin red ni base
// (CLI-12 y CLI-13, auditoría 360 del 18-oct-2026).

const MIGRACION = readFileSync(
  new URL(
    "../supabase/migrations/20261019190000_consentimientos_plantillas_y_recetas.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("estado de una plantilla", () => {
  it("los modelos de Esmalia quedan para revisar hasta que la clínica los marque", () => {
    expect(estadoPlantilla({ source: "esmalia_model", reviewedAt: null })).toBe(
      "modelo-sin-revisar",
    );
    expect(estadoPlantilla({ source: "esmalia_model", reviewedAt: "2026-10-19" })).toBe(
      "modelo-revisado",
    );
    expect(estadoPlantilla({ source: "clinic", reviewedAt: null })).toBe("propia");
  });
});

describe("piezas en notación FDI", () => {
  it("acepta permanentes y temporales", () => {
    for (const n of [11, 18, 28, 38, 48, 51, 55, 85]) expect(esPiezaFdi(n), String(n)).toBe(true);
    for (const n of [10, 19, 49, 56, 90, 9, 111]) expect(esPiezaFdi(n), String(n)).toBe(false);
  });

  it("lee una lista escrita a mano, sin duplicados", () => {
    expect(leerPiezas("38, 48 38;11")).toEqual({ piezas: [38, 48, 11], invalidas: [] });
    expect(leerPiezas("")).toEqual({ piezas: [], invalidas: [] });
    expect(leerPiezas("19 3a 21")).toEqual({ piezas: [21], invalidas: ["19", "3a"] });
  });
});

describe("quién firma", () => {
  it("propone al representante si el paciente es menor", () => {
    expect(firmantePorDefecto(9)).toBe("guardian");
    expect(firmantePorDefecto(17)).toBe("guardian");
    expect(firmantePorDefecto(18)).toBe("patient");
    expect(firmantePorDefecto(null)).toBe("patient");
  });

  const base = {
    title: "Consentimiento para exodoncia",
    procedure: "Exodoncia de la 38",
    body: "Texto suficiente para firmar.",
    informedByProfessionalId: "p1",
    signedByName: "Juan Soto",
    signerKind: "patient" as const,
    signerRelationship: "",
    tieneFirma: true,
    piezasInvalidas: [],
  };

  it("pide procedimiento, informante, parentesco del representante y firma", () => {
    expect(problemaParaFirmar(base)).toBeNull();
    expect(problemaParaFirmar({ ...base, procedure: " " })).toMatch(/procedimiento/);
    expect(problemaParaFirmar({ ...base, informedByProfessionalId: "" })).toMatch(/profesional/);
    expect(problemaParaFirmar({ ...base, signerKind: "guardian" })).toMatch(/parentesco/);
    expect(
      problemaParaFirmar({ ...base, signerKind: "guardian", signerRelationship: "Madre" }),
    ).toBeNull();
    expect(problemaParaFirmar({ ...base, tieneFirma: false })).toMatch(/firma/);
    expect(problemaParaFirmar({ ...base, piezasInvalidas: ["19"] })).toMatch(/19/);
  });
});

describe("migración 20261019190000", () => {
  const CLAVES = [
    "exodoncia",
    "endodoncia",
    "implante",
    "blanqueamiento",
    "ortodoncia",
    "anestesia-local",
    "periodontal",
    "imagenes-radiografias",
  ];

  it("siembra los 8 modelos, cada uno con descripción, riesgos y alternativas", () => {
    for (const clave of CLAVES) expect(MIGRACION).toContain(`'${clave}',`);
    // 3 textos largos por plantilla: descripción, riesgos y alternativas.
    const textos = [...MIGRACION.matchAll(/\$t\$([\s\S]*?)\$t\$/g)].map((m) => m[1].trim());
    expect(textos).toHaveLength(CLAVES.length * 3);
    for (const t of textos) expect(t.length).toBeGreaterThan(80);
  });

  it("la siembra es idempotente y llega a clínicas nuevas y existentes", () => {
    expect(MIGRACION).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS consent_templates_seed_key_uniq/);
    expect(MIGRACION).toMatch(
      /ON CONFLICT \(clinic_id, seed_key\) WHERE seed_key IS NOT NULL DO NOTHING/,
    );
    expect(MIGRACION).toMatch(/AFTER INSERT ON public\.clinics/);
    expect(MIGRACION).toMatch(
      /SELECT public\.seed_clinic_consent_templates\(id\) FROM public\.clinics/,
    );
    expect(MIGRACION).toMatch(/'esmalia_model'/);
  });

  it("los textos no prometen validez legal ni usan usted", () => {
    const textos = [...MIGRACION.matchAll(/\$t\$([\s\S]*?)\$t\$/g)].map((m) => m[1]);
    for (const t of textos) {
      expect(t).not.toMatch(/\busted\b/i);
      expect(t).not.toMatch(
        /validez legal|legalmente v[aá]lido|garantiza(mos)? (el|un) resultado/i,
      );
    }
  });

  it("ninguna función SECURITY DEFINER nueva queda llamable por usuarios", () => {
    const definers = [
      ...MIGRACION.matchAll(
        /CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(([^)]*)\)[\s\S]*?SECURITY DEFINER/g,
      ),
    ].map((m) => `${m[1]}(${m[2].replace(/p_[a-z_]+ /g, "")})`);
    expect(definers.length).toBeGreaterThanOrEqual(6);
    for (const f of definers) {
      expect(MIGRACION, f).toContain(
        `REVOKE EXECUTE ON FUNCTION ${f} FROM PUBLIC, anon, authenticated`,
      );
    }
  });

  it("las recetas tienen RLS, no se borran y la base completa los datos del profesional", () => {
    expect(MIGRACION).toMatch(/ALTER TABLE public\.prescriptions ENABLE ROW LEVEL SECURITY/);
    expect(MIGRACION).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON public\.prescriptions TO authenticated/,
    );
    expect(MIGRACION).not.toMatch(/GRANT[^;]*DELETE[^;]*prescriptions TO authenticated/);
    expect(MIGRACION).toMatch(/v_prof\.user_id IS DISTINCT FROM auth\.uid\(\)/);
    expect(MIGRACION).toMatch(/next_clinic_counter\(NEW\.clinic_id, 'prescription'/);
    expect(MIGRACION).toMatch(
      /CREATE TRIGGER block_demo_writes\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.prescriptions/,
    );
  });
});
