import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 13 · frente A (migraciones 20261109100000 y 20261109100100), contra la
 * base efímera (SQL con `SET LOCAL ROLE authenticated` y el `sub` del JWT,
 * como llega por PostgREST):
 *
 * - Aislamiento entre clínicas y regla 2: solo owner/admin/dentist/assistant
 *   ven y cargan exámenes y sesiones; recepción y contabilidad no (ni la
 *   fila, ni el archivo en Storage).
 * - Cupo: el trigger bloquea al 100 % (también el tamaño confirmado por el
 *   servidor) y el límite por tipo de archivo.
 * - Archivar no borra: sin DELETE, motivo obligatorio, un archivado no se
 *   edita y restaurar es de owner/admin.
 */

const MB = 1024 * 1024;

describe("Ola 13 · exámenes y fotos clínicas (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let otraClinica: string;
  let usuarios: Record<string, string>;
  let otroOwner: string;
  let pacienteId: string;
  let otroPaciente: string;
  let pacienteOtraClinica: string;

  async function como<T = Record<string, unknown>>(
    userId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string; code: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query("SET LOCAL ROLE authenticated");
    try {
      const r = await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: r.rows as T[], error: "", code: "" };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      const err = e as Error & { code?: string };
      return { filas: [], error: err.message, code: err.code ?? "" };
    }
  }

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function servicioFalla(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    await client.query("SAVEPOINT sp_srv");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_srv");
      return { error: "", code: "" };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_srv");
      const err = e as Error & { code?: string };
      return { error: err.message, code: err.code ?? "" };
    }
  }

  const INSERTAR = `INSERT INTO public.patient_exams
      (id, clinic_id, patient_id, kind, taken_on, teeth, storage_path, filename, mime_type, size_bytes, uploaded_by, photo_session_id)
    VALUES ($1, $2, $3, $4, current_date, $5::smallint[], $6, $7, $8, $9, $10, $11)
    RETURNING id, status, uploaded_by, teeth`;

  function subir(
    userId: string,
    opciones: {
      clinic?: string;
      patient?: string;
      kind?: string;
      size?: number;
      teeth?: number[];
      sesion?: string | null;
      nombre?: string;
    } = {},
  ) {
    const id = randomUUID();
    const clinic = opciones.clinic ?? clinicId;
    const patient = opciones.patient ?? pacienteId;
    const nombre = opciones.nombre ?? "foto.jpg";
    return como<{ id: string; status: string; uploaded_by: string; teeth: number[] }>(
      userId,
      INSERTAR,
      [
        id,
        clinic,
        patient,
        opciones.kind ?? "foto_clinica",
        opciones.teeth ?? [],
        `${clinic}/${patient}/${id}/${nombre}`,
        nombre,
        "image/jpeg",
        opciones.size ?? 1000,
        userId,
        opciones.sesion ?? null,
      ],
    );
  }

  async function examenListo(opciones: { size?: number; kind?: string } = {}) {
    const r = await subir(usuarios.dentist, opciones);
    expect(r.error).toBe("");
    const id = r.filas[0].id;
    await servicio(
      `UPDATE public.patient_exams SET status = 'listo', confirmed_at = now() WHERE id = $1`,
      [id],
    );
    return id;
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
    const [p1] = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteId = p1.id;
    const [p2] = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Beto Ruiz', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    otroPaciente = p2.id;
    const [p3] = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Otro Paciente', $2) RETURNING id`,
      [otraClinica, otroOwner],
    );
    pacienteOtraClinica = p3.id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ── Permisos y aislamiento ─────────────────────────────────────────────

  describe("regla 2 y aislamiento entre clínicas", () => {
    it("los roles clínicos suben; la reserva queda pendiente y a nombre de quien sube", async () => {
      for (const rol of ["owner", "admin", "dentist", "assistant"]) {
        const r = await subir(usuarios[rol]);
        expect(r.error, rol).toBe("");
        expect(r.filas[0].status).toBe("pendiente");
        expect(r.filas[0].uploaded_by).toBe(usuarios[rol]);
      }
    });

    it("recepción y contabilidad no suben ni ven exámenes", async () => {
      const id = await examenListo();
      for (const rol of ["reception", "accounting"]) {
        expect((await subir(usuarios[rol])).error, rol).not.toBe("");
        const ve = await como(usuarios[rol], `SELECT id FROM public.patient_exams WHERE id = $1`, [
          id,
        ]);
        expect(ve.filas, rol).toHaveLength(0);
      }
      const dentista = await como(
        usuarios.assistant,
        `SELECT id FROM public.patient_exams WHERE id = $1`,
        [id],
      );
      expect(dentista.filas).toHaveLength(1);
    });

    it("otra clínica no ve los exámenes ni las sesiones, ni sube a un paciente ajeno", async () => {
      const id = await examenListo();
      const [s] = await servicio<{ id: string }>(
        `INSERT INTO public.clinical_photo_sessions (clinic_id, patient_id, session_date, reason, created_by)
         VALUES ($1, $2, current_date, 'Inicio', $3) RETURNING id`,
        [clinicId, pacienteId, usuarios.dentist],
      );
      expect(
        (await como(otroOwner, `SELECT id FROM public.patient_exams WHERE id = $1`, [id])).filas,
      ).toHaveLength(0);
      expect(
        (
          await como(otroOwner, `SELECT id FROM public.clinical_photo_sessions WHERE id = $1`, [
            s.id,
          ])
        ).filas,
      ).toHaveLength(0);
      // Owner de otra clínica intentando cargar en la nuestra.
      expect((await subir(otroOwner)).error).not.toBe("");
      // Dentista nuestro intentando cargar a un paciente de otra clínica en la nuestra.
      expect((await subir(usuarios.dentist, { patient: pacienteOtraClinica })).error).not.toBe("");
    });

    it("la ruta del archivo tiene que ser de la clínica y el paciente", async () => {
      const id = randomUUID();
      const r = await como(usuarios.dentist, INSERTAR, [
        id,
        clinicId,
        pacienteId,
        "foto_clinica",
        [],
        `${otraClinica}/${pacienteId}/${id}/x.jpg`,
        "x.jpg",
        "image/jpeg",
        10,
        usuarios.dentist,
        null,
      ]);
      expect(r.error).toMatch(/ruta del archivo/);
    });

    it("el archivo en Storage solo lo leen los roles clínicos de la clínica", async () => {
      const ruta = `${clinicId}/${pacienteId}/${randomUUID()}/foto.jpg`;
      await servicio(
        `INSERT INTO storage.objects (bucket_id, name) VALUES ('clinical-exams', $1)`,
        [ruta],
      );
      const ver = (u: string) =>
        como(
          u,
          `SELECT name FROM storage.objects WHERE bucket_id = 'clinical-exams' AND name = $1`,
          [ruta],
        );
      expect((await ver(usuarios.dentist)).filas).toHaveLength(1);
      expect((await ver(usuarios.assistant)).filas).toHaveLength(1);
      expect((await ver(usuarios.reception)).filas).toHaveLength(0);
      expect((await ver(usuarios.accounting)).filas).toHaveLength(0);
      expect((await ver(otroOwner)).filas).toHaveLength(0);
      // Nadie sube con su sesión: lo hace el servidor con una URL firmada.
      const sube = await como(
        usuarios.owner,
        `INSERT INTO storage.objects (bucket_id, name) VALUES ('clinical-exams', $1)`,
        [`${clinicId}/${pacienteId}/${randomUUID()}/otra.jpg`],
      );
      expect(sube.error).not.toBe("");
    });

    it("un permiso quitado de historia clínica (EQU-01) también corta los exámenes", async () => {
      const id = await examenListo();
      const [m] = await servicio<{ id: string }>(
        `SELECT id FROM public.clinic_members WHERE clinic_id = $1 AND user_id = $2`,
        [clinicId, usuarios.dentist2],
      );
      await servicio(
        `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
         VALUES ($1, $2, 'clinical:view', 'revoke')`,
        [clinicId, m.id],
      );
      const ve = await como(
        usuarios.dentist2,
        `SELECT id FROM public.patient_exams WHERE id = $1`,
        [id],
      );
      expect(ve.filas).toHaveLength(0);
    });
  });

  // ── Cupo ───────────────────────────────────────────────────────────────

  describe("cupo de almacenamiento", () => {
    it("por defecto (sin suscripción) la clínica tiene el cupo del plan Clínica", async () => {
      const r = await como<{ cupo_bytes: string; plan: string; usado_bytes: string }>(
        usuarios.reception,
        `SELECT * FROM public.uso_de_almacenamiento($1)`,
        [clinicId],
      );
      expect(r.error).toBe("");
      expect(Number(r.filas[0].cupo_bytes)).toBe(45 * 1024 * MB);
      expect(r.filas[0].plan).toBe("clinica");
      expect(Number(r.filas[0].usado_bytes)).toBe(0);
    });

    it("con el plan guardado en la suscripción (sin depender del ID de precio), la clínica Solo tiene 15 GB", async () => {
      await servicio(
        `INSERT INTO public.subscriptions (clinic_id, stripe_price_id, status, plan) VALUES ($1, 'price_nuevo_cualquiera', 'active', 'solo')
         ON CONFLICT (clinic_id) DO UPDATE SET stripe_price_id = excluded.stripe_price_id, plan = excluded.plan`,
        [clinicId],
      );
      const r = await como<{ cupo_bytes: string; plan: string }>(
        usuarios.owner,
        `SELECT * FROM public.uso_de_almacenamiento($1)`,
        [clinicId],
      );
      expect(Number(r.filas[0].cupo_bytes)).toBe(15 * 1024 * MB);
      expect(r.filas[0].plan).toBe("solo");
      await servicio(
        `UPDATE public.subscriptions SET plan = NULL, stripe_price_id = NULL WHERE clinic_id = $1`,
        [clinicId],
      );
    });

    it("con el precio de Solo cargado (suscripciones sin plan guardado), la clínica Solo tiene 15 GB", async () => {
      await servicio(
        `UPDATE public.storage_quota_plans SET stripe_price_id = 'price_solo_test' WHERE plan = 'solo'`,
      );
      await servicio(
        `INSERT INTO public.subscriptions (clinic_id, stripe_price_id, status) VALUES ($1, 'price_solo_test', 'active')
         ON CONFLICT (clinic_id) DO UPDATE SET stripe_price_id = excluded.stripe_price_id`,
        [clinicId],
      );
      const r = await como<{ cupo_bytes: string; plan: string }>(
        usuarios.owner,
        `SELECT * FROM public.uso_de_almacenamiento($1)`,
        [clinicId],
      );
      expect(Number(r.filas[0].cupo_bytes)).toBe(15 * 1024 * MB);
      expect(r.filas[0].plan).toBe("solo");
    });

    it("quien no es de la clínica no ve su uso", async () => {
      const r = await como(otroOwner, `SELECT * FROM public.uso_de_almacenamiento($1)`, [clinicId]);
      expect(r.error).toMatch(/permisos/);
    });

    it("bloquea la subida que pasaría el 100 % (en el servidor, con código ES001)", async () => {
      await servicio(
        `UPDATE public.storage_quota_plans SET quota_bytes = 10000 WHERE plan = 'clinica'`,
      );
      expect((await subir(usuarios.dentist, { size: 6000 })).error).toBe("");
      const lleno = await subir(usuarios.dentist, { size: 5000 });
      expect(lleno.code).toBe("ES001");
      expect(lleno.error).toMatch(/100 %/);
      // Justo hasta el borde sí entra.
      expect((await subir(usuarios.dentist, { size: 4000 })).error).toBe("");
      expect((await subir(usuarios.dentist, { size: 1 })).code).toBe("ES001");
    });

    it("los documentos clínicos anteriores también cuentan para el cupo", async () => {
      await servicio(
        `UPDATE public.storage_quota_plans SET quota_bytes = 10000 WHERE plan = 'clinica'`,
      );
      await servicio(
        `INSERT INTO public.patient_documents (clinic_id, patient_id, kind, storage_path, filename, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, 'image', $3, 'a.jpg', 'image/jpeg', 9000, $4)`,
        [clinicId, pacienteId, `${clinicId}/${pacienteId}/a.jpg`, usuarios.dentist],
      );
      expect((await subir(usuarios.dentist, { size: 2000 })).code).toBe("ES001");
    });

    it("el tamaño real confirmado por el servidor también respeta el cupo", async () => {
      await servicio(
        `UPDATE public.storage_quota_plans SET quota_bytes = 10000 WHERE plan = 'clinica'`,
      );
      const r = await subir(usuarios.dentist, { size: 1000 });
      const id = r.filas[0].id;
      const falla = await servicioFalla(
        `UPDATE public.patient_exams SET size_bytes = 20000, status = 'listo' WHERE id = $1`,
        [id],
      );
      expect(falla.code).toBe("ES001");
      await servicio(
        `UPDATE public.patient_exams SET size_bytes = 8000, status = 'listo' WHERE id = $1`,
        [id],
      );
    });

    it("el usuario no puede achicar el tamaño declarado para hacer lugar", async () => {
      const id = await examenListo({ size: 5000 });
      await como(usuarios.dentist, `UPDATE public.patient_exams SET size_bytes = 1 WHERE id = $1`, [
        id,
      ]);
      const [f] = await servicio<{ size_bytes: string }>(
        `SELECT size_bytes FROM public.patient_exams WHERE id = $1`,
        [id],
      );
      expect(Number(f.size_bytes)).toBe(5000);
    });

    it("límite por archivo: 20 MB una foto, 50 MB un CBCT (código ES002)", async () => {
      expect((await subir(usuarios.dentist, { size: 20 * MB })).error).toBe("");
      expect((await subir(usuarios.dentist, { size: 20 * MB + 1 })).code).toBe("ES002");
      expect(
        (await subir(usuarios.dentist, { kind: "cbct_dicom", size: 50 * MB, nombre: "ct.zip" }))
          .error,
      ).toBe("");
      expect(
        (
          await subir(usuarios.dentist, {
            kind: "cbct_dicom",
            size: 50 * MB + 1,
            nombre: "ct.zip",
          })
        ).code,
      ).toBe("ES002");
    });
  });

  // ── Archivar, no borrar ────────────────────────────────────────────────

  describe("archivar no borra (Decreto 41)", () => {
    it("nadie con sesión borra un examen, ni siquiera el owner", async () => {
      const id = await examenListo();
      const borra = await como(usuarios.owner, `DELETE FROM public.patient_exams WHERE id = $1`, [
        id,
      ]);
      expect(borra.error).not.toBe("");
      const [n] = await servicio<{ n: string }>(
        `SELECT count(*) AS n FROM public.patient_exams WHERE id = $1`,
        [id],
      );
      expect(Number(n.n)).toBe(1);
    });

    it("archivar pide motivo, queda la fila con quién y cuándo, y no se edita archivado", async () => {
      const id = await examenListo();
      const sinMotivo = await como(
        usuarios.dentist,
        `UPDATE public.patient_exams SET archived_at = now() WHERE id = $1`,
        [id],
      );
      expect(sinMotivo.error).not.toBe("");
      const ok = await como(
        usuarios.assistant,
        `UPDATE public.patient_exams SET archived_at = now(), archive_reason = 'Subida duplicada' WHERE id = $1`,
        [id],
      );
      expect(ok.error).toBe("");
      const [f] = await servicio<{
        archived_by: string;
        archive_reason: string;
        storage_path: string;
      }>(
        `SELECT archived_by, archive_reason, storage_path FROM public.patient_exams WHERE id = $1`,
        [id],
      );
      expect(f.archived_by).toBe(usuarios.assistant);
      expect(f.archive_reason).toBe("Subida duplicada");
      expect(f.storage_path).toContain(id);
      const edita = await como(
        usuarios.dentist,
        `UPDATE public.patient_exams SET notes = 'cambio' WHERE id = $1`,
        [id],
      );
      expect(edita.error).toMatch(/archivado/);
    });

    it("restaurar es solo de owner/admin", async () => {
      const id = await examenListo();
      await como(
        usuarios.dentist,
        `UPDATE public.patient_exams SET archived_at = now(), archive_reason = 'Error de paciente' WHERE id = $1`,
        [id],
      );
      const restaura = `UPDATE public.patient_exams SET archived_at = null, archive_reason = null WHERE id = $1`;
      expect((await como(usuarios.dentist, restaura, [id])).error).toMatch(/owner o admin/);
      expect((await como(usuarios.admin, restaura, [id])).error).toBe("");
    });

    it("las sesiones tampoco se borran y se archivan con motivo", async () => {
      const s = await como<{ id: string }>(
        usuarios.dentist,
        `INSERT INTO public.clinical_photo_sessions (clinic_id, patient_id, session_date, reason, stage, created_by)
         VALUES ($1, $2, current_date, 'Inicio del blanqueamiento', 'antes', $3) RETURNING id`,
        [clinicId, pacienteId, usuarios.dentist],
      );
      expect(s.error).toBe("");
      const id = s.filas[0].id;
      expect(
        (
          await como(usuarios.owner, `DELETE FROM public.clinical_photo_sessions WHERE id = $1`, [
            id,
          ])
        ).error,
      ).not.toBe("");
      expect(
        (
          await como(
            usuarios.dentist,
            `UPDATE public.clinical_photo_sessions SET archived_at = now(), archive_reason = 'Duplicada' WHERE id = $1`,
            [id],
          )
        ).error,
      ).toBe("");
    });
  });

  // ── Sesiones y piezas ──────────────────────────────────────────────────

  describe("sesiones de fotos y piezas", () => {
    it("una foto solo entra en una sesión vigente del mismo paciente", async () => {
      const [s] = await servicio<{ id: string }>(
        `INSERT INTO public.clinical_photo_sessions (clinic_id, patient_id, session_date, reason, created_by)
         VALUES ($1, $2, current_date, 'Control', $3) RETURNING id`,
        [clinicId, otroPaciente, usuarios.dentist],
      );
      const ajena = await subir(usuarios.dentist, { sesion: s.id });
      expect(ajena.error).toMatch(/sesión de fotos/);
      const [propia] = await servicio<{ id: string }>(
        `INSERT INTO public.clinical_photo_sessions (clinic_id, patient_id, session_date, reason, created_by)
         VALUES ($1, $2, current_date, 'Antes', $3) RETURNING id`,
        [clinicId, pacienteId, usuarios.dentist],
      );
      expect((await subir(usuarios.dentist, { sesion: propia.id })).error).toBe("");
      // Una radiografía no va en una sesión de fotos.
      expect(
        (await subir(usuarios.dentist, { sesion: propia.id, kind: "periapical" })).error,
      ).not.toBe("");
    });

    it("el plan de tratamiento de la sesión tiene que ser del mismo paciente", async () => {
      const [plan] = await servicio<{ id: string }>(
        `INSERT INTO public.treatment_plans (clinic_id, patient_id, name, created_by)
         VALUES ($1, $2, 'Plan de Beto', $3) RETURNING id`,
        [clinicId, otroPaciente, usuarios.owner],
      );
      const r = await como(
        usuarios.dentist,
        `INSERT INTO public.clinical_photo_sessions (clinic_id, patient_id, session_date, reason, treatment_plan_id, created_by)
         VALUES ($1, $2, current_date, 'Antes', $3, $4)`,
        [clinicId, pacienteId, plan.id, usuarios.dentist],
      );
      expect(r.error).toMatch(/plan de tratamiento/);
    });

    it("piezas FDI válidas, sin repetir y ordenadas; rechaza una pieza que no existe", async () => {
      const ok = await subir(usuarios.dentist, { teeth: [36, 11, 36, 85] });
      expect(ok.error).toBe("");
      expect(ok.filas[0].teeth).toEqual([11, 36, 85]);
      expect((await subir(usuarios.dentist, { teeth: [19] })).error).not.toBe("");
      expect((await subir(usuarios.dentist, { teeth: [56] })).error).not.toBe("");
    });

    it("la lectura de la sección 'examenes' queda registrada", async () => {
      const r = await como<{ ok: boolean }>(
        usuarios.dentist,
        `SELECT public.registrar_lectura_ficha($1, $2, 'examenes') AS ok`,
        [clinicId, pacienteId],
      );
      expect(r.error).toBe("");
      expect(r.filas[0].ok).toBe(true);
    });
  });
});
