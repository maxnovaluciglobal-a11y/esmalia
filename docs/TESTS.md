# Tests

La suite (`tests/**/*.test.ts`, vitest) corre **siempre contra una base local efímera**: un Supabase levantado con Docker (Postgres + Auth + PostgREST + Storage) con todas las migraciones de `supabase/migrations/` aplicadas en orden. **Nunca contra producción.**

Hasta oct-2026 el CI usaba la base real y dejó unos 1.579 perfiles basura (hallazgos COD-07 / FN-02 de la auditoría 360 del 18-oct-2026). Hoy hay una guardia (`tests/setup/guard-produccion.ts`, `globalSetup` de vitest) que **aborta la corrida** si `SUPABASE_URL`, `VITE_SUPABASE_URL`, `PGHOST`, `PGHOSTADDR`, `PGUSER` o `DATABASE_URL` contienen el ref del proyecto de producción (`hvfkygoguxvpmwslrccb`) o `pooler.supabase.com`.

## Correr la suite en local

Requisitos: Docker corriendo (Docker Desktop u OrbStack) y el Supabase CLI (el global o el de `devDependencies`, que queda en `node_modules/.bin` después de `npm ci`).

```bash
bash scripts/test-db/start.sh        # ~30 s con las imágenes ya bajadas
set -a; source .env.test; set +a     # PG* y SUPABASE_* de la base local
npm test
bash scripts/test-db/stop.sh         # apaga y descarta la base
```

`start.sh`:

1. Escribe una config propia en un directorio temporal (`$TMPDIR/esmalia-test-db`, se cambia con `ESMALIA_TEST_WORKDIR`) con `project_id = "esmalia-test"`. No usa `supabase/config.toml` del repo, que apunta al proyecto real.
2. `supabase start` solo con db, auth, rest, storage y kong.
3. Carga `scripts/test-db/preseed.sql`: lo que en producción existe desde antes de las migraciones (la cuenta `demo@esmalia.com` en `auth.users` y los privilegios por defecto clásicos del esquema `public`).
4. Aplica cada migración con `psql` en **autocommit**, como se aplicaron en producción. Un `supabase start` normal las corre en una transacción por archivo y aborta con `unsafe use of new enum value` (`ALTER TYPE ... ADD VALUE` seguido de su uso).
5. Escribe `.env.test` (gitignoreado) y, en GitHub Actions, también `$GITHUB_ENV`.

Correr un solo archivo: `npx vitest run tests/<archivo>.test.ts` con el mismo `.env.test` cargado. Los tests puros (sin base) no necesitan nada de esto.

Para reconstruir desde cero después de agregar una migración: `stop.sh` y de nuevo `start.sh`.

### Si no levanta

- Puertos ocupados (54321/54322): otro Supabase local corriendo. `supabase stop --project-id <otro>` o `docker ps`.
- `permission denied for table …` en tests que usan el service role: falta el bloque de privilegios por defecto de `preseed.sql`.
- Una migración nueva que referencia datos que solo existen en producción (ids fijos, usuarios): agregar el dato mínimo a `preseed.sql`, nunca conectar a la base real.

## En CI

`.github/workflows/ci.yml`, job `test`: `npm ci` → `bash scripts/test-db/start.sh` → `npm test`. El job **no recibe ningún secret**. La concurrencia es por rama (`ci-${{ github.ref }}`): un push nuevo cancela la corrida anterior de la misma rama; en `main` no se cancela.

## Escribir tests que tocan la base

- Conexión directa: `tests/helpers/db.ts` (`conectar()`, transacción con `ROLLBACK` por test, `comoUsuario` para simular `auth.uid()`). Con `PGSSLMODE=disable` conecta sin TLS.
- Cliente REST: `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` para sembrar y limpiar, `SUPABASE_PUBLISHABLE_KEY` + login para probar RLS de punta a punta.
- Todo dato lo siembra el propio test (fixtures). Ningún test puede depender de filas que solo existen en producción.
