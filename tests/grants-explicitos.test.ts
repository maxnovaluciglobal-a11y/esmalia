import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Desde el 30-oct-2026 Supabase deja de dar acceso automático de la Data API
 * (supabase-js, PostgREST) a las tablas NUEVAS del schema `public` en
 * proyectos existentes: sin un GRANT explícito, la API responde
 * "permission denied" aunque la RLS lo permita.
 *
 * La base efímera de los tests sí da esos permisos por defecto
 * (`scripts/test-db/preseed.sql`, ALTER DEFAULT PRIVILEGES), así que la suite
 * no se entera: la tabla funciona en CI y falla en producción. Este test lo
 * convierte en un check: toda migración desde la Ola 11 que crea una tabla en
 * `public` le otorga en el mismo archivo permisos a `authenticated` y a
 * `service_role`.
 *
 * Una tabla que a propósito solo toca el servidor puede omitir el GRANT a
 * `authenticated` con un comentario `-- sin-grant-authenticated: <motivo>` en
 * la migración (el de `service_role` es siempre obligatorio).
 */

const DIR_MIGRACIONES = new URL("../supabase/migrations/", import.meta.url);
// Desde esta versión el GRANT tiene que estar en el MISMO archivo que crea la
// tabla. Las anteriores se aplicaron antes del cambio y en producción sus tablas
// funcionan por los permisos por defecto; su hueco conocido está congelado en el
// segundo bloque de este archivo.
const DESDE_VERSION = "20261107000000";

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z0-9_]+)\1/gi;

function otorgaA(sql: string, tabla: string, rol: string): boolean {
  const re = new RegExp(
    `grant\\s+[a-z_,\\s]+(?:\\([^)]*\\)\\s*)?on\\s+(?:table\\s+)?(?:[a-z0-9_.,\\s"]*?)public\\.("?)${tabla}\\1\\b[^;]*\\bto\\b[^;]*\\b${rol}\\b`,
    "i",
  );
  return re.test(sql);
}

function migracionesNuevas(): { archivo: string; sql: string }[] {
  return readdirSync(DIR_MIGRACIONES)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= DESDE_VERSION)
    .sort()
    .map((archivo) => ({ archivo, sql: readFileSync(new URL(archivo, DIR_MIGRACIONES), "utf8") }));
}

describe("GRANT explícito en tablas nuevas de public (cambio de Supabase del 30-oct-2026)", () => {
  it("el detector reconoce un GRANT y su ausencia", () => {
    const sql =
      "create table public.x (id int);\ngrant select, insert on public.x to authenticated;";
    expect(otorgaA(sql, "x", "authenticated")).toBe(true);
    expect(otorgaA(sql, "x", "service_role")).toBe(false);
    expect(otorgaA("grant all on table public.x to service_role;", "x", "service_role")).toBe(true);
  });

  it("toda tabla creada desde la Ola 11 otorga permisos a authenticated y service_role", () => {
    const faltan: string[] = [];
    for (const { archivo, sql } of migracionesNuevas()) {
      const omiteAuthenticated = /--\s*sin-grant-authenticated:\s*\S/i.test(sql);
      for (const m of sql.matchAll(CREATE_TABLE)) {
        const tabla = m[2];
        if (!otorgaA(sql, tabla, "service_role"))
          faltan.push(`${archivo}: ${tabla} → service_role`);
        if (!omiteAuthenticated && !otorgaA(sql, tabla, "authenticated")) {
          faltan.push(`${archivo}: ${tabla} → authenticated`);
        }
      }
    }
    expect(
      faltan,
      `Agrega en la misma migración: grant ... on public.<tabla> to authenticated; grant all on public.<tabla> to service_role;`,
    ).toEqual([]);
  });
});

describe("tablas anteriores a la Ola 11 (se crearon cuando el permiso venía por defecto)", () => {
  // Foto del 28-oct-2026: tablas creadas antes de DESDE_VERSION que ninguna migración
  // otorga a `service_role`. En producción funcionan por los permisos por defecto de
  // Supabase; en un proyecto NUEVO armado desde las migraciones (restauración de un
  // desastre) el servidor no las podría leer. No se corrige con una migración porque
  // (1) no está comprobado desde cuándo un proyecto nuevo sale sin permisos por defecto
  // y (2) varias migraciones revocan a propósito permisos de estas tablas, así que un
  // GRANT en bloque cambiaría su modelo de acceso. Lo que sí hace el test: que la lista
  // no crezca (una tabla nueva anterior a DESDE_VERSION no puede existir) y que, si
  // alguien la corrige, la lista se achique. Ver docs/DISASTER_RECOVERY.md.
  const LEGADAS_SIN_GRANT_A_SERVICE_ROLE = [
    "cash_registers",
    "clinic_counters",
    "clinic_patient_options",
    "import_batch_changes",
    "import_batches",
    "lifecycle_emails",
    "marketing_events",
    "marketing_leads",
    "online_booking_settings",
    "online_booking_verifications",
    "ortho_cases",
    "ortho_controls",
    "patient_document_bidx",
    "procedure_supplies",
    "stripe_events",
    "subscriptions",
    "trial_extensions",
    "whatsapp_credentials",
  ];

  it("la foto de legadas sin GRANT a service_role coincide con las migraciones", () => {
    const todas = readdirSync(DIR_MIGRACIONES)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((archivo) => ({
        archivo,
        sql: readFileSync(new URL(archivo, DIR_MIGRACIONES), "utf8"),
      }));
    const total = todas.map((m) => m.sql).join("\n");
    const actuales = new Set<string>();
    for (const { archivo, sql } of todas) {
      if (archivo.slice(0, 14) >= DESDE_VERSION) continue;
      for (const m of sql.matchAll(CREATE_TABLE)) {
        if (!otorgaA(total, m[2], "service_role")) actuales.add(m[2]);
      }
    }
    expect([...actuales].sort()).toEqual([...LEGADAS_SIN_GRANT_A_SERVICE_ROLE].sort());
  });
});
