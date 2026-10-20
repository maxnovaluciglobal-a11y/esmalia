import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { conectar, comoUsuario, sembrarEscenario } from "./helpers/db";

/**
 * Advisor de performance de Supabase (`multiple_permissive_policies`): una
 * política `FOR ALL` de escritura también aplica a SELECT, así que Postgres
 * evaluaba DOS políticas permisivas en cada lectura. La migración
 * 20261020120000_rls_politicas_por_comando.sql parte cada `FOR ALL` en
 * INSERT / UPDATE / DELETE con las mismas expresiones y une los SELECT
 * duplicados con OR.
 *
 * Este test fija dos cosas:
 *  1. Estructura: ninguna tabla tiene más de una política permisiva por
 *     (rol, comando). Si alguien vuelve a agregar un `FOR ALL` encima de un
 *     SELECT, falla acá y no en el advisor semanas después.
 *  2. Semántica: quién puede hacer qué en cada tabla tocada es EXACTAMENTE lo
 *     que era antes de la migración. La matriz esperada se generó evaluando
 *     las políticas de la base ANTES de aplicar la migración.
 *
 * Como la conexión de test es `postgres` (BYPASSRLS), no se puede observar
 * RLS con INSERTs reales: se evalúan las expresiones USING / WITH CHECK
 * reales de `pg_policies` (OR de todas las permisivas que aplican al comando)
 * sobre una fila sintética de la tabla, con la identidad de cada rol. Es la
 * misma técnica de `evaluarPolitica` en los otros tests de RLS.
 */

const PERSONAS = [
  "owner",
  "admin",
  "dentist",
  "assistant",
  "reception",
  "accounting",
  "externo",
] as const;

type Accion = "select" | "insert" | "update_using" | "update_check" | "delete";
type Matriz = Record<Accion, string[]>;

const LECTURA_MIEMBROS = ["owner", "admin", "dentist", "assistant", "reception", "accounting"];
const GESTION = ["owner", "admin"];
const FINANZAS = ["owner", "admin", "dentist", "reception"];
const CLINICOS = ["owner", "admin", "dentist", "assistant"];

function escritura(roles: string[]): Omit<Matriz, "select"> {
  return { insert: roles, update_using: roles, update_check: roles, delete: roles };
}

/**
 * Quién pasa cada política sobre una fila de su propia clínica (solo
 * `clinic_id` seteado). Generada contra la base previa a la migración.
 */
const ESPERADO: Record<string, Matriz> = {
  // El WITH CHECK exige además convenio y prestación de la misma clínica; con
  // la fila sintética (sin agreement_id/procedure_id) nadie lo pasa.
  agreement_coverage: {
    select: LECTURA_MIEMBROS,
    insert: [],
    update_using: GESTION,
    update_check: [],
    delete: GESTION,
  },
  appointment_statuses: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  branches: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  consent_templates: { select: CLINICOS, ...escritura(GESTION) },
  email_sandbox_config: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  message_templates: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  messages: { select: LECTURA_MIEMBROS, ...escritura(FINANZAS) },
  operatories: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  ortho_cases: { select: LECTURA_MIEMBROS, ...escritura(CLINICOS) },
  ortho_controls: { select: LECTURA_MIEMBROS, ...escritura(CLINICOS) },
  payment_methods: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  // payments excluye assistant (regla 2 de CLAUDE.md).
  payments: { select: [...FINANZAS, "accounting"], ...escritura(FINANZAS) },
  procedure_supplies: { select: LECTURA_MIEMBROS, ...escritura(["owner", "admin", "dentist"]) },
  procedures: { select: LECTURA_MIEMBROS, ...escritura(["owner", "admin", "dentist"]) },
  professional_schedules: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  professionals: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  quote_items: { select: LECTURA_MIEMBROS, ...escritura(FINANZAS) },
  quotes: { select: LECTURA_MIEMBROS, ...escritura(FINANZAS) },
  specialties: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  treatment_items: { select: LECTURA_MIEMBROS, ...escritura(FINANZAS) },
  treatment_plans: { select: LECTURA_MIEMBROS, ...escritura(FINANZAS) },
  waitlist_entries: { select: LECTURA_MIEMBROS, ...escritura(FINANZAS) },
  warehouses: {
    select: ["owner", "admin", "dentist", "assistant", "reception"],
    ...escritura(GESTION),
  },
  whatsapp_accounts: { select: LECTURA_MIEMBROS, ...escritura(GESTION) },
  whatsapp_leads: { select: LECTURA_MIEMBROS, ...escritura(FINANZAS) },
  // SELECT duplicados unidos con OR: sin actor/profesional, solo managers.
  clinic_data_exports: {
    select: GESTION,
    insert: [],
    update_using: [],
    update_check: [],
    delete: [],
  },
  commission_rules: {
    select: ["owner", "admin", "accounting"],
    ...escritura(GESTION),
  },
  commission_settlements: {
    select: ["owner", "admin", "accounting"],
    insert: GESTION,
    update_using: GESTION,
    update_check: GESTION,
    delete: [],
  },
};

interface Politica {
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

/** OR de las políticas permisivas que aplican a `authenticated` para la acción. */
function expresion(politicas: Politica[], accion: Accion): string {
  const cmd = accion.startsWith("update") ? "UPDATE" : accion.toUpperCase();
  const partes = politicas
    .filter((p) => p.cmd === cmd || p.cmd === "ALL")
    .map((p) => {
      if (accion === "insert") return p.with_check ?? p.qual;
      // Sin WITH CHECK, UPDATE usa el USING como chequeo de la fila nueva.
      if (accion === "update_check") return p.with_check ?? p.qual;
      return p.qual;
    })
    .filter((e): e is string => e !== null);
  return partes.length ? partes.map((e) => `(${e})`).join(" OR ") : "false";
}

describe("RLS: una política permisiva por comando, sin cambiar quién puede qué", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;

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

  async function politicas(tabla: string): Promise<Politica[]> {
    const res = await client.query<Politica>(
      `SELECT policyname, cmd, qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public' AND tablename = $1
          AND permissive = 'PERMISSIVE'
          AND roles && ARRAY['authenticated','public']::name[]`,
      [tabla],
    );
    return res.rows;
  }

  async function quienes(
    tabla: string,
    expr: string,
    fila: Record<string, unknown>,
  ): Promise<string[]> {
    const permitidos: string[] = [];
    for (const persona of PERSONAS) {
      const [r] = await comoUsuario<{ ok: boolean | null }>(
        client,
        usuarios[persona],
        `SELECT (${expr}) AS ok FROM json_populate_record(NULL::public.${tabla}, $1::json) AS ${tabla}`,
        [JSON.stringify(fila)],
      );
      if (r.ok === true) permitidos.push(persona);
    }
    return permitidos;
  }

  it("ninguna tabla tiene más de una política permisiva por (rol, comando)", async () => {
    const res = await client.query<{ fila: string }>(
      `SELECT p.tablename || ' ' || r || ' ' || c || ': ' ||
              string_agg(p.policyname, ', ' ORDER BY p.policyname) AS fila
         FROM pg_policies p,
              unnest(p.roles) AS r,
              unnest(CASE WHEN p.cmd = 'ALL'
                          THEN ARRAY['SELECT','INSERT','UPDATE','DELETE']
                          ELSE ARRAY[p.cmd] END) AS c
        WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE'
        GROUP BY p.tablename, r, c
       HAVING count(*) > 1
        ORDER BY 1`,
    );
    expect(res.rows.map((f) => f.fila)).toEqual([]);
  });

  it("ninguna política llama auth.uid() sin envolver en (select …)", async () => {
    const res = await client.query<{ policyname: string }>(
      `SELECT tablename || '.' || policyname AS policyname
         FROM pg_policies
        WHERE schemaname = 'public'
          AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
              ~ '(?<!SELECT )auth\\.uid\\(\\)'`,
    );
    expect(res.rows.map((f) => f.policyname)).toEqual([]);
  });

  it.each(Object.keys(ESPERADO))("%s: misma matriz de acceso por rol", async (tabla) => {
    const pols = await politicas(tabla);
    const fila = { clinic_id: clinicId };
    const obtenido = {} as Matriz;
    for (const accion of Object.keys(ESPERADO[tabla]) as Accion[]) {
      obtenido[accion] = await quienes(tabla, expresion(pols, accion), fila);
    }
    expect(obtenido).toEqual(ESPERADO[tabla]);
  });

  it("clinic_data_exports: quien exportó ve su propia exportación; otro miembro no", async () => {
    const expr = expresion(await politicas("clinic_data_exports"), "select");
    const fila = { clinic_id: clinicId, actor_id: usuarios.reception };
    expect(await quienes("clinic_data_exports", expr, fila)).toEqual([
      "owner",
      "admin",
      "reception",
    ]);
  });

  it.each(["commission_rules", "commission_settlements"])(
    "%s: el profesional ve lo suyo; otro profesional no",
    async (tabla) => {
      const profesionalId = randomUUID();
      await client.query(
        `INSERT INTO public.professionals (id, clinic_id, full_name, user_id)
         VALUES ($1, $2, 'Profesional Test', $3)`,
        [profesionalId, clinicId, usuarios.dentist],
      );
      const expr = expresion(await politicas(tabla), "select");
      const fila = { clinic_id: clinicId, professional_id: profesionalId };
      expect(await quienes(tabla, expr, fila)).toEqual(["owner", "admin", "dentist", "accounting"]);
    },
  );
});
