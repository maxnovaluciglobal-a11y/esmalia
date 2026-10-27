// Paso del simulacro: recrea los usuarios de auth del backup con su MISMO id
// (auth.admin.createUser acepta `id`), como se haría en un proyecto nuevo.
// Ver docs/BACKUPS.md → "Restaurar usuarios de auth".
//
// Solo contra la base efímera: se niega si SUPABASE_URL no es local.
// Nunca imprime correos: solo conteos y, si falla uno, su id.
//
// Uso: SUPABASE_URL=http://127.0.0.1:… SUPABASE_SERVICE_ROLE_KEY=… node restaurar-auth.mjs <backup.json>
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { exigirBaseLocal } from "./local.mjs";

const [jsonPath] = process.argv.slice(2);
const url = exigirBaseLocal(process.env.SUPABASE_URL);
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const doc = JSON.parse(readFileSync(jsonPath, "utf8"));
if (!Array.isArray(doc.auth_users)) {
  console.log("  backup sin auth_users (anterior al 10-oct-2026): no hay usuarios que recrear");
  process.exit(0);
}

let creados = 0;
let yaExistian = 0;
let fallidos = 0;
for (const u of doc.auth_users) {
  const { error } = await admin.auth.admin.createUser({
    id: u.id,
    email: u.email ?? undefined,
    phone: u.phone ?? undefined,
    email_confirm: Boolean(u.email_confirmed_at),
    phone_confirm: Boolean(u.phone_confirmed_at),
    user_metadata: u.user_metadata ?? {},
    app_metadata: u.app_metadata ?? {},
  });
  if (!error) {
    creados++;
    continue;
  }
  // La cuenta demo la siembra preseed.sql antes de las migraciones (igual que en producción).
  const { data } = await admin.auth.admin.getUserById(u.id);
  if (data?.user?.id === u.id) {
    yaExistian++;
  } else {
    fallidos++;
    console.error(`  no se pudo crear el usuario ${u.id}: ${error.message}`);
  }
}
console.log(
  `  usuarios de auth: ${creados} creados con su id, ${yaExistian} ya existían, ${fallidos} fallidos`,
);
// No sale con error: el veredicto lo da evaluar.mjs con todas las mediciones juntas.
