// Paso del simulacro: sube a la base efímera cada archivo del backup de
// Storage (storage.tar.gz ya extraído), en su bucket y su ruta original.
// Ver docs/BACKUPS.md → "Restaurar archivos de Storage".
//
// Si el bucket no existe en la base efímera (lo crean las migraciones; un
// bucket nuevo que no venga de una migración sí puede faltar), lo crea con la
// configuración del manifiesto.
//
// Uso: SUPABASE_URL=http://127.0.0.1:… SUPABASE_SERVICE_ROLE_KEY=… node restaurar-storage.mjs <dir extraído>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isSafeRelativePath } from "../backup-lib.mjs";
import { exigirBaseLocal } from "./local.mjs";

const [dir] = process.argv.slice(2);
const url = exigirBaseLocal(process.env.SUPABASE_URL);
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const { data: existentes, error: listError } = await admin.storage.listBuckets();
if (listError) {
  console.error(`  listBuckets: ${listError.message}`);
  process.exit(1);
}
const ids = new Set(existentes.map((b) => b.id));

let subidos = 0;
let fallidos = 0;
for (const bucket of manifest.buckets) {
  if (!ids.has(bucket.id)) {
    const { error } = await admin.storage.createBucket(bucket.id, {
      public: Boolean(bucket.public),
      fileSizeLimit: bucket.file_size_limit ?? undefined,
      allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
    });
    if (error) {
      console.error(`  no se pudo crear el bucket ${bucket.id}: ${error.message}`);
      fallidos += bucket.objects.length;
      continue;
    }
    console.log(`  bucket ${bucket.id} creado (no venía de una migración)`);
  }
  for (const obj of bucket.objects) {
    if (!isSafeRelativePath(obj.path)) {
      fallidos++;
      continue;
    }
    const bytes = readFileSync(join(dir, bucket.id, obj.path));
    const { error } = await admin.storage.from(bucket.id).upload(obj.path, bytes, {
      contentType: obj.mimetype ?? undefined,
      upsert: false,
    });
    if (error) {
      fallidos++;
      // La ruta es {clinic_id}/{patient_id}/…: ids técnicos, sin nombre de archivo.
      console.error(`  no se pudo subir un archivo de ${bucket.id}: ${error.message}`);
    } else {
      subidos++;
    }
  }
}
console.log(`  storage: ${subidos} archivos subidos, ${fallidos} fallidos`);
