# Runbook: aplicar una migración en producción

**Versión:** 1 · 19-oct-2026 · Aplica a todo archivo nuevo en `supabase/migrations/`. Proyecto de producción: `hvfkygoguxvpmwslrccb` (`esmalia-prod`).

## Reglas

1. **Solo con OK explícito de Walter**, por migración. Un agente versiona el archivo y escribe en el PR "Requiere aplicar la migración con OK de Walter" con el comando; no la aplica.
2. **Se aplica justo antes de mergear**, con el PR revisado y el CI en verde. Push a `main` es deploy: si la migración entra mucho antes, el código viejo corre contra el schema nuevo; si entra después, el código nuevo corre sin su schema y falla. La ventana entre aplicar y mergear tiene que ser de minutos.
3. **Compatible con el código que está en producción.** Por la regla 2, durante unos minutos conviven el schema nuevo y el código viejo, y un rollback de Vercel deja al código viejo con el schema nuevo para siempre. Agregar columnas nullable, tablas o funciones: sí. Renombrar o borrar algo que el código actual usa: en dos PRs (primero el código deja de usarlo, después la migración lo borra).
4. **Las migraciones aplicadas no se editan.** Si algo quedó mal, se escribe una migración correctiva con versión nueva.
5. **Nunca `supabase db push`** ni `supabase migration list` como fuente de verdad: casi todas las migraciones se aplicaron a mano y el historial de la CLI no refleja lo que hay en la base.

## Antes de aplicar

- [ ] Versión única y mayor que la última aplicada (las tandas de agentes reciben la suya en el brief de ejecución).
- [ ] El job `test` del CI la aplicó en la base efímera junto con todas las anteriores y quedó en verde (`docs/TESTS.md`).
- [ ] RLS activa y con políticas en toda tabla nueva; `REVOKE ... FROM PUBLIC, anon` en toda función `SECURITY DEFINER` (`tests/permisos-funciones-definer.test.ts` lo vigila).
- [ ] Tabla nueva sumada a `scripts/backup-tables.mjs` (`tests/backup-tables-sync.test.ts` lo vigila).
- [ ] El PR trae el bloque **"Cómo revertir"** con el SQL inverso.
- [ ] Si borra o reescribe datos (`DROP`, `UPDATE` masivo, cambio de tipo): disparar un backup antes y esperar que termine en verde: `gh workflow run backup.yml`, después `gh run watch`.

## Aplicar

### Camino A (preferido): Management API, sin contraseña de Postgres

Usa la sesión del Supabase CLI. Corre **desde el checkout principal**, que es el que tiene el proyecto enlazado (`supabase/.temp/project-ref`, no versionado: los worktrees no lo tienen). Por eso el archivo va con **ruta absoluta**, apuntando al worktree del PR:

```bash
cd "$HOME/Documents/01 - Maxnova Luci Global/04 - Esmalia/05 - Producto/esmalia"
npx supabase db query --linked \
  -f "$HOME/Documents/01 - Maxnova Luci Global/04 - Esmalia/05 - Producto/esmalia/.claude/worktrees/<worktree>/supabase/migrations/<version>_<tema>.sql"
```

Con una ruta relativa el CLI la resuelve contra otro directorio y, en el mejor caso, no encuentra el archivo.

### Camino B: psql por el pooler

Para cuando el camino A no sirve: la migración agrega un valor a un enum y lo usa en el mismo archivo (`unsafe use of new enum value`), o hace falta ver los `NOTICE` línea por línea. `PGPASSWORD` sale del `.env` local, nunca del chat:

```bash
psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" \
  -v ON_ERROR_STOP=1 --single-transaction -f "<ruta>/supabase/migrations/<archivo>.sql"
```

`--single-transaction` hace que un error a mitad de archivo no deje la base a medias. Sacarlo solo para el caso del enum, y entonces la migración tiene que ser idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`) para poder correrla de nuevo.

## Verificar (antes de mergear)

Con `npx supabase db query --linked "<sql>"` desde el checkout principal:

```sql
-- Tabla creada, con RLS y políticas
select relname, relrowsecurity from pg_class where oid = 'public.<tabla>'::regclass;
select policyname, cmd, roles from pg_policies where tablename = '<tabla>';

-- Columnas nuevas
select column_name, data_type, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = '<tabla>';

-- Función definer no ejecutable por anon (tiene que dar false)
select has_function_privilege('anon', 'public.<funcion>(<args>)', 'execute');

-- Triggers
select tgname from pg_trigger where tgrelid = 'public.<tabla>'::regclass and not tgisinternal;
```

Y `npx supabase db advisors --linked`: no puede aparecer un aviso de seguridad nuevo.

Recién entonces: `gh pr merge <N> --squash --delete-branch`.

## Después del merge

1. El deploy de Vercel termina en **Ready**.
2. `curl -s https://esmalia.com/api/health` devuelve `{"status":"ok",…}` y `/estado` muestra "Todo funciona con normalidad".
3. Probar a mano el flujo que toca la migración, en `/demo` o con la clínica de prueba.
4. Sentry sin errores nuevos durante 15 minutos.
5. Comentar en el PR: "Migración aplicada en producción el AAAA-MM-DD HH:MM UTC con el camino A/B" y actualizar el brief o `00 - Gestion/ESTADO.md` (fuera del repo) con la última versión aplicada.

## Revertir

| Qué salió mal                               | Qué hacer                                                                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La migración falló al aplicarse             | Con `--single-transaction` (o el camino A) no quedó nada aplicado: corregir el archivo en el PR y repetir. Sin transacción: ver qué objetos quedaron (consultas de arriba) y completar o deshacer a mano. |
| El código nuevo falla y el schema está bien | Vercel → Deployments → **Instant Rollback** al deploy anterior (~15 min, `docs/SLO.md`). Por la regla 3, el código viejo sigue funcionando con el schema nuevo.                                           |
| La migración rompe algo                     | Aplicar el SQL de **"Cómo revertir"** del PR como migración correctiva (versión nueva, mismo procedimiento) y mergear su archivo.                                                                         |
| La migración borró o dañó datos             | Restaurar: snapshot diario de Supabase (≤ 24 h, el camino rápido) o backup propio en B2 (`docs/BACKUPS.md`). Es un incidente: cargarlo en `src/content/incidentes.ts` y seguir `docs/SLO.md`, sección 4.  |

## Referencias

- `CLAUDE.md`, regla 5, y `docs/TESTS.md` (cómo se aplican las migraciones en la base efímera).
- `docs/SLO.md` (RPO/RTO, presupuesto de error) y `docs/BACKUPS.md`.
