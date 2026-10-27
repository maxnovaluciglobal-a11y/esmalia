import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 10 · frente A (migraciones 20261106100000 a 20261106100300), contra la
 * base efímera de tests (SQL directo con `SET LOCAL ROLE authenticated` y el
 * `sub` del JWT):
 *
 * - Aislamiento entre clínicas en las 7 tablas nuevas y en las lecturas
 *   agregadas.
 * - Dinero por rol: gastos fijos solo owner/admin/accounting; assistant no ve
 *   empresas, planes, cuotas ni folios (regla 2); recepción cobra cuotas.
 * - Reglas: gastos fijos idempotentes por mes, cuotas con vista previa y
 *   período del plan, snapshot de la cuota pactada, estados que solo avanzan,
 *   paciente y pago de la misma clínica.
 * - Sumas en SQL con la zona de la clínica (venta real, por sucursal, por
 *   cobrar, estado de cuenta de la empresa).
 */

describe("Ola 10 · finanzas (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let otraClinica: string;
  let usuarios: Record<string, string>;
  let otroOwner: string;
  let pacientes: string[];
  let pacienteOtraClinica: string;

  async function como<T = Record<string, unknown>>(
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

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function plan(clinica: string, owner: string, periodo = "monthly", fee = 15000) {
    const r = await servicio<{ id: string }>(
      `INSERT INTO public.membership_plans (clinic_id, name, fee_cents, billing_period, currency, created_by)
       VALUES ($1, $2, $3, $4, '', $5) RETURNING id`,
      [clinica, `Plan ${randomUUID().slice(0, 6)}`, fee, periodo, owner],
    );
    return r[0].id;
  }

  async function inscribir(
    clinica: string,
    paciente: string,
    planId: string,
    desde: string,
    owner: string,
  ) {
    const r = await servicio<{ id: string }>(
      `INSERT INTO public.patient_memberships (clinic_id, patient_id, plan_id, starts_on, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [clinica, paciente, planId, desde, owner],
    );
    return r[0].id;
  }

  async function empresa(clinica: string, owner: string, nombre = "Constructora Sur") {
    const r = await servicio<{ id: string }>(
      `INSERT INTO public.partner_companies (clinic_id, name, discount_kind, discount_percent, currency, created_by)
       VALUES ($1, $2, 'percent', 15, '', $3) RETURNING id`,
      [clinica, nombre, owner],
    );
    return r[0].id;
  }

  async function pago(
    clinica: string,
    paciente: string,
    owner: string,
    monto: number,
    paidAt: string,
  ) {
    const r = await servicio<{ id: string }>(
      `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, paid_at, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [clinica, paciente, monto, paidAt, owner],
    );
    return r[0].id;
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
    await servicio(`UPDATE public.clinics SET timezone = 'America/Santiago' WHERE id = $1`, [
      clinicId,
    ]);
    otraClinica = randomUUID();
    otroOwner = randomUUID();
    await servicio(`INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`, [
      otraClinica,
      otroOwner,
    ]);
    pacientes = [];
    for (const nombre of ["Ana Pérez", "Beto Soto", "Caro Díaz"]) {
      const p = await servicio<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [clinicId, nombre, usuarios.owner],
      );
      pacientes.push(p[0].id);
    }
    const p2 = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Otro Paciente', $2) RETURNING id`,
      [otraClinica, otroOwner],
    );
    pacienteOtraClinica = p2[0].id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  const TABLAS = [
    "recurring_expenses",
    "partner_companies",
    "partner_company_patients",
    "membership_plans",
    "patient_memberships",
    "membership_charges",
    "payment_receipts",
  ];

  async function sembrarOtraClinica() {
    await servicio(
      `INSERT INTO public.recurring_expenses (clinic_id, category, description, amount_cents, currency, starts_on, created_by)
       VALUES ($1, 'Arriendo', 'Ajeno', 100, '', '2026-01-01', $2)`,
      [otraClinica, otroOwner],
    );
    const emp = await empresa(otraClinica, otroOwner);
    await servicio(
      `INSERT INTO public.partner_company_patients (clinic_id, company_id, patient_id, created_by)
       VALUES ($1, $2, $3, $4)`,
      [otraClinica, emp, pacienteOtraClinica, otroOwner],
    );
    const pl = await plan(otraClinica, otroOwner);
    await inscribir(otraClinica, pacienteOtraClinica, pl, "2026-10-01", otroOwner);
    await servicio(`SELECT * FROM public.generar_cuotas_de_membresia($1, '2026-10-01', true)`, [
      otraClinica,
    ]);
    const pg = await pago(
      otraClinica,
      pacienteOtraClinica,
      otroOwner,
      5000,
      "2026-10-10T15:00:00Z",
    );
    await servicio(
      `INSERT INTO public.payment_receipts (clinic_id, payment_id, doc_type, folio, issued_on, created_by)
       VALUES ($1, $2, 'boleta', '99', '2026-10-10', $3)`,
      [otraClinica, pg, otroOwner],
    );
  }

  describe("aislamiento entre clínicas", () => {
    it("nadie lee filas de otra clínica en las tablas nuevas", async () => {
      await sembrarOtraClinica();
      for (const tabla of TABLAS) {
        const total = await servicio<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.${tabla} WHERE clinic_id = $1`,
          [otraClinica],
        );
        expect(total[0].n, tabla).toBeGreaterThan(0);
        for (const rol of ["owner", "admin", "accounting", "reception"]) {
          const r = await como<{ n: number }>(
            usuarios[rol],
            `SELECT count(*)::int AS n FROM public.${tabla} WHERE clinic_id = $1`,
            [otraClinica],
          );
          expect(r.error, `${tabla}/${rol}`).toBe("");
          expect(r.filas[0].n, `${tabla}/${rol}`).toBe(0);
        }
      }
    });

    it("las lecturas agregadas no devuelven nada de otra clínica", async () => {
      await sembrarOtraClinica();
      for (const sql of [
        `SELECT * FROM public.finanzas_por_sucursal($1, '2026-10-01', '2026-10-31')`,
        `SELECT * FROM public.finanzas_venta_real($1, '2026-10-01', '2026-10-31')`,
      ]) {
        const r = await como(usuarios.owner, sql, [otraClinica]);
        expect(r.error).toBe("");
        expect(r.filas).toEqual([]);
      }
      const c = await como<{ cuotas_pendientes: number; saldo_pacientes_cents: number }>(
        usuarios.owner,
        `SELECT * FROM public.finanzas_por_cobrar($1)`,
        [otraClinica],
      );
      expect(Number(c.filas[0].cuotas_pendientes)).toBe(0);
      expect(Number(c.filas[0].saldo_pacientes_cents)).toBe(0);
    });

    it("no se escribe en otra clínica ni se afilia un paciente ajeno", async () => {
      const r = await como(
        usuarios.owner,
        `INSERT INTO public.membership_plans (clinic_id, name, fee_cents, currency, created_by)
         VALUES ($1, 'Intruso', 100, '', $2)`,
        [otraClinica, usuarios.owner],
      );
      expect(r.error).not.toBe("");
      const emp = await empresa(clinicId, usuarios.owner);
      const a = await como(
        usuarios.owner,
        `INSERT INTO public.partner_company_patients (clinic_id, company_id, patient_id, created_by)
         VALUES ($1, $2, $3, $4)`,
        [clinicId, emp, pacienteOtraClinica, usuarios.owner],
      );
      expect(a.error).toMatch(/no es de esta clínica/);
    });

    it("no se anota folio sobre un pago de otra clínica", async () => {
      const pg = await pago(
        otraClinica,
        pacienteOtraClinica,
        otroOwner,
        5000,
        "2026-10-10T15:00:00Z",
      );
      const r = await como(
        usuarios.owner,
        `INSERT INTO public.payment_receipts (clinic_id, payment_id, doc_type, folio, issued_on, created_by)
         VALUES ($1, $2, 'boleta', '1', '2026-10-10', $3)`,
        [clinicId, pg, usuarios.owner],
      );
      expect(r.error).not.toBe("");
    });
  });

  describe("dinero por rol", () => {
    it("gastos fijos: solo owner, admin y accounting los ven y crean", async () => {
      for (const rol of ["owner", "admin", "accounting"]) {
        const r = await como(
          usuarios[rol],
          `INSERT INTO public.recurring_expenses (clinic_id, category, description, amount_cents, currency, starts_on, created_by)
           VALUES ($1, 'Luz', $2, 100, '', '2026-01-01', $3)`,
          [clinicId, `Luz ${rol}`, usuarios[rol]],
        );
        expect(r.error, rol).toBe("");
      }
      for (const rol of ["reception", "dentist", "assistant"]) {
        const ver = await como<{ n: number }>(
          usuarios[rol],
          `SELECT count(*)::int AS n FROM public.recurring_expenses WHERE clinic_id = $1`,
          [clinicId],
        );
        expect(ver.filas[0].n, rol).toBe(0);
        const crear = await como(
          usuarios[rol],
          `INSERT INTO public.recurring_expenses (clinic_id, category, description, amount_cents, currency, starts_on, created_by)
           VALUES ($1, 'Luz', 'x', 100, '', '2026-01-01', $2)`,
          [clinicId, usuarios[rol]],
        );
        expect(crear.error, rol).not.toBe("");
      }
    });

    it("assistant no ve empresas, planes, inscripciones, cuotas ni folios", async () => {
      const emp = await empresa(clinicId, usuarios.owner);
      await servicio(
        `INSERT INTO public.partner_company_patients (clinic_id, company_id, patient_id, created_by)
         VALUES ($1, $2, $3, $4)`,
        [clinicId, emp, pacientes[0], usuarios.owner],
      );
      const pl = await plan(clinicId, usuarios.owner);
      await inscribir(clinicId, pacientes[0], pl, "2026-10-01", usuarios.owner);
      await servicio(`SELECT * FROM public.generar_cuotas_de_membresia($1, '2026-10-01', true)`, [
        clinicId,
      ]);
      const pg = await pago(clinicId, pacientes[0], usuarios.owner, 1000, "2026-10-10T15:00:00Z");
      await servicio(
        `INSERT INTO public.payment_receipts (clinic_id, payment_id, doc_type, folio, issued_on, created_by)
         VALUES ($1, $2, 'boleta', '7', '2026-10-10', $3)`,
        [clinicId, pg, usuarios.owner],
      );
      for (const tabla of TABLAS.filter((t) => t !== "recurring_expenses")) {
        const asis = await como<{ n: number }>(
          usuarios.assistant,
          `SELECT count(*)::int AS n FROM public.${tabla} WHERE clinic_id = $1`,
          [clinicId],
        );
        expect(asis.filas[0].n, `assistant/${tabla}`).toBe(0);
        const rec = await como<{ n: number }>(
          usuarios.reception,
          `SELECT count(*)::int AS n FROM public.${tabla} WHERE clinic_id = $1`,
          [clinicId],
        );
        expect(rec.filas[0].n, `reception/${tabla}`).toBeGreaterThan(0);
      }
    });

    it("recepción cobra una cuota pero no administra planes ni empresas", async () => {
      const pl = await plan(clinicId, usuarios.owner);
      await inscribir(clinicId, pacientes[1], pl, "2026-10-01", usuarios.owner);
      await servicio(`SELECT * FROM public.generar_cuotas_de_membresia($1, '2026-10-01', true)`, [
        clinicId,
      ]);
      const cobrar = await como<{ paid_by: string; status: string }>(
        usuarios.reception,
        `UPDATE public.membership_charges SET status = 'paid' WHERE clinic_id = $1 RETURNING paid_by, status`,
        [clinicId],
      );
      expect(cobrar.error).toBe("");
      expect(cobrar.filas[0]).toEqual({ paid_by: usuarios.reception, status: "paid" });
      const planNuevo = await como(
        usuarios.reception,
        `INSERT INTO public.membership_plans (clinic_id, name, fee_cents, currency, created_by)
         VALUES ($1, 'Desde recepción', 100, '', $2)`,
        [clinicId, usuarios.reception],
      );
      expect(planNuevo.error).not.toBe("");
      const emp = await como(
        usuarios.reception,
        `INSERT INTO public.partner_companies (clinic_id, name, discount_kind, currency, created_by)
         VALUES ($1, 'Desde recepción', 'none', '', $2)`,
        [clinicId, usuarios.reception],
      );
      expect(emp.error).not.toBe("");
    });
  });

  describe("roles de la Ola 10 · C", () => {
    it("Coordinación cobra cuotas como recepción; Técnico/a dental no ve dinero", async () => {
      const coord = randomUUID();
      const tecnico = randomUUID();
      await servicio(
        `INSERT INTO public.clinic_members (clinic_id, user_id, role)
         VALUES ($1, $2, 'coordinator'), ($1, $3, 'lab_technician')`,
        [clinicId, coord, tecnico],
      );
      const pl = await plan(clinicId, usuarios.owner);
      await inscribir(clinicId, pacientes[0], pl, "2026-10-01", usuarios.owner);
      await servicio(`SELECT * FROM public.generar_cuotas_de_membresia($1, '2026-10-01', true)`, [
        clinicId,
      ]);
      const cobrar = await como<{ status: string }>(
        coord,
        `UPDATE public.membership_charges SET status = 'paid' WHERE clinic_id = $1 RETURNING status`,
        [clinicId],
      );
      expect(cobrar.error).toBe("");
      expect(cobrar.filas).toEqual([{ status: "paid" }]);
      for (const tabla of TABLAS) {
        const r = await como<{ n: number }>(
          tecnico,
          `SELECT count(*)::int AS n FROM public.${tabla} WHERE clinic_id = $1`,
          [clinicId],
        );
        expect(r.filas[0].n, tabla).toBe(0);
      }
    });
  });

  describe("gastos fijos (FIN-09)", () => {
    it("confirmar crea el gasto del mes una sola vez, con el monto ajustado", async () => {
      const r = await servicio<{ id: string }>(
        `INSERT INTO public.recurring_expenses (clinic_id, category, description, amount_cents, currency, day_of_month, starts_on, created_by)
         VALUES ($1, 'Luz', 'Luz', 50000, '', 28, '2026-01-01', $2) RETURNING id`,
        [clinicId, usuarios.owner],
      );
      const items = JSON.stringify([{ recurring_expense_id: r[0].id, amount_cents: 61234 }]);
      const a = await como<{ n: number }>(
        usuarios.accounting,
        `SELECT public.confirmar_gastos_fijos($1, '2026-02-10', $2::jsonb) AS n`,
        [clinicId, items],
      );
      expect(a.error).toBe("");
      expect(a.filas[0].n).toBe(1);
      const b = await como<{ n: number }>(
        usuarios.owner,
        `SELECT public.confirmar_gastos_fijos($1, '2026-02-01', $2::jsonb) AS n`,
        [clinicId, items],
      );
      expect(b.filas[0].n).toBe(0);
      const g = await servicio<{
        amount_cents: string;
        incurred_on: string;
        recurring_period: string;
        created_by: string;
      }>(
        `SELECT amount_cents, incurred_on::text, recurring_period::text, created_by FROM public.expenses WHERE recurring_expense_id = $1`,
        [r[0].id],
      );
      expect(g).toEqual([
        {
          amount_cents: "61234",
          incurred_on: "2026-02-28",
          recurring_period: "2026-02-01",
          created_by: usuarios.accounting,
        },
      ]);
      const rec = await como<{ n: number }>(
        usuarios.reception,
        `SELECT public.confirmar_gastos_fijos($1, '2026-03-01', $2::jsonb) AS n`,
        [clinicId, items],
      );
      // Recepción no ve la plantilla (RLS): no se crea nada.
      expect(rec.filas[0]?.n ?? 0).toBe(0);
    });

    it("no confirma un mes fuera del rango ni una plantilla pausada", async () => {
      const r = await servicio<{ id: string }>(
        `INSERT INTO public.recurring_expenses (clinic_id, category, description, amount_cents, currency, starts_on, ends_on, created_by)
         VALUES ($1, 'Arriendo', 'Local', 1000, '', '2026-03-01', '2026-04-01', $2) RETURNING id`,
        [clinicId, usuarios.owner],
      );
      const items = JSON.stringify([{ recurring_expense_id: r[0].id }]);
      for (const mes of ["2026-02-01", "2026-05-01"]) {
        const x = await como<{ n: number }>(
          usuarios.owner,
          `SELECT public.confirmar_gastos_fijos($1, $2, $3::jsonb) AS n`,
          [clinicId, mes, items],
        );
        expect(x.filas[0].n, mes).toBe(0);
      }
      await servicio(`UPDATE public.recurring_expenses SET active = false WHERE id = $1`, [
        r[0].id,
      ]);
      const y = await como<{ n: number }>(
        usuarios.owner,
        `SELECT public.confirmar_gastos_fijos($1, '2026-03-01', $2::jsonb) AS n`,
        [clinicId, items],
      );
      expect(y.filas[0].n).toBe(0);
    });
  });

  describe("membresías (FIN-12)", () => {
    it("la inscripción toma la cuota del plan, no la que manda el cliente, y hay una vigente por paciente", async () => {
      const pl = await plan(clinicId, usuarios.owner, "monthly", 15000);
      const r = await como<{ fee_cents: string; plan_name_snapshot: string; currency: string }>(
        usuarios.reception,
        `INSERT INTO public.patient_memberships (clinic_id, patient_id, plan_id, starts_on, fee_cents, currency, plan_name_snapshot, billing_period, created_by)
         VALUES ($1, $2, $3, '2026-10-01', 1, 'USD', 'trucho', 'yearly', $4)
         RETURNING fee_cents, plan_name_snapshot, currency`,
        [clinicId, pacientes[0], pl, usuarios.reception],
      );
      expect(r.error).toBe("");
      expect(r.filas[0].fee_cents).toBe("15000");
      expect(r.filas[0].plan_name_snapshot).not.toBe("trucho");
      expect(r.filas[0].currency).not.toBe("USD");
      const otra = await como(
        usuarios.reception,
        `INSERT INTO public.patient_memberships (clinic_id, patient_id, plan_id, starts_on, created_by)
         VALUES ($1, $2, $3, '2026-11-01', $4)`,
        [clinicId, pacientes[0], pl, usuarios.reception],
      );
      expect(otra.error).not.toBe("");
    });

    it("genera con vista previa, respeta el período del plan y no repite", async () => {
      const mensual = await plan(clinicId, usuarios.owner, "monthly", 15000);
      const trimestral = await plan(clinicId, usuarios.owner, "quarterly", 40000);
      await inscribir(clinicId, pacientes[0], mensual, "2026-09-01", usuarios.owner);
      await inscribir(clinicId, pacientes[1], trimestral, "2026-09-01", usuarios.owner);
      const previaOct = await como<{ patient_id: string }>(
        usuarios.accounting,
        `SELECT * FROM public.generar_cuotas_de_membresia($1, '2026-10-01', false)`,
        [clinicId],
      );
      expect(previaOct.filas.map((f) => f.patient_id)).toEqual([pacientes[0]]);
      const sinEscribir = await servicio<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.membership_charges WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(sinEscribir[0].n).toBe(0);
      const dic = await como<{ patient_id: string; period_end: string }>(
        usuarios.accounting,
        `SELECT patient_id, period_end::text FROM public.generar_cuotas_de_membresia($1, '2026-12-15', true) ORDER BY amount_cents`,
        [clinicId],
      );
      expect(dic.filas).toEqual([
        { patient_id: pacientes[0], period_end: "2026-12-31" },
        { patient_id: pacientes[1], period_end: "2027-02-28" },
      ]);
      const otraVez = await como(
        usuarios.accounting,
        `SELECT * FROM public.generar_cuotas_de_membresia($1, '2026-12-01', true)`,
        [clinicId],
      );
      expect(otraVez.filas).toEqual([]);
    });

    it("una cuota cobrada no vuelve a pendiente ni cambia de monto; anular pide motivo", async () => {
      const pl = await plan(clinicId, usuarios.owner);
      await inscribir(clinicId, pacientes[2], pl, "2026-10-01", usuarios.owner);
      await servicio(`SELECT * FROM public.generar_cuotas_de_membresia($1, '2026-10-01', true)`, [
        clinicId,
      ]);
      await como(
        usuarios.reception,
        `UPDATE public.membership_charges SET status = 'paid' WHERE clinic_id = $1`,
        [clinicId],
      );
      const volver = await como(
        usuarios.owner,
        `UPDATE public.membership_charges SET status = 'pending', paid_at = null WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(volver.error).toMatch(/no vuelve a pendiente/);
      const monto = await como(
        usuarios.owner,
        `UPDATE public.membership_charges SET amount_cents = 1 WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(monto.error).toMatch(/no se editan/);
      const sinMotivo = await como(
        usuarios.owner,
        `UPDATE public.membership_charges SET status = 'void' WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(sinMotivo.error).not.toBe("");
      const borrar = await como(
        usuarios.owner,
        `DELETE FROM public.membership_charges WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(borrar.error).not.toBe("");
    });
  });

  describe("sumas en SQL (FIN-01, FIN-11, FIN-18)", () => {
    it("venta real, por sucursal y por cobrar con la zona de la clínica", async () => {
      const prof = await servicio<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Soto') RETURNING id`,
        [clinicId],
      );
      const tp = await servicio<{ id: string }>(
        `INSERT INTO public.treatment_plans (clinic_id, patient_id, name, created_by) VALUES ($1, $2, 'Plan', $3) RETURNING id`,
        [clinicId, pacientes[0], usuarios.owner],
      );
      // Completado el 31-oct a las 23:30 de Chile = 1-nov en UTC: cuenta en octubre.
      await servicio(
        `INSERT INTO public.treatment_items (clinic_id, plan_id, name_snapshot, price_cents, patient_cents, professional_id, status, completed_at)
         VALUES ($1, $2, 'Resina', 100000, 80000, $3, 'completed', '2026-11-01T02:30:00Z'),
                ($1, $2, 'Corona', 300000, NULL, $3, 'pending', NULL)`,
        [clinicId, tp[0].id, prof[0].id],
      );
      await servicio(
        `INSERT INTO public.quotes (clinic_id, patient_id, number, status, total_cents, accepted_total_cents, accepted_at, professional_id, created_by)
         VALUES ($1, $2, 'Q-1', 'accepted', 500000, 400000, '2026-10-05T15:00:00Z', $3, $4)`,
        [clinicId, pacientes[0], prof[0].id, usuarios.owner],
      );
      await pago(clinicId, pacientes[0], usuarios.owner, 50000, "2026-10-10T15:00:00Z");
      // 1-nov 00:30 UTC = 31-oct 21:30 en Chile: es de octubre.
      await pago(clinicId, pacientes[1], usuarios.owner, 7000, "2026-11-01T00:30:00Z");
      await servicio(
        `INSERT INTO public.expenses (clinic_id, category, description, amount_cents, incurred_on, created_by)
         VALUES ($1, 'Arriendo', 'Local', 200000, '2026-10-05', $2)`,
        [clinicId, usuarios.owner],
      );

      const v = await como<Record<string, string>>(
        usuarios.accounting,
        `SELECT professional_id, presupuestado_cents, realizado_cents, realizado_paciente_cents, cobrado_cents
           FROM public.finanzas_venta_real($1, '2026-10-01', '2026-10-31') ORDER BY professional_id NULLS LAST`,
        [clinicId],
      );
      expect(v.error).toBe("");
      expect(v.filas).toEqual([
        {
          professional_id: prof[0].id,
          presupuestado_cents: "400000",
          realizado_cents: "100000",
          realizado_paciente_cents: "80000",
          cobrado_cents: "0",
        },
        {
          professional_id: null,
          presupuestado_cents: "0",
          realizado_cents: "0",
          realizado_paciente_cents: "0",
          cobrado_cents: "57000",
        },
      ]);

      const s = await como<Record<string, string>>(
        usuarios.owner,
        `SELECT cobrado_cents, pagos, gastos_cents, realizado_cents FROM public.finanzas_por_sucursal($1, '2026-10-01', '2026-10-31')`,
        [clinicId],
      );
      expect(s.filas).toEqual([
        { cobrado_cents: "57000", pagos: "2", gastos_cents: "200000", realizado_cents: "100000" },
      ]);

      // Saldo: facturado 100000 (patient 80000) + 300000 = 380000 − 50000 = 330000 de Ana;
      // Beto pagó 7000 sin deuda: saldo a favor, no compensa.
      const c = await como<Record<string, string>>(
        usuarios.owner,
        `SELECT saldo_pacientes_cents, pacientes_con_saldo FROM public.finanzas_por_cobrar($1)`,
        [clinicId],
      );
      expect(c.filas[0]).toEqual({ saldo_pacientes_cents: "330000", pacientes_con_saldo: "1" });

      const emp = await empresa(clinicId, usuarios.owner);
      await servicio(
        `INSERT INTO public.partner_company_patients (clinic_id, company_id, patient_id, employee_code, created_by)
         VALUES ($1, $2, $3, 'T-1', $4)`,
        [clinicId, emp, pacientes[0], usuarios.owner],
      );
      const e = await como<Record<string, string>>(
        usuarios.accounting,
        `SELECT full_name, employee_code, realizado_cents, pagado_cents, saldo_cents
           FROM public.estado_cuenta_empresa($1, $2, '2026-10-01', '2026-10-31')`,
        [clinicId, emp],
      );
      expect(e.filas).toEqual([
        {
          full_name: "Ana Pérez",
          employee_code: "T-1",
          realizado_cents: "80000",
          pagado_cents: "50000",
          saldo_cents: "330000",
        },
      ]);
    });

    it("assistant no obtiene montos por las lecturas agregadas", async () => {
      await pago(clinicId, pacientes[0], usuarios.owner, 50000, "2026-10-10T15:00:00Z");
      const s = await como(
        usuarios.assistant,
        `SELECT * FROM public.finanzas_por_sucursal($1, '2026-10-01', '2026-10-31')`,
        [clinicId],
      );
      expect(s.filas).toEqual([]);
    });
  });
});
