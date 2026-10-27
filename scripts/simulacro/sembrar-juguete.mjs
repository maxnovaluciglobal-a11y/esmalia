// Siembra el Supabase efímero de origen del backup de juguete (juguete.sh):
// 2 usuarios de prueba (correos @example.invalid) y un archivo de prueba en
// cada bucket. Las tablas ya traen la clínica demo que siembran las migraciones.
import { createClient } from "@supabase/supabase-js";
import { exigirBaseLocal } from "./local.mjs";

const url = exigirBaseLocal(process.env.SUPABASE_URL);
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

for (const n of [1, 2]) {
  const { error } = await admin.auth.admin.createUser({
    email: `simulacro-${n}@example.invalid`,
    email_confirm: true,
    user_metadata: { full_name: `Usuario de simulacro ${n}` },
  });
  if (error) throw new Error(`usuario de prueba ${n}: ${error.message}`);
}

const { data: buckets, error } = await admin.storage.listBuckets();
if (error) throw new Error(`listBuckets: ${error.message}`);
for (const b of buckets) {
  // Ruta con la forma real {clinic_id}/{patient_id}/archivo, con ids inventados,
  // y un tipo que el bucket acepte (cada bucket limita sus mimetypes).
  const permitidos = b.allowed_mime_types ?? [];
  const usaPng = permitidos.length > 0 && !permitidos.includes("application/pdf");
  const ruta = `00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/simulacro.${usaPng ? "png" : "pdf"}`;
  const bytes = usaPng
    ? Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      )
    : Buffer.from("%PDF-1.4\n% archivo de prueba del simulacro de restauracion\n%%EOF\n");
  const { error: upError } = await admin.storage
    .from(b.id)
    .upload(ruta, bytes, { contentType: usaPng ? "image/png" : "application/pdf", upsert: true });
  if (upError) throw new Error(`archivo de prueba en ${b.id}: ${upError.message}`);
}
console.log(`  sembrado: 2 usuarios de prueba y 1 archivo en ${buckets.length} buckets`);
