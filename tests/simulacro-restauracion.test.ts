import { describe, expect, it } from "vitest";
import {
  conteosDelBackup,
  elegirUltimoBackup,
  evaluarSimulacro,
  formatearDuracion,
  reporteMarkdown,
} from "../scripts/simulacro/lib.mjs";
import { esUrlLocal } from "../scripts/simulacro/local.mjs";

/**
 * Verificador del simulacro de restauración (SEG-05). Se arma un backup de
 * juguete con la forma de scripts/backup-data.mjs y se compara con mediciones
 * simuladas de la base efímera: sin red, sin Docker.
 */

const NOMBRE_SENSIBLE = "Paciente De Juguete Que No Debe Salir";

function backupDeJuguete({ conAuth = true } = {}) {
  const clinica = "11111111-1111-1111-1111-111111111111";
  const usuarios = ["u-1", "u-2"];
  const pacientes = Array.from({ length: 3 }, (_, i) => ({
    id: `p-${i}`,
    clinic_id: clinica,
    full_name: i === 0 ? NOMBRE_SENSIBLE : `Paciente ${i}`,
  }));
  return {
    exportedAt: "2026-10-27T07:15:00.000Z",
    tables: {
      clinics: [{ id: clinica, name: "Clínica de juguete" }],
      patients: pacientes,
      appointments: pacientes.map((p, i) => ({
        id: `a-${i}`,
        patient_id: p.id,
        clinic_id: clinica,
      })),
      clinic_members: usuarios.map((u) => ({ clinic_id: clinica, user_id: u })),
      expenses: [],
    },
    ...(conAuth
      ? { auth_users: usuarios.map((id, i) => ({ id, email: `u${i}@example.invalid` })) }
      : {}),
  };
}

const manifiestoDeJuguete = {
  exportedAt: "2026-10-27T07:16:00.000Z",
  buckets: [
    {
      id: "clinical-documents",
      objects: [
        { path: "c/p-0/rx.png", size: 1200, mimetype: "image/png" },
        { path: "c/p-1/consentimiento.pdf", size: 5400, mimetype: "application/pdf" },
      ],
    },
  ],
  failed: [],
};

/** Mediciones de una restauración perfecta del backup de juguete. */
function medicionesPerfectas(backup: ReturnType<typeof backupDeJuguete>) {
  return {
    backup,
    conteosBase: conteosDelBackup(backup),
    fksRotas: [],
    fksRevisadas: 4,
    usuariosRestaurados: (backup.auth_users ?? []).map((u) => u.id),
    usuariosStub: 0,
    manifiesto: manifiestoDeJuguete,
    objetosBase: {
      "clinical-documents": manifiestoDeJuguete.buckets[0].objects.map(({ path, size }) => ({
        path,
        size,
      })),
    },
    migraciones: { ok: 204, fallidas: [] },
    tiempos: [
      { paso: "0 bajar", segundos: 12.4, rto: true },
      { paso: "2 migraciones", segundos: 40, rto: true },
      { paso: "6 verificar", segundos: 0.5, rto: false },
    ],
  };
}

const check = (r: ReturnType<typeof evaluarSimulacro>, id: string) =>
  r.checks.find((c: { id: string }) => c.id === id)!;

describe("conteosDelBackup", () => {
  it("cuenta las filas de cada tabla, también las vacías", () => {
    expect(conteosDelBackup(backupDeJuguete())).toEqual({
      clinics: 1,
      patients: 3,
      appointments: 3,
      clinic_members: 2,
      expenses: 0,
    });
  });

  it("rechaza un archivo que no tiene la forma de un backup", () => {
    expect(() => conteosDelBackup({ foo: 1 })).toThrow(/forma/);
    expect(() => conteosDelBackup({ tables: { patients: "x" } })).toThrow(/patients/);
  });
});

describe("evaluarSimulacro", () => {
  it("da ok cuando la base restaurada coincide con el backup", () => {
    const r = evaluarSimulacro(medicionesPerfectas(backupDeJuguete()));
    expect(r.estado).toBe("ok");
    expect(r.checks.map((c: { ok: boolean }) => c.ok)).toEqual([true, true, true, true, true]);
    expect(r.tablas).toBe(5);
    expect(r.filas).toBe(9);
    // El RTO suma solo los pasos de restauración, no la verificación.
    expect(r.rtoSegundos).toBe(52.4);
    expect(r.totalSegundos).toBe(52.9);
  });

  it("falla si una tabla quedó con otro conteo o no existe en el esquema", () => {
    const m = medicionesPerfectas(backupDeJuguete());
    m.conteosBase = { ...m.conteosBase, patients: 2, appointments: null };
    const r = evaluarSimulacro(m);
    expect(r.estado).toBe("falla");
    const c = check(r, "conteos");
    expect(c.ok).toBe(false);
    expect(c.detalle).toContain("patients (backup 3, base 2)");
    expect(c.detalle).toContain("sin tabla en el esquema: appointments");
  });

  it("falla con filas huérfanas y nombra la FK", () => {
    const m = medicionesPerfectas(backupDeJuguete());
    m.fksRotas = [
      { tabla: "appointments", columna: "patient_id", referencia: "patients", huerfanos: 1 },
    ] as never;
    const r = evaluarSimulacro(m);
    expect(r.estado).toBe("falla");
    expect(check(r, "fks").detalle).toContain("appointments.patient_id → patients (1)");
  });

  it("falla si un usuario de auth no volvió con su id", () => {
    const m = medicionesPerfectas(backupDeJuguete());
    m.usuariosRestaurados = ["u-1"];
    const r = evaluarSimulacro(m);
    expect(r.estado).toBe("falla");
    expect(check(r, "auth").detalle).toContain("1/2 usuarios");
  });

  it("omite (sin fallar) la verificación de auth en un backup anterior a auth_users", () => {
    const backup = backupDeJuguete({ conAuth: false });
    const r = evaluarSimulacro({ ...medicionesPerfectas(backup), usuariosStub: 2 });
    expect(r.estado).toBe("ok");
    expect(check(r, "auth")).toMatchObject({ ok: true, omitido: true });
  });

  it("falla si un archivo de Storage falta o cambió de tamaño", () => {
    const m = medicionesPerfectas(backupDeJuguete());
    m.objetosBase = { "clinical-documents": [{ path: "c/p-0/rx.png", size: 999 }] };
    const r = evaluarSimulacro(m);
    expect(r.estado).toBe("falla");
    expect(check(r, "storage").detalle).toContain("0/2 archivos");
  });

  it("omite Storage cuando el backup no lo trae", () => {
    const r = evaluarSimulacro({ ...medicionesPerfectas(backupDeJuguete()), manifiesto: null });
    expect(r.estado).toBe("ok");
    expect(check(r, "storage")).toMatchObject({ ok: true, omitido: true });
  });

  it("falla si alguna migración no se pudo aplicar", () => {
    const m = medicionesPerfectas(backupDeJuguete());
    m.migraciones = { ok: 203, fallidas: ["20261110300000_x.sql"] as never[] };
    const r = evaluarSimulacro(m);
    expect(r.estado).toBe("falla");
    expect(check(r, "migraciones").detalle).toContain("20261110300000_x.sql");
  });

  it("no da verde con un backup vacío", () => {
    const backup = { exportedAt: "x", tables: {} };
    const r = evaluarSimulacro({
      ...medicionesPerfectas(backupDeJuguete()),
      backup,
      conteosBase: {},
    });
    expect(check(r, "conteos").ok).toBe(false);
  });
});

describe("reporteMarkdown", () => {
  it("resume estado, RTO y verificaciones sin ningún dato de las filas", () => {
    const backup = backupDeJuguete();
    const r = evaluarSimulacro(medicionesPerfectas(backup));
    const md = reporteMarkdown(r, { origen: "esmalia_20261027_071500.json.gz.age", fecha: "F" });
    expect(md).toContain("✅ Simulacro de restauración: correcto");
    expect(md).toContain("RTO medido");
    expect(md).toContain("52,4 s");
    expect(md).not.toContain(NOMBRE_SENSIBLE);
    expect(md).not.toContain("example.invalid");
    expect(md).not.toContain("rx.png");
  });
});

describe("formatearDuracion", () => {
  it("usa segundos con coma o minutos", () => {
    expect(formatearDuracion(3.04)).toBe("3 s");
    expect(formatearDuracion(40.25)).toBe("40,3 s");
    expect(formatearDuracion(252)).toBe("4 min 12 s");
  });
});

describe("elegirUltimoBackup", () => {
  it("elige el sello más nuevo y su Storage gemelo", () => {
    const r = elegirUltimoBackup(
      [
        "esmalia_20261025_071501.json.gz.age",
        "esmalia_20261027_071503.json.gz.age",
        "esmalia_20261026_071502.json.gz.age",
        "otra-cosa.txt",
      ],
      ["esmalia_storage_20261026_071502.tar.gz.age", "esmalia_storage_20261027_071503.tar.gz.age"],
    );
    expect(r).toEqual({
      db: "esmalia_20261027_071503.json.gz.age",
      storage: "esmalia_storage_20261027_071503.tar.gz.age",
      sello: "20261027_071503",
    });
  });

  it("devuelve null sin backups y storage null si falta el gemelo", () => {
    expect(elegirUltimoBackup([])).toBeNull();
    expect(elegirUltimoBackup(["esmalia_20260818_010623.json.gz.age"], [])?.storage).toBeNull();
  });
});

describe("esUrlLocal", () => {
  it("solo acepta la base efímera local", () => {
    expect(esUrlLocal("http://127.0.0.1:54321")).toBe(true);
    expect(esUrlLocal("http://localhost:54321")).toBe(true);
    expect(esUrlLocal("https://hvfkygoguxvpmwslrccb.supabase.co")).toBe(false);
    expect(esUrlLocal("")).toBe(false);
  });
});
