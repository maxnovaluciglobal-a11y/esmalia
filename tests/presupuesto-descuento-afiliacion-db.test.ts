import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Cierre · ítem 2 (migración 20261112100100) contra la base efímera: el
 * presupuesto guarda de dónde salió el descuento de afiliación con snapshots
 * (regla 10), los presupuestos existentes quedan igual y otra clínica no ve
 * nada.
 */

describe("Cierre · rastro del descuento de afiliación en el presupuesto (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacienteId: string;
  let empresaId: string;
  let otraClinica: string;
  let otroOwner: string;

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function como<T = Record<string, unknown>>(
    userId: string,
    sql: string,
    params: unknown[] = [],
  ) {
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
      return { filas: [] as T[], error: (e as Error).message };
    }
  }

  async function intentar(sql: string, params: unknown[]) {
    await client.query("SAVEPOINT sp_intento");
    try {
      await servicio(sql, params);
      await client.query("RELEASE SAVEPOINT sp_intento");
      return "";
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_intento");
      return (e as Error).message;
    }
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
    const e = await servicio<{ id: string }>(
      `INSERT INTO public.partner_companies (clinic_id, name, discount_kind, discount_percent, created_by)
       VALUES ($1, 'Constructora Andes', 'percent', 15, $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    empresaId = e[0].id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  const insertarPresupuesto = (extra = "", valores: unknown[] = []) =>
    servicio<{ id: string }>(
      `INSERT INTO public.quotes (clinic_id, patient_id, created_by, number${extra ? ", " + extra.split("|")[0] : ""})
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000001', 'P-2026-0001'${extra ? ", " + extra.split("|")[1] : ""}) RETURNING id`,
      [clinicId, pacienteId, ...valores],
    );

  it("un presupuesto sin descuento de afiliación sigue siendo válido (los existentes no cambian)", async () => {
    const [q] = await insertarPresupuesto();
    const [fila] = await servicio<Record<string, unknown>>(
      `SELECT affiliation_discount_source, partner_company_id, membership_plan_id FROM public.quotes WHERE id = $1`,
      [q.id],
    );
    expect(fila.affiliation_discount_source).toBeNull();
    expect(fila.partner_company_id).toBeNull();
    expect(fila.membership_plan_id).toBeNull();
  });

  it("guarda el origen con snapshot del nombre y de la regla", async () => {
    const [q] = await insertarPresupuesto(
      `commercial_discount_pct, affiliation_discount_source, affiliation_discount_name_snapshot, affiliation_discount_rule_snapshot, affiliation_discount_percent, partner_company_id|15, 'empresa', 'Constructora Andes', '15 % de descuento', 15, $3`,
      [empresaId],
    );
    const [fila] = await servicio<Record<string, unknown>>(
      `SELECT * FROM public.quotes WHERE id = $1`,
      [q.id],
    );
    expect(fila.affiliation_discount_source).toBe("empresa");
    expect(fila.affiliation_discount_name_snapshot).toBe("Constructora Andes");
    expect(Number(fila.affiliation_discount_percent)).toBe(15);
    expect(fila.partner_company_id).toBe(empresaId);
  });

  it("si la empresa se borra, el presupuesto conserva el snapshot (ON DELETE SET NULL)", async () => {
    const [q] = await insertarPresupuesto(
      `affiliation_discount_source, affiliation_discount_name_snapshot, affiliation_discount_percent, partner_company_id|'empresa', 'Constructora Andes', 15, $3`,
      [empresaId],
    );
    await servicio(`DELETE FROM public.partner_company_patients WHERE company_id = $1`, [
      empresaId,
    ]);
    await servicio(`DELETE FROM public.partner_companies WHERE id = $1`, [empresaId]);
    const [fila] = await servicio<Record<string, unknown>>(
      `SELECT affiliation_discount_name_snapshot, partner_company_id FROM public.quotes WHERE id = $1`,
      [q.id],
    );
    expect(fila.affiliation_discount_name_snapshot).toBe("Constructora Andes");
    expect(fila.partner_company_id).toBeNull();
  });

  it("el origen y su nombre van juntos, y la regla es porcentaje o monto, no ambos", async () => {
    const sinNombre = await intentar(
      `INSERT INTO public.quotes (clinic_id, patient_id, created_by, number, affiliation_discount_source)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000001', 'P-2026-0002', 'empresa')`,
      [clinicId, pacienteId],
    );
    expect(sinNombre).toMatch(/quotes_affiliation_discount_consistente/);
    const nombreSinOrigen = await intentar(
      `INSERT INTO public.quotes (clinic_id, patient_id, created_by, number, affiliation_discount_name_snapshot)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000001', 'P-2026-0003', 'Constructora Andes')`,
      [clinicId, pacienteId],
    );
    expect(nombreSinOrigen).toMatch(/quotes_affiliation_discount_consistente/);
    const ambos = await intentar(
      `INSERT INTO public.quotes (clinic_id, patient_id, created_by, number, affiliation_discount_source,
         affiliation_discount_name_snapshot, affiliation_discount_percent, affiliation_discount_amount_cents)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000001', 'P-2026-0004', 'empresa', 'X', 15, 5000)`,
      [clinicId, pacienteId],
    );
    expect(ambos).toMatch(/quotes_affiliation_discount_consistente/);
    const origenInvalido = await intentar(
      `INSERT INTO public.quotes (clinic_id, patient_id, created_by, number, affiliation_discount_source,
         affiliation_discount_name_snapshot)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000001', 'P-2026-0005', 'seguro', 'X')`,
      [clinicId, pacienteId],
    );
    expect(origenInvalido).toMatch(/quotes_affiliation_discount_consistente/);
  });

  it("aislamiento entre clínicas: el rastro de un presupuesto no lo lee otra clínica", async () => {
    const [q] = await insertarPresupuesto(
      `affiliation_discount_source, affiliation_discount_name_snapshot, affiliation_discount_percent|'empresa', 'Constructora Andes', 15`,
    );
    const propio = await como<{ affiliation_discount_name_snapshot: string }>(
      usuarios.owner,
      `SELECT affiliation_discount_name_snapshot FROM public.quotes WHERE id = $1`,
      [q.id],
    );
    expect(propio.filas).toHaveLength(1);
    const ajeno = await como(
      otroOwner,
      `SELECT affiliation_discount_name_snapshot FROM public.quotes WHERE id = $1`,
      [q.id],
    );
    expect(ajeno.filas).toHaveLength(0);
  });
});
