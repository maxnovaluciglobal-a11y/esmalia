import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Cierre · ítem 1 (migración 20261112100000) contra la base efímera: la cuota
 * de membresía cobrada es un pago real (payments) que entra a la caja y al
 * arqueo, es idempotente y se reversa en los dos sentidos. Se ejecuta con
 * `SET LOCAL ROLE authenticated` y el `sub` del JWT como llega por PostgREST.
 */

describe("Cierre · cuota de membresía cobrada como pago (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacienteId: string;
  let cuotaId: string;
  let otraClinica: string;
  let otroOwner: string;

  async function como<T = Record<string, unknown>>(
    userId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string; code: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query("SET LOCAL ROLE authenticated");
    try {
      const r = await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: r.rows as T[], error: "", code: "" };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: [], error: (e as Error).message, code: (e as { code?: string }).code ?? "" };
    }
  }

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function abrirCaja(userId: string, apertura = 20000) {
    const r = await como<{ id: string }>(
      userId,
      `INSERT INTO public.cash_registers (clinic_id, opening_amount_cents, opened_by, operator_id, operator_name_snapshot)
       VALUES ($1, $2, $3, $3, 'Persona') RETURNING id`,
      [clinicId, apertura, userId],
    );
    expect(r.error).toBe("");
    return r.filas[0].id;
  }

  function cobrarCuota(userId: string, id = cuotaId, medio: string | null = null) {
    return como<{ payment_id: string; ya_cobrada: boolean }>(
      userId,
      `SELECT * FROM public.cobrar_cuota_de_membresia($1, $2, 'cash', NULL, 'comprobante 1')`,
      [id, medio],
    );
  }

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query("BEGIN");
    const esc = await sembrarEscenario(client);
    clinicId = esc.clinicId;
    usuarios = esc.usuarios;
    otraClinica = randomUUID();
    otroOwner = randomUUID();
    await servicio(`INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`, [
      otraClinica,
      otroOwner,
    ]);
    const p = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteId = p[0].id;
    const plan = await servicio<{ id: string }>(
      `INSERT INTO public.membership_plans (clinic_id, name, fee_cents, billing_period, created_by)
       VALUES ($1, 'Plan Sonrisa', 15000, 'monthly', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    const insc = await servicio<{ id: string }>(
      `INSERT INTO public.patient_memberships (clinic_id, patient_id, plan_id, starts_on, created_by)
       VALUES ($1, $2, $3, '2026-10-01', $4) RETURNING id`,
      [clinicId, pacienteId, plan[0].id, usuarios.owner],
    );
    const cuota = await servicio<{ id: string }>(
      `INSERT INTO public.membership_charges (clinic_id, membership_id, patient_id, period_start, period_end, amount_cents, currency)
       VALUES ($1, $2, $3, '2026-10-01', '2026-10-31', 15000, '') RETURNING id`,
      [clinicId, insc[0].id, pacienteId],
    );
    cuotaId = cuota[0].id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("cobrar en efectivo crea el pago, lo deja en la caja de quien cobra y entra al arqueo", async () => {
    const caja = await abrirCaja(usuarios.reception);
    const r = await cobrarCuota(usuarios.reception);
    expect(r.error).toBe("");
    expect(r.filas[0].ya_cobrada).toBe(false);

    const pagos = await servicio<{
      id: string;
      amount_cents: string;
      method: string;
      cash_register_id: string;
      membership_charge_id: string;
      currency: string;
      created_by: string;
    }>(`SELECT * FROM public.payments WHERE membership_charge_id = $1`, [cuotaId]);
    expect(pagos).toHaveLength(1);
    expect(Number(pagos[0].amount_cents)).toBe(15000);
    expect(pagos[0].method).toBe("cash");
    expect(pagos[0].cash_register_id).toBe(caja);
    expect(pagos[0].created_by).toBe(usuarios.reception);
    // La moneda la fija la base desde la clínica (regla 14), no la cuota ni el cliente.
    expect(pagos[0].currency).not.toBe("");

    const cuota = await servicio<{ status: string; paid_by: string }>(
      `SELECT status, paid_by FROM public.membership_charges WHERE id = $1`,
      [cuotaId],
    );
    expect(cuota[0].status).toBe("paid");
    expect(cuota[0].paid_by).toBe(usuarios.reception);

    // El esperado en efectivo de la caja incluye la cuota (apertura 20000 + 15000).
    const efectivo = await servicio<{ efectivo_cents: string }>(
      `SELECT efectivo_cents FROM public.efectivo_en_caja($1)`,
      [caja],
    );
    expect(Number(efectivo[0].efectivo_cents)).toBe(15000);
  });

  it("es idempotente: cobrar dos veces no duplica el pago", async () => {
    await abrirCaja(usuarios.reception);
    const primero = await cobrarCuota(usuarios.reception);
    const segundo = await cobrarCuota(usuarios.reception);
    expect(segundo.error).toBe("");
    expect(segundo.filas[0].ya_cobrada).toBe(true);
    expect(segundo.filas[0].payment_id).toBe(primero.filas[0].payment_id);
    const [{ n }] = await servicio<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.payments WHERE membership_charge_id = $1`,
      [cuotaId],
    );
    expect(Number(n)).toBe(1);
  });

  it("el índice único impide un segundo pago vigente de la misma cuota", async () => {
    await cobrarCuota(usuarios.reception);
    const r = await como(
      usuarios.reception,
      `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, method, membership_charge_id)
       VALUES ($1, $2, 15000, 'cash', $3)`,
      [clinicId, pacienteId, cuotaId],
    );
    expect(r.code).toBe("23505");
  });

  it("un pago de cuota tiene que ser por el monto y del paciente de la cuota", async () => {
    const otroPaciente = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Otra Persona', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    const monto = await como(
      usuarios.reception,
      `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, method, membership_charge_id)
       VALUES ($1, $2, 9999, 'cash', $3)`,
      [clinicId, pacienteId, cuotaId],
    );
    expect(monto.error).toMatch(/monto de la cuota/);
    const paciente = await como(
      usuarios.reception,
      `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, method, membership_charge_id)
       VALUES ($1, $2, 15000, 'cash', $3)`,
      [clinicId, otroPaciente[0].id, cuotaId],
    );
    expect(paciente.error).toMatch(/otro paciente/);
  });

  it("la cuota cobrada NO resta del saldo de tratamientos del paciente", async () => {
    await cobrarCuota(usuarios.reception);
    const saldo = await como<{ billed_cents: string; paid_cents: string }>(
      usuarios.owner,
      `SELECT * FROM public.patient_balances($1, ARRAY[$2]::uuid[])`,
      [clinicId, pacienteId],
    );
    expect(saldo.error).toBe("");
    // Sin tratamientos ni pagos de tratamientos: el paciente no aparece con saldo.
    expect(saldo.filas.every((f) => Number(f.paid_cents) === 0)).toBe(true);
  });

  it("la vista general cuenta la cuota una sola vez (en cuotas, no en pagos)", async () => {
    await cobrarCuota(usuarios.reception);
    const f = await como<{
      cobrado_cents: string;
      pagos: string;
      cuotas_cobradas_cents: string;
      cuotas_cobradas: string;
    }>(
      usuarios.owner,
      `SELECT sum(cobrado_cents)::text AS cobrado_cents, sum(pagos)::text AS pagos,
              sum(cuotas_cobradas_cents)::text AS cuotas_cobradas_cents,
              sum(cuotas_cobradas)::text AS cuotas_cobradas
         FROM public.finanzas_por_sucursal($1, current_date - 1, current_date + 1)`,
      [clinicId],
    );
    expect(f.error).toBe("");
    expect(Number(f.filas[0].cobrado_cents)).toBe(0);
    expect(Number(f.filas[0].pagos)).toBe(0);
    expect(Number(f.filas[0].cuotas_cobradas_cents)).toBe(15000);
    expect(Number(f.filas[0].cuotas_cobradas)).toBe(1);
  });

  it("reversar el pago anula la cuota", async () => {
    await abrirCaja(usuarios.reception);
    const r = await cobrarCuota(usuarios.reception);
    const rev = await como(
      usuarios.owner,
      `UPDATE public.payments SET reversed_at = now(), reversed_by = $2, reversal_reason = 'Cobro mal cargado'
        WHERE id = $1`,
      [r.filas[0].payment_id, usuarios.owner],
    );
    expect(rev.error).toBe("");
    const [cuota] = await servicio<{ status: string; void_reason: string }>(
      `SELECT status, void_reason FROM public.membership_charges WHERE id = $1`,
      [cuotaId],
    );
    expect(cuota.status).toBe("void");
    expect(cuota.void_reason).toMatch(/Pago reversado/);
  });

  it("anular una cuota cobrada reversa su pago y sale del arqueo", async () => {
    const caja = await abrirCaja(usuarios.reception);
    await cobrarCuota(usuarios.reception);
    const anula = await como(
      usuarios.owner,
      `UPDATE public.membership_charges SET status = 'void', void_reason = 'Cobrada por error' WHERE id = $1`,
      [cuotaId],
    );
    expect(anula.error).toBe("");
    const [pago] = await servicio<{ reversed_at: string | null; reversal_reason: string }>(
      `SELECT reversed_at, reversal_reason FROM public.payments WHERE membership_charge_id = $1`,
      [cuotaId],
    );
    expect(pago.reversed_at).not.toBeNull();
    expect(pago.reversal_reason).toMatch(/Cuota de membresía anulada/);
    const efectivo = await servicio<{ efectivo_cents: string }>(
      `SELECT efectivo_cents FROM public.efectivo_en_caja($1)`,
      [caja],
    );
    expect(Number(efectivo[0].efectivo_cents)).toBe(0);
  });

  it("una cuota anulada no se cobra", async () => {
    await como(
      usuarios.owner,
      `UPDATE public.membership_charges SET status = 'void', void_reason = 'Plan cancelado' WHERE id = $1`,
      [cuotaId],
    );
    const r = await cobrarCuota(usuarios.reception);
    expect(r.error).toMatch(/anulada/);
  });

  it("aislamiento entre clínicas: el owner de otra clínica y el asistente no pueden cobrar", async () => {
    const ajeno = await cobrarCuota(otroOwner);
    expect(ajeno.code).toBe("42501");
    const asistente = await cobrarCuota(usuarios.assistant);
    expect(asistente.code).toBe("42501");
    const [{ n }] = await servicio<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.payments WHERE membership_charge_id = $1`,
      [cuotaId],
    );
    expect(Number(n)).toBe(0);
  });

  it("el medio de pago tiene que ser de la clínica de la cuota", async () => {
    const medioAjeno = await servicio<{ id: string }>(
      `INSERT INTO public.payment_methods (clinic_id, name, kind, position) VALUES ($1, 'Ajeno', 'cash', 0) RETURNING id`,
      [otraClinica],
    );
    const r = await cobrarCuota(usuarios.reception, cuotaId, medioAjeno[0].id);
    expect(r.error).toMatch(/medio de pago/);
  });
});
