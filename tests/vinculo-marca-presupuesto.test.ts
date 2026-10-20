import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, esperaFallo, sembrarEscenario } from "./helpers/db";

/**
 * PR 11b (migración 20261020010000): `quote_items.odontogram_mark_id`.
 *
 * - Nullable: los ítems de siempre siguen entrando sin vínculo.
 * - La marca tiene que ser de la misma clínica y del mismo paciente que el
 *   presupuesto (la FK sola no lo garantiza: su verificación ignora RLS).
 * - Si la marca se borra, el ítem queda con el vínculo en NULL, sin error.
 * - La marca nunca se edita (regla 9): el vínculo vive en `quote_items`.
 */
describe("vínculo marca del odontograma → ítem de presupuesto", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let patientId: string;
  let otroPacienteId: string;
  let quoteId: string;

  async function crearPaciente(clinica: string, creador: string, nombre: string) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [clinica, nombre, creador],
    );
    return r.rows[0].id;
  }

  async function crearMarca(clinica: string, paciente: string, autor: string) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.odontogram_marks
         (clinic_id, patient_id, tooth_number, surface, condition, status, recorded_by)
       VALUES ($1, $2, 36, 'whole', 'endodoncia', 'planificado', $3) RETURNING id`,
      [clinica, paciente, autor],
    );
    return r.rows[0].id;
  }

  async function crearItem(markId: string | null, quote = quoteId, clinica = clinicId) {
    const r = await client.query<{ id: string; odontogram_mark_id: string | null }>(
      `INSERT INTO public.quote_items
         (clinic_id, quote_id, name_snapshot, tooth_number, surface,
          unit_price_cents, total_cents, odontogram_mark_id)
       VALUES ($1, $2, 'Endodoncia molar', 36, 'whole', 18000000, 18000000, $3)
       RETURNING id, odontogram_mark_id`,
      [clinica, quote, markId],
    );
    return r.rows[0];
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
    patientId = await crearPaciente(clinicId, usuarios.owner, "Paciente Vínculo");
    otroPacienteId = await crearPaciente(clinicId, usuarios.owner, "Otro Paciente");
    const q = await client.query<{ id: string }>(
      `INSERT INTO public.quotes (clinic_id, patient_id, number, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [clinicId, patientId, `P-${randomUUID().slice(0, 8)}`, usuarios.owner],
    );
    quoteId = q.rows[0].id;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("la columna existe, es nullable y apunta a odontogram_marks con ON DELETE SET NULL", async () => {
    const col = await client.query<{ is_nullable: string; data_type: string }>(
      `SELECT is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'quote_items'
          AND column_name = 'odontogram_mark_id'`,
    );
    expect(col.rows).toEqual([{ is_nullable: "YES", data_type: "uuid" }]);

    const fk = await client.query<{ confdeltype: string; ref: string }>(
      `SELECT c.confdeltype, c.confrelid::regclass::text AS ref
         FROM pg_constraint c
        WHERE c.conrelid = 'public.quote_items'::regclass
          AND c.contype = 'f'
          AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                 WHERE attrelid = 'public.quote_items'::regclass
                                   AND attname = 'odontogram_mark_id')]`,
    );
    expect(fk.rows).toEqual([{ confdeltype: "n", ref: "odontogram_marks" }]);

    const idx = await client.query(
      `SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'quote_items'
          AND indexname = 'quote_items_odontogram_mark_idx'`,
    );
    expect(idx.rowCount).toBe(1);
  });

  it("un ítem sin vínculo entra igual que siempre", async () => {
    const item = await crearItem(null);
    expect(item.odontogram_mark_id).toBeNull();
  });

  it("acepta una marca del mismo paciente y la misma clínica", async () => {
    const markId = await crearMarca(clinicId, patientId, usuarios.dentist);
    const item = await crearItem(markId);
    expect(item.odontogram_mark_id).toBe(markId);
  });

  it("rechaza una marca de otro paciente de la misma clínica", async () => {
    const markId = await crearMarca(clinicId, otroPacienteId, usuarios.dentist);
    const fallo = await esperaFallo(client, () => crearItem(markId));
    expect(fallo.code).toBe("23514");
    expect(fallo.message).toMatch(/no corresponde a este presupuesto/);
  });

  it("rechaza una marca de otra clínica aunque se conozca su id", async () => {
    // `sembrarEscenario` no se puede llamar dos veces en la misma transacción
    // (crea una tabla temporal): la otra clínica se siembra a mano.
    const otraClinica = randomUUID();
    const otroOwner = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, otroOwner],
    );
    const pacienteAjeno = await crearPaciente(otraClinica, otroOwner, "Ajeno");
    const markAjena = await crearMarca(otraClinica, pacienteAjeno, otroOwner);
    const fallo = await esperaFallo(client, () => crearItem(markAjena));
    expect(fallo.code).toBe("23514");
    // El mensaje no dice de quién es la marca.
    expect(fallo.message).not.toMatch(/Otra clínica|Ajeno/);
  });

  it("rechaza mover el vínculo a una marca ajena con un UPDATE", async () => {
    const item = await crearItem(null);
    const markId = await crearMarca(clinicId, otroPacienteId, usuarios.dentist);
    const fallo = await esperaFallo(client, () =>
      client.query(`UPDATE public.quote_items SET odontogram_mark_id = $1 WHERE id = $2`, [
        markId,
        item.id,
      ]),
    );
    expect(fallo.code).toBe("23514");
  });

  it("si la marca se borra, el ítem queda con el vínculo en NULL", async () => {
    const markId = await crearMarca(clinicId, patientId, usuarios.dentist);
    const item = await crearItem(markId);
    // Sin política de DELETE para usuarios: lo hace la conexión de servicio.
    await client.query(`DELETE FROM public.odontogram_marks WHERE id = $1`, [markId]);
    const r = await client.query<{ odontogram_mark_id: string | null }>(
      `SELECT odontogram_mark_id FROM public.quote_items WHERE id = $1`,
      [item.id],
    );
    expect(r.rows[0].odontogram_mark_id).toBeNull();
  });

  it("vincular no modifica la marca (regla 9)", async () => {
    const markId = await crearMarca(clinicId, patientId, usuarios.dentist);
    const antes = await client.query(`SELECT * FROM public.odontogram_marks WHERE id = $1`, [
      markId,
    ]);
    await crearItem(markId);
    const despues = await client.query(`SELECT * FROM public.odontogram_marks WHERE id = $1`, [
      markId,
    ]);
    expect(despues.rows).toEqual(antes.rows);
  });

  it("la función de validación no se puede llamar por RPC", async () => {
    const r = await client.query<{ anon: boolean; authn: boolean }>(
      `SELECT has_function_privilege('anon', p.oid, 'execute') AS anon,
              has_function_privilege('authenticated', p.oid, 'execute') AS authn
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'validar_vinculo_marca_presupuesto'`,
    );
    expect(r.rows).toEqual([{ anon: false, authn: false }]);
  });
});
