import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

import type { Database } from "@/integrations/supabase/types";
import { pngGenerado, sembrarExamenesDeLaDemo } from "@/lib/demo/examenes.server";
import { DEMO_CLINIC_ID } from "@/lib/demo/ola9.server";
import { conectar } from "./helpers/db";

/**
 * Datos de ejemplo de la Ola 13 · frente A en `/api/demo-reset`, contra la
 * base efímera (con Storage): `reset_demo_clinic()` + el paso de exámenes dos
 * veces (no duplica) y un segundo reset con los exámenes ya sembrados (las
 * FKs RESTRICT hacia pacientes y sesiones no lo traban). Sin errores.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Este test corre contra la base local de ` +
        `scripts/test-db/start.sh (ver docs/TESTS.md).`,
    );
  }
  return value;
}

describe("demo-reset · exámenes de la Ola 13, en la base", () => {
  let admin: SupabaseClient<Database>;
  let client: Client;

  beforeAll(async () => {
    admin = createClient<Database>(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    client = await conectar();
  });

  afterAll(async () => {
    await client.query("DELETE FROM public.clinics WHERE id = $1", [DEMO_CLINIC_ID]);
    await client.end();
  });

  async function resetYSembrar(veces: number) {
    const { error } = await admin.rpc("reset_demo_clinic");
    expect(error).toBeNull();
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let i = 0; i < veces; i++) await sembrarExamenesDeLaDemo(admin);
      expect(errores).not.toHaveBeenCalled();
    } finally {
      errores.mockRestore();
    }
  }

  async function verificar() {
    const ex = await client.query<{ kind: string; status: string; storage_path: string }>(
      "SELECT kind, status, storage_path FROM public.patient_exams WHERE clinic_id = $1",
      [DEMO_CLINIC_ID],
    );
    expect(ex.rows).toHaveLength(5);
    expect(ex.rows.every((r) => r.status === "listo")).toBe(true);
    expect(ex.rows.map((r) => r.kind).sort()).toEqual([
      "escaneo_intraoral",
      "foto_clinica",
      "foto_clinica",
      "panoramica",
      "periapical",
    ]);
    const ses = await client.query<{ stage: string; fotos: string }>(
      `SELECT s.stage, (SELECT count(*) FROM public.patient_exams e WHERE e.photo_session_id = s.id) AS fotos
         FROM public.clinical_photo_sessions s WHERE s.clinic_id = $1 ORDER BY s.session_date`,
      [DEMO_CLINIC_ID],
    );
    expect(ses.rows.map((r) => [r.stage, Number(r.fotos)])).toEqual([
      ["antes", 1],
      ["despues", 1],
    ]);
    // Los archivos existen en Storage y son PNG de verdad.
    const png = ex.rows.find((r) => r.storage_path.endsWith("periapical-36.png"))!;
    const { data, error } = await admin.storage.from("clinical-exams").download(png.storage_path);
    expect(error).toBeNull();
    const bytes = new Uint8Array(await data!.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }

  it("siembra exámenes y sesiones, no duplica y no traba el reset siguiente", async () => {
    await resetYSembrar(2);
    await verificar();
    await resetYSembrar(1);
    await verificar();
  });

  it("genera PNG livianos y válidos", () => {
    const png = pngGenerado(4, 3, () => [10, 20, 30]);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.length).toBeLessThan(200);
  });
});
