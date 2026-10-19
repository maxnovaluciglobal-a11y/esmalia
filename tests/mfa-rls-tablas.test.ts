import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FUNCION_AAL2,
  MIGRACION_AAL2,
  POLITICA_AAL2,
  TABLAS_CON_AAL2,
  TABLAS_SIN_AAL2,
  sqlPoliticaAal2,
  sqlReversaAal2,
  tablasConAal2,
} from "../src/lib/auth/mfa-rls";

/**
 * SEG-01, segunda parte: la política RESTRICTIVE `mfa_exige_aal2` hace que
 * el MFA de quien lo activó valga contra PostgREST y no solo en la pantalla.
 *
 * Una lista de tablas protegidas se pudre igual que la del backup
 * (`backup-tables-sync.test.ts`): alguien crea `prescriptions` con datos de
 * salud, nadie se acuerda de la política, y el hueco vuelve en silencio. Por
 * eso este test obliga a CLASIFICAR toda tabla del schema: o exige aal2, o
 * está en la lista de excluidas con su motivo.
 *
 * Puro: lee archivos del repo, sin red ni base.
 */

const DIR_MIGRACIONES = new URL("../supabase/migrations/", import.meta.url);

// Mismo parser que backup-tables-sync.test.ts.
const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z0-9_]+)\1/gi;

function tablasDelSchema(): string[] {
  const encontradas = new Set<string>();
  for (const archivo of readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(new URL(archivo, DIR_MIGRACIONES), "utf8");
    for (const [, , tabla] of sql.matchAll(CREATE_TABLE)) encontradas.add(tabla);
  }
  return [...encontradas].sort();
}

function migracion(): string {
  return readFileSync(new URL(MIGRACION_AAL2, DIR_MIGRACIONES), "utf8");
}

describe("clasificación de tablas para la política aal2", () => {
  it("el parser encuentra las tablas clínicas conocidas", () => {
    const schema = tablasDelSchema();
    for (const t of ["patients", "clinical_notes", "odontogram_marks", "payments", "quotes"]) {
      expect(schema).toContain(t);
    }
  });

  it("toda tabla del schema está clasificada (con o sin aal2)", () => {
    const sinClasificar = tablasDelSchema().filter(
      (t) => !(t in TABLAS_CON_AAL2) && !(t in TABLAS_SIN_AAL2),
    );
    expect(
      sinClasificar,
      "Tabla nueva sin clasificar. Si guarda datos de salud, de un paciente o de dinero, " +
        "agregala a TABLAS_CON_AAL2 en src/lib/auth/mfa-rls.ts y crea la política en una " +
        "migración nueva con sqlPoliticaAal2(). Si no, agregala a TABLAS_SIN_AAL2 con el motivo.",
    ).toEqual([]);
  });

  it("ninguna tabla está en las dos listas", () => {
    const enAmbas = Object.keys(TABLAS_CON_AAL2).filter((t) => t in TABLAS_SIN_AAL2);
    expect(enAmbas).toEqual([]);
  });

  it("las listas no nombran tablas que no existen", () => {
    const schema = new Set(tablasDelSchema());
    const fantasmas = [...Object.keys(TABLAS_CON_AAL2), ...Object.keys(TABLAS_SIN_AAL2)].filter(
      (t) => !schema.has(t),
    );
    expect(fantasmas).toEqual([]);
  });

  it("cubre las tablas que pidió el hallazgo", () => {
    for (const t of [
      "patients",
      "clinical_notes",
      "clinical_note_versions",
      "odontogram_marks",
      "periodontal_charts",
      "periodontal_measurements",
      "patient_medical_history",
      "patient_documents",
      "patient_consents",
      "quotes",
      "quote_items",
      "payments",
    ]) {
      expect(TABLAS_CON_AAL2).toHaveProperty(t);
    }
  });

  it("cada clasificación tiene motivo", () => {
    for (const motivo of [...Object.values(TABLAS_CON_AAL2), ...Object.values(TABLAS_SIN_AAL2)]) {
      expect(motivo.trim().length).toBeGreaterThan(5);
    }
  });
});

describe("SQL generado", () => {
  it("la política es RESTRICTIVE, para authenticated y evalúa la función una vez por consulta", () => {
    const sql = sqlPoliticaAal2("patients");
    expect(sql).toContain(`create policy ${POLITICA_AAL2} on public.patients`);
    expect(sql).toContain("as restrictive");
    expect(sql).toContain("for all");
    expect(sql).toContain("to authenticated");
    // `(select f())` → InitPlan: una evaluación por consulta, no por fila.
    expect(sql).toContain(`using ((select ${FUNCION_AAL2}))`);
    expect(sql).toContain(`with check ((select ${FUNCION_AAL2}))`);
    expect(sql.startsWith(`drop policy if exists ${POLITICA_AAL2} on public.patients;`)).toBe(true);
  });

  it("rechaza nombres de tabla que no son identificadores simples", () => {
    expect(() => sqlPoliticaAal2("patients; drop table x")).toThrow();
    expect(() => sqlReversaAal2('"Patients"')).toThrow();
  });
});

describe(`migración ${MIGRACION_AAL2}`, () => {
  const sql = migracion();

  it("crea la política en cada tabla de la lista, tal cual la genera el módulo", () => {
    const faltan = tablasConAal2().filter((t) => !sql.includes(sqlPoliticaAal2(t)));
    expect(faltan).toEqual([]);
  });

  it("no crea la política en tablas fuera de la lista", () => {
    const creadas = [
      ...sql.matchAll(new RegExp(`^create policy ${POLITICA_AAL2} on public\\.([a-z0-9_]+)`, "gm")),
    ].map((m) => m[1]);
    expect(creadas.sort()).toEqual(tablasConAal2());
  });

  it("documenta la reversa de cada tabla", () => {
    const faltan = tablasConAal2().filter((t) => !sql.includes(`-- ${sqlReversaAal2(t)}`));
    expect(faltan).toEqual([]);
    expect(sql).toContain("-- drop function if exists public.sesion_cumple_mfa();");
  });

  it("la función es STABLE, SECURITY DEFINER, con search_path vacío y sin EXECUTE para anon", () => {
    const def = sql.slice(
      sql.indexOf("create or replace function public.sesion_cumple_mfa()"),
      sql.indexOf("$$;"),
    );
    expect(def).toMatch(/\bstable\b/);
    expect(def).toMatch(/\bsecurity definer\b/);
    expect(def).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke execute on function public.sesion_cumple_mfa() from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.sesion_cumple_mfa() to authenticated, service_role;",
    );
  });

  it("aplica el patrón oficial: aal2 si hay factor verificado, libre si no, y deja pasar a la demo", () => {
    expect(sql).toContain("coalesce(auth.jwt() ->> 'aal', '') = 'aal2'");
    expect(sql).toMatch(/not exists \(\s*select 1\s+from auth\.mfa_factors f/);
    expect(sql).toContain("f.status = 'verified'");
    expect(sql).toContain("'demo@esmalia.com'");
  });

  it("protege el bucket de documentos clínicos sin tocar los demás buckets", () => {
    expect(sql).toContain(
      "using (bucket_id <> 'clinical-documents' or (select public.sesion_cumple_mfa()))",
    );
  });

  it("corre en una transacción", () => {
    expect(sql).toMatch(/^begin;$/m);
    expect(sql).toMatch(/^commit;$/m);
  });
});
