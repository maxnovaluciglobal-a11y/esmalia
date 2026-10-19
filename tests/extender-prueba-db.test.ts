// La regla que manda para extender la prueba vive en la función SQL
// `extender_prueba_de_la_clinica` (migración 20261020000000). Se prueba contra
// la base efímera: extiende, deja registro de quién y cuándo, no acorta, no toca
// una suscripción de Stripe y no la puede llamar un usuario de la app.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { conectar } from "./helpers/db";

let client: Client;
const clinicas: string[] = [];

beforeAll(async () => {
  client = await conectar();
});

afterAll(async () => {
  if (clinicas.length) {
    await client.query(`delete from public.clinics where id = any($1::uuid[])`, [clinicas]);
  }
  await client?.end();
});

/** Crea una clínica; el trigger le da su prueba de 14 días. */
async function nuevaClinica(): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into public.clinics (id, name, created_by) values ($1, 'Clinica de prueba', $2)`,
    [id, randomUUID()],
  );
  clinicas.push(id);
  return id;
}

function extender(clinicId: string, dias: number, motivo: string | null = null) {
  return client.query<{ r: Date }>(
    `select public.extender_prueba_de_la_clinica($1, $2, null, 'Staff@Esmalia.com', $3) as r`,
    [clinicId, dias, motivo],
  );
}

describe("extender_prueba_de_la_clinica", () => {
  it("mueve el fin de prueba a hoy + N días y deja el registro", async () => {
    const id = await nuevaClinica();
    const antes = await client.query<{ trial_end: Date }>(
      `select trial_end from public.subscriptions where clinic_id = $1`,
      [id],
    );

    const { rows } = await extender(id, 90, "  Clínica fundadora  ");
    const despues = await client.query<{ trial_end: Date }>(
      `select trial_end from public.subscriptions where clinic_id = $1`,
      [id],
    );
    expect(despues.rows[0].trial_end.getTime()).toBe(rows[0].r.getTime());
    const dias = (rows[0].r.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(89.9);
    expect(dias).toBeLessThan(90.1);

    const reg = await client.query(
      `select previous_trial_end, new_trial_end, days, reason, extended_by_email, extended_at
         from public.trial_extensions where clinic_id = $1`,
      [id],
    );
    expect(reg.rows).toHaveLength(1);
    expect(reg.rows[0].previous_trial_end.getTime()).toBe(antes.rows[0].trial_end.getTime());
    expect(reg.rows[0].new_trial_end.getTime()).toBe(rows[0].r.getTime());
    expect(reg.rows[0].days).toBe(90);
    expect(reg.rows[0].reason).toBe("Clínica fundadora");
    expect(reg.rows[0].extended_by_email).toBe("staff@esmalia.com");
    expect(Date.now() - reg.rows[0].extended_at.getTime()).toBeLessThan(60_000);
  });

  it("no acorta: una fecha igual o anterior se rechaza y no deja registro", async () => {
    const id = await nuevaClinica(); // 14 días
    await expect(extender(id, 7)).rejects.toThrow(/no_extiende/);
    const reg = await client.query(`select 1 from public.trial_extensions where clinic_id = $1`, [
      id,
    ]);
    expect(reg.rows).toHaveLength(0);
  });

  it("reabre una prueba vencida", async () => {
    const id = await nuevaClinica();
    await client.query(
      `update public.subscriptions set trial_end = now() - interval '3 days' where clinic_id = $1`,
      [id],
    );
    await extender(id, 30);
    const { rows } = await client.query<{ vigente: boolean }>(
      `select trial_end > now() as vigente from public.subscriptions where clinic_id = $1`,
      [id],
    );
    expect(rows[0].vigente).toBe(true);
  });

  it("no toca una suscripción que ya pasó por Stripe", async () => {
    const id = await nuevaClinica();
    await client.query(
      `update public.subscriptions set stripe_subscription_id = 'sub_test' where clinic_id = $1`,
      [id],
    );
    await expect(extender(id, 90)).rejects.toThrow(/no_es_prueba_de_la_base/);
  });

  it("no toca una suscripción activa", async () => {
    const id = await nuevaClinica();
    await client.query(`update public.subscriptions set status = 'active' where clinic_id = $1`, [
      id,
    ]);
    await expect(extender(id, 90)).rejects.toThrow(/no_es_prueba_de_la_base/);
  });

  it("clínica sin fila de suscripción: sin_prueba", async () => {
    const id = await nuevaClinica();
    await client.query(`delete from public.subscriptions where clinic_id = $1`, [id]);
    await expect(extender(id, 90)).rejects.toThrow(/sin_prueba/);
  });

  it("días fuera de rango se rechazan", async () => {
    const id = await nuevaClinica();
    await expect(extender(id, 0)).rejects.toThrow(/dias_invalidos/);
    await expect(extender(id, 121)).rejects.toThrow(/dias_invalidos/);
  });

  it("ni anon ni authenticated pueden llamarla, y la tabla no se lee desde la app", async () => {
    const { rows } = await client.query<{ rol: string; puede: boolean }>(`
      select r.rol, has_function_privilege(r.rol, 'public.extender_prueba_de_la_clinica(uuid,integer,uuid,text,text)', 'execute') as puede
      from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
    `);
    const por = Object.fromEntries(rows.map((r) => [r.rol, r.puede]));
    expect(por).toEqual({ anon: false, authenticated: false, service_role: true });

    const tabla = await client.query<{ rol: string; lee: boolean }>(`
      select r.rol, has_table_privilege(r.rol, 'public.trial_extensions', 'select') as lee
      from (values ('anon'), ('authenticated')) as r(rol)
    `);
    for (const t of tabla.rows) expect(t.lee, t.rol).toBe(false);
  });
});
