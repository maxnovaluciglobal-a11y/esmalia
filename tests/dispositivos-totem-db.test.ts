import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { conectar } from "./helpers/db";

/**
 * Ola 14 · Dispositivos, tótem y sala de espera (migraciones 20261110100000 y
 * 20261110100100), contra la base:
 *
 * - AUT-06: solo owner/admin crean dispositivos y emiten códigos; el código
 *   sirve una vez y vence; la base guarda solo huellas; revocado, el token
 *   deja de servir. Las funciones del dispositivo solo las ejecuta el rol de
 *   servicio y cada una exige SU tipo.
 * - Aislamiento: un tótem no encuentra pacientes de otra clínica, no ve citas
 *   de otra sucursal y no marca llegada fuera de su sucursal; la TV no muestra
 *   turnos de otra sucursal; ninguna función devuelve RUT ni datos clínicos.
 * - AUT-01: límite de intentos por RUT; la llegada pasa a 'en-sala' con turno,
 *   nunca a 'confirmada'.
 * - AUT-02: agendar crea 'tentativa' con las reglas de la reserva.
 * - AUT-04/05: "Llamar" solo para roles de agenda y pacientes en sala.
 * - El token del dispositivo no es un JWT: PostgREST lo rechaza.
 */

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const secreto = () => randomBytes(32).toString("base64url");

interface Clinica {
  clinicId: string;
  owner: string;
  recepcion: string;
  asistente: string;
  branchId: string;
  branch2Id: string;
  profId: string;
  prof2Id: string;
  boxId: string;
  box2Id: string;
  tipoId: string;
}

type Fila = Record<string, unknown>;

describe("dispositivos, tótem y sala de espera en la base", () => {
  let client: Client;
  let a: Clinica;
  let b: Clinica;

  async function servicio<T = Fila>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function como<T = Fila>(userId: string, sql: string, params: unknown[] = []) {
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

  async function sembrarClinica(nombre: string): Promise<Clinica> {
    const c = {
      clinicId: randomUUID(),
      owner: randomUUID(),
      recepcion: randomUUID(),
      asistente: randomUUID(),
      branchId: randomUUID(),
      branch2Id: randomUUID(),
      profId: randomUUID(),
      prof2Id: randomUUID(),
      boxId: randomUUID(),
      box2Id: randomUUID(),
      tipoId: "",
    };
    await client.query(
      `INSERT INTO auth.users (id) SELECT unnest($1::uuid[]) ON CONFLICT (id) DO NOTHING`,
      [[c.owner, c.recepcion, c.asistente]],
    );
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by, country, timezone) VALUES ($1, $2, $3, 'CL', 'America/Santiago')`,
      [c.clinicId, nombre, c.owner],
    );
    for (const [u, rol] of [
      [c.owner, "owner"],
      [c.recepcion, "reception"],
      [c.asistente, "assistant"],
    ]) {
      await client.query(
        `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [c.clinicId, u, rol],
      );
    }
    await client.query(
      `INSERT INTO public.branches (id, clinic_id, name, timezone) VALUES ($1, $3, 'Matriz', 'America/Santiago'), ($2, $3, 'Norte', 'America/Santiago')`,
      [c.branchId, c.branch2Id, c.clinicId],
    );
    await client.query(
      `INSERT INTO public.operatories (id, clinic_id, branch_id, name) VALUES ($1, $3, $4, 'Box 1'), ($2, $3, $5, 'Box Norte')`,
      [c.boxId, c.box2Id, c.clinicId, c.branchId, c.branch2Id],
    );
    await client.query(
      `INSERT INTO public.professionals (id, clinic_id, branch_id, full_name, color, default_operatory_id)
       VALUES ($1, $3, $4, 'Dra. Matriz', '#a06f24', $6), ($2, $3, $5, 'Dr. Norte', '#a06f24', $7)`,
      [c.profId, c.prof2Id, c.clinicId, c.branchId, c.branch2Id, c.boxId, c.box2Id],
    );
    const t = await client.query<{ id: string }>(
      `INSERT INTO public.appointment_types (clinic_id, name, position) VALUES ($1, 'Evaluación tótem', 99) RETURNING id`,
      [c.clinicId],
    );
    c.tipoId = t.rows[0].id;
    await client.query(
      `INSERT INTO public.online_booking_settings (clinic_id, enabled, slug, min_notice_hours, bookable_appointment_type_ids)
       VALUES ($1, true, $2, 2, ARRAY[$3]::uuid[])`,
      [c.clinicId, `totem-${randomUUID().slice(0, 8)}`, c.tipoId],
    );
    return c;
  }

  async function paciente(
    c: Clinica,
    opts: { rut?: string; telefono?: string; nombre?: string } = {},
  ) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.patients (id, clinic_id, full_name, document_type, document_id, phone, birth_date, created_by)
       VALUES ($1, $2, $3, 'rut', $4, $5, '1990-03-07', $6)`,
      [
        id,
        c.clinicId,
        opts.nombre ?? "María José González Pérez",
        opts.rut ?? "12.345.678-5",
        opts.telefono ?? "+56 9 8765 4321",
        c.owner,
      ],
    );
    return id;
  }

  /** Cita de hoy que empezó hace 5 minutos (dentro de la ventana de llegada). */
  async function citaDeHoy(
    c: Clinica,
    patientId: string,
    opts: { branch?: string; prof?: string; box?: string | null; status?: string } = {},
  ) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.appointments
         (clinic_id, branch_id, patient_id, professional_id, operatory_id, treatment_label,
          starts_at, ends_at, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Limpieza profunda', now() - interval '5 minutes',
               now() + interval '40 minutes', $6, $7)
       RETURNING id`,
      [
        c.clinicId,
        opts.branch ?? c.branchId,
        patientId,
        opts.prof ?? c.profId,
        opts.box === undefined ? c.boxId : opts.box,
        opts.status ?? "confirmada",
        c.owner,
      ],
    );
    return r.rows[0].id;
  }

  /** Crea un dispositivo como owner, emite el código y lo vincula. */
  async function dispositivo(
    c: Clinica,
    tipo: "totem" | "sala" | "box",
    opts: { branch?: string; box?: string | null } = {},
  ) {
    const creado = await como<{ id: string }>(
      c.owner,
      `SELECT public.dispositivo_crear($1, $2, $3, $4, $5, 'iniciales') AS id`,
      [c.clinicId, opts.branch ?? c.branchId, tipo, `Prueba ${tipo}`, opts.box ?? null],
    );
    expect(creado.error).toBe("");
    const id = creado.filas[0].id;
    const codigo = `COD${randomUUID().slice(0, 5)}`;
    const emit = await como(c.owner, `SELECT public.dispositivo_emitir_codigo($1, $2) AS v`, [
      id,
      sha(codigo),
    ]);
    expect(emit.error).toBe("");
    const token = secreto();
    const [v] = await servicio<{ r: Fila }>(`SELECT public.dispositivo_vincular($1, $2) AS r`, [
      sha(codigo),
      sha(token),
    ]);
    expect(v.r).toEqual({ ok: true, kind: tipo });
    return { id, token, codigo };
  }

  async function identificar(deviceId: string, rut: string, tipo: string, valor: string) {
    const sesion = secreto();
    const [r] = await servicio<{ r: Fila }>(
      `SELECT public.totem_identificar($1, $2, $3, $4, $5) AS r`,
      [deviceId, rut, tipo, valor, sha(sesion)],
    );
    return { r: r.r, sesion };
  }

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    a = await sembrarClinica("Clínica A tótem");
    b = await sembrarClinica("Clínica B tótem");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("las funciones del dispositivo solo las ejecuta el rol de servicio", async () => {
    const { rows } = await client.query<{ f: string; anon: boolean; authn: boolean; srv: boolean }>(
      `SELECT p.oid::regprocedure::text AS f,
              has_function_privilege('anon', p.oid, 'execute') AS anon,
              has_function_privilege('authenticated', p.oid, 'execute') AS authn,
              has_function_privilege('service_role', p.oid, 'execute') AS srv
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('dispositivo_vincular', 'dispositivo_por_token', 'dispositivo_de_tipo',
                            'totem_identificar', 'totem_paciente_de_sesion', 'totem_terminar',
                            'totem_resumen', 'totem_marcar_llegada', 'totem_agendar',
                            'sala_estado', 'box_estado', 'dispositivo_llamar',
                            'sala_asignar_turno', 'sala_registrar_llamado')`,
    );
    expect(rows.length).toBe(14);
    for (const r of rows) {
      expect(r.anon, r.f).toBe(false);
      expect(r.authn, r.f).toBe(false);
      expect(r.srv, r.f).toBe(true);
    }
    // Las de la app: authenticated sí, anon no.
    const app = await client.query<{ f: string; anon: boolean; authn: boolean }>(
      `SELECT p.oid::regprocedure::text AS f,
              has_function_privilege('anon', p.oid, 'execute') AS anon,
              has_function_privilege('authenticated', p.oid, 'execute') AS authn
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('dispositivo_crear', 'dispositivo_editar', 'dispositivo_emitir_codigo',
                            'dispositivo_revocar', 'llamar_a_sala')`,
    );
    expect(app.rows.length).toBe(5);
    for (const r of app.rows) {
      expect(r.anon, r.f).toBe(false);
      expect(r.authn, r.f).toBe(true);
    }
  });

  it("solo owner/admin crean dispositivos y emiten códigos; la base guarda solo huellas", async () => {
    const rec = await como(
      a.recepcion,
      `SELECT public.dispositivo_crear($1, $2, 'totem', 'Tótem', null, 'iniciales')`,
      [a.clinicId, a.branchId],
    );
    expect(rec.error).toMatch(/permisos/);
    const ajeno = await como(
      b.owner,
      `SELECT public.dispositivo_crear($1, $2, 'totem', 'Tótem', null, 'iniciales')`,
      [a.clinicId, a.branchId],
    );
    expect(ajeno.error).toMatch(/permisos/);
    // Sucursal de otra clínica: no.
    const cruzado = await como(
      a.owner,
      `SELECT public.dispositivo_crear($1, $2, 'totem', 'Tótem', null, 'iniciales')`,
      [a.clinicId, b.branchId],
    );
    expect(cruzado.error).not.toBe("");

    const d = await dispositivo(a, "totem");
    const [fila] = await servicio<{ token_hash: string; pairing_code_hash: string | null }>(
      `SELECT token_hash, pairing_code_hash FROM public.clinic_devices WHERE id = $1`,
      [d.id],
    );
    expect(fila.token_hash).toBe(sha(d.token));
    expect(fila.token_hash).not.toContain(d.token);
    expect(fila.pairing_code_hash).toBeNull();

    // Nadie escribe la tabla directo, ni el owner.
    const directo = await como(
      a.owner,
      `UPDATE public.clinic_devices SET token_hash = $2 WHERE id = $1`,
      [d.id, sha("otro")],
    );
    expect(directo.error).toMatch(/permission denied/);
    const recEmite = await como(a.recepcion, `SELECT public.dispositivo_emitir_codigo($1, $2)`, [
      d.id,
      sha("X"),
    ]);
    expect(recEmite.error).toMatch(/permisos/);
  });

  it("RLS: solo owner/admin de la clínica ven sus dispositivos", async () => {
    await dispositivo(a, "totem");
    const owner = await como<{ n: number }>(
      a.owner,
      `SELECT count(*)::int AS n FROM public.clinic_devices`,
    );
    expect(owner.filas[0].n).toBe(1);
    for (const u of [a.recepcion, a.asistente, b.owner]) {
      const r = await como<{ n: number }>(
        u,
        `SELECT count(*)::int AS n FROM public.clinic_devices`,
      );
      expect(r.filas[0].n, u).toBe(0);
    }
  });

  it("el código sirve una vez, vence y revocado el token deja de servir", async () => {
    const d = await dispositivo(a, "totem");
    const [otra] = await servicio<{ r: Fila }>(`SELECT public.dispositivo_vincular($1, $2) AS r`, [
      sha(d.codigo),
      sha(secreto()),
    ]);
    expect(otra.r.ok).toBe(false);

    const [quien] = await servicio<{ r: Fila }>(`SELECT public.dispositivo_por_token($1) AS r`, [
      sha(d.token),
    ]);
    expect(quien.r).toMatchObject({
      id: d.id,
      clinic_id: a.clinicId,
      branch_id: a.branchId,
      kind: "totem",
    });

    // Código vencido.
    await como(a.owner, `SELECT public.dispositivo_emitir_codigo($1, $2)`, [d.id, sha("VENCIDO1")]);
    await servicio(
      `UPDATE public.clinic_devices SET pairing_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [d.id],
    );
    const [vencido] = await servicio<{ r: Fila }>(
      `SELECT public.dispositivo_vincular($1, $2) AS r`,
      [sha("VENCIDO1"), sha(secreto())],
    );
    expect(vencido.r.ok).toBe(false);

    const rev = await como(a.owner, `SELECT public.dispositivo_revocar($1)`, [d.id]);
    expect(rev.error).toBe("");
    const [nada] = await servicio<{ r: Fila | null }>(
      `SELECT public.dispositivo_por_token($1) AS r`,
      [sha(d.token)],
    );
    expect(nada.r).toBeNull();
    await paciente(a);
    const { r } = await identificar(d.id, "12345678-5", "telefono", "4321");
    expect(r).toMatchObject({ ok: false, motivo: "dispositivo" });
  });

  it("la demo no administra dispositivos", async () => {
    await servicio(`UPDATE public.clinics SET is_demo = true WHERE id = $1`, [a.clinicId]);
    const r = await como(
      a.owner,
      `SELECT public.dispositivo_crear($1, $2, 'totem', 'Tótem', null, 'iniciales')`,
      [a.clinicId, a.branchId],
    );
    expect(r.error).toMatch(/demo/);
  });

  it("identificación: dato correcto abre sesión; 3 fallos bloquean el RUT; nunca dice si existe", async () => {
    const d = await dispositivo(a, "totem");
    await paciente(a);
    const mal1 = await identificar(d.id, "12.345.678-5", "telefono", "0000");
    expect(mal1.r).toMatchObject({ ok: false, motivo: "datos", restantes: 2 });
    const noExiste = await identificar(d.id, "11.111.111-1", "telefono", "4321");
    expect(noExiste.r).toMatchObject({ ok: false, motivo: "datos" });
    const ok = await identificar(d.id, "12345678-5", "nacimiento", "0703");
    expect(ok.r).toEqual({ ok: true });
    await identificar(d.id, "12345678-5", "telefono", "1111");
    const mal3 = await identificar(d.id, "12345678-5", "telefono", "2222");
    expect(mal3.r).toMatchObject({ ok: false, motivo: "bloqueado_rut" });
    // Bloqueado: ni con el dato correcto.
    const bloqueado = await identificar(d.id, "12345678-5", "telefono", "4321");
    expect(bloqueado.r).toMatchObject({ ok: false, motivo: "bloqueado_rut" });
    const [log] = await servicio<{ rut_hash: string | null }>(
      `SELECT rut_hash FROM public.totem_identifications WHERE device_id = $1 AND rut_hash IS NOT NULL LIMIT 1`,
      [d.id],
    );
    expect(log.rut_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("un tótem no encuentra pacientes de otra clínica ni ve citas de otra sucursal", async () => {
    const d = await dispositivo(a, "totem");
    // El mismo RUT existe en la clínica B: desde el tótem de A no aparece.
    const pacB = await paciente(b, { rut: "9.876.543-3", telefono: "+56 9 1111 2222" });
    await citaDeHoy(b, pacB);
    const cruzado = await identificar(d.id, "9.876.543-3", "telefono", "2222");
    expect(cruzado.r).toMatchObject({ ok: false, motivo: "datos" });

    const pacA = await paciente(a);
    const enMatriz = await citaDeHoy(a, pacA);
    const enNorte = await citaDeHoy(a, pacA, {
      branch: a.branch2Id,
      prof: a.prof2Id,
      box: a.box2Id,
    });
    const { r, sesion } = await identificar(d.id, "12345678-5", "telefono", "4321");
    expect(r.ok).toBe(true);
    const [res] = await servicio<{ r: { ok: boolean; nombre: string; citas: Fila[] } }>(
      `SELECT public.totem_resumen($1, $2) AS r`,
      [d.id, sha(sesion)],
    );
    expect(res.r.ok).toBe(true);
    expect(res.r.nombre).toBe("María");
    expect(res.r.citas.map((c) => c.id)).toEqual([enMatriz]);
    // Nada clínico ni identificador: solo estas claves.
    expect(Object.keys(res.r.citas[0]).sort()).toEqual(
      ["estado", "fin", "id", "inicio", "profesional", "puede_llegar", "turno"].sort(),
    );
    expect(JSON.stringify(res.r)).not.toMatch(/12\.?345\.?678|Limpieza|González/);

    const otraSucursal = await servicio<{ r: Fila }>(
      `SELECT public.totem_marcar_llegada($1, $2, $3) AS r`,
      [d.id, sha(sesion), enNorte],
    );
    expect(otraSucursal[0].r).toMatchObject({ ok: false, motivo: "invalida" });
    // Una sesión inventada no sirve.
    const [falsa] = await servicio<{ r: Fila }>(`SELECT public.totem_resumen($1, $2) AS r`, [
      d.id,
      sha(secreto()),
    ]);
    expect(falsa.r).toMatchObject({ ok: false, motivo: "sesion" });
  });

  it("marcar llegada: pasa a en-sala con turno y hora de llegada; nunca a confirmada", async () => {
    const d = await dispositivo(a, "totem");
    const pac = await paciente(a);
    const cita = await citaDeHoy(a, pac, { status: "tentativa" });
    const { sesion } = await identificar(d.id, "12345678-5", "telefono", "4321");
    const [r] = await servicio<{ r: Fila }>(`SELECT public.totem_marcar_llegada($1, $2, $3) AS r`, [
      d.id,
      sha(sesion),
      cita,
    ]);
    expect(r.r).toMatchObject({ ok: true, turno: 1 });
    const [ap] = await servicio<{
      status: string;
      arrived_at: string | null;
      confirmed_at: string | null;
    }>(`SELECT status, arrived_at, confirmed_at FROM public.appointments WHERE id = $1`, [cita]);
    expect(ap.status).toBe("en-sala");
    expect(ap.arrived_at).not.toBeNull();
    expect(ap.confirmed_at).toBeNull();
    const [t] = await servicio<{ checked_in_via: string; turn_number: number }>(
      `SELECT checked_in_via, turn_number FROM public.waiting_room_turns WHERE appointment_id = $1`,
      [cita],
    );
    expect(t).toEqual({ checked_in_via: "totem", turn_number: 1 });
    // Otra vez: no duplica.
    const [otra] = await servicio<{ r: Fila }>(
      `SELECT public.totem_marcar_llegada($1, $2, $3) AS r`,
      [d.id, sha(sesion), cita],
    );
    expect(otra.r).toMatchObject({ ok: true, turno: 1, ya_estaba: true });
  });

  it("un dispositivo no usa las funciones de otro tipo", async () => {
    const sala = await dispositivo(a, "sala");
    await paciente(a);
    const { r } = await identificar(sala.id, "12345678-5", "telefono", "4321");
    expect(r).toMatchObject({ ok: false, motivo: "dispositivo" });
    const totem = await dispositivo(a, "totem");
    const [s] = await servicio<{ r: Fila }>(`SELECT public.sala_estado($1) AS r`, [totem.id]);
    expect(s.r).toEqual({ ok: false });
  });

  it("la TV solo muestra su sucursal y nunca RUT ni motivo; Llamar es de roles de agenda", async () => {
    const sala = await dispositivo(a, "sala");
    const pac = await paciente(a);
    const pac2 = await paciente(a, { rut: "5.555.555-9", nombre: "Pedro Soto" });
    const cMatriz = await citaDeHoy(a, pac);
    const cNorte = await citaDeHoy(a, pac2, {
      branch: a.branch2Id,
      prof: a.prof2Id,
      box: a.box2Id,
    });
    // Recepción los pasa a sala desde la agenda: el trigger da el turno.
    await client.query(
      `UPDATE public.appointments SET status = 'en-sala' WHERE id = ANY($1::uuid[])`,
      [[cMatriz, cNorte]],
    );
    const [antes] = await servicio<{ r: { llamados: Fila[]; en_espera: Fila[] } }>(
      `SELECT public.sala_estado($1) AS r`,
      [sala.id],
    );
    expect(antes.r.en_espera).toHaveLength(1);
    expect(antes.r.llamados).toHaveLength(0);

    const asistente = await como(a.asistente, `SELECT public.llamar_a_sala($1) AS r`, [cMatriz]);
    expect(asistente.error).toMatch(/permisos/);
    const ajeno = await como(b.owner, `SELECT public.llamar_a_sala($1) AS r`, [cMatriz]);
    expect(ajeno.error).toMatch(/permisos/);
    const rec = await como<{ r: Fila }>(a.recepcion, `SELECT public.llamar_a_sala($1) AS r`, [
      cMatriz,
    ]);
    expect(rec.error).toBe("");
    expect(rec.filas[0].r).toMatchObject({ ok: true, turno: 1, box: "Box 1" });
    // El de la otra sucursal también se llama, pero no aparece en esta TV.
    await como(a.owner, `SELECT public.llamar_a_sala($1)`, [cNorte]);

    const [despues] = await servicio<{ r: { llamados: Fila[]; en_espera: Fila[] } }>(
      `SELECT public.sala_estado($1) AS r`,
      [sala.id],
    );
    expect(despues.r.llamados).toHaveLength(1);
    expect(despues.r.en_espera).toHaveLength(0);
    expect(Object.keys(despues.r.llamados[0]).sort()).toEqual(
      ["box", "llamado_en", "nombre", "turno", "veces"].sort(),
    );
    expect(JSON.stringify(despues.r)).not.toMatch(/12\.?345|Limpieza|Pedro|Dra\./);

    // Turnos visibles para los miembros de la clínica, no para otra.
    const otra = await como<{ n: number }>(
      b.owner,
      `SELECT count(*)::int AS n FROM public.waiting_room_turns`,
    );
    expect(otra.filas[0].n).toBe(0);
    const propia = await como<{ n: number }>(
      a.asistente,
      `SELECT count(*)::int AS n FROM public.waiting_room_turns`,
    );
    expect(propia.filas[0].n).toBe(2);
    const escribe = await como(a.owner, `UPDATE public.waiting_room_turns SET turn_number = 99`);
    expect(escribe.error).toMatch(/permission denied/);
  });

  it("solo se llama a quien está en sala", async () => {
    const pac = await paciente(a);
    const cita = await citaDeHoy(a, pac);
    const r = await como<{ r: Fila }>(a.owner, `SELECT public.llamar_a_sala($1) AS r`, [cita]);
    expect(r.filas[0].r).toEqual({ ok: false, motivo: "no_en_sala" });
  });

  it("pantalla del box: ve su box y llama al siguiente que llegó", async () => {
    const box = await dispositivo(a, "box", { box: a.boxId });
    const pac = await paciente(a);
    const pac2 = await paciente(a, { rut: "5.555.555-9", nombre: "Pedro Soto" });
    const enBox = await citaDeHoy(a, pac);
    const enOtroBox = await citaDeHoy(a, pac2, {
      branch: a.branch2Id,
      prof: a.prof2Id,
      box: a.box2Id,
    });
    const [e] = await servicio<{ r: { citas: Fila[] } }>(`SELECT public.box_estado($1) AS r`, [
      box.id,
    ]);
    expect(e.r.citas.map((c) => c.id)).toEqual([enBox]);
    expect(JSON.stringify(e.r)).not.toMatch(/12\.?345/);

    const [antes] = await servicio<{ r: Fila }>(`SELECT public.dispositivo_llamar($1, $2) AS r`, [
      box.id,
      enBox,
    ]);
    expect(antes.r).toEqual({ ok: false, motivo: "no_en_sala" });
    await client.query(
      `UPDATE public.appointments SET status = 'en-sala' WHERE id = ANY($1::uuid[])`,
      [[enBox, enOtroBox]],
    );
    const [ok] = await servicio<{ r: Fila }>(`SELECT public.dispositivo_llamar($1, $2) AS r`, [
      box.id,
      enBox,
    ]);
    expect(ok.r).toMatchObject({ ok: true, box: "Box 1" });
    const [otro] = await servicio<{ r: Fila }>(`SELECT public.dispositivo_llamar($1, $2) AS r`, [
      box.id,
      enOtroBox,
    ]);
    expect(otro.r).toMatchObject({ ok: false, motivo: "invalida" });
    const [t] = await servicio<{ called_by_device_id: string; called_operatory_id: string }>(
      `SELECT called_by_device_id, called_operatory_id FROM public.waiting_room_turns WHERE appointment_id = $1`,
      [enBox],
    );
    expect(t).toEqual({ called_by_device_id: box.id, called_operatory_id: a.boxId });
  });

  it("agendar desde el tótem crea una cita tentativa con las reglas de la reserva", async () => {
    const d = await dispositivo(a, "totem");
    const pac = await paciente(a);
    const { sesion } = await identificar(d.id, "12345678-5", "telefono", "4321");
    const inicio = new Date(Date.now() + 3 * 86_400_000);
    inicio.setUTCHours(15, 0, 0, 0);
    const reserva = {
      professional_id: a.profId,
      appointment_type_id: a.tipoId,
      procedure_id: null,
      operatory_id: a.boxId,
      starts_at: inicio.toISOString(),
      status: "confirmada",
    };
    const [r] = await servicio<{ r: Fila }>(`SELECT public.totem_agendar($1, $2, $3::jsonb) AS r`, [
      d.id,
      sha(sesion),
      JSON.stringify(reserva),
    ]);
    expect(r.r.ok).toBe(true);
    const [cita] = await servicio<{
      status: string;
      patient_id: string;
      branch_id: string;
      booking_source: string;
    }>(
      `SELECT status, patient_id, branch_id, booking_source FROM public.appointments WHERE id = $1`,
      [r.r.appointment_id],
    );
    expect(cita).toEqual({
      status: "tentativa",
      patient_id: pac,
      branch_id: a.branchId,
      booking_source: "reserva_en_linea",
    });
    // Mismo horario: ocupado.
    const [ocupado] = await servicio<{ r: Fila }>(
      `SELECT public.totem_agendar($1, $2, $3::jsonb) AS r`,
      [d.id, sha(sesion), JSON.stringify(reserva)],
    );
    expect(ocupado.r).toMatchObject({ ok: false, motivo: "ocupado" });
    // Profesional de otra clínica: inválido.
    const [ajeno] = await servicio<{ r: Fila }>(
      `SELECT public.totem_agendar($1, $2, $3::jsonb) AS r`,
      [
        d.id,
        sha(sesion),
        JSON.stringify({ ...reserva, professional_id: b.profId, operatory_id: null }),
      ],
    );
    expect(ajeno.r).toMatchObject({ ok: false, motivo: "invalida" });
    // Reserva en línea apagada: no se agenda.
    await servicio(
      `UPDATE public.online_booking_settings SET enabled = false WHERE clinic_id = $1`,
      [a.clinicId],
    );
    const [apagada] = await servicio<{ r: Fila }>(
      `SELECT public.totem_agendar($1, $2, $3::jsonb) AS r`,
      [d.id, sha(sesion), JSON.stringify(reserva)],
    );
    expect(apagada.r).toMatchObject({ ok: false, motivo: "apagada" });
  });
});

describe("el token del dispositivo no abre la API", () => {
  it("PostgREST rechaza el token como credencial", async () => {
    const url = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anon) throw new Error("Falta SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (.env.test)");
    const token = secreto();
    for (const tabla of ["patients", "clinical_notes", "clinic_devices", "appointments"]) {
      const res = await fetch(`${url}/rest/v1/${tabla}?select=id&limit=1`, {
        headers: { apikey: anon, Authorization: `Bearer ${token}` },
      });
      expect(res.status, tabla).toBe(401);
    }
    const rpc = await fetch(`${url}/rest/v1/rpc/totem_resumen`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ p_device_id: randomUUID(), p_session_hash: sha(token) }),
    });
    expect([401, 403, 404]).toContain(rpc.status);
  });
});
