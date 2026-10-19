import { Client } from "pg";
import { randomUUID } from "node:crypto";

export type Rol = "owner" | "admin" | "dentist" | "assistant" | "reception" | "accounting";

/** Estado inicial opcional de la nota sembrada. */
export interface EstadoNota {
  status?: "draft" | "signed";
  reviewStatus?: "none" | "pending" | "approved" | "changes_requested";
  reviewerKey?: string;
  requesterKey?: string;
}

export interface Escenario {
  clinicId: string;
  usuarios: Record<string, string>;
  /** Nota real en public.clinical_notes (para historial y versiones). */
  noteId: string;
  patientRef: string;
}

/**
 * Tabla temporal espejo de public.clinical_notes con el mismo trigger de negocio.
 * El usuario de pruebas del sandbox solo tiene SELECT/INSERT sobre las tablas
 * reales, así que las transiciones de estado (UPDATE) se validan sobre este
 * espejo, que ejecuta exactamente la misma función `enforce_clinical_note_update`.
 */
export const TABLA_NOTAS = "notas_prueba";

export async function conectar() {
  // La base local de tests (scripts/test-db/start.sh) corre sin TLS y exporta
  // PGSSLMODE=disable; cualquier otra base va con TLS (certificado propio).
  const ssl = process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false };
  const client = new Client({ ssl });
  await client.connect();
  return client;
}

async function identidad(client: Client, userId: string | null) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "",
  ]);
}

/**
 * Ejecuta una consulta con la identidad de un usuario (auth.uid()).
 * Los triggers de negocio y las funciones de RLS leen esta identidad.
 */
export async function comoUsuario<T = unknown>(
  client: Client,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await identidad(client, userId);
  const res = await client.query(sql, params);
  return res.rows as T[];
}

/** Evalúa una expresión booleana de política RLS con la identidad indicada. */
export async function evaluarPolitica(
  client: Client,
  userId: string,
  expresion: string,
  params: unknown[] = [],
): Promise<boolean> {
  const filas = await comoUsuario<{ ok: boolean }>(
    client,
    userId,
    `SELECT (${expresion}) AS ok`,
    params,
  );
  return filas[0].ok;
}

/**
 * Devuelve el mensaje de error de una operación que se espera que falle.
 * Usa un savepoint para que la transacción siga utilizable después del fallo.
 */
export async function esperaError(client: Client, fn: () => Promise<unknown>): Promise<string> {
  await client.query("SAVEPOINT sp_error");
  try {
    await fn();
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT sp_error");
    return (e as Error).message;
  }
  await client.query("RELEASE SAVEPOINT sp_error");
  throw new Error("Se esperaba un error de permisos y la operación fue permitida.");
}

/**
 * Igual que `esperaError`, pero devuelve también el SQLSTATE del fallo.
 * Hay contratos que dependen del código y no del texto: `consumirInsumos`
 * saltea un insumo puntual cuando el error es 23514 y revienta el tratamiento
 * entero con cualquier otro, así que un cambio de código lo rompe en silencio.
 */
export async function esperaFallo(
  client: Client,
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  await client.query("SAVEPOINT sp_fallo");
  try {
    await fn();
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT sp_fallo");
    const err = e as Error & { code?: string };
    return { code: err.code ?? "", message: err.message };
  }
  await client.query("RELEASE SAVEPOINT sp_fallo");
  throw new Error("Se esperaba que la operación fallara y fue aceptada.");
}

/**
 * Crea una clínica con un miembro por rol, una nota clínica y su espejo temporal.
 * Todo ocurre dentro de la transacción abierta por el test (se revierte al final).
 */
export async function sembrarEscenario(
  client: Client,
  estado: EstadoNota = {},
): Promise<Escenario> {
  const clinicId = randomUUID();
  const roles: Rol[] = ["owner", "admin", "dentist", "assistant", "reception", "accounting"];
  const usuarios: Record<string, string> = {};
  for (const rol of roles) usuarios[rol] = randomUUID();
  usuarios.dentist2 = randomUUID();
  usuarios.externo = randomUUID();

  await client.query(
    `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Clínica Test', $2)`,
    [clinicId, usuarios.owner],
  );
  // El trigger de clínicas ya inserta al owner; el resto se agrega explícitamente.
  await client.query(
    `INSERT INTO public.clinic_members (clinic_id, user_id, role)
     SELECT $1, u.user_id, u.role::public.app_role
     FROM unnest($2::uuid[], $3::text[]) AS u(user_id, role)
     ON CONFLICT DO NOTHING`,
    [clinicId, [...roles.map((r) => usuarios[r]), usuarios.dentist2], [...roles, "dentist"]],
  );

  const patientRef = "pac-test";
  const noteId = randomUUID();
  const reviewerId = estado.reviewerKey ? usuarios[estado.reviewerKey] : null;
  const requesterId = estado.requesterKey ? usuarios[estado.requesterKey] : null;
  await client.query(
    `INSERT INTO public.clinical_notes
       (id, clinic_id, patient_ref, title, content, status, created_by,
        review_status, reviewer_id, review_requested_by, review_requested_at)
     VALUES ($1,$2,$3,'Nota de prueba','Contenido inicial',$4,$5,$6,$7,$8, CASE WHEN $6 = 'pending' THEN now() END)`,
    [
      noteId,
      clinicId,
      patientRef,
      estado.status ?? "draft",
      usuarios.dentist,
      estado.reviewStatus ?? "none",
      reviewerId,
      requesterId,
    ],
  );

  await client.query(
    `CREATE TEMP TABLE ${TABLA_NOTAS} (LIKE public.clinical_notes INCLUDING ALL) ON COMMIT DROP`,
  );
  await client.query(
    `CREATE TRIGGER tg_enforce BEFORE UPDATE ON ${TABLA_NOTAS}
       FOR EACH ROW EXECUTE FUNCTION public.enforce_clinical_note_update()`,
  );
  await client.query(
    `INSERT INTO ${TABLA_NOTAS} SELECT * FROM public.clinical_notes WHERE id = $1`,
    [noteId],
  );

  return { clinicId, usuarios, noteId, patientRef };
}

/** Cambia el estado de la nota espejo sin identidad (simula el rol de servicio). */
export async function comoServicio(client: Client, sql: string, params: unknown[] = []) {
  await identidad(client, null);
  await client.query(sql, params);
}
