import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUDIT_LABELS,
  lineaDeFirma,
  ordenarConAdendas,
  tituloDeAdenda,
  validarDatosDeFirma,
} from "../src/lib/clinical/clinical-notes";
import { NOTE_ACTIONS, evaluarAccionNota } from "../src/lib/clinical/note-permissions";

/**
 * Pruebas puras (sin base) de CLI-07 (una nota firmada no se reabre: se le
 * agrega una adenda) y CLI-08 (la firma lleva nombre completo y registro).
 */
const nota = (id: string, createdAt: string, addendumOf: string | null = null) => ({
  id,
  createdAt,
  addendumOf,
});

describe("orden de notas y adendas", () => {
  it("cada nota va seguida de sus adendas, de la más vieja a la más nueva", () => {
    const notas = [
      nota("N2", "2026-10-10T10:00:00Z"),
      nota("A2", "2026-10-12T10:00:00Z", "N1"),
      nota("N1", "2026-10-01T10:00:00Z"),
      nota("A1", "2026-10-11T10:00:00Z", "N1"),
    ];
    expect(ordenarConAdendas(notas).map((n) => n.id)).toEqual(["N2", "N1", "A1", "A2"]);
  });

  it("una adenda cuya nota no vino no se esconde: va al final", () => {
    const notas = [nota("N1", "2026-10-01T10:00:00Z"), nota("A9", "2026-10-02T10:00:00Z", "X")];
    expect(ordenarConAdendas(notas).map((n) => n.id)).toEqual(["N1", "A9"]);
  });

  it("el título de la adenda nombra la nota que corrige y respeta el largo máximo", () => {
    expect(tituloDeAdenda("Control 6 meses")).toBe("Adenda: Control 6 meses");
    expect(tituloDeAdenda("  ")).toBe("Adenda: Nota clínica");
    expect(tituloDeAdenda("x".repeat(300))).toHaveLength(160);
  });
});

describe("línea de firma", () => {
  it("un borrador no tiene firma", () => {
    expect(
      lineaDeFirma({ status: "draft", signedAt: null, signerName: null, signerLicense: null }),
    ).toBeNull();
  });

  it("la firma muestra nombre completo y registro profesional", () => {
    const linea = lineaDeFirma({
      status: "signed",
      signedAt: "2026-10-19T15:00:00Z",
      signerName: "Dra. Laura Pérez",
      signerLicense: "COP-12345",
    });
    expect(linea).toMatch(/^Firmada por Dra\. Laura Pérez · Registro profesional COP-12345 · /);
  });

  it("una firma anterior al registro obligatorio lo dice en vez de inventar un nombre", () => {
    expect(
      lineaDeFirma({ status: "signed", signedAt: null, signerName: null, signerLicense: null }),
    ).toMatch(/sin datos del firmante/);
  });
});

describe("datos de firma", () => {
  it("exige nombre completo y registro con los mismos límites que la base", () => {
    expect(validarDatosDeFirma({ nombre: "Lu", registro: "123" })).toMatch(/nombre completo/);
    expect(validarDatosDeFirma({ nombre: "Laura Pérez", registro: " " })).toMatch(/registro/);
    expect(validarDatosDeFirma({ nombre: "Laura Pérez", registro: "x".repeat(61) })).toMatch(
      /registro/,
    );
    expect(validarDatosDeFirma({ nombre: "  Laura Pérez ", registro: " 12345 " })).toBeNull();
  });
});

describe("matriz de permisos de notas", () => {
  it("ya no existe la acción de reabrir", () => {
    expect(NOTE_ACTIONS as readonly string[]).not.toContain("reopen");
    expect(NOTE_ACTIONS).toContain("addendum");
  });

  it("la adenda es para notas firmadas, y un borrador firmado no se edita", () => {
    expect(evaluarAccionNota("dentist", "draft", "addendum").verdict).toBe("deny");
    expect(evaluarAccionNota("dentist", "signed", "addendum").verdict).toBe("allow");
    expect(evaluarAccionNota("assistant", "signed_approved", "addendum").verdict).toBe(
      "conditional",
    );
    expect(evaluarAccionNota("reception", "signed", "addendum").verdict).toBe("deny");
    expect(evaluarAccionNota("owner", "signed", "edit").detalle).toMatch(/adenda/);
  });

  it("la auditoría tiene etiqueta para la adenda", () => {
    expect(AUDIT_LABELS.addendum).toBe("Agregó una adenda");
  });
});

/**
 * La migración no se aplica en CI (corre contra la base real). Este control
 * estático fija lo que no puede perderse si alguien la edita antes de
 * aplicarla.
 */
describe("migración 20261019220000 (control estático)", () => {
  const sql = readFileSync(
    join(__dirname, "../supabase/migrations/20261019220000_integridad_clinica.sql"),
    "utf8",
  );

  it("quita el borrado de pacientes y pasa las FKs clínicas a RESTRICT", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS patients_delete_managers ON public\.patients/);
    expect(sql).toMatch(/REVOKE DELETE, TRUNCATE ON public\.patients FROM anon, authenticated/);
    expect(sql).toMatch(/ON DELETE RESTRICT NOT VALID/);
    for (const tabla of [
      "odontogram_marks",
      "periodontal_charts",
      "patient_medical_history",
      "patient_documents",
      "patient_consents",
      "payments",
      "quotes",
      "treatment_plans",
    ]) {
      expect(sql, tabla).toContain(`'${tabla}'`);
    }
  });

  it("la fusión ya no toca una columna inexistente de clinical_notes", () => {
    expect(sql).not.toMatch(/UPDATE public\.clinical_notes\s+SET patient_id/);
  });

  it("una nota firmada no vuelve a borrador y la versión es obligatoria", () => {
    expect(sql).toMatch(/Una nota firmada no se reabre/);
    expect(sql).toMatch(/CREATE CONSTRAINT TRIGGER clinical_notes_exigir_version/);
    expect(sql).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
  });

  it("va en una sola transacción", () => {
    expect(sql.trim().startsWith("--")).toBe(true);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });
});
