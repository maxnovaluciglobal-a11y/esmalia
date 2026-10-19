import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ETIQUETA_SECCION,
  SECCIONES_FICHA,
  etiquetaSeccion,
} from "../src/lib/clinical/lecturas-ficha";
import {
  registrarLecturaDeFicha,
  reiniciarReportesDeLectura,
} from "../src/lib/clinical/lecturas-ficha.server";

/**
 * Registro de lecturas de la ficha (SEG-02). Tests puros: sin red ni base.
 * El comportamiento en Postgres (dedup de 15 min, RLS owner/admin,
 * inmutabilidad, cascada con la clínica) se verificó a mano contra una base
 * local al escribir la migración; acá se fijan las piezas que la app y la
 * migración tienen que mantener alineadas.
 */

const MIGRACION = readFileSync(
  new URL("../supabase/migrations/20261019160000_registro_lecturas_ficha.sql", import.meta.url),
  "utf8",
);

const ARGS = {
  clinicId: "aaaaaaaa-0000-4000-8000-000000000001",
  patientId: "11111111-0000-4000-8000-000000000001",
  seccion: "notas" as const,
};

function clienteQueResponde(respuesta: { error: { code?: string; message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: respuesta.error ? null : true, ...respuesta });
  return { rpc, cliente: { rpc } as unknown as Parameters<typeof registrarLecturaDeFicha>[0] };
}

beforeEach(() => {
  reiniciarReportesDeLectura();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("vocabulario de secciones", () => {
  it("es el mismo en la app y en el CHECK de la tabla", () => {
    const check = MIGRACION.match(/section IN \(([^)]*)\)/);
    expect(check, "no se encontró el CHECK de section en la migración").not.toBeNull();
    const enSql = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(enSql).toEqual([...SECCIONES_FICHA]);
  });

  it("cada sección tiene su texto para la pantalla", () => {
    for (const s of SECCIONES_FICHA) expect(ETIQUETA_SECCION[s]).toBeTruthy();
    expect(etiquetaSeccion("anamnesis")).toBe("Anamnesis");
    // Una sección que la app no conoce se muestra tal cual, no rompe la tabla.
    expect(etiquetaSeccion("otra")).toBe("otra");
  });
});

describe("la migración", () => {
  it("no abre ninguna escritura a los usuarios", () => {
    expect(MIGRACION).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i);
    expect(MIGRACION).toMatch(
      /REVOKE ALL ON public\.clinical_access_log FROM PUBLIC, anon, authenticated;/,
    );
    expect(MIGRACION).toMatch(/GRANT SELECT ON public\.clinical_access_log TO authenticated;/);
  });

  it("solo owner/admin leen el registro", () => {
    expect(MIGRACION).toMatch(
      /FOR SELECT TO authenticated\s+USING \(public\.can_manage_clinic\(clinic_id\)\)/,
    );
  });

  it("el RPC estampa el actor y no es ejecutable por anon", () => {
    expect(MIGRACION).toMatch(/v_actor uuid := auth\.uid\(\)/);
    expect(MIGRACION).toMatch(
      /REVOKE ALL ON FUNCTION public\.registrar_lectura_ficha\(uuid, uuid, text\) FROM PUBLIC, anon;/,
    );
  });

  it("deduplica en 15 minutos", () => {
    expect(MIGRACION).toMatch(/now\(\) - interval '15 minutes'/);
  });

  it("no tiene FK a pacientes ni a usuarios (un registro no puede ser un candado)", () => {
    const tabla = MIGRACION.slice(
      MIGRACION.indexOf("CREATE TABLE IF NOT EXISTS public.clinical_access_log"),
      MIGRACION.indexOf("CREATE INDEX IF NOT EXISTS clinical_access_log_clinic_accessed_idx"),
    );
    expect(tabla).toMatch(
      /clinic_id uuid NOT NULL REFERENCES public\.clinics\(id\) ON DELETE CASCADE/,
    );
    expect(tabla).not.toMatch(/patient_id[^,\n]*REFERENCES/);
    expect(tabla).not.toMatch(/actor_id[^,\n]*REFERENCES/);
  });
});

describe("registrarLecturaDeFicha", () => {
  it("llama al RPC con la clínica, el paciente y la sección", async () => {
    const { rpc, cliente } = clienteQueResponde({ error: null });
    const reportar = vi.fn();
    await registrarLecturaDeFicha(cliente, ARGS, reportar);
    expect(rpc).toHaveBeenCalledWith("registrar_lectura_ficha", {
      p_clinic_id: ARGS.clinicId,
      p_patient_id: ARGS.patientId,
      p_seccion: "notas",
    });
    expect(reportar).not.toHaveBeenCalled();
  });

  it("un error de la base no rompe la carga de la ficha y se reporta", async () => {
    const { cliente } = clienteQueResponde({
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const reportar = vi.fn();
    await expect(registrarLecturaDeFicha(cliente, ARGS, reportar)).resolves.toBeUndefined();
    expect(reportar).toHaveBeenCalledTimes(1);
    const mensaje = (reportar.mock.calls[0][0] as Error).message;
    expect(mensaje).toContain("notas");
    // Nada que identifique al paciente en el aviso.
    expect(mensaje).not.toContain(ARGS.patientId);
  });

  it("una excepción del cliente tampoco se propaga", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const reportar = vi.fn();
    await expect(
      registrarLecturaDeFicha(
        { rpc } as unknown as Parameters<typeof registrarLecturaDeFicha>[0],
        ARGS,
        reportar,
      ),
    ).resolves.toBeUndefined();
    expect(reportar).toHaveBeenCalledTimes(1);
  });

  it("si reportar falla, igual no se propaga", async () => {
    const { cliente } = clienteQueResponde({ error: { code: "XX000", message: "boom" } });
    const reportar = vi.fn().mockRejectedValue(new Error("sentry caído"));
    await expect(registrarLecturaDeFicha(cliente, ARGS, reportar)).resolves.toBeUndefined();
  });

  it("el mismo fallo se reporta una sola vez por intervalo (migración sin aplicar)", async () => {
    const { cliente } = clienteQueResponde({
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const reportar = vi.fn();
    for (let i = 0; i < 5; i++) await registrarLecturaDeFicha(cliente, ARGS, reportar);
    expect(reportar).toHaveBeenCalledTimes(1);
  });

  it("'el paciente no es de esta clínica' (42501) no es un error para Sentry", async () => {
    const { cliente } = clienteQueResponde({
      error: { code: "42501", message: "el paciente no pertenece a esta clinica" },
    });
    const reportar = vi.fn();
    await registrarLecturaDeFicha(cliente, ARGS, reportar);
    expect(reportar).not.toHaveBeenCalled();
  });
});

describe("las server functions de la ficha registran la lectura", () => {
  // Guardia contra que alguien saque la llamada al refactorizar un loader.
  const casos: Array<[string, string, number]> = [
    ["../src/lib/patients/patients.functions.ts", "datos", 1],
    ["../src/lib/clinical/clinical-notes.functions.ts", "notas", 1],
    ["../src/lib/clinical/odontogram.functions.ts", "odontograma", 2],
    ["../src/lib/clinical/periodontal.functions.ts", "periodontograma", 2],
    ["../src/lib/clinical/medical-history.functions.ts", "anamnesis", 1],
    ["../src/lib/clinical/clinical-documents.functions.ts", "documentos", 2],
    ["../src/lib/clinical/prescriptions.functions.ts", "documentos", 1],
  ];

  it.each(casos)("%s registra '%s'", (archivo, seccion, veces) => {
    const fuente = readFileSync(new URL(archivo, import.meta.url), "utf8");
    const llamadas = fuente.match(new RegExp(`seccion: "${seccion}"`, "g")) ?? [];
    expect(llamadas.length).toBe(veces);
    // Y se espera antes de responder (si no, Vercel puede congelar la
    // función con la escritura pendiente).
    expect((fuente.match(/await lectura;/g) ?? []).length).toBeGreaterThanOrEqual(veces);
  });
});
