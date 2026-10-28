import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

import type { Database } from "@/integrations/supabase/types";
import { AREAS_DE_LA_DEMO } from "@/lib/demo/areas";
import { CLINICA_DEMO_ID } from "@/lib/demo/contexto.server";
import { diaEnLaZona, sumarDiasCiviles } from "@/lib/demo/dia-de-la-clinica";
import {
  areasVaciasDeLaDemo,
  estadoActualDeLaDemo,
  reiniciarLaDemo,
  sembrarTodoLoDeLaDemo,
} from "@/lib/demo/reseteo.server";
import { conectar } from "./helpers/db";

/**
 * Demo completa (cierre del 28-oct-2026), contra la base efímera:
 *  - cada área de `AREAS_DE_LA_DEMO` queda con datos (conteos mínimos > 0);
 *  - un segundo reseteo no duplica ni se traba (idempotencia);
 *  - reproduce el "Cobrado hoy: $0" de la Caja: el reseteo SOLO SQL (lo que hacía el primer
 *    visitante del día) deja la caja vacía, y el reseteo completo la deja con cobros de hoy;
 *  - las fechas sembradas siguen el día de la clínica (Santiago), no el de UTC, aunque UTC ya
 *    esté en otro día.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno (ver docs/TESTS.md).`);
  return value;
}

describe("demo completa · siembra por área, en la base", () => {
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

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await client.query("DELETE FROM public.clinics WHERE id = $1", [CLINICA_DEMO_ID]);
    await client.end();
  });

  async function contar(tabla: string): Promise<number> {
    const r = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.${tabla} WHERE clinic_id = $1`,
      [CLINICA_DEMO_ID],
    );
    return Number(r.rows[0].n);
  }

  it("el reseteo solo SQL deja la caja de hoy vacía (el bug) y el completo la llena", async () => {
    const { error } = await admin.rpc("reset_demo_clinic");
    expect(error).toBeNull();
    // Lo que hacía `ensureDemoClinicFresh` en el primer visitante del día: la caja en $0.
    const soloSql = await estadoActualDeLaDemo(admin);
    expect(soloSql.areasVacias).toContain("caja-cobros-de-hoy");
    expect(soloSql.estado).toBe("completar");

    const r = await reiniciarLaDemo(admin, { soloSiHaceFalta: true });
    expect(r.accion).toBe("completar");
    expect(r.fallos).toEqual([]);
    const despues = await estadoActualDeLaDemo(admin);
    expect(despues.areasVacias).toEqual([]);
    expect(despues.estado).toBe("al-dia");
  });

  it("cada área de la demo queda con al menos su mínimo de filas", async () => {
    expect(await areasVaciasDeLaDemo(admin, CLINICA_DEMO_ID)).toEqual([]);
    for (const area of AREAS_DE_LA_DEMO.filter((a) => !a.filtros)) {
      expect(await contar(area.tabla), area.clave).toBeGreaterThanOrEqual(area.minimo);
    }
  });

  it("cobrado hoy tiene movimientos con todos los medios y el efectivo está en la caja abierta", async () => {
    const hoy = diaEnLaZona("America/Santiago");
    const r = await client.query<{ method: string; n: string; en_caja: string }>(
      `SELECT method, count(*) AS n, count(cash_register_id) AS en_caja
         FROM public.payments
        WHERE clinic_id = $1
          AND (paid_at AT TIME ZONE 'America/Santiago')::date = $2::date
        GROUP BY method`,
      [CLINICA_DEMO_ID, hoy],
    );
    const medios = new Set(r.rows.map((f) => f.method));
    for (const m of ["cash", "debit_card", "credit_card", "transfer"])
      expect(medios.has(m)).toBe(true);
    const efectivo = r.rows.find((f) => f.method === "cash");
    expect(Number(efectivo?.en_caja ?? 0)).toBeGreaterThan(0);
  });

  it("un segundo reseteo completo no duplica nada ni falla", async () => {
    const tablas = [
      "payments",
      "appointments",
      "quotes",
      "receivables",
      "receivable_installments",
      "expenses",
      "clinic_members",
      "branch_hours",
      "clinic_medications",
      "procedure_packages",
      "data_subject_requests",
      "security_incidents",
      "import_batches",
      "patient_vital_signs",
      "patient_consents",
      "patient_intake_forms",
      "waiting_room_turns",
    ];
    const antes = Object.fromEntries(
      await Promise.all(tablas.map(async (t) => [t, await contar(t)])),
    );
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fallos = await sembrarTodoLoDeLaDemo(admin);
      expect(fallos).toEqual([]);
      expect(errores).not.toHaveBeenCalled();
    } finally {
      errores.mockRestore();
    }
    const despues = Object.fromEntries(
      await Promise.all(tablas.map(async (t) => [t, await contar(t)])),
    );
    expect(despues).toEqual(antes);
  });

  it("la antigüedad de las cuentas por cobrar y los presupuestos tiene variedad", async () => {
    const r = await client.query<{ tramo: string; n: string }>(
      `SELECT CASE
                WHEN voided_at IS NOT NULL THEN 'anulada'
                WHEN due_on IS NULL THEN 'sin vencimiento'
                WHEN due_on >= (now() AT TIME ZONE 'America/Santiago')::date THEN 'por vencer'
                WHEN due_on >= (now() AT TIME ZONE 'America/Santiago')::date - 30 THEN 'vencida 1-30'
                WHEN due_on >= (now() AT TIME ZONE 'America/Santiago')::date - 60 THEN 'vencida 31-60'
                WHEN due_on >= (now() AT TIME ZONE 'America/Santiago')::date - 90 THEN 'vencida 61-90'
                ELSE 'vencida +90' END AS tramo, count(*) AS n
         FROM public.receivables WHERE clinic_id = $1 GROUP BY 1`,
      [CLINICA_DEMO_ID],
    );
    const tramos = new Set(r.rows.map((f) => f.tramo));
    for (const t of [
      "por vencer",
      "vencida 1-30",
      "vencida 31-60",
      "vencida 61-90",
      "vencida +90",
      "anulada",
    ]) {
      expect(tramos.has(t), t).toBe(true);
    }
    const q = await client.query<{ status: string }>(
      "SELECT DISTINCT status::text AS status FROM public.quotes WHERE clinic_id = $1",
      [CLINICA_DEMO_ID],
    );
    const estados = new Set(q.rows.map((f) => f.status));
    for (const e of ["draft", "sent", "accepted", "rejected", "expired"]) {
      expect(estados.has(e) || estados.has("converted"), e).toBe(true);
    }
  });

  it("hay historial de meses anteriores para los informes (pagos, citas y altas)", async () => {
    const pagos = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.payments
        WHERE clinic_id = $1 AND paid_at < now() - interval '35 days'`,
      [CLINICA_DEMO_ID],
    );
    expect(Number(pagos.rows[0].n)).toBeGreaterThan(30);
    const citas = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.appointments
        WHERE clinic_id = $1 AND status = 'finalizada' AND starts_at < now() - interval '35 days'`,
      [CLINICA_DEMO_ID],
    );
    expect(Number(citas.rows[0].n)).toBeGreaterThan(30);
    const altas = await client.query<{ meses: string }>(
      `SELECT count(DISTINCT date_trunc('month', created_at)) AS meses
         FROM public.patients WHERE clinic_id = $1`,
      [CLINICA_DEMO_ID],
    );
    expect(Number(altas.rows[0].meses)).toBeGreaterThanOrEqual(4);
  });

  it("el día cambia en UTC a las 21:00 de Santiago: lo sembrado sigue el día de la clínica", async () => {
    const { error } = await admin.rpc("reset_demo_clinic");
    expect(error).toBeNull();
    // 29-oct 01:30 UTC = 28-oct 22:30 en Santiago (verano, UTC-3). UTC ya va un día adelante.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T01:30:00Z"));
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-10-29");
    expect(diaEnLaZona("America/Santiago")).toBe("2026-10-28");

    const fallos = await sembrarTodoLoDeLaDemo(admin);
    expect(fallos).toEqual([]);

    // Cuenta por cobrar emitida hace 125 días: 25-jun (día de la clínica), no 26-jun (día de UTC).
    const cuenta = await client.query<{ emitida: string; vence: string }>(
      `SELECT issued_on::text AS emitida, due_on::text AS vence FROM public.receivables
        WHERE clinic_id = $1 AND description = 'Corona dental pieza 2.6'`,
      [CLINICA_DEMO_ID],
    );
    expect(cuenta.rows).toEqual([
      {
        emitida: sumarDiasCiviles("2026-10-28", -125),
        vence: sumarDiasCiviles("2026-10-28", -100),
      },
    ]);
    expect(cuenta.rows[0].emitida).toBe("2026-06-25");

    // Los cobros de "hoy" caen dentro del 28 de Santiago, no del 29.
    const cobros = await client.query<{ dia: string; n: string }>(
      `SELECT (paid_at AT TIME ZONE 'America/Santiago')::date::text AS dia, count(*) AS n
         FROM public.payments WHERE clinic_id = $1 AND notes LIKE 'Demo · %' GROUP BY 1`,
      [CLINICA_DEMO_ID],
    );
    expect(cobros.rows).toEqual([{ dia: "2026-10-28", n: "10" }]);

    // La validez del presupuesto sin respuesta cuenta desde el día de la clínica.
    const q = await client.query<{ valid_until: string }>(
      "SELECT valid_until::text AS valid_until FROM public.quotes WHERE clinic_id = $1 AND number = 'DEMO-0003'",
      [CLINICA_DEMO_ID],
    );
    expect(q.rows[0].valid_until).toBe(sumarDiasCiviles("2026-10-28", 30 - 9));
  });

  it("pasada la medianoche de Santiago la demo de ayer se rehace entera", async () => {
    const { error } = await admin.rpc("reset_demo_clinic");
    expect(error).toBeNull();
    // Un día después del reseteo, a las 00:30 de Santiago (03:30 UTC).
    const manana = new Date(Date.now() + 36 * 3_600_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(manana);
    const estado = await estadoActualDeLaDemo(admin);
    expect(estado.estado).toBe("reiniciar");
    vi.useRealTimers();
    const r = await reiniciarLaDemo(admin);
    expect(r.accion).toBe("reiniciar");
    expect(r.fallos).toEqual([]);
    expect((await estadoActualDeLaDemo(admin)).estado).toBe("al-dia");
  });
});
