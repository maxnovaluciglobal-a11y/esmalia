import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 10 · frente B (migraciones 20261106200000 y 20261106200100) contra la
 * base efímera de tests, con `SET LOCAL ROLE authenticated` y el `sub` del
 * JWT como llega por PostgREST:
 *
 * - CAJ-02/03: dos operadores con cajas abiertas a la vez; cada pago queda en
 *   la caja de quien cobra; una caja la cierra su dueña u owner/admin; cerrada
 *   no cambia; la base vuelve a calcular el esperado al cerrar.
 * - CAJ-04: traspaso entre cajas, tope de efectivo, caja cerrada, caja ajena.
 * - COM-03/04: una liquidación cerrada no cambia al editar la regla ni se
 *   puede reescribir; una regla nueva no rige desde una fecha liquidada; dos
 *   liquidaciones no se pisan.
 * - COM-05: un profesional no ve las reglas ni liquidaciones de otro.
 * - Aislamiento entre clínicas en las tablas nuevas.
 */

describe("Ola 10 · caja por operador y comisiones (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let otraClinica: string;
  let otroOwner: string;
  let pacienteId: string;

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

  async function cobrar(userId: string, monto: number, cajaPedida: string | null = null) {
    const r = await como<{ cash_register_id: string | null }>(
      userId,
      `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, method, cash_register_id)
       VALUES ($1, $2, $3, 'cash', $4) RETURNING cash_register_id`,
      [clinicId, pacienteId, monto, cajaPedida],
    );
    expect(r.error).toBe("");
    return r.filas[0].cash_register_id;
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
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ── CAJ-02 / CAJ-03 ─────────────────────────────────────────────────────

  describe("caja por operador", () => {
    it("dos operadores tienen cajas abiertas a la vez y cada cobro queda en la de quien cobra", async () => {
      const cajaRecepcion = await abrirCaja(usuarios.reception);
      const cajaAdmin = await abrirCaja(usuarios.admin);
      // Aunque la app mande la caja de otra persona, el pago va a la propia.
      expect(await cobrar(usuarios.reception, 5000, cajaAdmin)).toBe(cajaRecepcion);
      expect(await cobrar(usuarios.admin, 7000)).toBe(cajaAdmin);
      const sumas = await servicio<{ id: string; total: string }>(
        `SELECT cash_register_id AS id, sum(amount_cents)::text AS total FROM public.payments
          WHERE clinic_id = $1 GROUP BY 1 ORDER BY 2`,
        [clinicId],
      );
      expect(sumas).toEqual([
        { id: cajaRecepcion, total: "5000" },
        { id: cajaAdmin, total: "7000" },
      ]);
    });

    it("una persona no abre dos cajas a la vez ni abre la caja de otra", async () => {
      await abrirCaja(usuarios.reception);
      const doble = await como(
        usuarios.reception,
        `INSERT INTO public.cash_registers (clinic_id, opening_amount_cents, opened_by, operator_id)
         VALUES ($1, 0, $2, $2)`,
        [clinicId, usuarios.reception],
      );
      expect(doble.error).toMatch(/duplicate|única|unique/i);
      const ajena = await como(
        usuarios.reception,
        `INSERT INTO public.cash_registers (clinic_id, opening_amount_cents, opened_by, operator_id)
         VALUES ($1, 0, $2, $3)`,
        [clinicId, usuarios.reception, usuarios.admin],
      );
      expect(ajena.error).not.toBe("");
    });

    it("sin caja propia: vale el vínculo a la caja general, no a la de otra persona", async () => {
      const cajaRecepcion = await abrirCaja(usuarios.reception);
      expect(await cobrar(usuarios.dentist, 1000, cajaRecepcion)).toBeNull();
      const general = await como<{ id: string }>(
        usuarios.admin,
        `INSERT INTO public.cash_registers (clinic_id, opening_amount_cents, opened_by)
         VALUES ($1, 0, $2) RETURNING id`,
        [clinicId, usuarios.admin],
      );
      expect(general.error).toBe("");
      expect(await cobrar(usuarios.dentist, 1000, general.filas[0].id)).toBe(general.filas[0].id);
    });

    it("la caja de una persona la cierra ella u owner/admin, no otra recepcionista ni contabilidad", async () => {
      const caja = await abrirCaja(usuarios.reception);
      const cierre = `UPDATE public.cash_registers SET status = 'closed', closed_at = now(), closed_by = $2,
          expected_closing_cents = 20000, declared_closing_cents = 20000, difference_cents = 0
        WHERE id = $1 RETURNING id`;
      const contabilidad = await como(usuarios.accounting, cierre, [caja, usuarios.accounting]);
      expect(contabilidad.filas).toHaveLength(0);
      const owner = await como(usuarios.owner, cierre, [caja, usuarios.owner]);
      expect(owner.error).toBe("");
      expect(owner.filas).toHaveLength(1);
      // Cerrada no cambia.
      const editar = await como(
        usuarios.owner,
        `UPDATE public.cash_registers SET closing_notes = 'otra cosa' WHERE id = $1`,
        [caja],
      );
      expect(editar.error).toMatch(/ya está cerrada/);
    });

    it("al cerrar con los snapshots nuevos la base vuelve a calcular el esperado", async () => {
      const caja = await abrirCaja(usuarios.reception, 20000);
      await cobrar(usuarios.reception, 5000);
      const cerrar = (esperado: number) =>
        como(
          usuarios.reception,
          `UPDATE public.cash_registers SET status = 'closed', closed_at = now(), closed_by = $2,
             expected_closing_cents = $3, declared_closing_cents = $3, difference_cents = 0,
             cash_collected_cents = 5000, movements_in_cents = 0, movements_out_cents = 0
           WHERE id = $1 RETURNING id`,
          [caja, usuarios.reception, esperado],
        );
      expect((await cerrar(20000)).error).toMatch(/mientras contabas/);
      const ok = await cerrar(25000);
      expect(ok.error).toBe("");
      expect(ok.filas).toHaveLength(1);
    });
  });

  // ── CAJ-04 ──────────────────────────────────────────────────────────────

  describe("movimientos entre cajas", () => {
    it("traspaso entre cajas abiertas, con tope de efectivo y sin sacar de una caja ajena", async () => {
      const cajaRecepcion = await abrirCaja(usuarios.reception, 20000);
      const cajaAdmin = await abrirCaja(usuarios.admin, 10000);
      const mover = (userId: string, desde: string, hacia: string | null, monto: number) =>
        como(
          userId,
          `INSERT INTO public.cash_movements (clinic_id, kind, from_register_id, to_register_id, amount_cents, reason, created_by)
           VALUES ($1, $2, $3, $4, $5, 'Sencillo para vuelto', $6) RETURNING id`,
          [clinicId, hacia ? "traspaso" : "deposito", desde, hacia, monto, userId],
        );
      expect((await mover(usuarios.reception, cajaRecepcion, cajaAdmin, 5000)).error).toBe("");
      expect((await mover(usuarios.reception, cajaRecepcion, null, 99999)).error).toMatch(
        /No hay tanto efectivo/,
      );
      // Recepción no saca plata de la caja de admin.
      expect((await mover(usuarios.reception, cajaAdmin, null, 1000)).error).not.toBe("");
      const [saldo] = await servicio<{ e: string; s: string }>(
        `SELECT entradas_cents::text AS e, salidas_cents::text AS s FROM public.efectivo_en_caja($1)`,
        [cajaAdmin],
      );
      expect(saldo).toEqual({ e: "5000", s: "0" });
      // Un movimiento no se edita ni se borra.
      const borrar = await como(usuarios.owner, `DELETE FROM public.cash_movements RETURNING id`);
      expect(borrar.filas.length === 0 || borrar.error !== "").toBe(true);
    });

    it("no hay movimientos desde una caja cerrada ni hacia una caja de otra clínica", async () => {
      const caja = await abrirCaja(usuarios.admin, 10000);
      const ajena = await servicio<{ id: string }>(
        `INSERT INTO public.cash_registers (clinic_id, opening_amount_cents, opened_by, operator_id)
         VALUES ($1, 0, $2, $2) RETURNING id`,
        [otraClinica, otroOwner],
      );
      const r = await como(
        usuarios.admin,
        `INSERT INTO public.cash_movements (clinic_id, kind, from_register_id, to_register_id, amount_cents, reason, created_by)
         VALUES ($1, 'traspaso', $2, $3, 100, 'Prueba de aislamiento', $4)`,
        [clinicId, caja, ajena[0].id, usuarios.admin],
      );
      expect(r.error).toMatch(/destino no existe/);
      await servicio(
        `UPDATE public.cash_registers SET status = 'closed', closed_at = now(), closed_by = $2,
           expected_closing_cents = 10000, declared_closing_cents = 10000, difference_cents = 0 WHERE id = $1`,
        [caja, usuarios.admin],
      );
      const cerrada = await como(
        usuarios.admin,
        `INSERT INTO public.cash_movements (clinic_id, kind, from_register_id, amount_cents, reason, created_by)
         VALUES ($1, 'retiro', $2, 100, 'Retiro de prueba', $3)`,
        [clinicId, caja, usuarios.admin],
      );
      expect(cerrada.error).toMatch(/ya está cerrada/);
    });

    it("otra clínica no ve los movimientos", async () => {
      const a = await abrirCaja(usuarios.admin, 10000);
      await como(
        usuarios.admin,
        `INSERT INTO public.cash_movements (clinic_id, kind, from_register_id, amount_cents, reason, created_by)
         VALUES ($1, 'deposito', $2, 1000, 'Depósito de prueba', $3)`,
        [clinicId, a, usuarios.admin],
      );
      const visto = await como(otroOwner, `SELECT id FROM public.cash_movements`);
      expect(visto.filas).toHaveLength(0);
      const dentista = await como(usuarios.dentist, `SELECT id FROM public.cash_movements`);
      expect(dentista.filas).toHaveLength(0);
    });
  });

  // ── COM-03 / COM-04 / COM-05 ────────────────────────────────────────────

  describe("comisiones con vigencia y liquidación congelada", () => {
    let pro1: string;
    let pro2: string;

    beforeEach(async () => {
      const pros = await servicio<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name, user_id)
         VALUES ($1, 'Dra. Uno', $2), ($1, 'Dr. Dos', $3) RETURNING id`,
        [clinicId, usuarios.dentist, usuarios.dentist2],
      );
      [pro1, pro2] = pros.map((p) => p.id);
      for (const pro of [pro1, pro2]) {
        const r = await como(
          usuarios.owner,
          `INSERT INTO public.commission_rule_versions (clinic_id, professional_id, kind, percent_bps, base, effective_from)
           VALUES ($1, $2, 'percent', 4000, 'realizado', '2026-01-01')`,
          [clinicId, pro],
        );
        expect(r.error).toBe("");
      }
      const s = await como(
        usuarios.owner,
        `INSERT INTO public.commission_settlements
           (clinic_id, professional_id, period_from, period_to, rule_kind, rule_percent_bps,
            production_cents, procedure_count, commission_cents, closed_by, base, detail)
         VALUES ($1, $2, '2026-09-01', '2026-09-30', 'percent', 4000, 100000, 2, 40000, $3,
                 'realizado', '{"version":1,"currency":"CLP","tramos":[],"lineas":[]}')`,
        [clinicId, pro1, usuarios.owner],
      );
      expect(s.error).toBe("");
    });

    it("la liquidación cerrada no cambia al editar la regla y no se puede reescribir", async () => {
      // Regla nueva desde octubre: permitido, no toca septiembre.
      const nueva = await como(
        usuarios.owner,
        `INSERT INTO public.commission_rule_versions (clinic_id, professional_id, kind, percent_bps, base, effective_from)
         VALUES ($1, $2, 'percent', 6000, 'cobrado', '2026-10-01')`,
        [clinicId, pro1],
      );
      expect(nueva.error).toBe("");
      const [liq] = await servicio<{ commission_cents: string }>(
        `SELECT commission_cents::text FROM public.commission_settlements WHERE professional_id = $1`,
        [pro1],
      );
      expect(liq.commission_cents).toBe("40000");
      const reescribir = await como(
        usuarios.owner,
        `UPDATE public.commission_settlements SET commission_cents = 1 WHERE professional_id = $1`,
        [pro1],
      );
      expect(reescribir.error).toMatch(/no se modifica/);
      const pagar = await como(
        usuarios.owner,
        `UPDATE public.commission_settlements SET paid_at = now(), paid_by = $2 WHERE professional_id = $1 RETURNING id`,
        [pro1, usuarios.owner],
      );
      expect(pagar.error).toBe("");
      expect(pagar.filas).toHaveLength(1);
    });

    it("una regla nueva no rige desde una fecha liquidada, ni se cambia o borra la usada", async () => {
      const retro = await como(
        usuarios.owner,
        `INSERT INTO public.commission_rule_versions (clinic_id, professional_id, kind, percent_bps, base, effective_from)
         VALUES ($1, $2, 'percent', 9000, 'realizado', '2026-09-15')`,
        [clinicId, pro1],
      );
      expect(retro.error).toMatch(/liquidado/);
      const cambiar = await como(
        usuarios.owner,
        `UPDATE public.commission_rule_versions SET percent_bps = 9000 WHERE professional_id = $1`,
        [pro1],
      );
      expect(cambiar.error).toMatch(/liquidado/);
      const borrar = await como(
        usuarios.owner,
        `DELETE FROM public.commission_rule_versions WHERE professional_id = $1`,
        [pro1],
      );
      expect(borrar.error).toMatch(/liquidado/);
      // El otro profesional no tiene nada liquidado: su regla sí se cambia.
      const otro = await como(
        usuarios.owner,
        `UPDATE public.commission_rule_versions SET percent_bps = 4500 WHERE professional_id = $1 RETURNING id`,
        [pro2],
      );
      expect(otro.error).toBe("");
    });

    it("dos liquidaciones del mismo profesional no se pisan", async () => {
      const cruce = await como(
        usuarios.owner,
        `INSERT INTO public.commission_settlements
           (clinic_id, professional_id, period_from, period_to, rule_kind, production_cents, procedure_count, commission_cents, closed_by)
         VALUES ($1, $2, '2026-09-15', '2026-10-15', 'percent', 0, 0, 0, $3)`,
        [clinicId, pro1, usuarios.owner],
      );
      expect(cruce.error).toMatch(/se cruza/);
    });

    it("solo owner/admin escriben reglas; recepción y el propio profesional no", async () => {
      for (const rol of ["reception", "dentist", "accounting"]) {
        const r = await como(
          usuarios[rol],
          `INSERT INTO public.commission_rule_versions (clinic_id, professional_id, kind, percent_bps, base, effective_from)
           VALUES ($1, $2, 'percent', 9000, 'realizado', '2026-12-01')`,
          [clinicId, pro2],
        );
        expect(r.error, rol).not.toBe("");
      }
    });

    it("un profesional ve solo sus reglas y liquidaciones (COM-05)", async () => {
      const reglas = await como<{ professional_id: string }>(
        usuarios.dentist2,
        `SELECT professional_id FROM public.commission_rule_versions`,
      );
      expect(reglas.filas.map((f) => f.professional_id)).toEqual([pro2]);
      const liqOtro = await como(usuarios.dentist2, `SELECT id FROM public.commission_settlements`);
      expect(liqOtro.filas).toHaveLength(0);
      const liqPropia = await como(
        usuarios.dentist,
        `SELECT id FROM public.commission_settlements`,
      );
      expect(liqPropia.filas).toHaveLength(1);
      const recepcion = await como(
        usuarios.reception,
        `SELECT id FROM public.commission_rule_versions`,
      );
      expect(recepcion.filas).toHaveLength(0);
    });

    it("otra clínica no ve ni escribe las reglas", async () => {
      const ve = await como(otroOwner, `SELECT id FROM public.commission_rule_versions`);
      expect(ve.filas).toHaveLength(0);
      const escribe = await como(
        otroOwner,
        `INSERT INTO public.commission_rule_versions (clinic_id, professional_id, kind, percent_bps, base, effective_from)
         VALUES ($1, $2, 'percent', 9000, 'realizado', '2026-12-01')`,
        [clinicId, pro2],
      );
      expect(escribe.error).not.toBe("");
    });
  });
});
