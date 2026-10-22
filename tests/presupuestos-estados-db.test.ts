import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { QUOTE_STATUSES, type QuoteStatus } from "@/lib/finance/finance";
import { puedeTransicionar } from "@/lib/finance/estados-presupuesto";
import { comoUsuario, conectar, esperaFallo, sembrarEscenario } from "./helpers/db";

/**
 * Ola 3 · Frente Planes (migraciones 20261024200000 y 20261024200100):
 *
 * - PLA-02: el guard de transiciones de la base coincide con `TRANSICIONES`
 *   de la app, la aceptación parcial arma el plan solo con lo aceptado, y
 *   cada cambio queda en `quote_events` con quién y cuándo.
 * - PLA-06: `vencer_presupuestos()` vence lo pendiente cuya validez pasó, sin
 *   actor, y renovar exige una validez desde hoy.
 * - PLA-12: paquetes y líneas solo con datos de la misma clínica.
 */
describe("planes: estados, historial, validez y paquetes", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let patientId: string;

  async function crearPresupuesto(
    status: QuoteStatus = "draft",
    validUntil: string | null = "2099-12-31",
    lineas: { nombre: string; total: number; fase?: string }[] = [
      { nombre: "Limpieza", total: 30_000, fase: "Fase 1" },
      { nombre: "Endodoncia", total: 180_000, fase: "Fase 1" },
      { nombre: "Corona", total: 290_000, fase: "Fase 2" },
    ],
  ) {
    const total = lineas.reduce((s, l) => s + l.total, 0);
    const q = await comoUsuario<{ id: string }>(
      client,
      usuarios.reception,
      `INSERT INTO public.quotes
         (clinic_id, patient_id, number, status, valid_until, subtotal_cents, total_cents, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7) RETURNING id`,
      [
        clinicId,
        patientId,
        `P-${randomUUID().slice(0, 8)}`,
        status,
        validUntil,
        total,
        usuarios.reception,
      ],
    );
    const quoteId = q[0].id;
    const items: string[] = [];
    for (const [i, l] of lineas.entries()) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO public.quote_items
           (clinic_id, quote_id, name_snapshot, unit_price_cents, total_cents,
            phase_label, phase_position, position)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7) RETURNING id`,
        [clinicId, quoteId, l.nombre, l.total, l.fase ?? null, l.fase === "Fase 2" ? 2 : 1, i],
      );
      items.push(r.rows[0].id);
    }
    return { quoteId, items, total };
  }

  async function cambiarEstado(quoteId: string, status: QuoteStatus, extra = "") {
    return comoUsuario<{ status: QuoteStatus; accepted_total_cents: string | null }>(
      client,
      usuarios.reception,
      `UPDATE public.quotes SET status = $2 ${extra} WHERE id = $1
       RETURNING status, accepted_total_cents`,
      [quoteId, status],
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
    const p = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Paciente Plan', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    patientId = p.rows[0].id;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("el guard de la base permite exactamente las transiciones de la app", async () => {
    const desajustes: string[] = [];
    for (const desde of QUOTE_STATUSES) {
      for (const hacia of QUOTE_STATUSES) {
        if (desde === hacia) continue;
        const { quoteId } = await crearPresupuesto(desde);
        await client.query("SAVEPOINT sp_transicion");
        let paso = true;
        try {
          await cambiarEstado(quoteId, hacia);
        } catch {
          paso = false;
        }
        await client.query("ROLLBACK TO SAVEPOINT sp_transicion");
        if (paso !== puedeTransicionar(desde, hacia)) desajustes.push(`${desde} → ${hacia}`);
      }
    }
    expect(desajustes).toEqual([]);
  });

  it("aceptación total: plan con todas las líneas, 'converted' y monto aceptado", async () => {
    const { quoteId, total } = await crearPresupuesto("sent");
    const [fila] = await cambiarEstado(quoteId, "accepted");
    expect(fila.status).toBe("converted");
    expect(Number(fila.accepted_total_cents)).toBe(total);
    const plan = await client.query<{ total_cents: string; lineas: string }>(
      `SELECT tp.total_cents, (SELECT count(*) FROM public.treatment_items ti WHERE ti.plan_id = tp.id) AS lineas
         FROM public.treatment_plans tp WHERE tp.quote_id = $1`,
      [quoteId],
    );
    expect(plan.rows).toEqual([{ total_cents: String(total), lineas: "3" }]);
  });

  it("aceptación parcial: el plan lleva solo lo aceptado y el estado queda parcial", async () => {
    const { quoteId, items } = await crearPresupuesto("sent");
    // Acepta la Fase 1 (limpieza + endodoncia), no la corona.
    await client.query(
      `UPDATE public.quote_items SET accepted = (id = ANY($1::uuid[])) WHERE quote_id = $2`,
      [items.slice(0, 2), quoteId],
    );
    const [fila] = await cambiarEstado(quoteId, "partially_accepted");
    expect(fila.status).toBe("partially_accepted");
    expect(Number(fila.accepted_total_cents)).toBe(210_000);

    const plan = await client.query<{ total_cents: string; nombres: string[] }>(
      `SELECT tp.total_cents,
              ARRAY(SELECT ti.name_snapshot FROM public.treatment_items ti
                     WHERE ti.plan_id = tp.id ORDER BY ti.phase_position, ti.position) AS nombres
         FROM public.treatment_plans tp WHERE tp.quote_id = $1`,
      [quoteId],
    );
    expect(plan.rows).toEqual([{ total_cents: "210000", nombres: ["Limpieza", "Endodoncia"] }]);

    // Cerrado: no se vuelve a aceptar ni se crea otro plan.
    const fallo = await esperaFallo(client, () => cambiarEstado(quoteId, "accepted"));
    expect(fallo.code).toBe("23514");
  });

  it("aceptación parcial sin ninguna línea aceptada se rechaza", async () => {
    const { quoteId } = await crearPresupuesto("sent");
    await client.query(`UPDATE public.quote_items SET accepted = false WHERE quote_id = $1`, [
      quoteId,
    ]);
    const fallo = await esperaFallo(client, () => cambiarEstado(quoteId, "partially_accepted"));
    expect(fallo.message).toMatch(/al menos una prestación/);
  });

  it("el historial registra creación, cambios de estado con quién, motivo y contacto", async () => {
    const { quoteId } = await crearPresupuesto("draft");
    await cambiarEstado(quoteId, "sent");
    await cambiarEstado(quoteId, "rejected", ", rejection_reason = 'Le pareció caro'");
    await comoUsuario(
      client,
      usuarios.reception,
      `UPDATE public.quotes SET last_contact_at = now(), last_contact_note = 'Llamada',
              next_action = 'Volver a llamar' WHERE id = $1`,
      [quoteId],
    );
    const eventos = await client.query<{
      kind: string;
      from_status: string | null;
      to_status: string | null;
      note: string | null;
      actor_id: string | null;
    }>(
      `SELECT kind, from_status, to_status, note, actor_id FROM public.quote_events
        WHERE quote_id = $1 ORDER BY created_at`,
      [quoteId],
    );
    expect(eventos.rows).toEqual([
      {
        kind: "creado",
        from_status: null,
        to_status: "draft",
        note: null,
        actor_id: usuarios.reception,
      },
      {
        kind: "estado",
        from_status: "draft",
        to_status: "sent",
        note: null,
        actor_id: usuarios.reception,
      },
      {
        kind: "estado",
        from_status: "sent",
        to_status: "rejected",
        note: "Le pareció caro",
        actor_id: usuarios.reception,
      },
      {
        kind: "contacto",
        from_status: null,
        to_status: null,
        note: "Llamada · Próxima acción: Volver a llamar",
        actor_id: usuarios.reception,
      },
    ]);
  });

  it("nadie escribe el historial desde la API: solo hay política de lectura", async () => {
    const politicas = await client.query<{ policyname: string; cmd: string; permissive: string }>(
      `SELECT policyname, cmd, permissive FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'quote_events' ORDER BY policyname`,
    );
    expect(politicas.rows).toEqual([
      { policyname: "mfa_exige_aal2", cmd: "ALL", permissive: "RESTRICTIVE" },
      { policyname: "quote_events_select", cmd: "SELECT", permissive: "PERMISSIVE" },
    ]);
  });

  it("vencer_presupuestos vence lo pendiente con la validez pasada, sin actor", async () => {
    const vencido = await crearPresupuesto("sent", "2020-01-01");
    const borradorVencido = await crearPresupuesto("draft", "2020-01-01");
    const vigente = await crearPresupuesto("sent", "2099-01-01");
    const sinFecha = await crearPresupuesto("sent", null);
    const aceptado = await crearPresupuesto("rejected", "2020-01-01");

    const r = await comoUsuario<{ n: number }>(
      client,
      usuarios.accounting,
      `SELECT public.vencer_presupuestos($1) AS n`,
      [clinicId],
    );
    expect(r[0].n).toBe(2);

    const estados = await client.query<{ id: string; status: string; expired_at: Date | null }>(
      `SELECT id, status, expired_at FROM public.quotes WHERE id = ANY($1::uuid[])`,
      [[vencido, borradorVencido, vigente, sinFecha, aceptado].map((q) => q.quoteId)],
    );
    const por = new Map(estados.rows.map((e) => [e.id, e]));
    expect(por.get(vencido.quoteId)!.status).toBe("expired");
    expect(por.get(vencido.quoteId)!.expired_at).not.toBeNull();
    expect(por.get(borradorVencido.quoteId)!.status).toBe("expired");
    expect(por.get(vigente.quoteId)!.status).toBe("sent");
    expect(por.get(sinFecha.quoteId)!.status).toBe("sent");
    expect(por.get(aceptado.quoteId)!.status).toBe("rejected");

    const ev = await client.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM public.quote_events WHERE quote_id = $1 AND to_status = 'expired'`,
      [vencido.quoteId],
    );
    expect(ev.rows).toEqual([{ actor_id: null }]);
  });

  it("vencer_presupuestos: un externo no puede, y todas las clínicas solo el backend", async () => {
    let fallo = await esperaFallo(client, () =>
      comoUsuario(client, usuarios.externo, `SELECT public.vencer_presupuestos($1)`, [clinicId]),
    );
    expect(fallo.code).toBe("42501");
    fallo = await esperaFallo(client, () =>
      comoUsuario(client, usuarios.owner, `SELECT public.vencer_presupuestos(NULL)`),
    );
    expect(fallo.code).toBe("42501");
  });

  it("renovar un vencido exige una validez desde hoy y limpia expired_at", async () => {
    const { quoteId } = await crearPresupuesto("expired", "2020-01-01");
    const fallo = await esperaFallo(client, () => cambiarEstado(quoteId, "sent"));
    expect(fallo.message).toMatch(/validez desde hoy/);
    const [fila] = await comoUsuario<{ status: string; expired_at: Date | null }>(
      client,
      usuarios.reception,
      `UPDATE public.quotes SET status = 'sent', valid_until = '2099-01-01' WHERE id = $1
       RETURNING status, expired_at`,
      [quoteId],
    );
    expect(fila).toEqual({ status: "sent", expired_at: null });
  });

  it("el profesional del presupuesto tiene que ser de la misma clínica", async () => {
    const { quoteId } = await crearPresupuesto("draft");
    const otraClinica = randomUUID();
    const otroOwner = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, otroOwner],
    );
    const prof = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Ajena') RETURNING id`,
      [otraClinica],
    );
    const fallo = await esperaFallo(client, () =>
      client.query(`UPDATE public.quotes SET professional_id = $2 WHERE id = $1`, [
        quoteId,
        prof.rows[0].id,
      ]),
    );
    expect(fallo.code).toBe("23514");
  });

  it("paquetes: moneda de la clínica y líneas solo con prestaciones de la misma clínica", async () => {
    const pk = await client.query<{ id: string; currency: string }>(
      `INSERT INTO public.procedure_packages (clinic_id, name, price_cents, currency, created_by)
       VALUES ($1, 'Blanqueamiento completo', 130000, 'USD', $2) RETURNING id, currency`,
      [clinicId, usuarios.owner],
    );
    const moneda = await client.query<{ currency: string }>(
      `SELECT currency FROM public.clinics WHERE id = $1`,
      [clinicId],
    );
    // La moneda la fija la base (regla 14), no lo que mande el cliente.
    expect(pk.rows[0].currency).toBe(moneda.rows[0].currency);

    const otraClinica = randomUUID();
    const otroOwner = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, otroOwner],
    );
    const procAjeno = await client.query<{ id: string }>(
      `INSERT INTO public.procedures (clinic_id, name, default_price_cents, created_by)
       VALUES ($1, 'Ajena', 1000, $2) RETURNING id`,
      [otraClinica, otroOwner],
    );
    const fallo = await esperaFallo(client, () =>
      client.query(
        `INSERT INTO public.procedure_package_items (clinic_id, package_id, procedure_id, name_snapshot)
         VALUES ($1, $2, $3, 'Ajena')`,
        [clinicId, pk.rows[0].id, procAjeno.rows[0].id],
      ),
    );
    expect(fallo.code).toBe("23514");

    // Una línea de presupuesto no puede colgar de un paquete de otra clínica.
    const pkAjeno = await client.query<{ id: string }>(
      `INSERT INTO public.procedure_packages (clinic_id, name, price_cents, created_by)
       VALUES ($1, 'Ajeno', 1, $2) RETURNING id`,
      [otraClinica, otroOwner],
    );
    const { quoteId } = await crearPresupuesto("draft");
    const falloLinea = await esperaFallo(client, () =>
      client.query(
        `INSERT INTO public.quote_items (clinic_id, quote_id, name_snapshot, unit_price_cents, total_cents, package_id)
         VALUES ($1, $2, 'X', 1, 1, $3)`,
        [clinicId, quoteId, pkAjeno.rows[0].id],
      ),
    );
    expect(falloLinea.code).toBe("23514");
  });

  it("paquetes: leen todos los miembros y escriben owner, admin y dentist", async () => {
    const politicas = await client.query<{
      tablename: string;
      policyname: string;
      cmd: string;
      expr: string;
    }>(
      `SELECT tablename, policyname, cmd, coalesce(with_check, qual) AS expr FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('procedure_packages', 'procedure_package_items')
          AND permissive = 'PERMISSIVE'
        ORDER BY tablename, cmd`,
    );
    expect(politicas.rows.map((p) => `${p.tablename}:${p.cmd}`)).toEqual([
      "procedure_package_items:DELETE",
      "procedure_package_items:INSERT",
      "procedure_package_items:SELECT",
      "procedure_package_items:UPDATE",
      "procedure_packages:DELETE",
      "procedure_packages:INSERT",
      "procedure_packages:SELECT",
      "procedure_packages:UPDATE",
    ]);
    for (const p of politicas.rows) {
      if (p.cmd === "SELECT") expect(p.expr).toContain("is_clinic_member");
      else expect(p.expr).toMatch(/has_clinic_role.*owner.*admin.*dentist/s);
    }
  });
});
