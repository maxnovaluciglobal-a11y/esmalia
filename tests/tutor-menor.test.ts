import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MAYORIA_DE_EDAD,
  destinatarioDeComunicaciones,
  esMenorDeEdad,
  etiquetaParentesco,
  fechaDeMayoriaDeEdad,
  parentescoLegible,
  tutorPrincipal,
  tutorSchema,
  type Tutor,
} from "@/lib/patients/tutor";

/**
 * Paciente menor y su tutor (CLI-11, auditoría 360 del 18-oct-2026). Todo
 * puro. La regla de edad también vive en el trigger
 * `stamp_patient_consent_signer`: el último bloque fija que los dos dicen lo
 * mismo leyendo la migración como texto.
 */

const MIGRACION = new URL(
  "../supabase/migrations/20261019180000_anamnesis_estructurada_y_tutor.sql",
  import.meta.url,
);

function tutor(p: Partial<Tutor> = {}): Tutor {
  return {
    id: "t1",
    fullName: "Ana Pérez",
    documentId: "12.345.678-9",
    relationship: "madre",
    relationshipDetail: null,
    phone: "+56911111111",
    email: "ana@example.com",
    isPrimary: true,
    archivedAt: null,
    ...p,
  };
}

describe("menor de edad", () => {
  it("cumple 18 el día del cumpleaños, no antes", () => {
    expect(MAYORIA_DE_EDAD).toBe(18);
    expect(esMenorDeEdad("2008-10-19", "2026-10-18")).toBe(true);
    expect(esMenorDeEdad("2008-10-19", "2026-10-19")).toBe(false);
    expect(esMenorDeEdad("2008-10-19", "2026-10-20")).toBe(false);
  });

  it("29 de febrero: cumple el 28 en un año no bisiesto, igual que Postgres", () => {
    expect(fechaDeMayoriaDeEdad("2008-02-29")).toBe("2026-02-28");
    expect(esMenorDeEdad("2008-02-29", "2026-02-27")).toBe(true);
    expect(esMenorDeEdad("2008-02-29", "2026-02-28")).toBe(false);
    expect(fechaDeMayoriaDeEdad("2012-02-29")).toBe("2030-02-28");
    expect(fechaDeMayoriaDeEdad("2014-02-28")).toBe("2032-02-28");
  });

  it("sin fecha de nacimiento no se sabe (null), no se inventa", () => {
    expect(esMenorDeEdad(null, "2026-10-19")).toBeNull();
    expect(esMenorDeEdad(undefined, "2026-10-19")).toBeNull();
    expect(esMenorDeEdad("19/10/2010", "2026-10-19")).toBeNull();
  });

  it("acepta un timestamp en la fecha de nacimiento (usa solo el día)", () => {
    expect(esMenorDeEdad("2010-05-01T00:00:00Z", "2026-10-19")).toBe(true);
  });
});

describe("tutores", () => {
  it("el principal vigente primero; un archivado nunca es principal", () => {
    const a = tutor({ id: "a", isPrimary: false });
    const b = tutor({ id: "b", isPrimary: true, archivedAt: "2026-10-01T00:00:00Z" });
    const c = tutor({ id: "c", isPrimary: true });
    expect(tutorPrincipal([a, b, c])?.id).toBe("c");
    expect(tutorPrincipal([a, b])?.id).toBe("a");
    expect(tutorPrincipal([b])).toBeNull();
  });

  it("el parentesco se lee con el detalle si lo hay", () => {
    expect(parentescoLegible(tutor())).toBe("Madre");
    expect(
      parentescoLegible(tutor({ relationship: "familiar", relationshipDetail: "Abuela" })),
    ).toBe("Abuela");
    expect(parentescoLegible(tutor({ relationship: "tutor_legal", relationshipDetail: " " }))).toBe(
      "Tutor legal",
    );
  });

  it("exige nombre, documento, parentesco y algún contacto", () => {
    const base = { fullName: "Ana Pérez", documentId: "12345678", relationship: "madre" };
    expect(tutorSchema.safeParse({ ...base, phone: "+56911111111" }).success).toBe(true);
    expect(tutorSchema.safeParse({ ...base, email: "ana@example.com" }).success).toBe(true);
    const sinContacto = tutorSchema.safeParse(base);
    expect(sinContacto.success).toBe(false);
    expect(sinContacto.error?.issues[0].message).toMatch(/teléfono o un correo/);
    expect(tutorSchema.safeParse({ ...base, documentId: "", phone: "1" }).success).toBe(false);
    expect(tutorSchema.safeParse({ ...base, relationship: "vecino", phone: "1" }).success).toBe(
      false,
    );
  });
});

describe("destinatario de las comunicaciones", () => {
  const base = {
    hoy: "2026-10-19",
    telefonoPaciente: "+56922222222",
    emailPaciente: "nino@example.com",
  };

  it("un menor con tutor: los mensajes van al tutor", () => {
    const d = destinatarioDeComunicaciones({
      ...base,
      fechaNacimiento: "2015-03-10",
      tutores: [tutor()],
    });
    expect(d).toEqual({
      telefono: "+56911111111",
      email: "ana@example.com",
      para: "tutor",
      tutor: { id: "t1", fullName: "Ana Pérez" },
    });
  });

  it("si el tutor no dejó teléfono, el WhatsApp cae al de la ficha", () => {
    const d = destinatarioDeComunicaciones({
      ...base,
      fechaNacimiento: "2015-03-10",
      tutores: [tutor({ phone: null })],
    });
    expect(d.telefono).toBe("+56922222222");
    expect(d.email).toBe("ana@example.com");
    expect(d.para).toBe("tutor");
  });

  it("adulto, sin fecha o menor sin tutor: al paciente", () => {
    for (const fechaNacimiento of ["1990-01-01", null]) {
      expect(
        destinatarioDeComunicaciones({ ...base, fechaNacimiento, tutores: [tutor()] }).para,
      ).toBe("paciente");
    }
    expect(
      destinatarioDeComunicaciones({ ...base, fechaNacimiento: "2015-03-10", tutores: [] }),
    ).toEqual({
      telefono: "+56922222222",
      email: "nino@example.com",
      para: "paciente",
      tutor: null,
    });
  });
});

describe("la base aplica la misma regla", () => {
  const sql = readFileSync(MIGRACION, "utf8");

  it("el trigger exige tutor a un menor de 18 a la fecha de la firma", () => {
    expect(sql).toMatch(/CREATE TRIGGER patient_consents_stamp_signer\s+BEFORE INSERT/);
    expect(sql).toContain("(v_birth + interval '18 years')::date > v_fecha_firma");
    expect(sql).toContain("AT TIME ZONE v_tz");
  });

  it("los parentescos del CHECK y los de la app coinciden, con la misma etiqueta", () => {
    const check = /relationship IN \(([^)]+)\)/.exec(sql)?.[1] ?? "";
    const enSql = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enSql).toEqual(Object.keys(etiquetaParentesco).sort());
    for (const [clave, etiqueta] of Object.entries(etiquetaParentesco)) {
      if (clave === "otro") expect(sql).toContain(`ELSE '${etiqueta}'`);
      else expect(sql).toContain(`WHEN '${clave}' THEN '${etiqueta}'`);
    }
  });

  it("las funciones de trigger nuevas no las puede llamar nadie", () => {
    for (const f of [
      "enforce_patient_guardian_update",
      "log_patient_guardian_change",
      "stamp_patient_consent_signer",
      "enforce_patient_consent_signer_update",
      "log_patient_medical_history_change",
    ]) {
      expect(sql).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${f}() FROM PUBLIC, anon, authenticated`,
      );
    }
  });

  it("la auditoría de la anamnesis toma el actor de la sesión, no del cliente", () => {
    expect(sql).not.toMatch(/NEW\.updated_by,\s*'(insert|update)'/);
    expect(sql.match(/auth\.uid\(\), '(insert|update)'\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
