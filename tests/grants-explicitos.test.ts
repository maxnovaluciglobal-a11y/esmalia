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
// Las migraciones anteriores se aplicaron antes del cambio: sus tablas ya
// tienen los permisos por defecto en producción.
const DESDE_VERSION = "20261107000000";

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z0-9_]+)\1/gi;

function otorgaA(sql: string, tabla: string, rol: string): boolean {
  const re = new RegExp(
    `grant\\s+[a-z_,\\s]+\\s+on\\s+(?:table\\s+)?(?:[a-z0-9_.,\\s"]*?)public\\.("?)${tabla}\\1\\b[^;]*\\bto\\b[^;]*\\b${rol}\\b`,
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
