import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

import type { Database } from "@/integrations/supabase/types";
import { PREGUNTAS_RIESGO } from "@/lib/clinical/anamnesis";
import { nicDeSitio } from "@/lib/clinical/periodontal-nic";
import {
  CATALOGO_LAB_DEMO,
  DEMO_CLINIC_ID,
  PACIENTE_OLA9_DEMO,
  PROTOCOLOS_DEMO,
  sembrarOla9DeLaDemo,
} from "@/lib/demo/ola9.server";
import { conectar } from "./helpers/db";

/**
 * Datos de ejemplo de la Ola 9 en `/api/demo-reset`, contra la base efímera:
 * `reset_demo_clinic()` + los cuatro pasos, dos veces seguidas (no duplica),
 * y un segundo reset con los datos ya sembrados (las FKs RESTRICT hacia
 * pacientes e implantes no lo traban). Ningún paso puede registrar errores.
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

describe("demo-reset · datos de la Ola 9, en la base", () => {
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
    // La demo no queda en la base compartida de la suite.
    await client.query("DELETE FROM public.clinics WHERE id = $1", [DEMO_CLINIC_ID]);
    await client.end();
  });

  async function contar(sql: string): Promise<number> {
    const r = await client.query<{ n: string }>(sql, [DEMO_CLINIC_ID]);
    return Number(r.rows[0].n);
  }

  async function resetYSembrar(veces: number) {
    const { error } = await admin.rpc("reset_demo_clinic");
    expect(error).toBeNull();
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let i = 0; i < veces; i++) await sembrarOla9DeLaDemo(admin);
      expect(errores).not.toHaveBeenCalled();
    } finally {
      errores.mockRestore();
    }
  }

  async function verificar() {
    const paciente = await client.query<{ id: string }>(
      "SELECT id FROM public.patients WHERE clinic_id = $1 AND full_name = $2",
      [DEMO_CLINIC_ID, PACIENTE_OLA9_DEMO],
    );
    const pacienteId = paciente.rows[0].id;

    // Periodontograma: 2 exámenes del mismo paciente, meses aparte, con recesión.
    const charts = await client.query<{ id: string; recorded_at: Date }>(
      `SELECT id, recorded_at FROM public.periodontal_charts
        WHERE clinic_id = $1 AND patient_id = $2 ORDER BY recorded_at`,
      [DEMO_CLINIC_ID, pacienteId],
    );
    expect(charts.rows).toHaveLength(2);
    const meses =
      (charts.rows[1].recorded_at.getTime() - charts.rows[0].recorded_at.getTime()) /
      (30 * 86_400_000);
    expect(meses).toBeGreaterThan(6);
    const sitios = await client.query<{
      chart_id: string;
      tooth_number: number;
      point: string;
      pocket_depth_mm: number;
      recession_mm: number;
    }>(
      `SELECT chart_id, tooth_number, point, pocket_depth_mm, recession_mm
         FROM public.periodontal_measurements
        WHERE chart_id = ANY($1) AND point <> 'whole'`,
      [charts.rows.map((c) => c.id)],
    );
    expect(sitios.rows).toHaveLength(2 * 6 * 6);
    expect(sitios.rows.every((s) => s.recession_mm !== null)).toBe(true);
    const nic = (chart: string, diente: number, punto: string) => {
      const s = sitios.rows.find(
        (x) => x.chart_id === chart && x.tooth_number === diente && x.point === punto,
      );
      return nicDeSitio(s?.pocket_depth_mm ?? null, s?.recession_mm ?? null) ?? 0;
    };
    const [antes, despues] = charts.rows.map((c) => c.id);
    // Hay sitios que mejoran y sitios que empeoran (umbral de 2 mm).
    expect(nic(despues, 26, "dv") - nic(antes, 26, "dv")).toBeLessThanOrEqual(-2);
    expect(nic(despues, 46, "dv") - nic(antes, 46, "dv")).toBeGreaterThanOrEqual(2);

    // Laboratorio.
    expect(
      await contar("SELECT count(*) AS n FROM public.lab_catalog_items WHERE clinic_id = $1"),
    ).toBe(CATALOGO_LAB_DEMO.length);
    const ordenes = await client.query<{
      shade: string;
      material: string;
      margin_type: string;
      atrasada: boolean;
    }>(
      `SELECT shade, material, margin_type,
              (due_on < (now() AT TIME ZONE 'America/Santiago')::date AND status = 'enviado') AS atrasada
         FROM public.lab_orders WHERE clinic_id = $1 AND catalog_item_id IS NOT NULL`,
      [DEMO_CLINIC_ID],
    );
    expect(ordenes.rows).toHaveLength(2);
    expect(ordenes.rows.every((o) => o.shade && o.material && o.margin_type)).toBe(true);
    expect(ordenes.rows.filter((o) => o.atrasada)).toHaveLength(1);

    // Ortodoncia: alineadores con 2 etapas y brackets con 3.
    const casos = await client.query<{ kind: string; aligner_current: number; etapas: string }>(
      `SELECT c.kind, c.aligner_current,
              (SELECT count(*) FROM public.ortho_stage_events e WHERE e.ortho_case_id = c.id) AS etapas
         FROM public.ortho_cases c WHERE c.clinic_id = $1 ORDER BY c.kind`,
      [DEMO_CLINIC_ID],
    );
    expect(casos.rows.map((c) => [c.kind, Number(c.etapas)])).toEqual([
      ["brackets", 3],
      ["aligners", 2],
    ]);
    expect(casos.rows.find((c) => c.kind === "aligners")?.aligner_current).toBe(9);

    // Ficha clínica.
    expect(
      await contar("SELECT count(*) AS n FROM public.clinical_protocols WHERE clinic_id = $1"),
    ).toBe(PROTOCOLOS_DEMO.length);
    const inter = await client.query<{ status: string }>(
      "SELECT status FROM public.patient_referrals WHERE clinic_id = $1 ORDER BY status",
      [DEMO_CLINIC_ID],
    );
    expect(inter.rows.map((r) => r.status)).toEqual(["enviada", "respondida"]);
    const implantes = await client.query<{ tooth: number; status: string; lot: string }>(
      "SELECT tooth, status, lot FROM public.patient_implants WHERE clinic_id = $1 ORDER BY tooth",
      [DEMO_CLINIC_ID],
    );
    expect(implantes.rows.map((i) => [i.tooth, i.status])).toEqual([
      [36, "oseointegrado"],
      [45, "colocado"],
    ]);
    expect(
      await contar(
        "SELECT count(*) AS n FROM public.patient_implant_controls WHERE clinic_id = $1",
      ),
    ).toBe(1);
    const historia = await client.query<{ rq: Record<string, unknown> }>(
      "SELECT risk_questionnaire AS rq FROM public.patient_medical_history WHERE patient_id = $1",
      [pacienteId],
    );
    expect(Object.keys(historia.rows[0].rq).sort()).toEqual(
      PREGUNTAS_RIESGO.map((p) => p.key).sort(),
    );
    expect(
      await contar(
        "SELECT count(*) AS n FROM public.clinical_notes WHERE clinic_id = $1 AND restricted",
      ),
    ).toBe(0);
  }

  it("siembra todo y una segunda corrida no duplica", async () => {
    await resetYSembrar(2);
    await verificar();
  });

  it("el reset siguiente borra lo sembrado y se vuelve a sembrar igual", async () => {
    await resetYSembrar(1);
    await verificar();
  });
});
