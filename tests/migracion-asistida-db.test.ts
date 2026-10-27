import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Migración asistida por lotes (migraciones 20261027100000 y 20261027100100),
 * contra la base:
 *
 * - EXP-05: solo owner/admin crean, importan y deshacen lotes; otra clínica no
 *   los ve. Cada fila importada lleva su lote; la reversa borra exactamente
 *   eso y vacía los campos completados, y se niega si hubo actividad después.
 * - EXP-06: la marca y el dato de origen no se editan; una cita importada que
 *   ya había pasado es historial de solo lectura (salvo la fusión de fichas).
 * - REC-06: las citas importadas no entran en Recordatorios salvo que el lote
 *   lo pida o se active después, y activar no impide deshacer.
 */

describe("migración asistida por lotes en la base", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let otraClinica: string;
  let otroOwner: string;
  let branchId: string;
  let professionalId: string;

  async function como<T>(
    userId: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "",
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query(userId ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE service_role");
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

  async function crearLote(
    userId: string,
    kind: "pacientes" | "citas",
    extra: { clinica?: string; incluir?: boolean; politica?: string } = {},
  ) {
    return como<{ id: string }>(
      userId,
      `INSERT INTO public.import_batches (clinic_id, kind, source, file_name, rows_total, duplicate_policy, include_in_reminders, created_by)
       VALUES ($1, $2, 'dentalink', 'export.csv', 3, $3, $4, $5) RETURNING id`,
      [
        extra.clinica ?? clinicId,
        kind,
        kind === "pacientes" ? (extra.politica ?? "omitir") : null,
        extra.incluir ?? false,
        userId,
      ],
    );
  }

  type ResFila = { fila: number; accion: string; id: string | null; mensaje: string | null };

  async function importar(userId: string, loteId: string, filas: unknown[]) {
    const r = await como<{ r: ResFila[] }>(
      userId,
      `SELECT public.migracion_importar_bloque($1, $2::jsonb) AS r`,
      [loteId, JSON.stringify(filas)],
    );
    return { res: r.filas[0]?.r ?? [], error: r.error };
  }

  async function cerrar(loteId: string) {
    return como(
      usuarios.owner,
      `UPDATE public.import_batches SET status = 'completado', completed_at = now() WHERE id = $1`,
      [loteId],
    );
  }

  async function lotePacientes(filas: unknown[], politica = "omitir") {
    const lote = await crearLote(usuarios.owner, "pacientes", { politica });
    expect(lote.error).toBe("");
    const loteId = lote.filas[0].id;
    const { res, error } = await importar(usuarios.owner, loteId, filas);
    expect(error).toBe("");
    expect((await cerrar(loteId)).error).toBe("");
    return { loteId, res };
  }

  async function loteCitas(
    pacienteId: string,
    citas: { inicio: string; fin: string; estado?: string }[],
    incluir = false,
  ) {
    const lote = await crearLote(usuarios.owner, "citas", { incluir });
    expect(lote.error).toBe("");
    const loteId = lote.filas[0].id;
    const { res, error } = await importar(
      usuarios.owner,
      loteId,
      citas.map((c, i) => ({
        fila: i + 1,
        patient_id: pacienteId,
        professional_id: professionalId,
        branch_id: branchId,
        inicio: c.inicio,
        fin: c.fin,
        estado: c.estado ?? "tentativa",
        motivo: "Control",
        original: { Fecha: c.inicio },
      })),
    );
    expect(error).toBe("");
    expect((await cerrar(loteId)).error).toBe("");
    return { loteId, res };
  }

  /** Todo el test corre en una transacción (now() fijo): la importación se
   *  "aleja" un minuto para que una edición posterior se note como en la vida
   *  real, donde importar y editar son transacciones distintas. */
  async function envejecer(loteId: string) {
    await client.query("SET LOCAL session_replication_role = replica");
    for (const t of ["patients", "appointments"]) {
      await client.query(
        `UPDATE public.${t} SET imported_at = imported_at - interval '1 minute',
                updated_at = updated_at - interval '1 minute'
          WHERE import_batch_id = $1`,
        [loteId],
      );
    }
    await client.query("SET LOCAL session_replication_role = origin");
  }

  async function bloqueos(loteId: string) {
    const r = await como<{ tabla: string; usada_por: string; cantidad: string }>(
      usuarios.owner,
      `SELECT * FROM public.migracion_bloqueos_de_lote($1)`,
      [loteId],
    );
    expect(r.error).toBe("");
    return r.filas;
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
    otroOwner = randomUUID();
    otraClinica = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, otroOwner],
    );
    branchId = (
      await client.query<{ id: string }>(
        `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Central') RETURNING id`,
        [clinicId],
      )
    ).rows[0].id;
    professionalId = (
      await client.query<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Rojas') RETURNING id`,
        [clinicId],
      )
    ).rows[0].id;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("solo owner/admin crean lotes, y otra clínica no los ve", async () => {
    for (const rol of ["owner", "admin"]) {
      expect((await crearLote(usuarios[rol], "pacientes")).error, rol).toBe("");
    }
    for (const rol of ["dentist", "assistant", "reception", "accounting"]) {
      expect((await crearLote(usuarios[rol], "pacientes")).error, rol).not.toBe("");
    }
    // Ni en la clínica de otro.
    expect((await crearLote(usuarios.owner, "pacientes", { clinica: otraClinica })).error).not.toBe(
      "",
    );

    const visibles = await como<{ n: string }>(
      otroOwner,
      `SELECT count(*) AS n FROM public.import_batches WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(Number(visibles.filas[0].n)).toBe(0);
    const recepcion = await como<{ n: string }>(
      usuarios.reception,
      `SELECT count(*) AS n FROM public.import_batches WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(Number(recepcion.filas[0].n)).toBe(0);
  });

  it("importa pacientes con la marca que pone la base; una fila con error no tumba el bloque", async () => {
    const { loteId, res } = await lotePacientes([
      {
        fila: 1,
        nombre: "Ana Pérez",
        documento: "11.111.111-1",
        documento_tipo: "rut",
        nacimiento: "1980-03-01",
        externo: "D-1",
        original: { Nombre: "Ana Pérez", RUT: "11.111.111-1" },
      },
      { fila: 2, nombre: "Rut Malo", documento: "12.345.678-0", documento_tipo: "rut" },
      { fila: 3, nombre: "Luis Soto", prevision: "fonasa", tramo: "B" },
    ]);
    expect(res.map((r) => r.accion)).toEqual(["creado", "error", "creado"]);

    const pac = await client.query(
      `SELECT full_name, import_batch_id, import_source, imported_at IS NOT NULL AS con_fecha,
              import_external_id, import_original, status::text
         FROM public.patients WHERE import_batch_id = $1 ORDER BY full_name`,
      [loteId],
    );
    expect(pac.rows).toHaveLength(2);
    expect(pac.rows[0]).toMatchObject({
      full_name: "Ana Pérez",
      import_source: "dentalink",
      con_fecha: true,
      import_external_id: "D-1",
      import_original: { Nombre: "Ana Pérez", RUT: "11.111.111-1" },
      status: "active",
    });

    const lote = await client.query(
      `SELECT rows_created, rows_failed, status FROM public.import_batches WHERE id = $1`,
      [loteId],
    );
    expect(lote.rows[0]).toMatchObject({ rows_created: 2, rows_failed: 1, status: "completado" });
  });

  it("la marca de importación no se pone a mano ni se edita (EXP-06)", async () => {
    const { loteId } = await lotePacientes([{ fila: 1, nombre: "Ana Pérez" }]);
    const pacienteId = (
      await client.query<{ id: string }>(
        `SELECT id FROM public.patients WHERE import_batch_id = $1`,
        [loteId],
      )
    ).rows[0].id;

    // El dato de origen y la marca no se editan…
    const editar = await como(
      usuarios.owner,
      `UPDATE public.patients SET import_original = '{"Nombre":"Otra"}' WHERE id = $1`,
      [pacienteId],
    );
    expect(editar.error).toMatch(/marca de importación/);
    const desmarcar = await como(
      usuarios.owner,
      `UPDATE public.patients SET import_batch_id = NULL WHERE id = $1`,
      [pacienteId],
    );
    expect(desmarcar.error).toMatch(/marca de importación/);
    // …pero la ficha sí se completa.
    const completar = await como(
      usuarios.owner,
      `UPDATE public.patients SET phone = '+56911112222' WHERE id = $1`,
      [pacienteId],
    );
    expect(completar.error).toBe("");

    // Un paciente propio no se cuelga de un lote cerrado ni de otra clínica.
    const enLoteCerrado = await como(
      usuarios.owner,
      `INSERT INTO public.patients (clinic_id, full_name, import_batch_id) VALUES ($1, 'Colado', $2)`,
      [clinicId, loteId],
    );
    expect(enLoteCerrado.error).toMatch(/cerrado/);
    const sinLote = await como(
      usuarios.owner,
      `INSERT INTO public.patients (clinic_id, full_name, import_source) VALUES ($1, 'Colado', 'dentalink')`,
      [clinicId],
    );
    expect(sinLote.error).toMatch(/sin lote/);
    const otro = await crearLote(usuarios.owner, "pacientes");
    const ajeno = await como(
      otroOwner,
      `INSERT INTO public.patients (clinic_id, full_name, import_batch_id) VALUES ($1, 'Colado', $2)`,
      [otraClinica, otro.filas[0].id],
    );
    expect(ajeno.error).not.toBe("");
  });

  it("un lote no se marca deshecho a mano ni cambia sus recordatorios", async () => {
    const { loteId } = await lotePacientes([{ fila: 1, nombre: "Ana Pérez" }]);
    const deshacer = await como(
      usuarios.owner,
      `UPDATE public.import_batches SET status = 'deshecho', reverted_at = now() WHERE id = $1`,
      [loteId],
    );
    expect(deshacer.error).toMatch(/reversa/);
    const avisos = await como(
      usuarios.owner,
      `UPDATE public.import_batches SET include_in_reminders = true WHERE id = $1`,
      [loteId],
    );
    expect(avisos.error).toMatch(/recordatorios/);
  });

  it("busca duplicados por id externo, documento y nombre + fecha de nacimiento", async () => {
    await lotePacientes([
      { fila: 1, nombre: "Ána  Pérez", nacimiento: "1980-03-01", externo: "D-1" },
      { fila: 2, nombre: "Luis Soto", documento: "11.111.111-1", documento_tipo: "rut" },
    ]);
    const r = await como<{ i: number; via: string }>(
      usuarios.admin,
      `SELECT i, via FROM public.migracion_buscar_pacientes($1, $2::jsonb, 'dentalink') ORDER BY i, via`,
      [
        clinicId,
        JSON.stringify([
          { i: 1, externo: "D-1" },
          { i: 2, documento: "111111111" },
          { i: 3, nombre: "ana pérez", nacimiento: "1980-03-01" },
          { i: 4, nombre: "Nadie" },
        ]),
      ],
    );
    expect(r.error).toBe("");
    expect(r.filas).toEqual([
      { i: 1, via: "externo" },
      { i: 2, via: "documento" },
      { i: 3, via: "nombre_nacimiento" },
    ]);

    // Otra clínica no ve las fichas de esta, y recepción no puede buscar.
    const ajena = await como(
      otroOwner,
      `SELECT * FROM public.migracion_buscar_pacientes($1, '[{"i":1,"externo":"D-1"}]'::jsonb, 'dentalink')`,
      [clinicId],
    );
    expect(ajena.error).toMatch(/permisos/);
    const recepcion = await como(
      usuarios.reception,
      `SELECT * FROM public.migracion_buscar_pacientes($1, '[]'::jsonb)`,
      [clinicId],
    );
    expect(recepcion.error).toMatch(/permisos/);
  });

  it("completar llena solo campos vacíos y la reversa los vuelve a vaciar", async () => {
    const existente = (
      await client.query<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, email, created_by)
         VALUES ($1, 'Rosa Díaz', 'rosa@ejemplo.cl', $2) RETURNING id`,
        [clinicId, usuarios.owner],
      )
    ).rows[0].id;

    const { loteId, res } = await lotePacientes(
      [
        {
          fila: 1,
          accion: "completar",
          patient_id: existente,
          nombre: "Rosa Díaz",
          email: "otro@ejemplo.cl",
          telefono: "+56922223333",
          comuna: "Ñuñoa",
        },
      ],
      "completar",
    );
    expect(res[0].accion).toBe("actualizado");
    const despues = await client.query(
      `SELECT email, phone, commune, import_batch_id FROM public.patients WHERE id = $1`,
      [existente],
    );
    expect(despues.rows[0]).toEqual({
      email: "rosa@ejemplo.cl",
      phone: "+56922223333",
      commune: "Ñuñoa",
      import_batch_id: null,
    });

    // Alguien corrige la comuna después: la reversa no pisa ese cambio.
    await client.query(`UPDATE public.patients SET commune = 'Providencia' WHERE id = $1`, [
      existente,
    ]);
    const r = await como<{ r: { campos_vaciados: number } }>(
      usuarios.owner,
      `SELECT public.migracion_deshacer_lote($1) AS r`,
      [loteId],
    );
    expect(r.error).toBe("");
    expect(r.filas[0].r.campos_vaciados).toBe(1);
    const final = await client.query(
      `SELECT email, phone, commune FROM public.patients WHERE id = $1`,
      [existente],
    );
    expect(final.rows[0]).toEqual({
      email: "rosa@ejemplo.cl",
      phone: null,
      commune: "Providencia",
    });
  });

  it("deshace un lote sin actividad y deja registro; con actividad, explica qué lo impide", async () => {
    const { loteId } = await lotePacientes([
      { fila: 1, nombre: "Ana Pérez", documento: "11.111.111-1", documento_tipo: "rut" },
      { fila: 2, nombre: "Luis Soto" },
    ]);
    const [ana, luis] = (
      await client.query<{ id: string }>(
        `SELECT id FROM public.patients WHERE import_batch_id = $1 ORDER BY full_name`,
        [loteId],
      )
    ).rows.map((r) => r.id);
    expect(await bloqueos(loteId)).toEqual([]);
    await envejecer(loteId);

    // Actividad posterior: una nota clínica, una cita creada en Esmalia y una
    // edición de la ficha.
    await client.query(
      `INSERT INTO public.clinical_notes (clinic_id, patient_ref, title, content, created_by)
       VALUES ($1, $2, 'Control', 'Sin novedad', $3)`,
      [clinicId, ana, usuarios.dentist],
    );
    await client.query(
      `INSERT INTO public.appointments (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, now() + interval '2 day', now() + interval '2 day 30 min', $5)`,
      [clinicId, branchId, luis, professionalId, usuarios.owner],
    );
    await client.query(`UPDATE public.patients SET phone = '+56900000000' WHERE id = $1`, [luis]);

    const b = await bloqueos(loteId);
    expect(b.map((x) => `${x.tabla}:${x.usada_por}`).sort()).toEqual([
      "patients:appointments",
      "patients:clinical_notes",
      "patients:edicion",
    ]);
    const negado = await como(usuarios.owner, `SELECT public.migracion_deshacer_lote($1)`, [
      loteId,
    ]);
    expect(negado.error).toMatch(/No se puede deshacer/);

    // Un lote limpio sí se deshace, y solo owner/admin pueden hacerlo.
    const limpio = await lotePacientes([
      { fila: 1, nombre: "Eva Mora", documento: "22.222.222-2", documento_tipo: "rut" },
    ]);
    const recepcion = await como(usuarios.reception, `SELECT public.migracion_deshacer_lote($1)`, [
      limpio.loteId,
    ]);
    expect(recepcion.error).toMatch(/permisos|No encontramos/);
    const ok = await como<{ r: { pacientes: number } }>(
      usuarios.admin,
      `SELECT public.migracion_deshacer_lote($1) AS r`,
      [limpio.loteId],
    );
    expect(ok.error).toBe("");
    expect(ok.filas[0].r.pacientes).toBe(1);
    const lote = await client.query(
      `SELECT status, reverted_by FROM public.import_batches WHERE id = $1`,
      [limpio.loteId],
    );
    expect(lote.rows[0]).toEqual({ status: "deshecho", reverted_by: usuarios.admin });
    const quedan = await client.query(
      `SELECT count(*)::int AS n FROM public.patients WHERE import_batch_id = $1`,
      [limpio.loteId],
    );
    expect(quedan.rows[0].n).toBe(0);
    const otraVez = await como(usuarios.admin, `SELECT public.migracion_deshacer_lote($1)`, [
      limpio.loteId,
    ]);
    expect(otraVez.error).toMatch(/ya se deshizo/);
  });

  it("las citas pasadas importadas son historial de solo lectura; las futuras se mueven", async () => {
    const pacienteId = (
      await client.query<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
        [clinicId, usuarios.owner],
      )
    ).rows[0].id;
    const { loteId, res } = await loteCitas(pacienteId, [
      { inicio: "2025-05-10T13:00:00Z", fin: "2025-05-10T13:30:00Z", estado: "finalizada" },
      { inicio: "2099-05-10T13:00:00Z", fin: "2099-05-10T13:30:00Z" },
    ]);
    expect(res.map((r) => r.accion)).toEqual(["creado", "creado"]);
    const [pasada, futura] = res.map((r) => r.id as string);
    await envejecer(loteId);

    const editar = await como(
      usuarios.reception,
      `UPDATE public.appointments SET notes = 'cambio' WHERE id = $1`,
      [pasada],
    );
    expect(editar.error).toMatch(/historial/);
    const borrar = await como(usuarios.owner, `DELETE FROM public.appointments WHERE id = $1`, [
      pasada,
    ]);
    expect(borrar.error).toMatch(/historial/);
    const mover = await como(
      usuarios.reception,
      `UPDATE public.appointments SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' WHERE id = $1`,
      [futura],
    );
    expect(mover.error).toBe("");

    // La cita repetida en otro lote se omite.
    const repetida = await loteCitas(pacienteId, [
      { inicio: "2025-05-10T13:00:00Z", fin: "2025-05-10T13:30:00Z" },
    ]);
    expect(repetida.res[0].accion).toBe("omitido");

    // Las citas de un lote de citas bloquean deshacer el lote de pacientes…
    // (acá el paciente no es importado: el lote de citas se puede deshacer
    // salvo por la cita futura que se movió).
    const b = await bloqueos(loteId);
    expect(b).toEqual([{ tabla: "appointments", usada_por: "edicion", cantidad: "1" }]);
  });

  it("la fusión de fichas mueve también el historial importado", async () => {
    const [origen, destino] = (
      await client.query<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by)
         VALUES ($1, 'Ana Pérez', $2), ($1, 'Ana Perez', $2) RETURNING id`,
        [clinicId, usuarios.owner],
      )
    ).rows.map((r) => r.id);
    const { res } = await loteCitas(origen, [
      { inicio: "2025-05-10T13:00:00Z", fin: "2025-05-10T13:30:00Z", estado: "finalizada" },
    ]);
    const fusion = await como(usuarios.owner, `SELECT public.merge_patients($1, $2, $3)`, [
      clinicId,
      origen,
      destino,
    ]);
    expect(fusion.error).toBe("");
    const cita = await client.query(`SELECT patient_id FROM public.appointments WHERE id = $1`, [
      res[0].id,
    ]);
    expect(cita.rows[0].patient_id).toBe(destino);
  });

  it("REC-06: las citas importadas no entran en recordatorios hasta activarlas, y activar no bloquea la reversa", async () => {
    const pacienteId = (
      await client.query<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
        [clinicId, usuarios.owner],
      )
    ).rows[0].id;
    const silenciado = await loteCitas(pacienteId, [
      { inicio: "2099-01-10T13:00:00Z", fin: "2099-01-10T13:30:00Z" },
    ]);
    const conAvisos = await loteCitas(
      pacienteId,
      [{ inicio: "2099-02-10T13:00:00Z", fin: "2099-02-10T13:30:00Z" }],
      true,
    );
    const muted = await client.query<{ id: string; reminders_muted: boolean }>(
      `SELECT id, reminders_muted FROM public.appointments WHERE id = ANY($1) ORDER BY starts_at`,
      [[silenciado.res[0].id, conAvisos.res[0].id]],
    );
    expect(muted.rows.map((r) => r.reminders_muted)).toEqual([true, false]);

    // Nadie lo cambia a mano.
    const aMano = await como(
      usuarios.owner,
      `UPDATE public.appointments SET reminders_muted = false WHERE id = $1`,
      [silenciado.res[0].id],
    );
    expect(aMano.error).toMatch(/recordatorios/);

    const activar = await como<{ n: number }>(
      usuarios.admin,
      `SELECT public.migracion_activar_recordatorios($1) AS n`,
      [silenciado.loteId],
    );
    expect(activar.error).toBe("");
    expect(activar.filas[0].n).toBe(1);
    const ahora = await client.query(
      `SELECT reminders_muted FROM public.appointments WHERE id = $1`,
      [silenciado.res[0].id],
    );
    expect(ahora.rows[0].reminders_muted).toBe(false);

    expect(await bloqueos(silenciado.loteId)).toEqual([]);
    const deshacer = await como(usuarios.owner, `SELECT public.migracion_deshacer_lote($1)`, [
      silenciado.loteId,
    ]);
    expect(deshacer.error).toBe("");

    // Recepción no activa recordatorios.
    const recepcion = await como(
      usuarios.reception,
      `SELECT public.migracion_activar_recordatorios($1)`,
      [conAvisos.loteId],
    );
    expect(recepcion.error).not.toBe("");
  });
});
