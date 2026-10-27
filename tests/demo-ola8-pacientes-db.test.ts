import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

import type { Database } from "@/integrations/supabase/types";
import {
  ETIQUETAS_DEMO,
  SEGMENTOS_DEMO,
  sembrarEtiquetasYSegmentosDeLaDemo,
} from "@/lib/demo/ola8-pacientes.server";
import { normalizarFiltros } from "@/lib/patients/filtros-pacientes";
import { conectar } from "./helpers/db";

/**
 * Etiquetas y segmentos de ejemplo de la Ola 8 · A en `/api/demo-reset`,
 * contra la base efímera: `reset_demo_clinic()` + el paso, dos veces (no
 * duplica), sin errores registrados, y los filtros guardados se leen igual
 * que los de la lista.
 */

const DEMO_CLINIC_ID = "20cea989-de9b-4a3e-852a-31347dc3fe83";

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

describe("demo-reset · etiquetas y segmentos (Ola 8 · A), en la base", () => {
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

  it("siembra etiquetas, asignaciones y segmentos sin duplicar ni registrar errores", async () => {
    const { error } = await admin.rpc("reset_demo_clinic");
    expect(error).toBeNull();
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await sembrarEtiquetasYSegmentosDeLaDemo(admin);
      await sembrarEtiquetasYSegmentosDeLaDemo(admin);
      expect(errores).not.toHaveBeenCalled();
    } finally {
      errores.mockRestore();
    }

    const etiquetas = await client.query<{ name: string }>(
      "SELECT name FROM public.patient_labels WHERE clinic_id = $1 ORDER BY name",
      [DEMO_CLINIC_ID],
    );
    expect(etiquetas.rows.map((r) => r.name)).toEqual(
      ETIQUETAS_DEMO.map((e) => e.nombre).sort((a, b) => a.localeCompare(b)),
    );
    const asignaciones = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM public.patient_label_assignments WHERE clinic_id = $1",
      [DEMO_CLINIC_ID],
    );
    expect(Number(asignaciones.rows[0].n)).toBeGreaterThan(0);

    const segmentos = await client.query<{ name: string; filters: unknown }>(
      "SELECT name, filters FROM public.patient_segments WHERE clinic_id = $1",
      [DEMO_CLINIC_ID],
    );
    expect(segmentos.rows).toHaveLength(SEGMENTOS_DEMO.length);
    for (const s of segmentos.rows) {
      const esperado = SEGMENTOS_DEMO.find((d) => d.nombre === s.name);
      expect(normalizarFiltros(s.filters)).toEqual(esperado?.filtros);
    }
  });
});
