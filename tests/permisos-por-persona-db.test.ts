import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { CLINIC_ROLES, PERMISSIONS, ajusteAdmitido } from "@/lib/access/access";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 10 · frente C (migraciones 20261106300000 a 20261106300200), contra la
 * base efímera de tests (SQL directo con `SET LOCAL ROLE authenticated`):
 *
 * - El catálogo SQL de ajustes es espejo exacto de `ajusteAdmitido` (access.ts).
 * - Un ajuste por persona nunca abre historia clínica a recepción,
 *   contabilidad, coordinación ni laboratorio, ni pagos a asistente: ni por
 *   la API (RLS + trigger) ni como servicio (trigger).
 * - Lo QUITADO se cumple en la base (políticas restrictivas): notas,
 *   agenda y pacientes.
 * - Roles nuevos: Coordinación hereda recepción/contabilidad y nada clínico;
 *   Técnico/a dental lee laboratorio e inventario y nada clínico ni pagos.
 * - Aislamiento entre clínicas en la tabla nueva y en la profesión.
 */

describe("Ola 10 · permisos por persona, roles nuevos y profesión (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let miembros: Record<string, string>;
  let otraClinica: string;
  let otroOwner: string;
  let otroAdmin: string;
  let miembroOtraClinica: string;
  let branchId: string;
  let profesionalId: string;
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

    otraClinica = randomUUID();
    otroOwner = randomUUID();
    otroAdmin = randomUUID();
    await servicio(`INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`, [
      otraClinica,
      otroOwner,
    ]);
    const m2 = await servicio<{ id: string }>(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES
         ($1, $2, 'admin'), ($1, $3, 'reception') RETURNING id, role`,
      [otraClinica, otroAdmin, randomUUID()],
    );
    miembroOtraClinica = m2[1].id;

    const b = await servicio<{ id: string }>(
      `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Centro') RETURNING id`,
      [clinicId],
    );
    branchId = b[0].id;
    const pr = await servicio<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Rojas') RETURNING id`,
      [clinicId],
    );
    profesionalId = pr[0].id;
    const p = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteId = p[0].id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  const contarNotas = async (uid: string) =>
    (
      await como<{ n: number }>(
        uid,
        `SELECT count(*)::int AS n FROM public.clinical_notes WHERE clinic_id = $1`,
        [clinicId],
      )
    ).filas[0]?.n ?? -1;

  const crearCita = (uid: string) =>
    como(
      uid,
      `INSERT INTO public.appointments
         (clinic_id, branch_id, professional_id, patient_id, starts_at, ends_at, treatment_label, created_by)
       VALUES ($1, $2, $3, $4, now() + interval '2 days', now() + interval '2 days 30 minutes', 'Control', $5)
       RETURNING id`,
      [clinicId, branchId, profesionalId, pacienteId, uid],
    );

  const crearPaciente = (uid: string) =>
    como(
      uid,
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Nuevo', $2) RETURNING id`,
      [clinicId, uid],
    );

  // ── Catálogo ──────────────────────────────────────────────────────────────

  it("el catálogo SQL es espejo de ajusteAdmitido en todas las combinaciones", async () => {
    const distintos: string[] = [];
    for (const r of CLINIC_ROLES) {
      for (const p of PERMISSIONS) {
        for (const e of ["grant", "revoke"] as const) {
          const [{ ok }] = await servicio<{ ok: boolean }>(
            `SELECT public.ajuste_de_permiso_admitido($1::public.app_role, $2, $3) AS ok`,
            [r, p, e],
          );
          if (ok !== ajusteAdmitido(r, p, e)) distintos.push(`${r} ${p} ${e}`);
        }
      }
    }
    expect(distintos).toEqual([]);
  });

  // ── Regla 2 ───────────────────────────────────────────────────────────────

  it("ningún ajuste da historia clínica a recepción, contabilidad, coordinación ni laboratorio", async () => {
    for (const clave of ["reception", "accounting", "coordinator", "lab_technician"]) {
      for (const permiso of ["clinical:view", "clinical:write"]) {
        const r = await ajustar(clave, permiso, "grant");
        expect(r.error, `${clave} ${permiso}`).toMatch(/historia clínica/);
        // Ni siquiera como servicio (bypass de RLS): lo frena el trigger.
        const s = await servicioConError(
          `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
           VALUES ($1, $2, $3, 'grant')`,
          [clinicId, miembros[clave], permiso],
        );
        expect(s, `${clave} ${permiso} servicio`).toMatch(/historia clínica/);
      }
      expect(await contarNotas(usuarios[clave])).toBe(0);
    }
  });

  it("ningún ajuste da pagos a asistente dental", async () => {
    for (const permiso of ["finance:view", "cash:manage", "payments:reverse"]) {
      const r = await ajustar("assistant", permiso, "grant");
      expect(r.error, permiso).toMatch(/pagos/);
      const s = await servicioConError(
        `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
         VALUES ($1, $2, $3, 'grant')`,
        [clinicId, miembros.assistant, permiso],
      );
      expect(s, `${permiso} servicio`).toMatch(/pagos/);
    }
    // La RLS de payments sigue dejando afuera a assistant.
    const v = await como<{ ok: boolean }>(
      usuarios.assistant,
      `SELECT public.has_clinic_role($1, array['owner','admin','dentist','reception','accounting']::public.app_role[]) AS ok`,
      [clinicId],
    );
    expect(v.filas[0].ok).toBe(false);
  });

  it("un ajuste no se puede pasar de un rol a otro con un UPDATE", async () => {
    const r = await ajustar("assistant", "clinical:view", "grant");
    expect(r.error).toBe("");
    const u = await como(
      usuarios.admin,
      `UPDATE public.clinic_member_permission_overrides SET member_id = $1 WHERE id = $2`,
      [miembros.reception, (r.filas[0] as { id: string }).id],
    );
    expect(u.error).toMatch(/otro integrante/);
  });

  // ── Lo quitado se cumple en la base ───────────────────────────────────────

  it("quitar «Ver historia clínica» a un profesional le oculta las notas; a otro no", async () => {
    expect(await contarNotas(usuarios.dentist)).toBe(1);
    expect((await ajustar("dentist", "clinical:view", "revoke")).error).toBe("");
    expect(await contarNotas(usuarios.dentist)).toBe(0);
    expect(await contarNotas(usuarios.dentist2)).toBe(1);
    // Volver al rol: se borra el ajuste y vuelve a ver.
    await como(
      usuarios.admin,
      `DELETE FROM public.clinic_member_permission_overrides WHERE member_id = $1`,
      [miembros.dentist],
    );
    expect(await contarNotas(usuarios.dentist)).toBe(1);
  });

  it("quitar «Escribir historia clínica» impide crear notas pero deja leerlas", async () => {
    expect((await ajustar("dentist", "clinical:write", "revoke")).error).toBe("");
    const ins = await como(
      usuarios.dentist,
      `INSERT INTO public.clinical_notes (clinic_id, patient_ref, patient_name, title, content, status, created_by, updated_by)
       VALUES ($1, 'PAC-2', 'Paciente', 'Control', 'texto', 'draft', $2, $2)`,
      [clinicId, usuarios.dentist],
    );
    expect(ins.error).toMatch(/row-level security/);
    expect(await contarNotas(usuarios.dentist)).toBe(1);
    const otro = await como(
      usuarios.dentist2,
      `INSERT INTO public.clinical_notes (clinic_id, patient_ref, patient_name, title, content, status, created_by, updated_by)
       VALUES ($1, 'PAC-2', 'Paciente', 'Control', 'texto', 'draft', $2, $2)`,
      [clinicId, usuarios.dentist2],
    );
    expect(otro.error).toBe("");
  });

  it("quitar «Agendar» y «Crear y editar pacientes» a recepción", async () => {
    expect((await crearCita(usuarios.reception)).error).toBe("");
    expect((await ajustar("reception", "agenda:manage", "revoke")).error).toBe("");
    expect((await crearCita(usuarios.reception)).error).toMatch(/row-level security/);
    expect((await crearPaciente(usuarios.reception)).error).toBe("");
    expect((await ajustar("reception", "patients:manage", "revoke")).error).toBe("");
    expect((await crearPaciente(usuarios.reception)).error).toMatch(/row-level security/);
    // Otro rol con el mismo permiso no se ve afectado.
    expect((await crearCita(usuarios.dentist)).error).toBe("");
  });

  it("un quitar que ya no corresponde al rol (cambió de rol) deja de aplicar", async () => {
    expect((await ajustar("dentist", "clinical:view", "revoke")).error).toBe("");
    expect(await contarNotas(usuarios.dentist)).toBe(0);
    await servicio(`UPDATE public.clinic_members SET role = 'assistant' WHERE id = $1`, [
      miembros.dentist,
    ]);
    expect(await contarNotas(usuarios.dentist)).toBe(1);
  });

  // ── Quién ajusta ──────────────────────────────────────────────────────────

  it("solo owner/admin ajustan; nunca a sí mismos ni al propietario", async () => {
    const rec = await como(
      usuarios.reception,
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       VALUES ($1, $2, 'clinical:view', 'grant')`,
      [clinicId, miembros.assistant],
    );
    expect(rec.error).toMatch(/row-level security/);
    const yo = await como(
      usuarios.owner,
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       VALUES ($1, $2, 'clinical:view', 'revoke')`,
      [clinicId, miembros.owner],
    );
    expect(yo.error).toMatch(/propios permisos|propietario/);
    const admin = await como(
      usuarios.admin,
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       VALUES ($1, $2, 'clinical:view', 'revoke')`,
      [clinicId, miembros.admin],
    );
    expect(admin.error).toMatch(/propios permisos/);
    expect((await ajustar("owner", "clinical:view", "revoke")).error).toMatch(/propietario/);
  });

  // ── Aislamiento entre clínicas ────────────────────────────────────────────

  it("aislamiento: otra clínica no lee ni escribe ajustes de esta", async () => {
    expect((await ajustar("assistant", "clinical:view", "grant")).error).toBe("");
    const lee = await como<{ n: number }>(
      otroAdmin,
      `SELECT count(*)::int AS n FROM public.clinic_member_permission_overrides`,
    );
    expect(lee.filas[0].n).toBe(0);
    // Con el clinic_id de esta clínica: la RLS lo frena.
    const conEsta = await como(
      otroAdmin,
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       VALUES ($1, $2, 'agenda:manage', 'revoke')`,
      [clinicId, miembros.reception],
    );
    expect(conEsta.error).toMatch(/row-level security/);
    // Con el clinic_id propio y un integrante de esta clínica: lo frena el trigger.
    const cruzado = await como(
      otroAdmin,
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       VALUES ($1, $2, 'agenda:manage', 'revoke')`,
      [otraClinica, miembros.reception],
    );
    expect(cruzado.error).toMatch(/no es de esta clínica/);
    // Y al revés: el admin de esta no toca a la otra.
    const alReves = await como(
      usuarios.admin,
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       VALUES ($1, $2, 'agenda:manage', 'revoke')`,
      [otraClinica, miembroOtraClinica],
    );
    expect(alReves.error).toMatch(/row-level security/);
  });

  it("cada integrante ve sus ajustes y no los de los demás", async () => {
    expect((await ajustar("assistant", "clinical:view", "grant")).error).toBe("");
    expect((await ajustar("reception", "agenda:manage", "revoke")).error).toBe("");
    const propios = await como<{ permission: string }>(
      usuarios.assistant,
      `SELECT permission FROM public.clinic_member_permission_overrides`,
    );
    expect(propios.filas.map((f) => f.permission)).toEqual(["clinical:view"]);
    const admin = await como<{ n: number }>(
      usuarios.admin,
      `SELECT count(*)::int AS n FROM public.clinic_member_permission_overrides`,
    );
    expect(admin.filas[0].n).toBe(2);
  });

  // ── Roles nuevos ──────────────────────────────────────────────────────────

  it("Coordinación cuenta como recepción/contabilidad y nunca como rol clínico", async () => {
    const q = async (roles: string) =>
      (
        await como<{ ok: boolean }>(
          usuarios.coordinator,
          `SELECT public.has_clinic_role($1, $2::public.app_role[]) AS ok`,
          [clinicId, roles],
        )
      ).filas[0].ok;
    expect(await q("{reception}")).toBe(true);
    expect(await q("{accounting}")).toBe(true);
    expect(await q("{owner,admin,dentist,assistant}")).toBe(false);
    expect(await q("{owner,admin}")).toBe(false);
    expect(await contarNotas(usuarios.coordinator)).toBe(0);
    expect((await crearCita(usuarios.coordinator)).error).toBe("");
    expect((await crearPaciente(usuarios.coordinator)).error).toBe("");
    // Y no gestiona el equipo.
    const m = await como(
      usuarios.coordinator,
      `UPDATE public.clinic_members SET role = 'admin' WHERE id = $1 RETURNING id`,
      [miembros.reception],
    );
    expect(m.filas).toHaveLength(0);
  });

  it("los seis roles de siempre siguen igual en has_clinic_role", async () => {
    const q = async (uid: string, roles: string) =>
      (
        await como<{ ok: boolean }>(
          uid,
          `SELECT public.has_clinic_role($1, $2::public.app_role[]) AS ok`,
          [clinicId, roles],
        )
      ).filas[0].ok;
    expect(await q(usuarios.reception, "{reception}")).toBe(true);
    expect(await q(usuarios.reception, "{accounting}")).toBe(false);
    expect(await q(usuarios.accounting, "{reception}")).toBe(false);
    expect(await q(usuarios.assistant, "{reception,accounting}")).toBe(false);
    expect(await q(usuarios.dentist, "{owner,admin,dentist,assistant}")).toBe(true);
  });

  it("Técnico/a dental: laboratorio e inventario sí; historia clínica, pagos y agenda no", async () => {
    const q = async (roles: string) =>
      (
        await como<{ ok: boolean }>(
          usuarios.lab_technician,
          `SELECT public.has_clinic_role($1, $2::public.app_role[]) AS ok`,
          [clinicId, roles],
        )
      ).filas[0].ok;
    expect(await q("{owner,admin,dentist,assistant}")).toBe(false);
    expect(await q("{owner,admin,dentist,reception,accounting}")).toBe(false);
    expect(await contarNotas(usuarios.lab_technician)).toBe(0);
    expect((await crearCita(usuarios.lab_technician)).error).toMatch(/row-level security/);
    expect((await crearPaciente(usuarios.lab_technician)).error).toMatch(/row-level security/);
    const almacen = await servicio<{ id: string }>(
      `INSERT INTO public.warehouses (clinic_id, name) VALUES ($1, 'Bodega') RETURNING id`,
      [clinicId],
    );
    const ve = await como<{ id: string }>(
      usuarios.lab_technician,
      `SELECT id FROM public.warehouses WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(ve.filas.map((f) => f.id)).toEqual([almacen[0].id]);
    const ajeno = await como<{ n: number }>(
      usuarios.lab_technician,
      `SELECT count(*)::int AS n FROM public.warehouses WHERE clinic_id = $1`,
      [otraClinica],
    );
    expect(ajeno.filas[0].n).toBe(0);
  });

  // ── Profesión ─────────────────────────────────────────────────────────────

  it("profesión: cada uno la suya, la de otros solo owner/admin, lista cerrada", async () => {
    const propia = await como(
      usuarios.reception,
      `SELECT public.definir_profesion_de_integrante($1, 'recepcion')`,
      [miembros.reception],
    );
    expect(propia.error).toBe("");
    const ajena = await como(
      usuarios.reception,
      `SELECT public.definir_profesion_de_integrante($1, 'recepcion')`,
      [miembros.dentist],
    );
    expect(ajena.error).toMatch(/permisos/);
    const admin = await como(
      usuarios.admin,
      `SELECT public.definir_profesion_de_integrante($1, 'odontologo_especialista')`,
      [miembros.dentist],
    );
    expect(admin.error).toBe("");
    const invalida = await como(
      usuarios.admin,
      `SELECT public.definir_profesion_de_integrante($1, 'astronauta')`,
      [miembros.dentist],
    );
    expect(invalida.error).toMatch(/clinic_members_profession_check/);
    const otra = await como(
      otroAdmin,
      `SELECT public.definir_profesion_de_integrante($1, 'otra')`,
      [miembros.dentist],
    );
    expect(otra.error).toMatch(/permisos|encontramos/);
    const [fila] = await servicio<{ profession: string }>(
      `SELECT profession FROM public.clinic_members WHERE id = $1`,
      [miembros.dentist],
    );
    expect(fila.profession).toBe("odontologo_especialista");
  });

  it("las funciones nuevas no las ejecuta anon", async () => {
    const { rows } = await client.query<{ proname: string; anon: boolean }>(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('permiso_quitado', 'ajuste_de_permiso_admitido',
                           'definir_profesion_de_integrante', 'has_clinic_role')
    `);
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.anon, r.proname).toBe(false);
  });
});
