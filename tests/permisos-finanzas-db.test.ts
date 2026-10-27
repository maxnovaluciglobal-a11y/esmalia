import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Cierre · Bloque 5 · ítem 11 (migración 20261114300000), contra la base
 * efímera de tests: permisos por persona en finanzas, caja y comisiones.
 *
 * - QUITAR se cumple en la base (políticas restrictivas `ajuste_quita_*`):
 *   gastos, abrir caja, mover plata, reversar un pago y las comisiones (lo
 *   ajeno y lo propio por separado).
 * - DAR abre solo lo acotado (`ajuste_da_*`): lectura de gastos y comisiones y,
 *   en caja, únicamente la caja PROPIA. Y deja de valer si cambia el rol.
 * - Regla 2: ningún "dar" llega a asistente dental ni a técnico/a.
 * - Los roles por defecto no cambian: sin ajustes, todos conservan su acceso.
 * - Aislamiento entre clínicas: un ajuste en una clínica no se siente en otra.
 */

describe("Cierre 11 · permisos por persona en finanzas, caja y comisiones (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let miembros: Record<string, string>;
  let profesionalDentist: string;
  let profesionalOtro: string;
  let cajaAjena: string;

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

  async function servicioConError(sql: string, params: unknown[] = []): Promise<string> {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    await client.query("SAVEPOINT sp_srv");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_srv");
      return "";
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_srv");
      return (e as Error).message;
    }
  }

  /** Ajuste hecho por el admin de la clínica, vía la API. */
  function ajustar(clave: string, permission: string, effect: "grant" | "revoke") {
    return como(
      usuarios.admin,
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [clinicId, miembros[clave], permission, effect],
    );
  }

  /** Ajuste puesto por el propietario (para ajustar al admin). */
  function ajustarComoOwner(clave: string, permission: string, effect: "grant" | "revoke") {
    return como(
      usuarios.owner,
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [clinicId, miembros[clave], permission, effect],
    );
  }

  const contar = async (uid: string, tabla: string) =>
    (
      await como<{ n: number }>(
        uid,
        `SELECT count(*)::int AS n FROM public.${tabla} WHERE clinic_id = $1`,
        [clinicId],
      )
    ).filas[0]?.n ?? -1;

  const abrirCaja = (uid: string, operador: string | null) =>
    como(
      uid,
      `INSERT INTO public.cash_registers
         (clinic_id, currency, opening_amount_cents, opened_by, operator_id, status)
       VALUES ($1, 'CLP', 10000, $2, $3, 'open') RETURNING id`,
      [clinicId, uid, operador],
    );

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
    usuarios.coordinator = randomUUID();
    usuarios.lab_technician = randomUUID();
    await servicio(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES
         ($1, $2, 'coordinator'), ($1, $3, 'lab_technician')`,
      [clinicId, usuarios.coordinator, usuarios.lab_technician],
    );
    const filas = await servicio<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM public.clinic_members WHERE clinic_id = $1`,
      [clinicId],
    );
    miembros = {};
    for (const [clave, uid] of Object.entries(usuarios)) {
      const m = filas.find((f) => f.user_id === uid);
      if (m) miembros[clave] = m.id;
    }

    // Comisiones: un profesional vinculado al doctor y otro al segundo doctor.
    const p1 = await servicio<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name, user_id)
       VALUES ($1, 'Dra. Rojas', $2) RETURNING id`,
      [clinicId, usuarios.dentist],
    );
    profesionalDentist = p1[0].id;
    const p2 = await servicio<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name, user_id)
       VALUES ($1, 'Dr. Soto', $2) RETURNING id`,
      [clinicId, usuarios.dentist2],
    );
    profesionalOtro = p2[0].id;
    for (const pro of [profesionalDentist, profesionalOtro]) {
      await servicio(
        `INSERT INTO public.commission_rules (clinic_id, professional_id, kind, percent_bps)
         VALUES ($1, $2, 'percent', 3000)`,
        [clinicId, pro],
      );
      await servicio(
        `INSERT INTO public.commission_settlements
           (clinic_id, professional_id, period_from, period_to, rule_kind, rule_percent_bps,
            production_cents, procedure_count, commission_cents, closed_by)
         VALUES ($1, $2, '2026-10-01', '2026-10-31', 'percent', 3000, 100000, 3, 30000, $3)`,
        [clinicId, pro, usuarios.owner],
      );
    }

    // Gastos y gastos fijos.
    await servicio(
      `INSERT INTO public.expenses (clinic_id, category, description, amount_cents, incurred_on, created_by)
       VALUES ($1, 'arriendo', 'Arriendo octubre', 500000, '2026-10-01', $2)`,
      [clinicId, usuarios.owner],
    );
    await servicio(
      `INSERT INTO public.recurring_expenses (clinic_id, category, description, amount_cents, currency, starts_on, created_by)
       VALUES ($1, 'arriendo', 'Arriendo mensual', 500000, 'CLP', '2026-10-01', $2)`,
      [clinicId, usuarios.owner],
    );

    // Una caja ajena (de la recepcionista) para probar que no se toca.
    const c = await servicio<{ id: string }>(
      `INSERT INTO public.cash_registers
         (clinic_id, currency, opening_amount_cents, opened_by, operator_id, status)
       VALUES ($1, 'CLP', 5000, $2, $2, 'open') RETURNING id`,
      [clinicId, usuarios.reception],
    );
    cajaAjena = c[0].id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ── Defaults intactos ─────────────────────────────────────────────────────

  it("sin ajustes, cada rol conserva el acceso que tenía", async () => {
    // Gastos: owner, admin, contabilidad y coordinación; nadie más.
    for (const clave of ["owner", "admin", "accounting", "coordinator"]) {
      expect(await contar(usuarios[clave], "expenses"), clave).toBe(1);
      expect(await contar(usuarios[clave], "recurring_expenses"), clave).toBe(1);
    }
    for (const clave of ["dentist", "assistant", "reception", "lab_technician"]) {
      expect(await contar(usuarios[clave], "expenses"), clave).toBe(0);
    }
    // Comisiones: todos para owner/admin/contabilidad/coordinación; lo propio para el doctor.
    for (const clave of ["owner", "admin", "accounting", "coordinator"]) {
      expect(await contar(usuarios[clave], "commission_settlements"), clave).toBe(2);
    }
    expect(await contar(usuarios.dentist, "commission_settlements")).toBe(1);
    expect(await contar(usuarios.dentist2, "commission_settlements")).toBe(1);
    expect(await contar(usuarios.reception, "commission_settlements")).toBe(0);
    expect(await contar(usuarios.assistant, "commission_settlements")).toBe(0);
    // Caja: recepción y contabilidad abren la suya; el doctor no.
    expect((await abrirCaja(usuarios.accounting, usuarios.accounting)).error).toBe("");
    expect((await abrirCaja(usuarios.dentist, usuarios.dentist)).error).not.toBe("");
  });

  // ── Finanzas ──────────────────────────────────────────────────────────────

  it("quitar finanzas a contabilidad le oculta los gastos; a otro no", async () => {
    expect((await ajustar("accounting", "finance:view", "revoke")).error).toBe("");
    expect(await contar(usuarios.accounting, "expenses")).toBe(0);
    expect(await contar(usuarios.accounting, "recurring_expenses")).toBe(0);
    expect(await contar(usuarios.coordinator, "expenses")).toBe(1);
    expect(await contar(usuarios.owner, "expenses")).toBe(1);
    // Y conserva la caja y las comisiones: son áreas distintas.
    expect((await abrirCaja(usuarios.accounting, usuarios.accounting)).error).toBe("");
    expect(await contar(usuarios.accounting, "commission_settlements")).toBe(2);
    // Volver al rol: se borra el ajuste y vuelve a verlos.
    await como(
      usuarios.admin,
      `DELETE FROM public.clinic_member_permission_overrides WHERE member_id = $1`,
      [miembros.accounting],
    );
    expect(await contar(usuarios.accounting, "expenses")).toBe(1);
  });

  it("quitar finanzas al administrador también se cumple (lo pone el propietario)", async () => {
    expect((await ajustarComoOwner("admin", "finance:view", "revoke")).error).toBe("");
    expect(await contar(usuarios.admin, "expenses")).toBe(0);
    expect(await contar(usuarios.owner, "expenses")).toBe(1);
  });

  it("dar finanzas a recepción le abre la lectura de gastos y nada más", async () => {
    expect(await contar(usuarios.reception, "expenses")).toBe(0);
    expect((await ajustar("reception", "finance:view", "grant")).error).toBe("");
    expect(await contar(usuarios.reception, "expenses")).toBe(1);
    expect(await contar(usuarios.reception, "recurring_expenses")).toBe(1);
    // Solo lectura: escribir gastos sigue siendo de owner/admin/contabilidad.
    const w = await como(
      usuarios.reception,
      `INSERT INTO public.expenses (clinic_id, category, description, amount_cents, incurred_on, created_by)
       VALUES ($1, 'otro', 'Intento', 1, '2026-10-02', $2)`,
      [clinicId, usuarios.reception],
    );
    expect(w.error).not.toBe("");
    // No le abre las comisiones de los demás ni la historia clínica.
    expect(await contar(usuarios.reception, "commission_settlements")).toBe(0);
    expect(await contar(usuarios.reception, "clinical_notes")).toBe(0);
    // Otra persona del mismo rol, sin ajuste, sigue sin ver gastos (aislamiento).
    const otra = randomUUID();
    await servicio(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, 'reception')`,
      [clinicId, otra],
    );
    expect(await contar(otra, "expenses")).toBe(0);
  });

  it("dar finanzas a un profesional abre los gastos; a asistente o técnico/a se rechaza", async () => {
    expect((await ajustar("dentist", "finance:view", "grant")).error).toBe("");
    expect(await contar(usuarios.dentist, "expenses")).toBe(1);
    for (const clave of ["assistant", "lab_technician"]) {
      const r = await ajustar(clave, "finance:view", "grant");
      expect(r.error, clave).not.toBe("");
      const s = await servicioConError(
        `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
         VALUES ($1, $2, 'finance:view', 'grant')`,
        [clinicId, miembros[clave]],
      );
      expect(s, `${clave} servicio`).not.toBe("");
      expect(await contar(usuarios[clave], "expenses")).toBe(0);
    }
  });

  it("un «dar» deja de valer si la persona cambia de rol", async () => {
    expect((await ajustar("reception", "finance:view", "grant")).error).toBe("");
    expect(await contar(usuarios.reception, "expenses")).toBe(1);
    // Pasa a asistente dental: el ajuste ya no corresponde y no abre nada.
    await servicio(`UPDATE public.clinic_members SET role = 'assistant' WHERE id = $1`, [
      miembros.reception,
    ]);
    expect(await contar(usuarios.reception, "expenses")).toBe(0);
  });

  // ── Caja ──────────────────────────────────────────────────────────────────

  it("quitar la caja a recepción le impide abrir una; a contabilidad no", async () => {
    // Recepción abre (se retira su caja sembrada para poder abrir otra).
    await servicio(`DELETE FROM public.cash_registers WHERE id = $1`, [cajaAjena]);
    expect((await abrirCaja(usuarios.reception, usuarios.reception)).error).toBe("");
    await servicio(`DELETE FROM public.cash_registers WHERE operator_id = $1`, [usuarios.reception]);
    const nueva = await servicio<{ id: string }>(
      `INSERT INTO public.cash_registers
         (clinic_id, currency, opening_amount_cents, opened_by, operator_id, status)
       VALUES ($1, 'CLP', 5000, $2, $2, 'open') RETURNING id`,
      [clinicId, usuarios.reception],
    );
    cajaAjena = nueva[0].id;
    // Ahora se le quita: tampoco puede abrir otra a nombre de la clínica (sin operador).
    expect((await ajustar("reception", "cash:manage", "revoke")).error).toBe("");
    expect((await abrirCaja(usuarios.reception, null)).error).not.toBe("");
    expect((await abrirCaja(usuarios.accounting, usuarios.accounting)).error).toBe("");
    // Tampoco puede cerrar la que tenía abierta ni mover plata.
    const cierre = await como(
      usuarios.reception,
      `UPDATE public.cash_registers SET status = 'closed' WHERE id = $1 RETURNING id`,
      [cajaAjena],
    );
    expect(cierre.filas.length).toBe(0);
    const mov = await como(
      usuarios.reception,
      `INSERT INTO public.cash_movements
         (clinic_id, kind, from_register_id, amount_cents, currency, reason, created_by)
       VALUES ($1, 'retiro', $2, 100, 'CLP', 'Prueba', $3)`,
      [clinicId, cajaAjena, usuarios.reception],
    );
    expect(mov.error).not.toBe("");
  });

  it("dar la caja a un profesional le abre SU caja y no la de otros ni la general", async () => {
    expect((await abrirCaja(usuarios.dentist, usuarios.dentist)).error).not.toBe("");
    expect((await ajustar("dentist", "cash:manage", "grant")).error).toBe("");
    const propia = await abrirCaja(usuarios.dentist, usuarios.dentist);
    expect(propia.error).toBe("");
    const miCaja = (propia.filas[0] as { id: string }).id;
    // Ni la general (sin operador) ni una a nombre de otra persona.
    expect((await abrirCaja(usuarios.dentist, null)).error).not.toBe("");
    expect((await abrirCaja(usuarios.dentist, usuarios.accounting)).error).not.toBe("");
    // Cierra la suya, no la ajena.
    const cierraSuya = await como(
      usuarios.dentist,
      `UPDATE public.cash_registers SET closing_notes = 'ok' WHERE id = $1 RETURNING id`,
      [miCaja],
    );
    expect(cierraSuya.filas.length).toBe(1);
    const cierraAjena = await como(
      usuarios.dentist,
      `UPDATE public.cash_registers SET closing_notes = 'ok' WHERE id = $1 RETURNING id`,
      [cajaAjena],
    );
    expect(cierraAjena.filas.length).toBe(0);
    // Saca plata de la propia, no de la ajena; ve sus movimientos y no los de otros.
    const movPropio = await como(
      usuarios.dentist,
      `INSERT INTO public.cash_movements
         (clinic_id, kind, from_register_id, amount_cents, currency, reason, created_by)
       VALUES ($1, 'retiro', $2, 100, 'CLP', 'Prueba', $3) RETURNING id`,
      [clinicId, miCaja, usuarios.dentist],
    );
    expect(movPropio.error).toBe("");
    const movAjeno = await como(
      usuarios.dentist,
      `INSERT INTO public.cash_movements
         (clinic_id, kind, from_register_id, amount_cents, currency, reason, created_by)
       VALUES ($1, 'retiro', $2, 100, 'CLP', 'Prueba', $3)`,
      [clinicId, cajaAjena, usuarios.dentist],
    );
    expect(movAjeno.error).not.toBe("");
    expect(await contar(usuarios.dentist, "cash_movements")).toBe(1);
    // Asistente dental: rechazado (regla 2) y sin efecto.
    expect((await ajustar("assistant", "cash:manage", "grant")).error).not.toBe("");
    expect((await abrirCaja(usuarios.assistant, usuarios.assistant)).error).not.toBe("");
  });

  // ── Reversar pagos ────────────────────────────────────────────────────────

  async function sembrarPago(): Promise<string> {
    const pac = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    const pago = await servicio<{ id: string }>(
      `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, method, created_by)
       VALUES ($1, $2, 20000, 'cash', $3) RETURNING id`,
      [clinicId, pac[0].id, usuarios.owner],
    );
    return pago[0].id;
  }

  const reversar = (uid: string, pagoId: string) =>
    como(
      uid,
      `UPDATE public.payments
          SET reversed_at = now(), reversed_by = $2, reversal_reason = 'Error de carga'
        WHERE id = $1 RETURNING id`,
      [pagoId, uid],
    );

  it("quitar «Reversar pagos» se cumple; lo demás del pago sigue editable", async () => {
    const pagoId = await sembrarPago();
    expect((await ajustar("coordinator", "payments:reverse", "revoke")).error).toBe("");
    expect((await reversar(usuarios.coordinator, pagoId)).filas.length).toBe(0);
    expect((await reversar(usuarios.coordinator, pagoId)).error).not.toBe("");
    // Otros campos del pago no cambian de regla.
    const nota = await como(
      usuarios.coordinator,
      `UPDATE public.payments SET notes = 'revisado' WHERE id = $1 RETURNING id`,
      [pagoId],
    );
    expect(nota.filas.length).toBe(1);
    // Quien conserva el permiso (recepción) sí puede.
    expect((await reversar(usuarios.reception, pagoId)).filas.length).toBe(1);
  });

  it("quitar «Reversar pagos» también impide anular una cuenta por cobrar", async () => {
    const pac = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Luis', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    const cuenta = await servicio<{ id: string }>(
      `INSERT INTO public.receivables (clinic_id, patient_id, description, amount_cents, currency, issued_on, created_by)
       VALUES ($1, $2, 'Cuota', 50000, 'CLP', '2026-10-01', $3) RETURNING id`,
      [clinicId, pac[0].id, usuarios.owner],
    );
    const anular = (uid: string) =>
      como(
        uid,
        `UPDATE public.receivables SET voided_at = now(), voided_by = $2, void_reason = 'Duplicada'
          WHERE id = $1 RETURNING id`,
        [cuenta[0].id, uid],
      );
    expect((await ajustar("coordinator", "payments:reverse", "revoke")).error).toBe("");
    expect((await anular(usuarios.coordinator)).filas.length).toBe(0);
    expect((await anular(usuarios.reception)).filas.length).toBe(1);
  });

  // ── Comisiones ────────────────────────────────────────────────────────────

  it("quitar «ver todas las comisiones» deja solo lo propio; quitar lo propio lo esconde", async () => {
    // Un administrador que además es profesional: ve lo propio aunque se le quite lo ajeno.
    await servicio(`UPDATE public.professionals SET user_id = $2 WHERE id = $1`, [
      profesionalDentist,
      usuarios.admin,
    ]);
    expect((await ajustarComoOwner("admin", "commission:view-all", "revoke")).error).toBe("");
    const ver = await como<{ professional_id: string }>(
      usuarios.admin,
      `SELECT professional_id FROM public.commission_settlements WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(ver.filas.map((f) => f.professional_id)).toEqual([profesionalDentist]);
    // Al revés: quitar lo propio esconde esas filas pero no las ajenas.
    expect((await ajustarComoOwner("admin", "commission:view-own", "revoke")).error).toBe("");
    await servicio(
      `DELETE FROM public.clinic_member_permission_overrides WHERE member_id = $1 AND permission = 'commission:view-all'`,
      [miembros.admin],
    );
    const ver2 = await como<{ professional_id: string }>(
      usuarios.admin,
      `SELECT professional_id FROM public.commission_settlements WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(ver2.filas.map((f) => f.professional_id)).toEqual([profesionalOtro]);
  });

  it("contabilidad sin «ver todas las comisiones» no ve ninguna; el doctor sin «ver la propia» tampoco", async () => {
    expect((await ajustar("accounting", "commission:view-all", "revoke")).error).toBe("");
    expect(await contar(usuarios.accounting, "commission_settlements")).toBe(0);
    expect(await contar(usuarios.accounting, "commission_rules")).toBe(0);
    expect(await contar(usuarios.accounting, "commission_rule_versions")).toBe(0);
    // Los gastos y la caja de contabilidad siguen igual.
    expect(await contar(usuarios.accounting, "expenses")).toBe(1);
    expect((await ajustar("dentist", "commission:view-own", "revoke")).error).toBe("");
    expect(await contar(usuarios.dentist, "commission_settlements")).toBe(0);
    expect(await contar(usuarios.dentist2, "commission_settlements")).toBe(1);
  });

  it("dar «ver todas las comisiones» a un doctor o a recepción abre solo comisiones", async () => {
    expect((await ajustar("dentist", "commission:view-all", "grant")).error).toBe("");
    expect(await contar(usuarios.dentist, "commission_settlements")).toBe(2);
    expect(await contar(usuarios.dentist, "commission_rules")).toBe(2);
    expect(await contar(usuarios.dentist, "expenses")).toBe(0);
    expect((await ajustar("reception", "commission:view-all", "grant")).error).toBe("");
    expect(await contar(usuarios.reception, "commission_settlements")).toBe(2);
    expect(await contar(usuarios.reception, "expenses")).toBe(0);
    // Asistente dental y técnico/a: rechazado.
    for (const clave of ["assistant", "lab_technician"]) {
      expect((await ajustar(clave, "commission:view-all", "grant")).error, clave).not.toBe("");
      expect(await contar(usuarios[clave], "commission_settlements"), clave).toBe(0);
    }
  });

  // ── Hoy ───────────────────────────────────────────────────────────────────

  it("Hoy respeta lo quitado y lo dado en dinero y en caja", async () => {
    const hoy = async (uid: string) =>
      (
        await como<{ r: Record<string, unknown> }>(uid, `SELECT public.panel_de_hoy($1) AS r`, [
          clinicId,
        ])
      ).filas[0].r;
    // Contabilidad: dinero y caja por rol.
    let r = await hoy(usuarios.accounting);
    expect(r).toHaveProperty("presupuestos");
    expect(r).toHaveProperty("cajas");
    await ajustar("accounting", "finance:view", "revoke");
    await ajustar("accounting", "cash:manage", "revoke");
    r = await hoy(usuarios.accounting);
    expect(r).not.toHaveProperty("presupuestos");
    expect(r).not.toHaveProperty("cajas");
    // Recepción: caja sí, dinero no; con finanzas dadas, aparece el dinero.
    r = await hoy(usuarios.reception);
    expect(r).toHaveProperty("cajas");
    expect(r).not.toHaveProperty("presupuestos");
    await ajustar("reception", "finance:view", "grant");
    r = await hoy(usuarios.reception);
    expect(r).toHaveProperty("presupuestos");
    // Un doctor con la caja dada ve su bloque de caja; sin ella, no.
    r = await hoy(usuarios.dentist);
    expect(r).not.toHaveProperty("cajas");
    await ajustar("dentist", "cash:manage", "grant");
    r = await hoy(usuarios.dentist);
    expect(r).toHaveProperty("cajas");
    expect(r).not.toHaveProperty("presupuestos");
  });

  // ── Informes con montos ───────────────────────────────────────────────────

  it("Informes con montos respeta lo dado y lo quitado", async () => {
    const cobrado = (uid: string) =>
      como(
        uid,
        `SELECT * FROM public.informe_metrica($1, 'cobrado', '2026-10-01', '2026-10-31')`,
        [clinicId],
      );
    expect((await cobrado(usuarios.accounting)).error).toBe("");
    expect((await cobrado(usuarios.reception)).error).toMatch(/permisos/);
    expect((await ajustar("reception", "finance:view", "grant")).error).toBe("");
    expect((await cobrado(usuarios.reception)).error).toBe("");
    expect((await ajustar("accounting", "finance:view", "revoke")).error).toBe("");
    expect((await cobrado(usuarios.accounting)).error).toMatch(/permisos/);
    // El embudo sigue entregando filas, pero sin «pagados» para quien perdió finanzas.
    const embudo = await como<{ pagados: string | null }>(
      usuarios.accounting,
      `SELECT * FROM public.informe_embudo($1, '2026-01-01', '2026-12-31')`,
      [clinicId],
    );
    expect(embudo.error).toBe("");
    for (const f of embudo.filas) expect(f.pagados).toBeNull();
  });

  // ── Aislamiento entre clínicas ────────────────────────────────────────────

  it("un ajuste en una clínica no se siente en otra", async () => {
    // El mismo usuario es contabilidad en dos clínicas; se le quita finanzas en la primera.
    const otraClinica = randomUUID();
    const otroOwner = randomUUID();
    await servicio(`INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`, [
      otraClinica,
      otroOwner,
    ]);
    await servicio(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, 'accounting')`,
      [otraClinica, usuarios.accounting],
    );
    await servicio(
      `INSERT INTO public.expenses (clinic_id, category, description, amount_cents, incurred_on, created_by)
       VALUES ($1, 'otro', 'Gasto de la otra', 1000, '2026-10-01', $2)`,
      [otraClinica, otroOwner],
    );
    expect((await ajustar("accounting", "finance:view", "revoke")).error).toBe("");
    expect(await contar(usuarios.accounting, "expenses")).toBe(0);
    const enOtra = await como<{ n: number }>(
      usuarios.accounting,
      `SELECT count(*)::int AS n FROM public.expenses WHERE clinic_id = $1`,
      [otraClinica],
    );
    expect(enOtra.filas[0].n).toBe(1);
    // Y el administrador de la primera no puede ajustar a un miembro de la otra.
    const ajeno = await servicio<{ id: string }>(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, 'reception') RETURNING id`,
      [otraClinica, randomUUID()],
    );
    const r = await como(
      usuarios.admin,
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       VALUES ($1, $2, 'finance:view', 'grant')`,
      [clinicId, ajeno[0].id],
    );
    expect(r.error).not.toBe("");
  });
});
