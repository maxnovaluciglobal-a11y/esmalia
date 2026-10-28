# Disaster Recovery — Esmalia

Runbook para escenarios de falla operacional. Autoridad: Walter (dueño del proyecto; contacto en el plan de continuidad, fuera del repo).

---

## Escenarios y respuesta

### 1. Base de datos corrupta o borrada accidentalmente

**Síntomas:** las tablas devuelven `PGRST116` o vacías; miembros no pueden iniciar sesión.

**Recuperación:**

1. ✅ **Actualizado 2026-09-05 — esto ya NO describe la situación real.** Desde el 2026-09-01 corre un backup diario propio (`.github/workflows/backup.yml`, 07:15 UTC): exporta todas las tablas de negocio vía API REST de Supabase (`service_role`), cifra con `age` y sube a Backblaze B2 (`b2:<B2_BUCKET>/db/`). La lista de tablas del script (`scripts/backup-data.mjs`) estaba desactualizada desde el 22-ago (excluía 22 tablas nuevas, incluidas `patient_medical_history`/`patient_consents`/`patient_documents`) — corregido hoy mismo. `pitr_enabled` sigue en `false` (Supabase plan actual no lo incluye) — el backup diario es la única cobertura, no hay recuperación a un punto intermedio del día.
2. Restauración: documentada paso a paso en `docs/BACKUPS.md` (recrear schema con las migraciones, recrear usuarios con su id, reinsertar cada tabla del JSON descifrado y subir los archivos). El camino de datos está **ensayado y automatizado**: ensayo manual del 10-oct-2026 (`scripts/restore-drill.sh`) y, desde el 27-oct-2026, **simulacro mensual** en un Supabase efímero (`.github/workflows/simulacro-restauracion.yml`, ver "Procedimiento: simulacro de restauración" abajo). Lo que sigue sin ensayarse es la parte manual: crear el proyecto Supabase nuevo y repuntar Vercel.
3. Si el backup del día también fallara (o el bucket B2 no fuera accesible), la única recuperación posible es reconstruir desde las migraciones versionadas en `supabase/migrations/` (ver `CLAUDE.md` regla 5) — esto reconstruye el **schema**, no los **datos**.
4. Los seeds iniciales se recuperan solos al re-ejecutar las migraciones: el trigger `on_clinic_created` → `handle_new_clinic()` (definido en `20260726145220`, última redefinición en `20260816170100`) siembra automáticamente los `procedures` default y las 14 `message_templates` de WhatsApp en **cualquier clínica nueva** que se cree.
5. El proyecto huérfano de Lovable Cloud (`9f5bde21-...`) es un snapshot congelado al 2026-08-14 — cada vez más desactualizado, no reemplaza al backup diario.

**Datos que se perderían (RPO real hoy):** hasta 24 horas — todo lo escrito entre la última corrida exitosa del backup (07:15 UTC) y el momento de la falla. Antes del 2026-09-01 no había backup alguno; ese hueco (14-ago a 01-sep) no es recuperable retroactivamente.

---

### 2. Deploy en Vercel roto

**Síntomas:** el sitio en producción tira 500 en todas las rutas, o carga en blanco.

**Recuperación:**

1. Vercel guarda historial de deploys. Ir al dashboard del proyecto → Deployments → identificar el último deploy que funcionaba → "Promote to Production".
2. Si el problema es un env var mal seteado, corregir en Vercel → Settings → Environment Variables y redeploy.
3. Si el problema es una migración que dejó la DB en estado incompatible con el código anterior, es un DR de DB (ver #1) — no basta con rollback de Vercel.

**Prevención:** cada deploy corre en preview antes de merge; nunca hacer push directo a main sin verificar en local + preview.

---

### 3. Credenciales de Supabase comprometidas

**Síntomas:** actividad sospechosa en logs (queries desde IPs raras), o alguien te avisó que la `SERVICE_ROLE_KEY` está en un repo público.

**Recuperación:**

1. Rotar las keys desde el dashboard de Supabase. Esto invalida todas las sesiones activas — los usuarios tendrán que re-loguear.
2. Actualizar `.env` local + Vercel env vars con las keys nuevas.
3. Auditar `pg_stat_activity` y las tablas sensibles (`clinical_notes`, `payments`, `patients`) por accesos anómalos en las últimas 24-48 hrs.
4. Si hubo lectura de datos de pacientes, seguir el escenario 8 (brecha de datos de salud).

**Prevención:** `.env` ya está gitignoreado. `SERVICE_ROLE_KEY` no está en el repo (solo `PUBLISHABLE_KEY` que es pública por diseño). Revisar `git log --all --full-history -- .env` periódicamente por accidentes históricos.

---

### 4. Sync con Lovable roto

**Síntomas:** Lovable no reconoce commits recientes; el editor visual muestra estado viejo.

**Recuperación:**

1. Nunca hacer `git push --force` a `main` (regla ya documentada en `AGENTS.md`). Si alguien lo hizo, restaurar desde el reflog local o desde otro clone.
2. Si el repo GitHub y Lovable divergieron: en el editor de Lovable, "Reconnect GitHub" y elegir mantener el estado del repo (no el de Lovable).
3. Si es imposible reconectar, exportar de Lovable como ZIP fallback y re-arrancar sync después de aplicar diffs manualmente.

**Prevención:** trabajar siempre por commits desde local; usar Lovable solo para lectura visual o cuando explícitamente se quiere que Lovable genere.

---

### 5. Vercel caído o cuenta suspendida

**Síntomas:** dominio principal no responde; Vercel manda email de billing.

**Recuperación temporal (mismo día):**

1. Desplegar en emergencia a otro provider: Cloudflare Pages, Netlify, o self-hosted en el VPS `91.99.204.162` (ver `~/.claude/projects/-Users-walterlamadriz-Documents/memory/user_business_context.md`).
2. Apuntar `esmalia.com` (y `www`) al host de respaldo cambiando los registros en Cloudflare (DNS de `esmalia.com` desde el 09-oct-2026). Propagación 5-60 min.
3. Verificar que las env vars de producción estén replicadas en el nuevo host.

**Prevención:** mantener `Dockerfile` funcional (ya existe) para deploy en cualquier docker host como fallback siempre disponible.

---

### 6. Lovable Cloud cerrado / Lovable AI abandonado

**Síntomas:** Lovable cierra el servicio o cambia términos incompatibles.

**Recuperación:**

1. Extraer el schema completo del Supabase de Lovable: `pg_dump` vía RPC o `supabase db dump` si migramos a Supabase self-hosted.
2. Crear proyecto Supabase propio (self-hosted en VPS o cloud oficial de Supabase).
3. Aplicar migraciones + restaurar datos.
4. Actualizar `.env` con nueva `SUPABASE_URL` + keys.
5. Perder: AI Gateway (Gemini + OpenAI fallback) — reconfigurar directo con las APIs de cada proveedor.

**Preparación:** los archivos `supabase/migrations/` son la fuente de verdad del schema; no hay migraciones "solo en Lovable". La app puede correr contra cualquier Postgres 15+ con las extensiones estándar.

---

### 7. Ataque de rate limit / DDoS

**Síntomas:** el sitio va lento; costos de Vercel/Supabase suben.

**Recuperación:**

1. El DNS de `esmalia.com` ya está en Cloudflare (09-oct-2026, registros en modo _DNS only_): la mitigación inmediata es activar el proxy de Cloudflare en esos registros. el dominio `.vercel.app` original queda fuera de esa protección.
2. Bloquear IPs en el firewall del Supabase (via Lovable soporte).
3. ✅ Actualizado 2026-09-05: `_serverFn/*` y `/api/*` (excepto los webhooks de Stripe/Meta, protegidos por firma) tienen un rate-limit por IP desde `src/server.ts` (`src/lib/rate-limit.server.ts`) — 180 req/min por IP en server functions, 60 req/min en API pública. **Limitación conocida:** es en memoria por instancia de función serverless, no compartido entre instancias — bajo un ataque distribuido en escala (muchas IPs, o mucho tráfico repartido entre instancias de Vercel) no alcanza. Un store compartido (Upstash Redis / Vercel KV) daría un tope real y exacto — no implementado, requiere decisión de infraestructura nueva.

**Prevención pendiente:** si el rate-limit en memoria no alcanza bajo un ataque real, migrar a un store compartido (Upstash Redis/Vercel KV). Ver también el hallazgo #12 de la auditoría (listAppointments sin paginación).

---

### 8. Brecha de datos de salud (Ley 21.719)

**Qué cuenta como brecha:** cualquier acceso, lectura, copia, alteración o pérdida no autorizada de datos de pacientes (fichas, notas clínicas, odontogramas, pagos, teléfonos), sea por credenciales filtradas, un fallo de RLS entre clínicas, un backup expuesto o un error humano.

**Rol de cada uno:** cada clínica es **responsable** de los datos de sus pacientes; Esmalia es **encargado** del tratamiento. Esmalia avisa a la clínica; la clínica decide y hace la notificación a la autoridad (Agencia de Protección de Datos Personales en Chile, o la de su país) y a los pacientes.

**Respuesta:**

1. **Contener**: cortar el acceso (rotar la clave expuesta, revocar sesiones, desactivar el endpoint o la policy rota, sacar el backup expuesto). Si hace falta, poner la app en mantenimiento.
2. **Evaluar**: qué datos, de qué clínicas, cuántos pacientes, desde cuándo y si hubo lectura efectiva (logs de Supabase, `pg_stat_activity`, logs de Vercel, Sentry). Cruce entre clínicas: verificar con las pruebas de aislamiento (`tests/multi-clinic-isolation.test.ts`).
3. **Notificar a los dueños de las clínicas afectadas sin dilación indebida (meta: 72 h desde que se detecta)**, por escrito: qué pasó, qué datos, qué se hizo y qué se recomienda. No esperar a tener el análisis completo para el primer aviso.
4. **Apoyar a la clínica** con la información que necesite para notificar a la autoridad y a los pacientes como responsable.
5. **Registro del incidente** en `docs/post-mortems/YYYY-MM-DD-<slug>.md` (sin datos de pacientes): cronología, alcance, decisiones, avisos enviados y a quién. Se guarda aunque se concluya que no hubo acceso real.
6. **Rotar secretos** relacionados aunque no se hayan confirmado como expuestos (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `PORTAL_TOKEN_SECRET`, claves de Resend/Stripe/Meta según el caso).

**Responsable:** Walter.

---

## RTO / RPO — objetivos formales

Sin SLA firmado con ninguna clínica todavía; estos son los objetivos internos que gobiernan cómo se prioriza este runbook y las decisiones de infraestructura, no una promesa contractual. Se actualizan si la infraestructura cambia (backups, PITR, ensayo de restore) o cuando exista un SLA real.

| Escenario                           | RPO objetivo             | RPO real hoy                   | RTO objetivo | RTO real hoy                                                                                                                                                                     |
| ----------------------------------- | ------------------------ | ------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB corrupta/borrada (#1)            | 24 h                     | 24 h (backup diario 07:15 UTC) | 4 h          | Datos: **medido por el simulacro mensual** (1 min 59 s en modo real, 28-oct; 40 s en modo juguete, 27-oct). Total con la configuración manual: ~45-60 min estimados, sin ensayar |
| Deploy Vercel roto (#2)             | 0 (sin pérdida de datos) | 0                              | 15 min       | ~15 min (rollback a deploy anterior vía dashboard)                                                                                                                               |
| Credenciales comprometidas (#3)     | 0                        | 0                              | 1 h          | Sin validar                                                                                                                                                                      |
| Vercel caído/cuenta suspendida (#5) | 0                        | 0                              | 4 h          | Sin validar — `esmalia.com` en Cloudflare: repuntar DNS                                                                                                                          |
| Ataque de rate limit/DDoS (#7)      | 0 (sin pérdida de datos) | 0                              | 30 min       | Sin validar — nunca se probó bajo tráfico real de ataque                                                                                                                         |

Los escenarios #4 (sync con Lovable) y #6 (cierre de Lovable Cloud) quedan fuera de esta tabla a propósito: no son escenarios de pérdida de datos ni de caída del sitio — Lovable hoy es un editor visual secundario desacoplado (`docs/DESACOPLE_LOVABLE.md`), no el runtime de producción, así que no tienen un RTO/RPO comparable al resto.

**Medición real del 28-oct-2026 (simulacro `real`, backup de B2 del 27-oct con la clave `BACKUP_AGE_KEY` ya cargada):** restauración completa en **1 min 59 s** (bajar el backup, descifrar, levantar el esquema con 218 migraciones, recrear 4 usuarios de auth con su id, cargar 143 de 143 tablas con el mismo conteo y subir 5 archivos de Storage; 0 fallos). Es el camino de datos en un Supabase efímero de GitHub: no incluye crear el proyecto Supabase real, repuntar el dominio ni verificar la app.

**Qué está validado del RTO de DB y qué no:** el camino de datos (descifrar, levantar el esquema con todas las migraciones, recrear usuarios con su id, cargar tablas, subir archivos y verificar conteos, FKs, usuarios y archivos contra el backup) lo mide el simulacro mensual en un Supabase efímero. Lo que no se puede ensayar en un runner es lo manual: crear el proyecto en Supabase, configurar Google OAuth/SMTP/plantillas y repuntar Vercel; eso está estimado (~45-60 min, tabla en `docs/BACKUPS.md`), no medido. Con eso, la meta de 4 h tiene margen, pero el número comprometible con una clínica piloto es la estimación manual (45-60 min), no el 1:59: ese solo mide el camino de datos con una base mínima (4 usuarios, 5 archivos) y no incluye crear el proyecto Supabase, OAuth/SMTP, Vercel, DNS ni un smoke test de la app.

**Próximo paso concreto:** una vez, cronometrar el restore completo contra un proyecto Supabase descartable siguiendo "Procedimiento: simulacro de restauración" (incluye lo manual: proyecto, OAuth/SMTP, Vercel, DNS y smoke test). Ya está cargado `BACKUP_AGE_KEY` y el simulacro mensual usa el backup real.

---

## Procedimiento: simulacro de restauración

Para qué: saber, todos los meses y sin depender de que alguien se acuerde, que el último backup se puede restaurar entero y cuánto tarda. Detalle técnico en `docs/BACKUPS.md` → "Simulacro automático".

1. **Automático**: el día 3 de cada mes, 10:00 UTC, GitHub Actions corre "Simulacro de restauración". Baja el último backup de B2, lo restaura en un Supabase efímero dentro del runner (nunca producción) y verifica conteos por tabla, FKs, usuarios de auth y archivos de Storage contra el backup.
2. **Revisar el resultado**: el resumen del run dice ✅ / 🔴 / ➖ (omitido) y el RTO medido; el artefacto del run guarda `reporte.md` 90 días. Si falla, aparece un Issue `🔴 Simulacro de restauración de Esmalia falló` (etiqueta `simulacro-fallido`).
3. **Si sale 🔴**: abrir el reporte. `migraciones` → una migración no levanta en una base vacía (arreglarla antes de que haga falta un restore de verdad). `conteos` → nombra la tabla y las dos cifras; revisar si la tabla está en `scripts/backup-tables.mjs` y si el SQL de carga la soporta. `fks` → nombra la FK con huérfanos (backup tomado a mitad de una escritura, o tabla que falta en el backup). `auth`/`storage` → usuarios o archivos que no volvieron. En todos los casos, el backup diario sigue corriendo: lo roto es la capacidad de restaurar, que es lo que este simulacro existe para detectar.
4. **Si sale ➖ omitido**: el secret `BACKUP_AGE_KEY` desapareció o está vacío (en operación normal el simulacro es `real`). Recargarlo (solo Walter, `docs/BACKUPS.md` → "Cargar o recargar el secret") o correr el modo `juguete` para al menos probar el circuito. Un omitido no abre Issue.
5. **A mano** (antes de un cambio grande en backups o migraciones): Actions → "Simulacro de restauración" → Run workflow (modo `real` o `juguete`), o en la Mac `bash scripts/simulacro/simulacro.sh <backup.age> <clave> [storage.age]`.
6. Anotar en la bitácora de `docs/BACKUPS.md` los resultados que cambien algo (un RTO distinto, una falla y su causa).

## Contactos y accesos

- **Owner del proyecto:** Walter (datos de contacto en `08 - Operaciones/continuidad/`, fuera del repo)
- **Lovable:** editor `https://lovable.dev/projects/9f5bde21-41b4-43c0-bc81-ea2215cab660`
- **GitHub:** `maxnovaluciglobal-a11y/esmalia` (rama `main`) — migrado desde `walterlamadriz-ai/esmalia` el 2026-08-31, la URL vieja redirige
- **Supabase propio (producción real):** proyecto `hvfkygoguxvpmwslrccb`, `sa-east-1`, org MaxnovaLuci. El proyecto Lovable Cloud `9f5bde21-...` es un huérfano congelado al 14-ago, no producción.
- **VPS fallback:** `91.99.204.162` (mismo host que GastroCore, ver memoria de proyectos)

## Checklist post-incidente

- [ ] Confirmar RTO real vs el objetivo de la tabla "RTO / RPO — objetivos formales" arriba.
- [ ] Identificar datos perdidos (RPO) y comunicar a las clínicas.
- [ ] Escribir post-mortem en `docs/post-mortems/YYYY-MM-DD-<slug>.md`.
- [ ] Actualizar este runbook con lo aprendido.

## Pendientes de infraestructura (bloquean DR real)

Ver también `docs/DEPLOY_PRODUCTION.md`.

1. ✅ Backup diario propio (API REST de Supabase → B2), corrigiendo 2026-09-05.
2. ✅ Rate-limit en server functions y API pública — con la limitación de memoria-por-instancia documentada arriba.
3. Monitoreo activo — Sentry **activo** en producción (`VITE_SENTRY_DSN` cargado); falta un healthcheck externo sobre `/api/health` con alerta.
4. ✅ Ensayo de restore desde backup: manual el 10-oct-2026 y automático mensual desde el 27-oct-2026 (SEG-05). El automático usa el backup real desde el 28-oct-2026 (1 min 59 s). Pendiente: un ensayo completo contra un proyecto Supabase real (la parte manual).
5. Documento formal de RTO/RPO firmado con clientes — la tabla de arriba son objetivos internos, no un SLA firmado; falta eso cuando haya clínicas piloto con contrato.
