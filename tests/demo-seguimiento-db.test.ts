import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

import type { Database } from "@/integrations/supabase/types";
import { DEMO_CLINIC_ID } from "@/lib/demo/ola9.server";
import { sembrarSeguimientoDeLaDemo } from "@/lib/demo/seguimiento.server";
import { conectar } from "./helpers/db";

/**
 * Datos de ejemplo de Seguimiento (Ola 8 · frente B) en `/api/demo-reset`,
 * contra la base efímera: `reset_demo_clinic()` + el paso, dos veces seguidas
 * (no duplica), y un segundo reset con los datos ya sembrados (las FKs
 * RESTRICT hacia pacientes no lo traban). El paso no puede registrar errores.
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

describe("demo-reset · datos de Seguimiento, en la base", () => {
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

  async function contar(tabla: string, extra = ""): Promise<number> {
    const r = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.${tabla} WHERE clinic_id = $1 ${extra}`,
      [DEMO_CLINIC_ID],
    );
    return Number(r.rows[0].n);
  }

  async function resetYSembrar(veces: number) {
    const { error } = await admin.rpc("reset_demo_clinic");
    expect(error).toBeNull();
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let i = 0; i < veces; i++) await sembrarSeguimientoDeLaDemo(admin);
      expect(errores).not.toHaveBeenCalled();
    } finally {
      errores.mockRestore();
    }
  }

  async function verificar() {
    expect(await contar("patient_controls")).toBe(2);
    expect(await contar("patient_controls", "AND due_on < current_date")).toBe(1);
    expect(await contar("followup_tasks")).toBeGreaterThanOrEqual(3);
    expect(await contar("followup_tasks", "AND due_on < current_date")).toBe(1);
    expect(await contar("outreach_templates")).toBe(2);
    expect(await contar("outreach_campaigns", "AND status = 'borrador'")).toBe(1);
    // Nada confirmado ni despachado en la demo.
    expect(await contar("outreach_campaign_recipients")).toBe(0);
  }

  it("siembra controles, tareas, plantillas y una campaña en borrador, sin duplicar", async () => {
    await resetYSembrar(2);
    await verificar();
  });

  it("un segundo reset con los datos sembrados no se traba", async () => {
    await resetYSembrar(1);
    await verificar();
  });
});
