import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";

import { conectar } from "./helpers/db";

/**
 * Ola 7 · Reserva en línea y gestión de la cita (migraciones 20261028100000 y
 * 20261028100100), contra la base:
 *
 * - Las funciones públicas solo las ejecuta el rol de servicio (ni anon ni
 *   authenticated).
 * - Código: uno por minuto por correo, 6 por día, 5 intentos y bloqueo, un
 *   solo uso y atado a la solicitud.
 * - La reserva crea la cita `tentativa` con origen "reserva en línea"; NUNCA
 *   `confirmada`. Busca la ficha por RUT o correo antes de crear una nueva.
 * - Horario ocupado (profesional o box) se rechaza; tope de 3 reservas
 *   pendientes por paciente.
 * - Aislamiento: una clínica no reserva con profesionales ni lee la
 *   configuración de otra; la gestión de la cita exige la clínica firmada.
 * - Gestión: confirmar solo escribe el eje del paciente; cancelar marca
 *   patient_cancelled_at; reagendar deja la cita `tentativa`.
 * - EQU-04: la marca "Atiende pacientes" manda sobre el rol.
 */

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

interface Clinica {
  clinicId: string;
  owner: string;
  externo: string;
  branchId: string;
  profId: string;
  boxId: string;
  tipoId: string;
  slug: string;
}

describe("reserva en línea en la base", () => {
  let client: Client;
  let a: Clinica;
  let b: Clinica;

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function como<T>(userId: string, sql: string, params: unknown[] = []) {
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

  async function sembrarClinica(slug: string, enabled = true): Promise<Clinica> {
    const clinicId = randomUUID();
    const owner = randomUUID();
    const branchId = randomUUID();
    const profId = randomUUID();
    const boxId = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by, country, timezone) VALUES ($1, $2, $3, 'CL', 'America/Santiago')`,
      [clinicId, `Clínica ${slug}`, owner],
    );
    await client.query(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [clinicId, owner],
    );
    await client.query(
      `INSERT INTO public.branches (id, clinic_id, name, timezone) VALUES ($1, $2, 'Matriz', 'America/Santiago')`,
      [branchId, clinicId],
    );
    await client.query(
      `INSERT INTO public.operatories (id, clinic_id, branch_id, name) VALUES ($1, $2, $3, 'Box 1')`,
      [boxId, clinicId, branchId],
    );
    await client.query(
      `INSERT INTO public.professionals (id, clinic_id, branch_id, full_name, color) VALUES ($1, $2, $3, 'Dra. Prueba', '#a06f24')`,
      [profId, clinicId, branchId],
    );
    const t = await client.query<{ id: string }>(
      `INSERT INTO public.appointment_types (clinic_id, name, position) VALUES ($1, 'Evaluación reserva', 99) RETURNING id`,
      [clinicId],
    );
    await client.query(
      `INSERT INTO public.online_booking_settings (clinic_id, enabled, slug, min_notice_hours, bookable_appointment_type_ids)
       VALUES ($1, $2, $3, 2, ARRAY[$4]::uuid[])`,
      [clinicId, enabled, slug, t.rows[0].id],
    );
    return {
      clinicId,
      owner,
      externo: randomUUID(),
      branchId,
      profId,
      boxId,
      tipoId: t.rows[0].id,
      slug,
    };
  }

  /** Inicio a N días, a las 15:00 UTC (siempre dentro de la anticipación). */
  const enDias = (n: number, hora = 15) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    d.setUTCHours(hora, 0, 0, 0);
    return d.toISOString();
  };

  function reserva(c: Clinica, extra: Record<string, unknown> = {}) {
    return {
      branch_id: c.branchId,
      professional_id: c.profId,
      appointment_type_id: c.tipoId,
      procedure_id: null,
      operatory_id: c.boxId,
      starts_at: enDias(3),
      nombre: "Paciente Reserva",
      email: "reserva@example.com",
      telefono: "+56912345678",
      rut: null,
      nota: null,
      ...extra,
    };
  }

  /** Pide un código y lo confirma (o no) como haría el servidor. */
  async function pedir(
    c: Clinica,
    opts: { email?: string; telefono?: string; ip?: string; req?: string } = {},
  ) {
    const req = opts.req ?? sha(randomUUID());
    const codigo = "123456";
    const [r] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.reserva_en_linea_preparar_codigo($1, $2, $3, $4, $5, $6) AS r`,
      [
        c.clinicId,
        req,
        sha(`${req}:${codigo}`),
        sha(`${c.clinicId}:${opts.email ?? "reserva@example.com"}`),
        sha(`${c.clinicId}:${opts.telefono ?? "+56912345678"}`),
        opts.ip ?? "198.51.100.9",
      ],
    );
    return { r: r.r, req, codigo };
  }

  async function confirmar(id: string, req: string, codigo: string, datos: object) {
    const [r] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.reserva_en_linea_confirmar($1, $2, $3, $4::jsonb) AS r`,
      [id, req, sha(`${req}:${codigo}`), JSON.stringify(datos)],
    );
    return r.r;
  }

  async function reservar(c: Clinica, extra: Record<string, unknown> = {}, email?: string) {
    const p = await pedir(c, { email: email ?? (extra.email as string) ?? undefined });
    expect(p.r.ok).toBe(true);
    return confirmar(String(p.r.id), p.req, p.codigo, reserva(c, extra));
  }

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    a = await sembrarClinica(`clinica-a-${randomUUID().slice(0, 8)}`);
    b = await sembrarClinica(`clinica-b-${randomUUID().slice(0, 8)}`);
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("solo el rol de servicio ejecuta las funciones públicas", async () => {
    const { rows } = await client.query<{ f: string; anon: boolean; authn: boolean; srv: boolean }>(
      `SELECT p.oid::regprocedure::text AS f,
              has_function_privilege('anon', p.oid, 'execute') AS anon,
              has_function_privilege('authenticated', p.oid, 'execute') AS authn,
              has_function_privilege('service_role', p.oid, 'execute') AS srv
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (p.proname LIKE 'reserva_en_linea_%' OR p.proname LIKE 'cita_gestion_%')`,
    );
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.anon, r.f).toBe(false);
      expect(r.authn, r.f).toBe(false);
    }
    const publicas = rows.filter((r) => !/_(atiende|ip_limitada|duracion)\(/.test(r.f));
    expect(publicas.length).toBe(7);
    for (const r of publicas) expect(r.srv, r.f).toBe(true);
  });

  it("el contexto solo existe con la reserva encendida", async () => {
    const [on] = await servicio<{ r: { estado: string; profesionales: unknown[] } }>(
      `SELECT public.reserva_en_linea_contexto($1) AS r`,
      [a.slug],
    );
    expect(on.r.estado).toBe("activa");
    expect(on.r.profesionales).toHaveLength(1);
    await client.query(
      `UPDATE public.online_booking_settings SET enabled = false WHERE clinic_id = $1`,
      [a.clinicId],
    );
    const [off] = await servicio<{ r: { estado: string } }>(
      `SELECT public.reserva_en_linea_contexto($1) AS r`,
      [a.slug],
    );
    expect(off.r.estado).toBe("apagada");
    const [no] = await servicio<{ r: { estado: string } }>(
      `SELECT public.reserva_en_linea_contexto('no-existe-esta') AS r`,
    );
    expect(no.r.estado).toBe("no_existe");
  });

  it("crea la cita tentativa con origen reserva en línea y una ficha mínima", async () => {
    const r = await reservar(a);
    expect(r.ok).toBe(true);
    expect(r.paciente_nuevo).toBe(true);
    const [cita] = await servicio<{
      status: string;
      booking_source: string;
      confirmed_at: string | null;
      operatory_id: string;
      clinic_id: string;
      created_by: string;
    }>(`SELECT * FROM public.appointments WHERE id = $1`, [r.appointment_id]);
    expect(cita.status).toBe("tentativa");
    expect(cita.confirmed_at).toBeNull();
    expect(cita.booking_source).toBe("reserva_en_linea");
    expect(cita.operatory_id).toBe(a.boxId);
    expect(cita.clinic_id).toBe(a.clinicId);
    expect(cita.created_by).toBe(a.owner);
    const [pac] = await servicio<{ full_name: string; email: string; acquisition_source: string }>(
      `SELECT p.* FROM public.patients p JOIN public.appointments x ON x.patient_id = p.id WHERE x.id = $1`,
      [r.appointment_id],
    );
    expect(pac.full_name).toBe("Paciente Reserva");
    expect(pac.acquisition_source).toBe("Reserva en línea");
  });

  it("nunca crea una cita confirmada, aunque la solicitud lo pida", async () => {
    const r = await reservar(a, { status: "confirmada" });
    expect(r.ok).toBe(true);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public.appointments WHERE booking_source IS NOT NULL AND status = 'confirmada'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("encuentra la ficha por RUT o por correo antes de crear otra", async () => {
    const porRut = randomUUID();
    await client.query(
      `INSERT INTO public.patients (id, clinic_id, full_name, document_type, document_id, email, created_by)
       VALUES ($1, $2, 'Ya Existe', 'rut', '12.345.678-5', 'otro@example.com', $3)`,
      [porRut, a.clinicId, a.owner],
    );
    const r1 = await reservar(a, { rut: "12345678-5" });
    expect(r1.paciente_nuevo).toBe(false);
    const [c1] = await servicio<{ patient_id: string; notes: string }>(
      `SELECT patient_id, notes FROM public.appointments WHERE id = $1`,
      [r1.appointment_id],
    );
    expect(c1.patient_id).toBe(porRut);
    expect(c1.notes).toContain("correo distinto");

    const porCorreo = randomUUID();
    await client.query(
      `INSERT INTO public.patients (id, clinic_id, full_name, email, created_by)
       VALUES ($1, $2, 'Por Correo', 'correo@example.com', $3)`,
      [porCorreo, a.clinicId, a.owner],
    );
    const r2 = await reservar(
      a,
      { email: "Correo@Example.com", starts_at: enDias(4) },
      "correo@example.com",
    );
    expect(r2.paciente_nuevo).toBe(false);
    const [c2] = await servicio<{ patient_id: string }>(
      `SELECT patient_id FROM public.appointments WHERE id = $1`,
      [r2.appointment_id],
    );
    expect(c2.patient_id).toBe(porCorreo);
  });

  it("código: 5 intentos, bloqueo, un solo uso y atado a la solicitud", async () => {
    const p = await pedir(a);
    const id = String(p.r.id);
    const otra = await confirmar(id, sha("otra"), p.codigo, reserva(a));
    expect(otra.motivo).toBe("invalida");
    for (let i = 1; i <= 4; i++) {
      const r = await confirmar(id, p.req, "000000", reserva(a));
      expect(r.motivo).toBe("codigo_incorrecto");
      expect(r.restantes).toBe(5 - i);
    }
    const quinto = await confirmar(id, p.req, "000000", reserva(a));
    expect(quinto.motivo).toBe("bloqueado");
    const despues = await confirmar(id, p.req, p.codigo, reserva(a));
    expect(despues.motivo).toBe("bloqueado");

    const q = await pedir(a, { email: "otra@example.com" });
    const ok = await confirmar(String(q.r.id), q.req, q.codigo, reserva(a));
    expect(ok.ok).toBe(true);
    const repetido = await confirmar(String(q.r.id), q.req, q.codigo, reserva(a));
    expect(repetido.motivo).toBe("usado");
  });

  it("antiabuso: uno por minuto, 6 por día por correo y por teléfono, y límite por IP", async () => {
    expect((await pedir(a)).r.ok).toBe(true);
    const espera = await pedir(a);
    expect(espera.r.motivo).toBe("espera");
    // Seis del mismo correo en 24 h (fuera del minuto) cortan el siguiente.
    await client.query(
      `INSERT INTO public.online_booking_verifications (clinic_id, request_hash, code_hash, email_hash, phone_hash, expires_at, created_at)
       SELECT $1, $2, $2, $3, $4, now(), now() - interval '2 hours' FROM generate_series(1, 6)`,
      [
        a.clinicId,
        sha("x"),
        sha(`${a.clinicId}:mucho@example.com`),
        sha(`${a.clinicId}:+56900000000`),
      ],
    );
    expect(
      (await pedir(a, { email: "mucho@example.com", telefono: "+56911111111" })).r.motivo,
    ).toBe("demasiados");
    expect(
      (await pedir(a, { email: "nuevo@example.com", telefono: "+56900000000" })).r.motivo,
    ).toBe("demasiados");
    // El mismo correo en OTRA clínica no cuenta.
    expect((await pedir(b, { email: "mucho@example.com" })).r.ok).toBe(true);
    // 30 pedidos de una IP en una hora la cortan en todas las clínicas.
    await client.query(
      `INSERT INTO public.online_booking_verifications (clinic_id, request_hash, code_hash, email_hash, ip_hint, expires_at)
       SELECT $1, $2, $2, $2, '192.0.2.50', now() FROM generate_series(1, 30)`,
      [a.clinicId, sha("ip")],
    );
    expect((await pedir(b, { email: "ip@example.com", ip: "192.0.2.50" })).r.motivo).toBe(
      "limitada",
    );
  });

  it("rechaza un horario ocupado por el profesional o el box, y fuera de plazo", async () => {
    const primera = await reservar(a);
    expect(primera.ok).toBe(true);
    const choque = await reservar(a, {}, "segundo@example.com");
    expect(choque.motivo).toBe("ocupado");
    const pronto = await reservar(
      a,
      { starts_at: new Date(Date.now() + 30 * 60_000).toISOString() },
      "p@example.com",
    );
    expect(pronto.motivo).toBe("fuera_de_plazo");
    const lejos = await reservar(a, { starts_at: enDias(60) }, "l@example.com");
    expect(lejos.motivo).toBe("fuera_de_plazo");
  });

  it("tope de 3 reservas pendientes por paciente", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await reservar(a, { starts_at: enDias(3 + i) }, `tope${i}@example.com`);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    const cuarta = await reservar(a, { starts_at: enDias(7) }, "tope3@example.com");
    expect(cuarta.motivo).toBe("demasiadas_reservas");
  });

  it("aislamiento: no reserva con profesional, sucursal o box de otra clínica", async () => {
    const r1 = await reservar(a, { professional_id: b.profId });
    expect(r1.motivo).toBe("invalida");
    const r2 = await reservar(a, { branch_id: b.branchId }, "x2@example.com");
    expect(r2.motivo).toBe("invalida");
    const r3 = await reservar(a, { operatory_id: b.boxId }, "x3@example.com");
    expect(r3.motivo).toBe("invalida");
    const r4 = await reservar(a, { appointment_type_id: b.tipoId }, "x4@example.com");
    expect(r4.motivo).toBe("invalida");
  });

  it("aislamiento: la configuración solo la ve su clínica y solo owner/admin la cambia", async () => {
    const propia = await como(a.owner, `SELECT slug FROM public.online_booking_settings`);
    expect(propia.filas.map((f) => (f as { slug: string }).slug)).toEqual([a.slug]);
    const ajena = await como(a.externo, `SELECT slug FROM public.online_booking_settings`);
    expect(ajena.filas).toHaveLength(0);
    const recep = randomUUID();
    await client.query(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, 'reception')`,
      [a.clinicId, recep],
    );
    const cambio = await como(
      recep,
      `UPDATE public.online_booking_settings SET enabled = false WHERE clinic_id = $1 RETURNING 1`,
      [a.clinicId],
    );
    expect(cambio.filas).toHaveLength(0);
    const verif = await como(a.owner, `SELECT count(*) FROM public.online_booking_verifications`);
    expect(verif.error).not.toBe("");
  });

  it("gestión: confirmar solo escribe el eje del paciente; reagendar vuelve a tentativa; cancelar", async () => {
    const r = await reservar(a);
    const id = String(r.appointment_id);
    // La clínica aceptó la cita.
    await client.query(`UPDATE public.appointments SET status = 'confirmada' WHERE id = $1`, [id]);

    const [ajena] = await servicio<{ r: unknown }>(`SELECT public.cita_gestion_ver($1, $2) AS r`, [
      id,
      b.clinicId,
    ]);
    expect(ajena.r).toBeNull();
    const [mal] = await servicio<{ r: { motivo: string } }>(
      `SELECT public.cita_gestion_confirmar($1, $2) AS r`,
      [id, b.clinicId],
    );
    expect(mal.r.motivo).toBe("no_existe");

    await servicio(`SELECT public.cita_gestion_confirmar($1, $2)`, [id, a.clinicId]);
    let [c] = await servicio<{ status: string; patient_confirmed_via: string }>(
      `SELECT status, patient_confirmed_via FROM public.appointments WHERE id = $1`,
      [id],
    );
    expect(c.status).toBe("confirmada");
    expect(c.patient_confirmed_via).toBe("enlace");

    const [re] = await servicio<{ r: { ok: boolean } }>(
      `SELECT public.cita_gestion_reagendar($1, $2, $3::timestamptz, NULL) AS r`,
      [id, a.clinicId, enDias(5)],
    );
    expect(re.r.ok).toBe(true);
    [c] = await servicio(
      `SELECT status, patient_confirmed_via FROM public.appointments WHERE id = $1`,
      [id],
    );
    expect(c.status).toBe("tentativa");
    expect(c.patient_confirmed_via).toBeNull();

    await servicio(`SELECT public.cita_gestion_cancelar($1, $2, 'No puedo')`, [id, a.clinicId]);
    const [fin] = await servicio<{
      status: string;
      patient_cancelled_at: string | null;
      notes: string;
    }>(`SELECT status, patient_cancelled_at, notes FROM public.appointments WHERE id = $1`, [id]);
    expect(fin.status).toBe("cancelada");
    expect(fin.patient_cancelled_at).not.toBeNull();
    expect(fin.notes).toContain("No puedo");
  });

  it("gestión: reagendar a un horario ocupado se rechaza", async () => {
    const r1 = await reservar(a);
    const r2 = await reservar(a, { starts_at: enDias(4) }, "dos@example.com");
    const [re] = await servicio<{ r: { motivo: string } }>(
      `SELECT public.cita_gestion_reagendar($1, $2, $3::timestamptz, NULL) AS r`,
      [r2.appointment_id, a.clinicId, enDias(3)],
    );
    expect(r1.ok).toBe(true);
    expect(re.r.motivo).toBe("ocupado");
  });

  it("EQU-04: la marca explícita manda sobre el rol", async () => {
    const recepUser = randomUUID();
    await client.query(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, 'reception')`,
      [a.clinicId, recepUser],
    );
    const p = randomUUID();
    await client.query(
      `INSERT INTO public.professionals (id, clinic_id, branch_id, full_name, color, user_id) VALUES ($1, $2, $3, 'Recepción', '#2f6f73', $4)`,
      [p, a.clinicId, a.branchId, recepUser],
    );
    const atiende = async () =>
      (await servicio<{ v: boolean }>(`SELECT public.reserva_en_linea_atiende($1) AS v`, [p]))[0].v;
    expect(await atiende()).toBe(false);
    await client.query(`UPDATE public.professionals SET attends_patients = true WHERE id = $1`, [
      p,
    ]);
    expect(await atiende()).toBe(true);
    await client.query(`UPDATE public.professionals SET attends_patients = false WHERE id = $1`, [
      a.profId,
    ]);
    const [ctx] = await servicio<{ r: { profesionales: { id: string }[] } }>(
      `SELECT public.reserva_en_linea_contexto($1) AS r`,
      [a.slug],
    );
    expect(ctx.r.profesionales.map((x) => x.id)).toEqual([p]);
  });
});
