import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 11 · frente B (migraciones 20261107200000 y 20261107200100) contra la
 * base efímera, con `SET LOCAL ROLE authenticated` y el `sub` del JWT:
 *
 * - PAN-03..08: `panel_de_hoy` arma cada sección solo si el rol la puede ver.
 *   Recepción no recibe ningún monto (aunque la RLS de cuotas la deja leer);
 *   el dinero es de finance:view. Un ajuste por persona que quita la agenda
 *   también quita sus alertas. Aislamiento entre clínicas.
 * - REC-10: el aviso de stock bajo sale una vez por cruce y por persona, no se
 *   duplica y respeta la preferencia de avisos (`notifications_respetar_preferencia`).
 */

describe("Ola 11 · panel de Hoy y alerta de stock (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacienteId: string;
  let profId: string;
  let otroProfId: string;
  let branchId: string;
  let otraClinica: string;
  let otroOwner: string;
  let insumoId: string;

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

  type Panel = Record<string, unknown> & { alertas: Record<string, number> };
  async function panel(userId: string, clinica = clinicId) {
    const r = await como<{ p: Panel }>(userId, `SELECT public.panel_de_hoy($1) AS p`, [clinica]);
    return { panel: r.filas[0]?.p, error: r.error };
  }

  async function avisosDeStock(userId: string) {
    return servicio<{ title: string; read_at: string | null }>(
      `SELECT title, read_at FROM public.notifications
        WHERE recipient_id = $1 AND kind = 'stock_low' AND clinic_id = $2`,
      [userId, clinicId],
    );
  }

  async function movimiento(kind: "entrada" | "salida" | "ajuste", cantidad: number) {
    await servicio(
      `INSERT INTO public.inventory_movements (clinic_id, item_id, kind, quantity, recorded_by)
       VALUES ($1, $2, $3::public.inventory_movement_kind, $4, $5)`,
      [clinicId, insumoId, kind, cantidad, usuarios.owner],
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
    usuarios.lab = randomUUID();
    usuarios.coordinador = randomUUID();
    await servicio(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role)
       VALUES ($1, $2, 'lab_technician'), ($1, $3, 'coordinator')`,
      [clinicId, usuarios.lab, usuarios.coordinador],
    );
    otraClinica = randomUUID();
    otroOwner = randomUUID();
    await servicio(`INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`, [
      otraClinica,
      otroOwner,
    ]);

    [{ id: pacienteId }] = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    [{ id: branchId }] = await servicio<{ id: string }>(
      `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Centro') RETURNING id`,
      [clinicId],
    );
    [{ id: profId }] = await servicio<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name, user_id) VALUES ($1, 'Dra. Prueba', $2) RETURNING id`,
      [clinicId, usuarios.dentist],
    );
    [{ id: otroProfId }] = await servicio<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dr. Otro') RETURNING id`,
      [clinicId],
    );

    // Reserva en línea por aceptar (mañana) y una cita común sin confirmar.
    await servicio(
      `INSERT INTO public.appointments
         (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at, status, created_by, booking_source)
       VALUES ($1, $2, $3, $4, now() + interval '1 day', now() + interval '1 day 30 minutes', 'tentativa', $5, 'reserva_en_linea'),
              ($1, $2, $3, $4, now() + interval '1 day 2 hours', now() + interval '1 day 150 minutes', 'tentativa', $5, null)`,
      [clinicId, branchId, pacienteId, profId, usuarios.owner],
    );
    // Control vencido.
    await servicio(
      `INSERT INTO public.patient_controls (clinic_id, patient_id, due_on, reason, created_by)
       VALUES ($1, $2, current_date - 10, 'Control de 6 meses', $3)`,
      [clinicId, pacienteId, usuarios.owner],
    );
    // Órdenes de laboratorio: una atrasada de la Dra. Prueba, una al día de otro profesional.
    await servicio(
      `INSERT INTO public.lab_orders
         (clinic_id, patient_id, professional_id, description, status, sent_on, due_on, created_by)
       VALUES ($1, $2, $3, 'Corona 1.6', 'enviado', current_date - 15, current_date - 2, $5),
              ($1, $2, $4, 'Placa de descanso', 'en_proceso', current_date - 3, current_date + 5, $5)`,
      [clinicId, pacienteId, profId, otroProfId, usuarios.owner],
    );
    // Presupuesto enviado (dinero).
    await servicio(
      `INSERT INTO public.quotes (clinic_id, patient_id, number, status, subtotal_cents, total_cents, created_by, sent_at)
       VALUES ($1, $2, 'P-1', 'sent', 120000, 120000, $3, now())`,
      [clinicId, pacienteId, usuarios.owner],
    );
    // Cuota de membresía vencida.
    const [{ id: planId }] = await servicio<{ id: string }>(
      `INSERT INTO public.membership_plans (clinic_id, name, fee_cents, currency, created_by)
       VALUES ($1, 'Plan Sonrisa', 15000, 'CLP', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    const [{ id: membresiaId }] = await servicio<{ id: string }>(
      `INSERT INTO public.patient_memberships
         (clinic_id, patient_id, plan_id, plan_name_snapshot, fee_cents, currency, billing_period, starts_on, created_by)
       VALUES ($1, $2, $4, 'Plan Sonrisa', 15000, 'CLP', 'monthly', date_trunc('month', current_date - 40)::date, $3)
       RETURNING id`,
      [clinicId, pacienteId, usuarios.owner, planId],
    );
    await servicio(
      `INSERT INTO public.membership_charges
         (clinic_id, membership_id, patient_id, period_start, period_end, amount_cents, currency)
       VALUES ($1, $2, $3, date_trunc('month', current_date - 40)::date,
               (date_trunc('month', current_date - 40) + interval '1 month - 1 day')::date, 15000, 'CLP')`,
      [clinicId, membresiaId, pacienteId],
    );
    // Caja de recepción abierta desde ayer.
    await servicio(
      `INSERT INTO public.cash_registers (clinic_id, opening_amount_cents, opened_by, operator_id, operator_name_snapshot, opened_at)
       VALUES ($1, 20000, $2, $2, 'Recepción', now() - interval '30 hours')`,
      [clinicId, usuarios.reception],
    );
    // Insumo con mínimo 5 y stock 10.
    [{ id: insumoId }] = await servicio<{ id: string }>(
      `INSERT INTO public.inventory_items (clinic_id, name, unit, min_stock, created_by)
       VALUES ($1, 'Guantes M', 'cajas', 5, $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    await movimiento("entrada", 10);
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  describe("panel_de_hoy por rol", () => {
    it("recepción ve confirmaciones, reservas y su caja, pero ningún monto", async () => {
      const { panel: p, error } = await panel(usuarios.reception);
      expect(error).toBe("");
      expect(p.alertas.reservas_por_aceptar).toBe(1);
      expect(p.alertas.citas_por_confirmar).toBe(1);
      expect(p.alertas.controles_vencidos).toBe(1);
      expect(p.alertas.cajas_sin_cerrar).toBe(1);
      expect((p.reservas as unknown[]).length).toBe(1);
      expect(p.cajas).toMatchObject({ abiertas: 1 });
      // Dinero: ni presupuestos ni cuotas, y ninguna clave con montos.
      expect(p.presupuestos).toBeUndefined();
      expect(p.alertas.cuotas_vencidas).toBeUndefined();
      expect(JSON.stringify(p)).not.toMatch(/cents/);
    });

    it("dueño y contabilidad ven presupuestos y cuotas vencidas; contabilidad sin agenda", async () => {
      const { panel: dueno } = await panel(usuarios.owner);
      expect(dueno.presupuestos).toMatchObject({ abiertos: 1, abiertos_cents: 120000 });
      expect(dueno.alertas.cuotas_vencidas).toBe(1);
      expect(dueno.alertas.cajas_sin_cerrar).toBe(1); // owner ve todas las cajas

      const { panel: conta } = await panel(usuarios.accounting);
      expect(conta.presupuestos).toMatchObject({ abiertos: 1 });
      expect(conta.alertas.cuotas_vencidas).toBe(1);
      expect(conta.reservas).toBeUndefined();
      expect(conta.alertas.reservas_por_aceptar).toBeUndefined();
      expect(conta.stock_bajo).toBeUndefined(); // contabilidad no ve inventario
    });

    it("coordinación ve agenda y dinero (recepción + contabilidad)", async () => {
      const { panel: p } = await panel(usuarios.coordinador);
      expect(p.alertas.reservas_por_aceptar).toBe(1);
      expect(p.presupuestos).toMatchObject({ abiertos: 1 });
    });

    it("el profesional ve sus notas sin firmar y solo sus órdenes de laboratorio", async () => {
      const { panel: p } = await panel(usuarios.dentist);
      expect(p.alertas.notas_sin_firmar).toBe(1); // la nota en borrador del escenario
      expect((p.notas_sin_firmar as unknown[]).length).toBe(1);
      const lab = p.laboratorio as { en_curso: number; atrasadas: number };
      expect(lab.en_curso).toBe(1);
      expect(lab.atrasadas).toBe(1);
      expect(p.desempeno_propio).toMatchObject({ atendidas_mes: 0 });
      expect(p.presupuestos).toBeUndefined();
      expect(p.cajas).toBeUndefined();
    });

    it("técnico/a dental ve el laboratorio completo e insumos, sin agenda ni dinero", async () => {
      const { panel: p } = await panel(usuarios.lab);
      const lab = p.laboratorio as { en_curso: number; atrasadas: number; ordenes: unknown[] };
      expect(lab.en_curso).toBe(2);
      expect(lab.atrasadas).toBe(1);
      expect(lab.ordenes.length).toBe(2);
      expect(p.stock_bajo).toEqual([]);
      expect(p.reservas).toBeUndefined();
      expect(p.presupuestos).toBeUndefined();
      expect(JSON.stringify(p)).not.toMatch(/cents/);
    });

    it("un ajuste que quita la agenda a recepción también quita sus alertas", async () => {
      const [{ id: memberId }] = await servicio<{ id: string }>(
        `SELECT id FROM public.clinic_members WHERE clinic_id = $1 AND user_id = $2`,
        [clinicId, usuarios.reception],
      );
      await servicio(
        `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
         VALUES ($1, $2, 'agenda:manage', 'revoke')`,
        [clinicId, memberId],
      );
      const { panel: p } = await panel(usuarios.reception);
      expect(p.alertas.reservas_por_aceptar).toBeUndefined();
      expect(p.reservas).toBeUndefined();
    });

    it("aislamiento: un integrante de otra clínica no puede pedir el panel", async () => {
      const { error } = await panel(otroOwner, clinicId);
      expect(error).toMatch(/permisos/i);
      // Y su propio panel no cuenta nada de esta clínica.
      const { panel: suyo } = await panel(otroOwner, otraClinica);
      const lab = suyo.laboratorio as { en_curso: number };
      expect(lab.en_curso).toBe(0);
      expect(suyo.presupuestos).toMatchObject({ abiertos: 0 });
    });
  });

  describe("REC-10 · alerta de stock", () => {
    it("avisa una vez al cruzar el mínimo, a owner/admin/técnico, sin duplicar", async () => {
      expect(await avisosDeStock(usuarios.owner)).toHaveLength(0);
      await movimiento("salida", 6); // 10 → 4: cruza
      for (const u of [usuarios.owner, usuarios.admin, usuarios.lab]) {
        const avisos = await avisosDeStock(u);
        expect(avisos).toHaveLength(1);
        expect(avisos[0].title).toBe("Stock bajo: Guantes M");
      }
      expect(await avisosDeStock(usuarios.dentist)).toHaveLength(0);
      expect(await avisosDeStock(usuarios.reception)).toHaveLength(0);

      await movimiento("salida", 1); // sigue bajo: no es un cruce
      expect(await avisosDeStock(usuarios.owner)).toHaveLength(1);

      // Se repone y vuelve a bajar sin haber leído el aviso: no se duplica.
      await movimiento("entrada", 10);
      await movimiento("salida", 9);
      expect(await avisosDeStock(usuarios.owner)).toHaveLength(1);

      // Leído el aviso, un nuevo cruce sí avisa de nuevo.
      await servicio(
        `UPDATE public.notifications SET read_at = now() WHERE recipient_id = $1 AND kind = 'stock_low'`,
        [usuarios.owner],
      );
      await movimiento("entrada", 10);
      await movimiento("salida", 10);
      expect(await avisosDeStock(usuarios.owner)).toHaveLength(2);

      // Y el panel lo cuenta.
      const { panel: p } = await panel(usuarios.lab);
      expect(p.alertas.stock_bajo).toBe(1);
      expect((p.stock_bajo as { nombre: string }[])[0].nombre).toBe("Guantes M");
    });

    it("respeta la preferencia de avisos de cada persona", async () => {
      await servicio(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
        usuarios.owner,
      ]);
      await servicio(
        `INSERT INTO public.notification_preferences (user_id, inapp_enabled) VALUES ($1, false)
         ON CONFLICT (user_id) DO UPDATE SET inapp_enabled = false`,
        [usuarios.owner],
      );
      await movimiento("salida", 6);
      expect(await avisosDeStock(usuarios.owner)).toHaveLength(0);
      expect(await avisosDeStock(usuarios.admin)).toHaveLength(1);
    });

    it("subir el mínimo por encima del stock también avisa; un insumo inactivo no", async () => {
      await servicio(`UPDATE public.inventory_items SET min_stock = 12 WHERE id = $1`, [insumoId]);
      expect(await avisosDeStock(usuarios.admin)).toHaveLength(1);

      const [{ id: inactivo }] = await servicio<{ id: string }>(
        `INSERT INTO public.inventory_items (clinic_id, name, unit, min_stock, is_active, created_by)
         VALUES ($1, 'Fresas', 'unidades', 3, false, $2) RETURNING id`,
        [clinicId, usuarios.owner],
      );
      await servicio(`UPDATE public.inventory_items SET min_stock = 4 WHERE id = $1`, [inactivo]);
      expect(await avisosDeStock(usuarios.admin)).toHaveLength(1);
    });
  });
});
