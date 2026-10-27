import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TABLAS_EXCLUIDAS_EXPORTACION,
  TABLAS_EXPORTACION,
} from "../src/lib/exportacion/exportacion-clinica";
import { TIPOS_COLUMNAS } from "../src/lib/exportacion/tipos-columnas";

/**
 * Cobertura de la exportación completa (EXP-02, Ola 6).
 *
 * La exportación promete "todos los datos de tu clínica". Esa promesa se
 * rompe en silencio cada vez que una ola agrega una tabla (o una columna) y
 * nadie la suma a `TABLAS_EXPORTACION`: el ZIP sigue saliendo, verde, con
 * menos datos. Mismo problema que `backup-tables-sync.test.ts` resuelve para
 * el backup: este test obliga a decidir. Toda tabla con `clinic_id` en
 * `types.ts` está exportada o excluida con su motivo, y toda columna de una
 * tabla exportada sale o figura en `omitidas` con su motivo.
 */

const FUENTE_TYPES = readFileSync(
  new URL("../src/integrations/supabase/types.ts", import.meta.url),
  "utf8",
);

/** Bloque `public.Tables` de types.ts: tabla → columnas del `Row`. */
function tablasDeTypes(): Map<string, Map<string, string>> {
  const inicioPublic = FUENTE_TYPES.indexOf("  public: {");
  const inicio = FUENTE_TYPES.indexOf("    Tables: {", inicioPublic);
  const fin = FUENTE_TYPES.indexOf("    Views: {", inicio);
  const bloque = FUENTE_TYPES.slice(inicio, fin);
  const salida = new Map<string, Map<string, string>>();
  for (const m of bloque.matchAll(/^ {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\};/gm)) {
    const columnas = new Map<string, string>();
    for (const c of m[2].matchAll(/^ {10}([a-z0-9_]+): (.+);$/gm)) columnas.set(c[1], c[2]);
    salida.set(m[1], columnas);
  }
  return salida;
}

const TABLAS = tablasDeTypes();
const EXPORTADAS = new Map(TABLAS_EXPORTACION.map((t) => [t.tabla, t]));

describe("cobertura de la exportación completa", () => {
  it("lee las tablas de types.ts", () => {
    // Ancla: si el parser se rompe, todo lo de abajo pasaría sin comparar nada.
    expect(TABLAS.size).toBeGreaterThan(60);
    expect(TABLAS.get("patients")?.has("clinic_id")).toBe(true);
    expect(TABLAS.get("appointments")?.has("starts_at")).toBe(true);
  });

  it("toda tabla con clinic_id se exporta o se excluye con motivo", () => {
    const sinDecidir = [...TABLAS]
      .filter(([, cols]) => cols.has("clinic_id"))
      .map(([tabla]) => tabla)
      .filter((t) => !EXPORTADAS.has(t) && !(t in TABLAS_EXCLUIDAS_EXPORTACION));
    expect(
      sinDecidir,
      `Estas tablas tienen clinic_id y no salen en la exportación: ${sinDecidir.join(", ")}. ` +
        "Agrégalas a TABLAS_EXPORTACION (src/lib/exportacion/exportacion-clinica.ts) " +
        "o a TABLAS_EXCLUIDAS_EXPORTACION con el motivo.",
    ).toEqual([]);
  });

  it("no exporta y excluye la misma tabla, ni excluye tablas que ya no existen", () => {
    for (const tabla of Object.keys(TABLAS_EXCLUIDAS_EXPORTACION)) {
      expect(EXPORTADAS.has(tabla), `${tabla} está exportada y excluida`).toBe(false);
      expect(TABLAS.has(tabla), `${tabla} se excluye pero no existe en types.ts`).toBe(true);
      expect(TABLAS_EXCLUIDAS_EXPORTACION[tabla].length).toBeGreaterThan(20);
    }
  });

  it("las credenciales y secretos quedan fuera", () => {
    for (const t of ["whatsapp_credentials", "subscriptions", "stripe_events"]) {
      expect(EXPORTADAS.has(t)).toBe(false);
    }
  });

  it("toda columna de una tabla exportada sale o se omite con motivo", () => {
    const faltantes: string[] = [];
    for (const t of TABLAS_EXPORTACION) {
      const reales = TABLAS.get(t.tabla);
      expect(reales, `${t.tabla} no está en types.ts`).toBeDefined();
      const omitidas = t.omitidas ?? {};
      for (const columna of reales!.keys()) {
        if (columna === "clinic_id") continue;
        if (t.columnas.includes(columna) || columna in omitidas) continue;
        faltantes.push(`${t.tabla}.${columna}`);
      }
      for (const [columna, motivo] of Object.entries(omitidas)) {
        expect(reales!.has(columna), `${t.tabla}.${columna} se omite pero no existe`).toBe(true);
        expect(t.columnas, `${t.tabla}.${columna} sale y se omite`).not.toContain(columna);
        expect(motivo.length, `${t.tabla}.${columna}: falta el motivo`).toBeGreaterThan(10);
      }
    }
    expect(
      faltantes,
      `Columnas que no salen ni tienen motivo: ${faltantes.join(", ")}. ` +
        "Agrégalas a `columnas` de su tabla o a `omitidas` con el motivo.",
    ).toEqual([]);
  });

  it("toda columna exportada tiene su tipo en el manifiesto, coherente con types.ts", () => {
    const sinTipo: string[] = [];
    const incoherentes: string[] = [];
    const numericos = new Set(["entero", "decimal"]);
    for (const t of TABLAS_EXPORTACION) {
      const tipos = TIPOS_COLUMNAS[t.tabla] ?? {};
      const reales = TABLAS.get(t.tabla)!;
      for (const c of t.columnas) {
        const tipo = tipos[c];
        if (!tipo) {
          sinTipo.push(`${t.tabla}.${c}`);
          continue;
        }
        const ts = (reales.get(c) ?? "").replace(/ \| null$/, "");
        const esNumero = ts === "number";
        const esBool = ts === "boolean";
        const esJson = ts === "Json" || ts.endsWith("[]");
        if (esNumero !== numericos.has(tipo))
          incoherentes.push(`${t.tabla}.${c}: ${ts} vs ${tipo}`);
        if (esBool !== (tipo === "booleano"))
          incoherentes.push(`${t.tabla}.${c}: ${ts} vs ${tipo}`);
        if (esJson !== (tipo === "json" || tipo === "lista"))
          incoherentes.push(`${t.tabla}.${c}: ${ts} vs ${tipo}`);
      }
    }
    expect(sinTipo, `Columnas sin tipo en tipos-columnas.ts: ${sinTipo.join(", ")}`).toEqual([]);
    expect(incoherentes).toEqual([]);
  });

  it("tipos-columnas.ts no describe tablas que no se exportan", () => {
    for (const tabla of Object.keys(TIPOS_COLUMNAS)) {
      expect(EXPORTADAS.has(tabla), tabla).toBe(true);
    }
  });

  it("incluye las tablas de las olas 1 a 5", () => {
    for (const t of [
      "appointment_types",
      "operatories",
      "schedule_blocks",
      "specialties",
      "treatment_plans",
      "receivables",
      "payments",
      "prescriptions",
      "issued_documents",
      "remote_signature_requests",
      "data_subject_requests",
      "security_incidents",
    ]) {
      if (TABLAS.has(t)) expect(EXPORTADAS.has(t), t).toBe(true);
    }
  });
});
