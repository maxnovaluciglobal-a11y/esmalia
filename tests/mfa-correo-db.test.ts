import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";
import { huellaCodigoMfaCorreo } from "@/lib/auth/mfa-correo";

/**
 * SEG-01, código por correo (migración 20261026900000), contra la base:
 *
 * - La frontera es `sesion_cumple_mfa()`, la que usan las políticas
 *   RESTRICTIVE `mfa_exige_aal2`: se prueba leyendo `clinical_notes` como
 *   `authenticated` con distintos JWT (aal, session_id).
 * - aal1 de un usuario con MFA sin verificar → bloqueada. aal1 + correo
 *   verificado en ESA sesión → permitida. Otra sesión del mismo usuario →
 *   bloqueada. aal2 TOTP → permitida.
 * - Código: vencido, usado, intentos agotados, límite de envíos.
 * - Las tablas no se leen desde la API; inscribir un TOTP con el correo
 *   activo exige la autorización de una sesión verificada.
 */

describe("segundo paso por correo en la base", () => {
  let client: Client;
  let usuarios: Record<string, string>;
  let noteId: string;

  async function crearUsuarioAuth(id: string, email: string) {
    await client.query(
      `insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
       values ($1, $2, 'authenticated', 'authenticated', now(), now(), now())
       on conflict (id) do nothing`,
      [id, email],
    );
  }

  async function crearSesion(userId: string): Promise<string> {
    const id = randomUUID();
    await client.query(
      `insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())`,
      [id, userId],
    );
    return id;
  }

  async function inscribirTotp(userId: string) {
    await client.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
       values ($1, $2, $3, 'totp', 'verified', now(), now(), 'SECRETO')`,
      [randomUUID(), userId, `app-${randomUUID()}`],
    );
  }

  /** Corre `sql` como `authenticated` con el JWT dado. */
  async function como<T>(
    claims: Record<string, unknown>,
    sql: string,
  ): Promise<{ filas: T[]; error: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role: "authenticated", ...claims }),
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query("SET LOCAL ROLE authenticated");
    try {
      const r = await client.query(sql);
      await client.query("RELEASE SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: r.rows as T[], error: "" };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: [], error: (e as Error).message };
    }
  }

  async function notasVisibles(claims: Record<string, unknown>): Promise<number> {
    const r = await como<{ n: number }>(
      claims,
      `select count(*)::int as n from public.clinical_notes where id = '${noteId}'`,
    );
    expect(r.error).toBe("");
    return r.filas[0].n;
  }

  async function cumple(claims: Record<string, unknown>): Promise<boolean> {
    const r = await como<{ ok: boolean }>(claims, "select public.sesion_cumple_mfa() as ok");
    expect(r.error).toBe("");
    return r.filas[0].ok;
  }

  async function emitir(userId: string, sessionId: string, proposito: string, codigo: string) {
    const r = await client.query(
      `select public.mfa_correo_emitir_codigo($1, $2, $3, $4, '203.0.113.7', 'Prueba') as j`,
      [userId, sessionId, proposito, await huellaCodigoMfaCorreo(userId, sessionId, codigo)],
    );
    return r.rows[0].j as { ok: boolean; motivo?: string; esperar?: number };
  }

  async function verificar(userId: string, sessionId: string, proposito: string, codigo: string) {
    const r = await client.query(
      `select public.mfa_correo_verificar_codigo($1, $2, $3, $4, '203.0.113.7', 'Prueba') as j`,
      [userId, sessionId, proposito, await huellaCodigoMfaCorreo(userId, sessionId, codigo)],
    );
    return r.rows[0].j as { ok: boolean; motivo?: string; restantes?: number };
  }

  /** Los límites de envío miran `created_at`: se corre el reloj de los códigos. */
  async function envejecerCodigos(userId: string) {
    await client.query(
      `update public.mfa_email_codes set created_at = created_at - interval '2 minutes' where user_id = $1`,
      [userId],
    );
  }

  /** Activa el correo para `userId` en la sesión dada (flujo real). */
  async function activarCorreo(userId: string, sessionId: string) {
    expect((await emitir(userId, sessionId, "activar", "246810")).ok).toBe(true);
    expect((await verificar(userId, sessionId, "activar", "246810")).ok).toBe(true);
    await envejecerCodigos(userId);
  }

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    const e = await sembrarEscenario(client);
    usuarios = e.usuarios;
    noteId = e.noteId;
    await crearUsuarioAuth(usuarios.owner, `owner-${randomUUID()}@clinica.cl`);
    await crearUsuarioAuth(usuarios.dentist, `dentist-${randomUUID()}@clinica.cl`);
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("sin ningún segundo paso, aal1 sigue viendo todo (sin cambios)", async () => {
    const s = await crearSesion(usuarios.owner);
    expect(await cumple({ sub: usuarios.owner, aal: "aal1", session_id: s })).toBe(true);
    expect(await notasVisibles({ sub: usuarios.owner, aal: "aal1", session_id: s })).toBe(1);
  });

  it("con TOTP: aal1 queda bloqueada en una tabla con mfa_exige_aal2 y aal2 pasa", async () => {
    await inscribirTotp(usuarios.owner);
    const s = await crearSesion(usuarios.owner);
    expect(await notasVisibles({ sub: usuarios.owner, aal: "aal1", session_id: s })).toBe(0);
    expect(await notasVisibles({ sub: usuarios.owner, aal: "aal2", session_id: s })).toBe(1);
  });

  it("con el correo activo: aal1 sin verificar queda bloqueada", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    const s2 = await crearSesion(usuarios.owner);
    expect(await cumple({ sub: usuarios.owner, aal: "aal1", session_id: s2 })).toBe(false);
    expect(await notasVisibles({ sub: usuarios.owner, aal: "aal1", session_id: s2 })).toBe(0);
  });

  it("aal1 + correo verificado en ESA sesión pasa; otra sesión del mismo usuario no", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    // La activación verificó la sesión s1.
    expect(await notasVisibles({ sub: usuarios.owner, aal: "aal1", session_id: s1 })).toBe(1);

    const s2 = await crearSesion(usuarios.owner);
    expect(await notasVisibles({ sub: usuarios.owner, aal: "aal1", session_id: s2 })).toBe(0);
    expect((await emitir(usuarios.owner, s2, "login", "135790")).ok).toBe(true);
    // Un código de s2 no sirve verificado desde otra sesión.
    const s3 = await crearSesion(usuarios.owner);
    expect((await verificar(usuarios.owner, s3, "login", "135790")).motivo).toBe("sin_codigo");
    expect((await verificar(usuarios.owner, s2, "login", "135790")).ok).toBe(true);
    expect(await notasVisibles({ sub: usuarios.owner, aal: "aal1", session_id: s2 })).toBe(1);
    expect(await notasVisibles({ sub: usuarios.owner, aal: "aal1", session_id: s3 })).toBe(0);
  });

  it("la verificación de otro usuario no sirve, aunque use el mismo session_id", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    const sd = await crearSesion(usuarios.dentist);
    await activarCorreo(usuarios.dentist, sd);
    expect(await cumple({ sub: usuarios.dentist, aal: "aal1", session_id: s1 })).toBe(false);
  });

  it("cerrar la sesión (borrarla de auth.sessions) anula la verificación", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    await client.query(`delete from auth.sessions where id = $1`, [s1]);
    expect(await cumple({ sub: usuarios.owner, aal: "aal1", session_id: s1 })).toBe(false);
  });

  it("session_id ausente o malformado no rompe la política: solo no cuenta", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    expect(await cumple({ sub: usuarios.owner, aal: "aal1" })).toBe(false);
    expect(await cumple({ sub: usuarios.owner, aal: "aal1", session_id: "no-es-uuid" })).toBe(
      false,
    );
  });

  it("TOTP + correo: cualquiera de los dos alcanza", async () => {
    await inscribirTotp(usuarios.owner);
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    const s2 = await crearSesion(usuarios.owner);
    expect(await cumple({ sub: usuarios.owner, aal: "aal1", session_id: s2 })).toBe(false);
    expect(await cumple({ sub: usuarios.owner, aal: "aal2", session_id: s2 })).toBe(true);
    expect(await cumple({ sub: usuarios.owner, aal: "aal1", session_id: s1 })).toBe(true);
  });

  it("si desactiva el correo, una verificación vieja deja de contar", async () => {
    await inscribirTotp(usuarios.owner);
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    await client.query(`update public.mfa_email_settings set enabled = false where user_id = $1`, [
      usuarios.owner,
    ]);
    expect(await cumple({ sub: usuarios.owner, aal: "aal1", session_id: s1 })).toBe(false);
  });

  it("código vencido → rechazado", async () => {
    const s = await crearSesion(usuarios.owner);
    expect((await emitir(usuarios.owner, s, "activar", "111111")).ok).toBe(true);
    await client.query(
      `update public.mfa_email_codes set expires_at = now() - interval '1 second' where user_id = $1`,
      [usuarios.owner],
    );
    expect((await verificar(usuarios.owner, s, "activar", "111111")).motivo).toBe("vencido");
    expect(await cumple({ sub: usuarios.owner, aal: "aal1", session_id: s })).toBe(true); // sigue sin MFA
  });

  it("código usado → rechazado la segunda vez", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    const s2 = await crearSesion(usuarios.owner);
    expect((await emitir(usuarios.owner, s2, "login", "222222")).ok).toBe(true);
    expect((await verificar(usuarios.owner, s2, "login", "222222")).ok).toBe(true);
    expect((await verificar(usuarios.owner, s2, "login", "222222")).motivo).toBe("sin_codigo");
  });

  it("5 intentos fallidos agotan el código, incluso para el correcto", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    const s2 = await crearSesion(usuarios.owner);
    expect((await emitir(usuarios.owner, s2, "login", "333333")).ok).toBe(true);
    for (let i = 1; i <= 4; i++) {
      const r = await verificar(usuarios.owner, s2, "login", "000000");
      expect(r).toMatchObject({ ok: false, motivo: "incorrecto", restantes: 5 - i });
    }
    expect((await verificar(usuarios.owner, s2, "login", "000000")).motivo).toBe("agotado");
    expect((await verificar(usuarios.owner, s2, "login", "333333")).motivo).toBe("agotado");
    expect(await cumple({ sub: usuarios.owner, aal: "aal1", session_id: s2 })).toBe(false);
  });

  it("un código nuevo anula el anterior", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    const s2 = await crearSesion(usuarios.owner);
    expect((await emitir(usuarios.owner, s2, "login", "444444")).ok).toBe(true);
    await envejecerCodigos(usuarios.owner);
    expect((await emitir(usuarios.owner, s2, "login", "555555")).ok).toBe(true);
    expect((await verificar(usuarios.owner, s2, "login", "444444")).motivo).toBe("incorrecto");
    expect((await verificar(usuarios.owner, s2, "login", "555555")).ok).toBe(true);
  });

  it("límites de envío: uno por minuto por sesión y cinco por hora por usuario", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    const s2 = await crearSesion(usuarios.owner);
    expect((await emitir(usuarios.owner, s2, "login", "123123")).ok).toBe(true);
    const espera = await emitir(usuarios.owner, s2, "login", "123124");
    expect(espera.motivo).toBe("espera");
    expect(espera.esperar).toBeGreaterThan(0);
    // Otra sesión (otro dispositivo) no espera el minuto de la primera.
    const s3 = await crearSesion(usuarios.owner);
    expect((await emitir(usuarios.owner, s3, "login", "123125")).ok).toBe(true);
    // activarCorreo emitió uno: van 3 en la hora. Dos más llegan a 5.
    for (let i = 0; i < 2; i++) {
      await envejecerCodigos(usuarios.owner);
      expect((await emitir(usuarios.owner, s2, "login", `77777${i}`)).ok).toBe(true);
    }
    await envejecerCodigos(usuarios.owner);
    expect((await emitir(usuarios.owner, s2, "login", "888888")).motivo).toBe("demasiados");
  });

  it("login sin el correo activo no emite; activar dos veces tampoco", async () => {
    const s = await crearSesion(usuarios.owner);
    expect((await emitir(usuarios.owner, s, "login", "999999")).motivo).toBe("no_activo");
    await activarCorreo(usuarios.owner, s);
    expect((await emitir(usuarios.owner, s, "activar", "999998")).motivo).toBe("ya_activo");
  });

  it("guarda solo el hash y registra los eventos sin el código", async () => {
    const s = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s);
    const codigos = await client.query(
      `select code_hash from public.mfa_email_codes where user_id = $1`,
      [usuarios.owner],
    );
    expect(codigos.rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(codigos.rows[0].code_hash).not.toContain("246810");
    const eventos = await client.query(
      `select event, coalesce(detail, '') as detail from public.mfa_email_events where user_id = $1 order by created_at`,
      [usuarios.owner],
    );
    expect(eventos.rows.map((e) => e.event)).toEqual(
      expect.arrayContaining(["codigo_enviado", "correo_activado", "verificado"]),
    );
    for (const e of eventos.rows) expect(e.detail).not.toContain("246810");
  });

  it("las tablas no se leen ni escriben desde la API, y las funciones del servidor no se llaman", async () => {
    const claims = { sub: usuarios.owner, aal: "aal1" };
    for (const tabla of [
      "mfa_email_settings",
      "mfa_email_codes",
      "mfa_email_verifications",
      "mfa_email_events",
    ]) {
      expect((await como(claims, `select * from public.${tabla}`)).error).toMatch(
        /permission denied/,
      );
    }
    const s = await crearSesion(usuarios.owner);
    const r = await como(
      claims,
      `select public.mfa_correo_verificar_codigo('${usuarios.owner}', '${s}', 'login', '${"a".repeat(64)}', '', '')`,
    );
    expect(r.error).toMatch(/permission denied/);
    // Ni la inserción directa de una verificación.
    expect(
      (
        await como(
          claims,
          `insert into public.mfa_email_verifications (session_id, user_id) values ('${s}', '${usuarios.owner}')`,
        )
      ).error,
    ).toMatch(/permission denied/);
  });

  it("mi_estado_mfa devuelve el estado del usuario y de su sesión", async () => {
    const s1 = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s1);
    const s2 = await crearSesion(usuarios.owner);
    const r = await como<{ j: Record<string, unknown> }>(
      { sub: usuarios.owner, aal: "aal1", session_id: s2 },
      "select public.mi_estado_mfa() as j",
    );
    expect(r.filas[0].j).toEqual({
      correo_activo: true,
      metodo_preferido: "email",
      tiene_totp: false,
      sesion_verificada_por_correo: false,
      sesion_cumple: false,
    });
  });

  it("con el correo activo no se inscribe un TOTP sin la autorización de una sesión verificada", async () => {
    const s = await crearSesion(usuarios.owner);
    await activarCorreo(usuarios.owner, s);
    await client.query("SAVEPOINT sp_totp");
    await expect(inscribirTotp(usuarios.owner)).rejects.toThrow(/código por correo/);
    await client.query("ROLLBACK TO SAVEPOINT sp_totp");
    await client.query(
      `update public.mfa_email_settings set totp_enroll_allowed_until = now() + interval '10 minutes' where user_id = $1`,
      [usuarios.owner],
    );
    await inscribirTotp(usuarios.owner);
    const n = await client.query(
      `select count(*)::int as n from auth.mfa_factors where user_id = $1`,
      [usuarios.owner],
    );
    expect(n.rows[0].n).toBe(1);
  });
});
