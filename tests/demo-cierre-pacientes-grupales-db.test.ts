import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

import type { Database } from "@/integrations/supabase/types";
import { sembrarCierrePacientesGrupalesDeLaDemo } from "@/lib/demo/cierre-pacientes-grupales.server";
import { sembrarGrupalesYEsterilizacionDeLaDemo } from "@/lib/demo/grupales-esterilizacion.server";
import { sembrarInformesDeLaDemo } from "@/lib/demo/informes.server";
import { DEMO_CLINIC_ID } from "@/lib/demo/ola9.server";
import { conectar } from "./helpers/db";

/**
 * Datos de ejemplo del cierre de la fase (pacientes y grupales) en
 * `/api/demo-reset`, contra la base efímera: el sexo repartido en las fichas,
 * el almuerzo semanal bloqueado (mapa de calor neto) y los avisos por
 * inscrito en la charla de hoy. Idempotente y sin errores.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno (ver docs/TESTS.md).`);
  return value;
}

describe("demo-reset · cierre pacientes y grupales, en la base", () => {
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

  it("siembra sexo, almuerzo y avisos sin errores, y una segunda vez no duplica", async () => {
    const { error } = await admin.rpc("reset_demo_clinic");
    expect(error).toBeNull();
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await sembrarGrupalesYEsterilizacionDeLaDemo(admin);
      await sembrarInformesDeLaDemo(admin);
      await sembrarCierrePacientesGrupalesDeLaDemo(admin);
      await sembrarCierrePacientesGrupalesDeLaDemo(admin);
      expect(errores).not.toHaveBeenCalled();
    } finally {
      errores.mockRestore();
    }

    const sexos = await client.query<{ sex: string | null; n: string }>(
      "SELECT sex, count(*) AS n FROM public.patients WHERE clinic_id = $1 GROUP BY sex",
      [DEMO_CLINIC_ID],
    );
    const distintos = new Set(sexos.rows.map((r) => r.sex));
    expect(distintos.has("femenino")).toBe(true);
    expect(distintos.has("masculino")).toBe(true);
    expect(distintos.has("prefiere_no_decir")).toBe(true);

    const almuerzos = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.agenda_exceptions
        WHERE clinic_id = $1 AND kind = 'bloqueo' AND reason = 'almuerzo' AND repeat_weekly`,
      [DEMO_CLINIC_ID],
    );
    expect(Number(almuerzos.rows[0].n)).toBe(5);

    const avisos = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.appointment_group_participants
        WHERE clinic_id = $1 AND patient_confirmed_at IS NOT NULL`,
      [DEMO_CLINIC_ID],
    );
    expect(Number(avisos.rows[0].n)).toBe(2);
    // La marca de la cita entera no se toca.
    const cabecera = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.appointments a
        JOIN public.appointment_groups g ON g.appointment_id = a.id
        WHERE a.clinic_id = $1 AND a.patient_confirmed_at IS NOT NULL`,
      [DEMO_CLINIC_ID],
    );
    expect(Number(cabecera.rows[0].n)).toBe(0);

    // El mapa de calor neto descuenta el almuerzo en la clínica demo.
    const desde = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const neta = await client.query<{ bloqueados: string }>(
      `SELECT coalesce(sum(minutos_bloqueados), 0) AS bloqueados
         FROM public.informe_ocupacion_neta($1, $2::date, $3::date)`,
      [DEMO_CLINIC_ID, desde, hasta],
    );
    expect(Number(neta.rows[0].bloqueados)).toBeGreaterThan(0);
  });
});
