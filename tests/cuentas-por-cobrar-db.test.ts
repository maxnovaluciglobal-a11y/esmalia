import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, esperaFallo, sembrarEscenario } from "./helpers/db";

/**
 * Ola 3 · Frente Cobros (migraciones 20261024300000-300200), contra la base:
 *
 * - PLA-07: aceptar un presupuesto crea su cuenta por cobrar por la parte del
 *   paciente, una sola vez (re-aceptar o tocar el estado no duplica).
 * - Plan cancelado → su cuenta se anula sola.
 * - FIN-03: las cuotas suman exacto la cuenta (RPC y constraint diferido).
 * - Lo pagado por cuenta (`receivable_paid_totals`): imputado, o al plan sin
 *   imputar; los reversados no cuentan.
 * - Un pago no se puede imputar a la cuenta de otro paciente ni a una anulada.
 * - RLS: assistant no ve ni toca cuentas (regla 2), otra clínica tampoco.
 * - FIN-07: una clínica de Chile nace con cheque, Redcompra, convenio y bono.
 * - La fusión de fichas mueve las cuentas con los pagos.
 *
 * La conexión es `postgres` (salta la RLS): para probarla se asume
 * `authenticated` con la identidad de cada persona, igual que PostgREST.
 */

describe("cuentas por cobrar en la base", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacienteId: string;
  let otroPaciente: string;

  async function como<T>(
    userId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query("SET LOCAL ROLE authenticated");
    try {
      const r = await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: r.rows as T[], error: "" };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: [], error: (e as Error).message };
    }
  }

  async function crearPaciente(nombre: string): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [clinicId, nombre, usuarios.owner],
    );
    return r.rows[0].id;
  }

  /** Presupuesto enviado con dos líneas; la segunda con convenio (paciente paga 20.000). */
  async function crearPresupuesto(paciente: string): Promise<string> {
    const q = await client.query<{ id: string }>(
      `INSERT INTO public.quotes (clinic_id, patient_id, number, status, total_cents, created_by)
       VALUES ($1, $2, $3, 'sent', 150000, $4) RETURNING id`,
      [clinicId, paciente, `P-${randomUUID().slice(0, 6)}`, usuarios.owner],
    );
    const quoteId = q.rows[0].id;
    await client.query(
      `INSERT INTO public.quote_items
         (clinic_id, quote_id, name_snapshot, unit_price_cents, total_cents, patient_cents, coverage_cents, position)
       VALUES ($1, $2, 'Resina', 100000, 100000, NULL, NULL, 0),
              ($1, $2, 'Endodoncia', 50000, 50000, 20000, 30000, 1)`,
      [clinicId, quoteId],
    );
    return quoteId;
  }

  async function aceptar(quoteId: string) {
    await client.query(`UPDATE public.quotes SET status = 'accepted' WHERE id = $1`, [quoteId]);
  }

  async function cuentasDe(quoteId: string) {
    const r = await client.query<{
      id: string;
      amount_cents: string;
      treatment_plan_id: string | null;
      patient_id: string;
      currency: string;
    }>(
      `SELECT id, amount_cents, treatment_plan_id, patient_id, currency
         FROM public.receivables WHERE quote_id = $1`,
      [quoteId],
    );
    return r.rows;
  }

  async function pagar(
    paciente: string,
    monto: number,
    extra: { receivableId?: string | null; planId?: string | null } = {},
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.payments
         (clinic_id, patient_id, amount_cents, method, created_by, receivable_id, treatment_plan_id)
       VALUES ($1, $2, $3, 'cash', $4, $5, $6) RETURNING id`,
      [clinicId, paciente, monto, usuarios.owner, extra.receivableId ?? null, extra.planId ?? null],
    );
    return r.rows[0].id;
  }

  async function pagado(receivableId: string): Promise<number | null> {
    const r = await client.query<{ paid_cents: string }>(
      `SELECT paid_cents FROM public.receivable_paid_totals($1, ARRAY[$2]::uuid[])`,
      [clinicId, receivableId],
    );
    return r.rows[0] ? Number(r.rows[0].paid_cents) : null;
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
    pacienteId = await crearPaciente("Paciente Uno");
    otroPaciente = await crearPaciente("Paciente Dos");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ─── PLA-07 ────────────────────────────────────────────────────────────────

  it("aceptar un presupuesto crea su cuenta por la parte del paciente, con el plan", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    const [cuenta, ...resto] = await cuentasDe(quoteId);
    expect(resto).toHaveLength(0);
    // 100.000 particular + 20.000 que paga el paciente de la línea con convenio.
    expect(Number(cuenta.amount_cents)).toBe(120_000);
    expect(cuenta.patient_id).toBe(pacienteId);
    expect(cuenta.currency).toBe("CLP");
    const plan = await client.query<{ id: string }>(
      `SELECT id FROM public.treatment_plans WHERE quote_id = $1`,
      [quoteId],
    );
    expect(cuenta.treatment_plan_id).toBe(plan.rows[0].id);
  });

  it("es idempotente: re-aceptar o tocar el estado no duplica la cuenta", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    // Mismo estado: no es transición, no crea nada.
    await client.query(`UPDATE public.quotes SET status = 'converted' WHERE id = $1`, [quoteId]);
    // Aunque el guard de transiciones (frente Planes) dejara volver atrás y
    // re-aceptar, el índice único por presupuesto no duplica la cuenta.
    await client.query(`ALTER TABLE public.quotes DISABLE TRIGGER quote_a_validar_transicion`);
    await client.query(`UPDATE public.quotes SET status = 'sent' WHERE id = $1`, [quoteId]);
    await aceptar(quoteId);
    await client.query(`UPDATE public.quotes SET status = 'sent' WHERE id = $1`, [quoteId]);
    await client.query(`UPDATE public.quotes SET status = 'partially_accepted' WHERE id = $1`, [
      quoteId,
    ]);
    await client.query(`ALTER TABLE public.quotes ENABLE TRIGGER quote_a_validar_transicion`);
    expect(await cuentasDe(quoteId)).toHaveLength(1);
  });

  it("aceptación parcial: la cuenta es por lo aceptado (parte del paciente)", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    // El paciente acepta solo la endodoncia (con convenio: paga 20.000).
    await client.query(
      `UPDATE public.quote_items SET accepted = (name_snapshot = 'Endodoncia') WHERE quote_id = $1`,
      [quoteId],
    );
    await client.query(`UPDATE public.quotes SET status = 'partially_accepted' WHERE id = $1`, [
      quoteId,
    ]);
    const estado = await client.query<{ status: string; accepted_total_cents: string }>(
      `SELECT status, accepted_total_cents FROM public.quotes WHERE id = $1`,
      [quoteId],
    );
    expect(estado.rows[0].status).toBe("partially_accepted");
    // Bruto aceptado 50.000; el convenio pone 30.000: la deuda del paciente es 20.000.
    expect(Number(estado.rows[0].accepted_total_cents)).toBe(50_000);
    const [cuenta, ...resto] = await cuentasDe(quoteId);
    expect(resto).toHaveLength(0);
    expect(Number(cuenta.amount_cents)).toBe(20_000);
    expect(cuenta.treatment_plan_id).not.toBeNull();
  });

  it("un presupuesto rechazado o en borrador no crea cuenta", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await client.query(`UPDATE public.quotes SET status = 'rejected' WHERE id = $1`, [quoteId]);
    expect(await cuentasDe(quoteId)).toHaveLength(0);
  });

  it("si el convenio cubre todo, no hay deuda que cobrar", async () => {
    const q = await client.query<{ id: string }>(
      `INSERT INTO public.quotes (clinic_id, patient_id, number, status, total_cents, created_by)
       VALUES ($1, $2, 'P-CUB', 'sent', 50000, $3) RETURNING id`,
      [clinicId, pacienteId, usuarios.owner],
    );
    await client.query(
      `INSERT INTO public.quote_items
         (clinic_id, quote_id, name_snapshot, unit_price_cents, total_cents, patient_cents, coverage_cents)
       VALUES ($1, $2, 'Control', 50000, 50000, 0, 50000)`,
      [clinicId, q.rows[0].id],
    );
    await aceptar(q.rows[0].id);
    expect(await cuentasDe(q.rows[0].id)).toHaveLength(0);
  });

  it("cancelar el plan anula su cuenta vigente", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    const [cuenta] = await cuentasDe(quoteId);
    await client.query(`UPDATE public.treatment_plans SET status = 'cancelled' WHERE id = $1`, [
      cuenta.treatment_plan_id,
    ]);
    const r = await client.query<{ voided_at: string | null; void_reason: string | null }>(
      `SELECT voided_at, void_reason FROM public.receivables WHERE id = $1`,
      [cuenta.id],
    );
    expect(r.rows[0].voided_at).not.toBeNull();
    expect(r.rows[0].void_reason).toMatch(/cancelado/);
  });

  it("el monto y el origen de una cuenta no se editan, y una anulada no revive", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    const [cuenta] = await cuentasDe(quoteId);
    const editar = await esperaFallo(client, () =>
      client.query(`UPDATE public.receivables SET amount_cents = 1 WHERE id = $1`, [cuenta.id]),
    );
    expect(editar.code).toBe("23514");
    await client.query(
      `UPDATE public.receivables SET voided_at = now(), void_reason = 'error' WHERE id = $1`,
      [cuenta.id],
    );
    const revivir = await esperaFallo(client, () =>
      client.query(
        `UPDATE public.receivables SET voided_at = NULL, void_reason = NULL WHERE id = $1`,
        [cuenta.id],
      ),
    );
    expect(revivir.code).toBe("23514");
  });

  // ─── FIN-03 ────────────────────────────────────────────────────────────────

  it("definir_cuotas reemplaza las cuotas y exige que sumen la cuenta", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    const [cuenta] = await cuentasDe(quoteId);
    await client.query(`SELECT public.definir_cuotas($1, $2::jsonb)`, [
      cuenta.id,
      JSON.stringify([
        { due_on: "2026-11-05", amount_cents: 60000 },
        { due_on: "2026-12-05", amount_cents: 60000 },
      ]),
    ]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const r = await client.query<{ number: number; amount_cents: string }>(
      `SELECT number, amount_cents FROM public.receivable_installments
        WHERE receivable_id = $1 ORDER BY number`,
      [cuenta.id],
    );
    expect(r.rows.map((x) => [x.number, Number(x.amount_cents)])).toEqual([
      [1, 60000],
      [2, 60000],
    ]);

    const mal = await esperaFallo(client, () =>
      client.query(`SELECT public.definir_cuotas($1, $2::jsonb)`, [
        cuenta.id,
        JSON.stringify([{ due_on: "2026-11-05", amount_cents: 1000 }]),
      ]),
    );
    expect(mal.code).toBe("23514");
  });

  it("el constraint diferido frena cuotas que no suman, aunque entren directo", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    const [cuenta] = await cuentasDe(quoteId);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const fallo = await esperaFallo(client, () =>
      client.query(
        `INSERT INTO public.receivable_installments (clinic_id, receivable_id, number, due_on, amount_cents)
         VALUES ($1, $2, 1, '2026-11-05', 500)`,
        [clinicId, cuenta.id],
      ),
    );
    expect(fallo.code).toBe("23514");
  });

  it("una cuota no puede colgar de una cuenta de otra clínica", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    const [cuenta] = await cuentasDe(quoteId);
    const otra = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`,
      [otra, randomUUID()],
    );
    const fallo = await esperaFallo(client, () =>
      client.query(
        `INSERT INTO public.receivable_installments (clinic_id, receivable_id, number, due_on, amount_cents)
         VALUES ($1, $2, 1, '2026-11-05', 120000)`,
        [otra, cuenta.id],
      ),
    );
    expect(fallo.code).toBe("23503");
  });

  // ─── Pagado por cuenta ────────────────────────────────────────────────────

  it("cuenta lo imputado y lo pagado al plan sin imputar; no lo reversado ni lo a cuenta", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    const [cuenta] = await cuentasDe(quoteId);
    expect(await pagado(cuenta.id)).toBeNull();

    await pagar(pacienteId, 30_000, { receivableId: cuenta.id });
    await pagar(pacienteId, 20_000, { planId: cuenta.treatment_plan_id });
    await pagar(pacienteId, 5_000); // a cuenta: no se atribuye a ninguna cuenta
    const reversado = await pagar(pacienteId, 7_000, { receivableId: cuenta.id });
    await client.query(
      `UPDATE public.payments SET reversed_at = now(), reversed_by = $2, reversal_reason = 'error'
        WHERE id = $1`,
      [reversado, usuarios.owner],
    );
    expect(await pagado(cuenta.id)).toBe(50_000);
  });

  it("un pago no se imputa a la cuenta de otro paciente ni a una anulada", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    const [cuenta] = await cuentasDe(quoteId);
    const ajeno = await esperaFallo(client, () =>
      pagar(otroPaciente, 1_000, { receivableId: cuenta.id }),
    );
    expect(ajeno.code).toBe("23514");
    await client.query(
      `UPDATE public.receivables SET voided_at = now(), void_reason = 'error' WHERE id = $1`,
      [cuenta.id],
    );
    const anulada = await esperaFallo(client, () =>
      pagar(pacienteId, 1_000, { receivableId: cuenta.id }),
    );
    expect(anulada.code).toBe("23514");
  });

  // ─── RLS ───────────────────────────────────────────────────────────────────

  it("leen y escriben los roles de dinero; assistant y otra clínica no", async () => {
    const quoteId = await crearPresupuesto(pacienteId);
    await aceptar(quoteId);
    const [cuenta] = await cuentasDe(quoteId);

    for (const rol of ["owner", "admin", "dentist", "reception", "accounting"]) {
      const { filas, error } = await como<{ id: string }>(
        usuarios[rol],
        `SELECT id FROM public.receivables WHERE id = $1`,
        [cuenta.id],
      );
      expect(error, rol).toBe("");
      expect(filas, rol).toHaveLength(1);
    }
    const asistente = await como<{ id: string }>(
      usuarios.assistant,
      `SELECT id FROM public.receivables WHERE id = $1`,
      [cuenta.id],
    );
    expect(asistente.filas).toHaveLength(0);
    const externo = await como<{ id: string }>(
      usuarios.externo,
      `SELECT id FROM public.receivables WHERE id = $1`,
      [cuenta.id],
    );
    expect(externo.filas).toHaveLength(0);

    const cuotasAsistente = await como(
      usuarios.assistant,
      `SELECT public.definir_cuotas($1, $2::jsonb)`,
      [cuenta.id, JSON.stringify([{ due_on: "2026-11-05", amount_cents: 120000 }])],
    );
    expect(cuotasAsistente.error).not.toBe("");

    const cuotasRecepcion = await como(
      usuarios.reception,
      `SELECT public.definir_cuotas($1, $2::jsonb)`,
      [cuenta.id, JSON.stringify([{ due_on: "2026-11-05", amount_cents: 120000 }])],
    );
    expect(cuotasRecepcion.error).toBe("");

    const borrar = await como<{ id: string }>(
      usuarios.owner,
      `DELETE FROM public.receivables WHERE id = $1 RETURNING id`,
      [cuenta.id],
    );
    expect(borrar.error).toMatch(/permission denied/);
  });

  it("las funciones nuevas no son ejecutables por anon y las tablas tienen RLS", async () => {
    for (const tabla of ["receivables", "receivable_installments"]) {
      const r = await client.query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`,
        [`public.${tabla}`],
      );
      expect(r.rows[0].relrowsecurity, tabla).toBe(true);
    }
    for (const f of [
      "public.definir_cuotas(uuid, jsonb)",
      "public.receivable_paid_totals(uuid, uuid[])",
      "public.crear_cuenta_por_cobrar_de_presupuesto()",
      "public.anular_cuenta_de_plan_cancelado()",
      "public.merge_patients(uuid, uuid, uuid)",
    ]) {
      const r = await client.query<{ ok: boolean }>(
        `SELECT has_function_privilege('anon', $1, 'execute') AS ok`,
        [f],
      );
      expect(r.rows[0].ok, f).toBe(false);
    }
  });

  // ─── FIN-07 ────────────────────────────────────────────────────────────────

  it("una clínica de Chile nace con sus medios de pago y su tipo", async () => {
    const r = await client.query<{ name: string; kind: string; legacy_key: string | null }>(
      `SELECT name, kind, legacy_key FROM public.payment_methods WHERE clinic_id = $1 ORDER BY position`,
      [clinicId],
    );
    expect(r.rows.map((m) => [m.name, m.kind, m.legacy_key])).toEqual([
      ["Efectivo", "cash", "cash"],
      ["Transferencia", "transfer", "transfer"],
      ["Tarjeta de débito", "debit", "debit_card"],
      ["Tarjeta de crédito", "credit", "credit_card"],
      ["Otro", "other", "other"],
      ["Cheque", "check", null],
      ["Redcompra", "redcompra", null],
      ["Convenio", "agreement", null],
      ["Bono Fonasa / isapre", "voucher", null],
    ]);
  });

  it("una clínica de otro país no recibe los medios propios de Chile", async () => {
    const mx = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, country, currency, created_by) VALUES ($1, 'MX', 'MX', 'MXN', $2)`,
      [mx, randomUUID()],
    );
    const r = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.payment_methods WHERE clinic_id = $1`,
      [mx],
    );
    expect(Number(r.rows[0].n)).toBe(5);
  });

  // ─── Resultados del piloto ────────────────────────────────────────────────

  it("el piloto cuenta cobros, no filas: repartido y bono + copago valen uno", async () => {
    const insertar = (monto: number, extra: string, valores: unknown[] = []) =>
      client.query(
        `INSERT INTO public.payments
           (clinic_id, patient_id, amount_cents, method, created_by, paid_at${extra ? ", " + extra.split("|")[0] : ""})
         VALUES ($1, $2, $3, 'cash', $4, now()${extra ? ", " + extra.split("|")[1] : ""})`,
        [clinicId, pacienteId, monto, usuarios.owner, ...valores],
      );
    const repartido = randomUUID();
    await insertar(30_000, "payment_group_id|$5", [repartido]);
    await insertar(70_000, "payment_group_id|$5", [repartido]);
    const bono = randomUUID();
    await insertar(
      15_000,
      "coverage_group_id, coverage_kind, coverage_role, coverage_price_cents, voucher_cents|$5, 'fonasa_mle', 'bono', 25000, 15000",
      [bono],
    );
    await insertar(
      10_000,
      "coverage_group_id, coverage_kind, coverage_role, coverage_price_cents, voucher_cents|$5, 'fonasa_mle', 'copago', 25000, 15000",
      [bono],
    );
    await insertar(5_000, "");
    const r = await client.query<{ payments_count: number; collected_cents: string }>(
      `SELECT payments_count, collected_cents FROM public.pilot_results($1, current_date - 1, current_date + 1)`,
      [clinicId],
    );
    expect(r.rows[0].payments_count).toBe(3);
    expect(Number(r.rows[0].collected_cents)).toBe(130_000);
  });

  // ─── Fusión ───────────────────────────────────────────────────────────────

  it("fusionar fichas mueve las cuentas junto con sus pagos", async () => {
    const quoteId = await crearPresupuesto(otroPaciente);
    await aceptar(quoteId);
    const [cuenta] = await cuentasDe(quoteId);
    await pagar(otroPaciente, 10_000, { receivableId: cuenta.id });
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: usuarios.owner, role: "authenticated" }),
    ]);
    await client.query(`SELECT public.merge_patients($1, $2, $3)`, [
      clinicId,
      otroPaciente,
      pacienteId,
    ]);
    const r = await client.query<{ patient_id: string }>(
      `SELECT patient_id FROM public.receivables WHERE id = $1`,
      [cuenta.id],
    );
    expect(r.rows[0].patient_id).toBe(pacienteId);
    expect(await pagado(cuenta.id)).toBe(10_000);
  });
});
