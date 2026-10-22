import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { normalizarDocumento, rutEsValido } from "../src/lib/patients/rut";
import { comoUsuario, conectar, esperaFallo, sembrarEscenario } from "./helpers/db";

/**
 * Ola 1 · Frente Pacientes contra la base efímera (scripts/test-db/start.sh):
 * migraciones 20261022100000 (datos de Chile y listas), 20261022100100
 * (búsqueda tolerante) y 20261022100200 (índice ciego del documento).
 *
 * La conexión de test es `postgres` (BYPASSRLS). Para probar la RLS de
 * verdad, las lecturas "como usuario" cambian a `SET LOCAL ROLE
 * authenticated` con los claims del JWT, igual que PostgREST.
 */

let client: Client;
let clinicId: string;
let usuarios: Record<string, string>;

/** Corre `sql` como `authenticated` con la identidad de `userId` y vuelve a postgres. */
async function comoAutenticado<T = Record<string, unknown>>(
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await client.query("SAVEPOINT como_autenticado");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    const filas = await comoUsuario<T>(client, userId, sql, params);
    await client.query("RESET ROLE");
    await client.query("RELEASE SAVEPOINT como_autenticado");
    return filas;
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT como_autenticado");
    await client.query("RESET ROLE");
    throw e;
  }
}

async function crearPaciente(campos: Record<string, unknown>): Promise<string> {
  const columnas = ["clinic_id", "created_by", ...Object.keys(campos)];
  const valores = [clinicId, usuarios.owner, ...Object.values(campos)];
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO public.patients (${columnas.join(", ")})
     VALUES (${columnas.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    valores,
  );
  return rows[0].id;
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
});
afterEach(async () => {
  await client.query("ROLLBACK");
});

describe("FIC-01: RUT en la base", () => {
  const casos = [
    "12.345.678-5",
    "123456785",
    "15.444.226-K",
    "15444226-k",
    "12.345.678-6",
    "123",
    "abc",
    "12.345.678-5x",
    "",
  ];

  it("rut_es_valido da lo mismo que rutEsValido (src/lib/patients/rut.ts)", async () => {
    for (const rut of casos) {
      const { rows } = await client.query<{ ok: boolean }>(
        "SELECT public.rut_es_valido($1) AS ok",
        [rut],
      );
      expect(rows[0].ok, rut).toBe(rutEsValido(rut));
    }
  });

  it("normalizar_documento da lo mismo que normalizarDocumento", async () => {
    for (const doc of ["12.345.678-5", "15.444.226-k", " ab 12-3 ", " .-", ""]) {
      const { rows } = await client.query<{ n: string | null }>(
        "SELECT public.normalizar_documento($1) AS n",
        [doc],
      );
      expect(rows[0].n, doc).toBe(normalizarDocumento(doc));
    }
  });

  it("un RUT inválido no se guarda cuando el tipo es RUT", async () => {
    const fallo = await esperaFallo(client, () =>
      crearPaciente({ full_name: "Mal RUT", document_type: "rut", document_id: "12.345.678-6" }),
    );
    expect(fallo.code).toBe("23514");
    await expect(
      crearPaciente({ full_name: "Buen RUT", document_type: "rut", document_id: "12.345.678-5" }),
    ).resolves.toBeTruthy();
  });

  it("las fichas viejas (sin tipo) y otros documentos no se revisan como RUT", async () => {
    await expect(
      crearPaciente({ full_name: "Vieja", document_id: "12.345.678-6" }),
    ).resolves.toBeTruthy();
    await expect(
      crearPaciente({ full_name: "Pasaporte", document_type: "pasaporte", document_id: "X1" }),
    ).resolves.toBeTruthy();
  });
});

describe("FIC-02: previsión", () => {
  it("las columnas nuevas son nullable (las fichas viejas quedan en NULL)", async () => {
    const { rows } = await client.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'patients'
          AND column_name = ANY($1)`,
      [
        [
          "document_type",
          "health_plan",
          "health_plan_tier",
          "health_plan_institution",
          "emergency_contact_name",
          "emergency_contact_relationship",
          "emergency_contact_phone",
          "acquisition_source",
          "acquisition_source_detail",
          "referred_by_patient_id",
          "address",
          "commune",
        ],
      ],
    );
    expect(rows).toHaveLength(12);
    for (const r of rows) expect(r.is_nullable, r.column_name).toBe("YES");
  });

  it("solo acepta los valores de la lista y el tramo solo en Fonasa", async () => {
    const malPlan = await esperaFallo(client, () =>
      crearPaciente({ full_name: "X", health_plan: "otra" }),
    );
    expect(malPlan.code).toBe("23514");
    const tramoIsapre = await esperaFallo(client, () =>
      crearPaciente({ full_name: "X", health_plan: "isapre", health_plan_tier: "A" }),
    );
    expect(tramoIsapre.code).toBe("23514");
    await expect(
      crearPaciente({ full_name: "Y", health_plan: "fonasa", health_plan_tier: "B" }),
    ).resolves.toBeTruthy();
  });
});

describe("FIC-02 y FIC-04: listas editables por clínica", () => {
  it("una clínica nueva nace con las isapres y los orígenes de siempre", async () => {
    const { rows } = await client.query<{ kind: string; label: string }>(
      `SELECT kind, label FROM public.clinic_patient_options WHERE clinic_id = $1
        ORDER BY kind, position`,
      [clinicId],
    );
    const isapres = rows.filter((r) => r.kind === "isapre").map((r) => r.label);
    const origenes = rows.filter((r) => r.kind === "acquisition_source").map((r) => r.label);
    expect(isapres).toEqual([
      "Banmédica",
      "Colmena",
      "Consalud",
      "Cruz Blanca",
      "Nueva Masvida",
      "Vida Tres",
      "Esencial",
    ]);
    expect(origenes).toEqual([
      "Instagram",
      "Google",
      "Recomendación",
      "Convenio",
      "Pasaba por aquí",
      "Otro",
    ]);
  });

  it("RLS activa: los miembros leen, alguien de otra clínica no", async () => {
    const { rows: rls } = await client.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.clinic_patient_options'::regclass",
    );
    expect(rls[0].relrowsecurity).toBe(true);
    const miembro = await comoAutenticado(
      usuarios.reception,
      "SELECT id FROM public.clinic_patient_options WHERE clinic_id = $1",
      [clinicId],
    );
    expect(miembro.length).toBe(13);
    const ajeno = await comoAutenticado(
      usuarios.externo,
      "SELECT id FROM public.clinic_patient_options WHERE clinic_id = $1",
      [clinicId],
    );
    expect(ajeno).toEqual([]);
  });

  it("solo owner/admin agregan opciones; recepción y otra clínica no", async () => {
    await expect(
      comoAutenticado(
        usuarios.admin,
        `INSERT INTO public.clinic_patient_options (clinic_id, kind, label)
         VALUES ($1, 'isapre', 'Isapre de prueba') RETURNING id`,
        [clinicId],
      ),
    ).resolves.toHaveLength(1);
    await expect(
      comoAutenticado(
        usuarios.reception,
        `INSERT INTO public.clinic_patient_options (clinic_id, kind, label)
         VALUES ($1, 'isapre', 'Otra') RETURNING id`,
        [clinicId],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      comoAutenticado(
        usuarios.externo,
        `INSERT INTO public.clinic_patient_options (clinic_id, kind, label)
         VALUES ($1, 'isapre', 'Ajena') RETURNING id`,
        [clinicId],
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("PAC-02: búsqueda tolerante", () => {
  it("normalizar_busqueda quita tildes, mayúsculas y espacios de más", async () => {
    const { rows } = await client.query<{ n: string }>(
      "SELECT public.normalizar_busqueda('  José   PÉREZ Ñúñez ') AS n",
    );
    expect(rows[0].n).toBe("jose perez nunez");
  });

  it("'jose peres' encuentra a José Pérez, con la RLS del usuario", async () => {
    await crearPaciente({ full_name: "José Pérez" });
    await crearPaciente({ full_name: "Juan Soto" });
    const filas = await comoAutenticado<{ full_name: string }>(
      usuarios.reception,
      "SELECT full_name FROM public.buscar_pacientes_por_nombre($1, 'jose peres', 8)",
      [clinicId],
    );
    expect(filas.map((f) => f.full_name)).toEqual(["José Pérez"]);
    const ajeno = await comoAutenticado(
      usuarios.externo,
      "SELECT full_name FROM public.buscar_pacientes_por_nombre($1, 'jose peres', 8)",
      [clinicId],
    );
    expect(ajeno).toEqual([]);
  });
});

describe("PAC-03: índice ciego del documento", () => {
  async function conClave() {
    await client.query(
      "SELECT vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'esmalia_document_id_key')",
    );
  }

  it("la tabla del índice no la lee ni la escribe nadie de la API", async () => {
    await expect(
      comoAutenticado(usuarios.owner, "SELECT * FROM public.patient_document_bidx"),
    ).rejects.toThrow(/permission denied/);
    const { rows } = await client.query<{ authn: boolean; anon: boolean }>(
      `SELECT has_function_privilege('authenticated', 'public.indice_ciego_documento(text)', 'execute') AS authn,
              has_function_privilege('anon', 'public.buscar_pacientes_por_documento(uuid, text)', 'execute') AS anon`,
    );
    expect(rows[0]).toEqual({ authn: false, anon: false });
  });

  it("sin clave en Vault no hay índice ni error", async () => {
    const id = await crearPaciente({ full_name: "Sin clave", document_id: "12.345.678-5" });
    const { rows } = await client.query(
      "SELECT 1 FROM public.patient_document_bidx WHERE patient_id = $1",
      [id],
    );
    expect(rows).toEqual([]);
  });

  it("'12.345.678-5' y '123456785' encuentran la misma ficha; otra clínica no", async () => {
    await conClave();
    const id = await crearPaciente({ full_name: "Con RUT", document_id: "12.345.678-5" });
    await crearPaciente({ full_name: "Otro", document_id: "11.111.111-1" });

    for (const termino of ["12.345.678-5", "123456785", "12345678-5"]) {
      const filas = await comoAutenticado<{ id: string }>(
        usuarios.reception,
        "SELECT id FROM public.buscar_pacientes_por_documento($1, $2) AS id",
        [clinicId, termino],
      );
      expect(
        filas.map((f) => f.id),
        termino,
      ).toEqual([id]);
    }

    await expect(
      comoAutenticado(
        usuarios.externo,
        "SELECT * FROM public.buscar_pacientes_por_documento($1, '123456785')",
        [clinicId],
      ),
    ).rejects.toThrow(/No tienes permisos/);
  });

  it("el índice sigue al documento: cambia al editarlo y se borra al quitarlo", async () => {
    await conClave();
    const id = await crearPaciente({ full_name: "Cambia", document_id: "12.345.678-5" });
    const antes = await client.query<{ document_bidx: string }>(
      "SELECT document_bidx FROM public.patient_document_bidx WHERE patient_id = $1",
      [id],
    );
    expect(antes.rows[0].document_bidx).toMatch(/^[0-9a-f]{64}$/);

    await client.query("UPDATE public.patients SET document_id = '11.111.111-1' WHERE id = $1", [
      id,
    ]);
    const despues = await client.query<{ document_bidx: string }>(
      "SELECT document_bidx FROM public.patient_document_bidx WHERE patient_id = $1",
      [id],
    );
    expect(despues.rows[0].document_bidx).not.toBe(antes.rows[0].document_bidx);

    await client.query("UPDATE public.patients SET document_id = NULL WHERE id = $1", [id]);
    const sin = await client.query(
      "SELECT 1 FROM public.patient_document_bidx WHERE patient_id = $1",
      [id],
    );
    expect(sin.rows).toEqual([]);
  });

  it("el índice usa una subclave: no coincide con document_id_hash", async () => {
    await conClave();
    const id = await crearPaciente({ full_name: "Hash", document_id: "123456785" });
    const { rows } = await client.query<{ bidx: string; hash: string | null }>(
      `SELECT b.document_bidx AS bidx, p.document_id_hash AS hash
         FROM public.patient_document_bidx b JOIN public.patients p ON p.id = b.patient_id
        WHERE b.patient_id = $1`,
      [id],
    );
    expect(rows[0].bidx).not.toBe(rows[0].hash);
  });
});
