# AGENTS.md — Esmalia

Instrucciones para cualquier agente de código. La guía completa está en `CLAUDE.md`; esto es lo mínimo que no se puede saltar.

- **Push a `main` = deploy a producción.** Trabajar en una rama propia (idealmente un worktree en `.claude/worktrees/<nombre>` creado desde `origin/main`) y abrir un PR. No pushear a `main`, no mergear, no `--force`, no tocar ramas ajenas. Walter mergea.
- **Chequeos antes del PR:** `npm run typecheck` y `npm run lint` en 0 errores. El hook `pre-commit` (husky + lint-staged) formatea y rechaza caracteres invisibles.
- **Tests:** la suite corre contra un Supabase efímero en Docker (`docs/TESTS.md`), nunca contra producción. En local: `bash scripts/test-db/start.sh`, cargar `.env.test`, `npm test`. Los tests puros: `npx vitest run tests/<archivo>.test.ts`. Nunca exportar credenciales de producción. El CI corre todo sin secrets.
- **Migraciones:** versionar en `supabase/migrations/` con la versión asignada y sumar las tablas nuevas a `scripts/backup-tables.mjs`. **No aplicarlas a producción**: el PR dice "Requiere aplicar la migración con OK de Walter" con el comando de `docs/RUNBOOK_MIGRACIONES.md`.
- **Sin OK de Walter tampoco:** cambiar variables de Vercel, Stripe, Supabase Auth, Meta, Cloudflare o Resend; borrar datos; encender Patty (`AI_ENABLED`); cambiar la visibilidad del repo.
- **Repo público:** nada de secretos ni datos de pacientes en código, tests, commits o PRs.
- **Estilo:** textos de UI en tuteo neutro y colores con tokens de `src/styles.css` (hay tests de guardia). Commits en inglés; descripción del PR en español.
