# Backups de Esmalia

## Qué respalda y qué no

- **Esquema** (tablas, columnas, triggers, RLS, funciones): ya vive versionado en `supabase/migrations/` — eso es su backup, no hace falta duplicarlo.
- **Data** (pacientes, citas, notas clínicas, pagos, todo lo que no está en git): la respalda `scripts/backup-data.mjs`, que exporta las tablas de negocio vía la API REST de Supabase (service role, no necesita la contraseña directa de Postgres). La lista vive en `scripts/backup-tables.mjs`.
- **Usuarios de auth** (`auth.users`): desde el 10-oct-2026 van en el mismo JSON, bajo `auth_users`, exportados con `supabase.auth.admin.listUsers` (paginado): `id`, `email`, `phone`, `created_at`, `email_confirmed_at`, `phone_confirmed_at`, `last_sign_in_at`, `banned_until`, `user_metadata`, `app_metadata` e `identity_providers` (`email`, `google`…). **Sin hashes de contraseña**: la API de admin no los devuelve (y tampoco tokens ni factores MFA). Un usuario restaurado entra con Google o con "olvidé mi contraseña". Hasta esa fecha el backup NO tenía usuarios: restaurarlo dejaba a `profiles`/`clinic_members` apuntando a ids que no existían y nadie podía iniciar sesión.
- **Archivos de Storage**: desde el 10-oct-2026, `scripts/backup-storage.mjs` recorre **todos** los buckets (`listBuckets`; hoy solo `clinical-documents`, privado: radiografías, imágenes, PDFs y firmas de presupuesto en `{clinic_id}/{patient_id}/…`), lista cada uno recursivamente y baja cada archivo. Se empaqueta en un `storage.tar.gz` aparte, con un `manifest.json` (bucket, ruta, tamaño, mimetype y la lista `failed`). Si falla un **listado**, el job queda en rojo; si falla la **descarga de un archivo**, se saltea, queda en `failed` y sale como `::warning::` en el run.
- **Qué sigue sin respaldarse**:
  - **La clave de Vault `esmalia_document_id_key`** (cifra `patients.document_id_enc` y firma `document_id_hash`). El backup trae esas columnas tal como están en la base, cifradas: sin la clave son ilegibles. Hoy no se pierde nada porque `document_id` en texto plano sigue siendo la fuente de verdad (Fase 1 de security-6), pero el día que se corte el texto plano, **la clave tiene que tener su propio respaldo** (guardarla junto a la clave de age en iCloud) o un restore pierde los RUT. En un proyecto nuevo sin la clave vieja: crear una nueva, dejar `document_id_enc`/`document_id_hash` en NULL y re-poblarlos con `set_patient_document_id` desde `document_id`.
  - Configuración del proyecto Supabase que no es SQL: proveedores de auth (Google OAuth, URLs de redirección), plantillas de email de auth (se cargan con `scripts/plantillas-auth-supabase.mjs`), SMTP, secretos de Edge Functions, variables de Vercel.
- **Que la lista esté completa no depende de que alguien se acuerde**: `tests/backup-tables-sync.test.ts` compara esa lista contra los `CREATE TABLE` de `supabase/migrations/` y falla el CI nombrando la tabla que falte. Se agregó el 06-sep-2026, después de que el mismo olvido pasara dos veces (`procedure_supplies` e `inventory_counts` se crearon ese día y quedaron fuera del backup, con el workflow en verde). Si alguna tabla no se debe respaldar, va en `EXCLUDED_TABLES` con el motivo escrito.

## Cómo funciona el automático

`.github/workflows/backup.yml` corre todos los días a las 07:15 UTC (~madrugada Chile):

1. `scripts/backup-data.mjs` exporta todas las tablas + `auth_users` a un JSON gzipeado.
2. `scripts/backup-storage.mjs` baja todos los archivos de Storage y se empaquetan en `storage.tar.gz`.
3. Los dos se cifran con `age` usando la clave pública de Esmalia (hardcodeada en el workflow — es pública, no es secreto).
4. Se suben a Backblaze B2: `<B2_BUCKET>/db/esmalia_<stamp>.json.gz.age` y `<B2_BUCKET>/storage/esmalia_storage_<stamp>.tar.gz.age`. ⚠️ Si la Application Key de B2 está restringida a un prefijo (`db/`), hay que ampliarla a todo el bucket o la subida de `storage/` falla. La regla de lifecycle de 90 días aplica a los dos prefijos.

También se puede disparar a mano desde GitHub → Actions → "Backup diario" → Run workflow.

## Setup (hecho)

Bucket privado en Backblaze B2 (su nombre está en la variable de Actions `B2_BUCKET`) con una Application Key restringida a ese bucket, y los 4 secrets del workflow (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `B2_ACCOUNT_ID`, `B2_APPLICATION_KEY`) cargados en GitHub el 01-sep-2026. Desde entonces las corridas diarias están en verde (verificado el 06-oct-2026). Si hubiera que rehacerlo: `gh secret set <NOMBRE>` para cada uno, tomando los valores de Supabase del `.env` local.

## La clave privada de cifrado

- **Pública** (segura en el repo): `age1xrwep8wxudjt6zy0ygnqf5xzr5tmpeakmn55yt8q37lg23ewqu2q2tzvqv`
- **Privada**: generada el 2026-08-17, guardada en `~/Library/Mobile Documents/com~apple~CloudDocs/esmalia-backups/.esmalia-backup-age.key` (iCloud Drive de Walter, `chmod 600`). Sin ella, los `.json.gz.age` en B2 son ilegibles — no hay forma de recuperarla si se pierde.
- Verificada por round-trip real el 2026-08-17: descifrado + descomprimido un backup real, confirmadas 33 tablas / 115 filas incluyendo el nombre de un paciente real.

**Si hay que rotar la clave** (sospecha de compromiso): `age-keygen` una nueva, actualizar la pública en `backup.yml`, guardar la privada nueva junto a la vieja (los backups viejos solo se leen con la vieja).

## Cómo restaurar

Lo más rápido para practicar o verificar un backup: `scripts/simulacro/simulacro.sh` (Supabase efímero en Docker, ver "Simulacro automático") o `scripts/restore-drill.sh` (Postgres pelado, ver "Ensayo de restauración"). Hace los pasos de esta sección contra un Postgres local descartable, verifica conteos e integridad, y borra todo al terminar.

```bash
# 1) Bajar el backup cifrado de B2 (o usar el botón "download" en el dashboard de B2)
rclone copy b2:<B2_BUCKET>/db/esmalia_YYYYMMDD_HHMMSS.json.gz.age /tmp/

# 2) Descifrar + descomprimir
age -d -i ~/Library/"Mobile Documents"/com~apple~CloudDocs/esmalia-backups/.esmalia-backup-age.key \
  /tmp/esmalia_YYYYMMDD_HHMMSS.json.gz.age | gunzip > /tmp/esmalia-restore.json

# 3) El JSON tiene forma { exportedAt, tables: { patients: [...], ... }, auth_users: [...] }
#    No es un dump SQL: se corre primero el esquema (supabase/migrations/ con
#    `psql -f`, una por una, en orden) y después se re-insertan las filas.
#    El SQL de carga probado está en scripts/simulacro/cargar-datos.sql
#    (TRUNCATE de lo sembrado + INSERT … jsonb_populate_recordset por tabla con
#    session_replication_role = replica, y secuencias al máximo). Contra un
#    Supabase real: usuarios primero (ver abajo), después ese paso 3.
```

### Restaurar usuarios de auth

`supabase.auth.admin.createUser` **acepta `id`** (`AdminUserAttributes.id` en `@supabase/auth-js` 2.110: "The `id` for the user"). Así cada usuario vuelve con el mismo UUID y no hay que remapear `profiles.id`, `clinic_members.user_id`, `professionals.user_id`, `created_by`, etc.

```js
// Una vez, contra el proyecto NUEVO, ANTES de cargar las tablas. El trigger
// on_auth_user_created va a crear filas en profiles: no importa, la carga
// hace TRUNCATE de profiles y pone las del backup.
for (const u of backup.auth_users) {
  const { error } = await admin.auth.admin.createUser({
    id: u.id,
    email: u.email ?? undefined,
    phone: u.phone ?? undefined,
    email_confirm: Boolean(u.email_confirmed_at), // no mandarles un mail de confirmación
    user_metadata: u.user_metadata,
    app_metadata: u.app_metadata,
    // sin password: no hay hash que restaurar
  });
  if (error) console.error(u.id, error.message); // solo el id, nunca el email en logs de CI
}
```

- Sin contraseña: quien entraba con email+password usa "olvidé mi contraseña" (avisar a las clínicas). Quien entraba con Google entra igual, siempre que el OAuth de Google esté configurado en el proyecto nuevo con la misma cuenta de Google Cloud (la identidad se re-vincula por email en el primer login).
- Si una versión futura de GoTrue dejara de aceptar `id`: crear sin `id`, armar un mapa `viejo → nuevo` y reescribir con SQL todas las columnas que guardan un user id (`profiles.id`, `*.user_id`, `created_by`, `confirmed_by`, `counted_by`, `actor_id`) antes de cargar.
- Backups anteriores al 10-oct-2026 no traen `auth_users`: los ids siguen en `profiles` y `clinic_members`, pero los emails solo están en `profiles.email` (si se llenó). Se pueden crear usuarios desde ahí y re-invitar.

### Restaurar archivos de Storage

```bash
age -d -i <clave> esmalia_storage_<stamp>.tar.gz.age | tar -xzf - -C /tmp/storage-restore
# /tmp/storage-restore/manifest.json  → buckets, rutas, tamaños, `failed`
# /tmp/storage-restore/<bucket>/<ruta> → el archivo
```

El bucket `clinical-documents` lo crea la migración `20260826200000` (con sus límites de tamaño y mimetypes). Después, por cada objeto del manifest: `admin.storage.from(bucket).upload(path, bytes, { contentType: mimetype, upsert: false })` con service role. Las rutas son `{clinic_id}/{patient_id}/…`, así que las policies de RLS vuelven a funcionar sin tocar nada, y `patient_documents.storage_path` / `quotes` siguen apuntando bien. Revisar `failed` del manifest: esos archivos no están en este backup (buscar en uno anterior).

## Simulacro automático (SEG-05)

Desde el 27-oct-2026 el ensayo de restauración corre solo: `.github/workflows/simulacro-restauracion.yml`, **el día 3 de cada mes a las 10:00 UTC** (después del backup de las 07:15) y a mano desde GitHub → Actions → "Simulacro de restauración" → Run workflow.

**Qué hace** (`scripts/simulacro/simulacro.sh`, el ensayo del 10-oct llevado a un Supabase de verdad):

1. Baja de B2 el último `db/esmalia_<sello>.json.gz.age` y su gemelo `storage/esmalia_storage_<sello>.tar.gz.age`.
2. Los descifra con `age` y levanta un **Supabase efímero en Docker dentro del runner** (db, auth, rest, storage; `scripts/simulacro/levantar.sh`) con `preseed.sql` y las migraciones una por una en autocommit. **Nunca producción**: los pasos que escriben se niegan si `SUPABASE_URL` no es `127.0.0.1`.
3. Recrea los usuarios con `auth.admin.createUser` y **su mismo id** (`restaurar-auth.mjs`), carga las tablas con el mismo SQL que el ensayo manual (`scripts/simulacro/cargar-datos.sql`, que ahora usa también `restore-drill.sh`) y sube los archivos con la API de Storage (`restaurar-storage.mjs`).
4. Verifica (`verificar.sql` + `evaluar.mjs`): migraciones sin error, **conteo de cada tabla igual al del backup**, **0 filas huérfanas** en todas las FKs de una columna, **todos los usuarios del backup con su id y su correo** y **cada archivo del manifiesto en su bucket con el mismo tamaño**.
5. Mide cada paso: el **RTO medido** suma bajar + descifrar + levantar y migrar + usuarios + tablas + archivos (la verificación no cuenta).
6. Apaga el Supabase descartando volúmenes y borra el directorio de trabajo y los archivos bajados.

**Dónde se ve**: el resumen del run y un artefacto `simulacro-restauracion-…` (90 días) con `reporte.md` y `reporte.json`. Solo nombres de tabla, conteos y tiempos: ningún dato de pacientes. Si falla, el job queda en rojo y abre (o comenta) un Issue con la etiqueta `simulacro-fallido`, el mismo canal que el backup diario.

**Modos**:

- **real** (el programado): necesita el secret `BACKUP_AGE_KEY`. **Mientras no esté cargado, el simulacro queda _omitido_ con el motivo en el resumen** (job `simulacro` en gris, aviso en `preparar`): ni verde falso ni rojo.
- **juguete**: arma un backup de prueba en el runner (Supabase efímero con la clínica demo que siembran las migraciones + 2 usuarios y un archivo por bucket, los scripts de backup **de verdad** y una clave `age` descartable) y lo restaura igual que el real. No usa ningún secret. Corre en cada PR que toque `scripts/simulacro/**`, los scripts de backup o `preseed.sql`, y a mano con modo `juguete`.

### Lo que falta para el modo real (solo Walter)

1. **Cargar la clave privada como secret** sin que pase por la pantalla ni por el portapapeles (solo la línea `AGE-SECRET-KEY-1…`, sin los comentarios del archivo):

   ```bash
   grep '^AGE-SECRET-KEY-1' ~/Library/"Mobile Documents"/com~apple~CloudDocs/esmalia-backups/.esmalia-backup-age.key \
     | gh secret set BACKUP_AGE_KEY --repo maxnovaluciglobal-a11y/esmalia
   ```

   Verificar con `gh secret list --repo maxnovaluciglobal-a11y/esmalia` (muestra el nombre, nunca el valor) y correr el workflow a mano en modo `real`.

2. **Que la Application Key de B2 pueda listar y leer** (`listFiles` + `readFiles`), no solo escribir. Si la key actual es de solo escritura, el paso "Bajar el último backup de B2" falla con 401: crear en Backblaze una key nueva para el mismo bucket con lectura y escritura y reemplazar `B2_ACCOUNT_ID`/`B2_APPLICATION_KEY` (o ampliar la actual).

**Qué se decide al cargarla**: con `BACKUP_AGE_KEY` en GitHub, quien pueda editar workflows del repo podría leer los backups. Es el mismo nivel de confianza que ya tiene `SUPABASE_SERVICE_ROLE_KEY` (que lee la base entera de producción), así que no agrega exposición nueva a los datos actuales; sí permite leer backups viejos de hasta 90 días. La clave solo la ve el paso que descifra, se escribe a un archivo `600` que se borra al terminar, y los PRs desde forks no reciben secrets. Si se prefiere no subirla: el modo `juguete` sigue probando el circuito todos los meses que se corra, y el real se hace en la Mac con la clave de iCloud (abajo).

### Correrlo en local

Requisitos: Docker, `age`, `node`, el Supabase CLI (global o el de `npm ci`).

```bash
# Backup de juguete (sin datos reales). SIMULACRO_PUERTO evita chocar con otro Supabase local.
SIMULACRO_PUERTO=53300 bash scripts/simulacro/juguete.sh

# Un backup real bajado de B2, con la clave de iCloud:
SIMULACRO_PUERTO=53300 bash scripts/simulacro/simulacro.sh \
  ~/Downloads/esmalia_YYYYMMDD_HHMMSS.json.gz.age \
  ~/Library/"Mobile Documents"/com~apple~CloudDocs/esmalia-backups/.esmalia-backup-age.key \
  ~/Downloads/esmalia_storage_YYYYMMDD_HHMMSS.tar.gz.age
```

El reporte queda en `./simulacro-reporte/` (cambiar con `SIMULACRO_SALIDA`). `KEEP=1` deja el Supabase arriba para inspeccionarlo (ojo: con un backup real tiene datos de pacientes; apagarlo con `supabase stop --project-id esmalia-simulacro --no-backup`).

### Primer resultado (27-oct-2026, modo juguete, local)

204 migraciones sin error · 136/136 tablas con el mismo conteo (521 filas) · 310 FKs, 0 huérfanos · 3/3 usuarios con su id · 4/4 archivos en 4 buckets. **RTO medido: 40 s**, casi todo levantar Supabase y aplicar migraciones (39 s); usuarios, tablas y archivos, menos de 1 s a este volumen. El primer simulacro con un backup real queda para cuando esté `BACKUP_AGE_KEY`.

El RTO medido es el **camino de datos**. Un incidente real suma lo que no es automatizable en un runner: crear el proyecto Supabase, configurar Google OAuth/SMTP/plantillas, cambiar las variables de Vercel y redeployar (la tabla "RTO estimado" de abajo: ~45-60 min en total).

**Cómo revertir**: borrar `.github/workflows/simulacro-restauracion.yml` (y, si se cargó, `gh secret delete BACKUP_AGE_KEY`). `scripts/simulacro/` no se ejecuta solo.

## Ensayo de restauración

### 2026-10-10 — primer ensayo, local

- **Backup usado**: `esmalia_20260818_010623.json.gz.age` (copia en iCloud; exportado 2026-08-18 01:06 UTC, formato viejo: sin `auth_users` ni Storage). 33 tablas, 115 filas (21 tablas con datos, 12 vacías).
- **Contra qué**: Postgres 16.x local descartable (Homebrew), puerto 55432, + **las 106 migraciones** de `supabase/migrations/` de `main` (esquema de octubre, datos de agosto: las columnas posteriores al backup toman su DEFAULT).
- **Cómo**: `scripts/restore-drill.sh` (queda en el repo para repetirlo).

| Paso                                                        | Tiempo    |
| ----------------------------------------------------------- | --------- |
| 1. Descifrar (age) + gunzip + contar                        | 0,0 s     |
| 2. initdb + arrancar + stubs de Supabase + 106 migraciones  | 2,4 s     |
| 3. Cargar 33 tablas + usuarios stub                         | 0,1 s     |
| 4. Verificar conteos, FKs y consultas de cordura            | 0,0 s     |
| 5. Apagar y borrar el directorio (tenía datos de pacientes) | 0,3 s     |
| **Total**                                                   | **3,0 s** |

**Resultado**: ✅ 33/33 tablas con el mismo conteo que el JSON; 145 FKs de una columna revisadas, 0 filas huérfanas; 5 pacientes en 2 clínicas; 7/7 citas con su paciente en la misma clínica; 2/2 `clinic_members` con usuario en `auth.users` **solo gracias a 4 usuarios stub** (el backup no traía `auth_users` — es el hueco que cierra el PR de este mismo cambio).

**Stubs de Supabase que necesitaron las migraciones** (lo que un Postgres pelado no tiene; un proyecto Supabase nuevo ya los trae, salvo los marcados ⚠️):

1. Roles `anon`, `authenticated`, `service_role` (BYPASSRLS), `supabase_admin`, `authenticator`, `supabase_auth_admin`, `supabase_storage_admin`, `dashboard_user` (NOLOGIN) — GRANTs y policies `TO authenticated`.
2. Schemas `extensions`, `auth`, `storage`, `vault`; `pgcrypto` y `uuid-ossp` en `extensions`, con `extensions` en el `search_path` de la base.
3. `auth.users` (columnas de GoTrue), `auth.uid()`, `auth.role()`, `auth.jwt()`, `auth.email()` — 134 usos de `auth.uid()`, FKs y el trigger `on_auth_user_created`.
4. `storage.buckets`, `storage.objects` (con RLS) y `storage.foldername()` — migración `20260826200000`.
5. `vault.secrets`, `vault.decrypted_secrets`, `vault.create_secret()` — migraciones de security-6 (`20260822150000` y siguientes). Stub **vacío**: la clave real no está en ningún backup (ver arriba).
6. Publicación `supabase_realtime` — `20260726161056` hace `ALTER PUBLICATION supabase_realtime ADD TABLE`.
7. ⚠️ **Usuario demo `139dd209-8495-415c-b6cd-6bbc63367bad` (`demo@esmalia.com`) en `auth.users` ANTES de las migraciones**: `20261011000000` llama a `reset_demo_clinic()`, que inserta `inventory_counts.counted_by` con FK a ese usuario. En un Supabase nuevo esto **también falla**: crear ese usuario con `admin.createUser({ id: '139dd209-…', email: 'demo@esmalia.com' })` antes de aplicar migraciones.

**Fallas y hallazgos**:

- ⚠️ **`20260815160000_…b0dfed53` no es transaccional**: hace `ALTER TYPE message_template_kind ADD VALUE 'appointment_checkin'` y usa el valor en el mismo archivo. Con `psql -f` (como se aplicó a prod) pasa; dentro de una transacción (`psql -1`, y probablemente `supabase db push`) falla con _unsafe use of new value_, y arrastra a 3 migraciones posteriores. Para un restore: aplicar las migraciones con `psql -f` una por una, no con `supabase db push`. El script lo detecta solo (intenta con `-1`, reintenta sin) y lo lista.
- Las migraciones siembran datos (catálogos, plantillas, la clínica demo): el script hace `TRUNCATE … CASCADE` de las tablas del backup antes de cargar, porque el backup es la verdad. Sin eso, `message_templates` choca por clave duplicada.
- Ninguna tabla del backup de agosto falta en el esquema actual, y ninguna fila violó un NOT NULL agregado después.
- Lo que **no** se ensayó: restaurar contra un proyecto Supabase real (ahí `postgres` no es superusuario; `session_replication_role = replica` debería estar permitido para `postgres` en Supabase, verificarlo en el primer ensayo real), recrear usuarios con `admin.createUser`, y subir archivos de Storage (el backup de agosto no los tiene; el script ya verifica un `storage.tar.gz.age` si se le pasa como tercer argumento).

**RTO estimado para un restore real en un proyecto Supabase nuevo** (no medido; los pasos de base de datos sí, el resto es estimación):

| Paso                                                                                       | Estimado                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Bajar el último backup de B2 + descifrar                                                   | 2-5 min                                                                        |
| Crear proyecto Supabase (sa-east-1) y esperar que levante                                  | 3-5 min                                                                        |
| Crear usuario demo + clave de Vault nueva                                                  | 2 min                                                                          |
| Aplicar 106 migraciones con `psql -f` contra el pooler                                     | 3-5 min (local: 2,4 s; el costo es la latencia de red)                         |
| Cargar datos (el SQL del script, sin el bootstrap de stubs)                                | < 1 min al volumen actual                                                      |
| Recrear usuarios con `admin.createUser` (con `id`)                                         | 2-5 min                                                                        |
| Subir Storage                                                                              | depende del volumen; minutos hoy                                               |
| Configurar Google OAuth, SMTP/plantillas, cambiar `SUPABASE_URL`/keys en Vercel + redeploy | 15-20 min                                                                      |
| Smoke test (login, ficha de paciente, documento)                                           | 10 min                                                                         |
| **Total**                                                                                  | **~45-60 min**, dominado por pasos manuales de configuración, no por los datos |

**RPO**: hasta 24 h (backup diario a las 07:15 UTC). **Conclusión**: el backup de agosto se restaura completo y consistente; el camino de base de datos está probado y automatizado. Los huecos que quedaban eran usuarios de auth y archivos de Storage (cerrados por este cambio, falta su primer ensayo con un backup nuevo) y la clave de Vault (sigue abierta). Repetir el ensayo con el primer backup que traiga `auth_users` y `storage.tar.gz.age`:

```bash
scripts/restore-drill.sh \
  ~/Downloads/esmalia_YYYYMMDD_HHMMSS.json.gz.age \
  ~/Library/"Mobile Documents"/com~apple~CloudDocs/esmalia-backups/.esmalia-backup-age.key \
  ~/Downloads/esmalia_storage_YYYYMMDD_HHMMSS.tar.gz.age
```

Requisitos: `age`, `node`, Postgres 16 en `/opt/homebrew/opt/postgresql@16/bin` (o `PGBIN=`). Solo imprime nombres de tabla y conteos; borra su directorio de trabajo al terminar (`KEEP=1` para inspeccionarlo, ojo que tiene datos reales).

## Bitácora

- **2026-08-17**: primer backup manual hecho a mano (no por el workflow, que todavía no tiene los secrets) — 33 tablas, 115 filas, verificado por round-trip. Cierra el riesgo de "cero backups con pacientes reales en prod" mientras se completa el setup de B2. Guardado también en iCloud junto a la clave privada (redundancia geográfica real desde el día uno, no solo local).
- **2026-10-10**: el backup suma `auth_users` y los archivos de Storage (`storage.tar.gz.age` en `b2:<B2_BUCKET>/storage/`). Primer ensayo de restauración, local, con el backup del 18-ago: 3,0 s, 33/33 tablas, 0 huérfanos (ver "Ensayo de restauración").
- **2026-10-27**: simulacro de restauración automático y mensual (SEG-05, `.github/workflows/simulacro-restauracion.yml`) sobre un Supabase efímero en el runner. Primer resultado en modo juguete: 40 s, todo verde. El modo real espera el secret `BACKUP_AGE_KEY` (ver "Simulacro automático").
