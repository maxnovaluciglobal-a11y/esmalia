# Migración Lovable Cloud → Supabase propio

Ejecutada 2026-08-14. Esmalia ahora corre contra la cuenta Supabase propia de Walter, aislada del proyecto FinanceOSpro (que vive en la misma cuenta pero es otro project).

## Proyecto nuevo

- **URL**: `https://hvfkygoguxvpmwslrccb.supabase.co`
- **Región**: `sa-east-1` (São Paulo) — mejor latencia LatAm
- **Plan**: Free tier (500 MB DB, 50k MAU) — alcanza para piloto
- **DB pooler**: `aws-0-sa-east-1.pooler.supabase.com:5432` (session pooler; el hostname directo `db.<ref>.supabase.co` fue deprecado por Supabase)

## Qué migró

- **Schema**: las 23 migraciones de `supabase/migrations/*.sql` → 30 tablas + RLS + triggers + RPCs.
- **Data**: la clínica piloto completa (1 clínica, 1 sucursal, 4 boxes, 2 profesionales, 8 especialidades, 3 procedures, 1 paciente de prueba con odontograma + presupuesto P-2026-0001 + plan + pago + mensaje WA).
- **auth.users**: 3 users recreados con Admin API preservando IDs (la cuenta owner de Walter, una cuenta de QA y una cuenta demo; los correos no se versionan en este repo público). Passwords rotadas el 2026-08-15 — viven en memoria privada, no en este repo público. Ver `esmalia_auditoria_multiagente_2026_08_15.md`.

## Env vars actualizadas

`.env` local (ver `.env.lovable-backup.*` para el snapshot previo si se necesita rollback):

```
VITE_SUPABASE_URL=https://hvfkygoguxvpmwslrccb.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_tghhM1Df9vkrHNkZoyPIrQ_kvfWwWpn
VITE_SUPABASE_PROJECT_ID=hvfkygoguxvpmwslrccb
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...   (⚠️ nunca commitear)
```

**Vercel Env Vars: rotadas.** Prod corre contra el Supabase propio desde antes del 2026-08-25 (verificado en el bundle servido del dominio `.vercel.app` original, que resuelve contra `hvfkygoguxvpmwslrccb.supabase.co`).

## Verificado end-to-end en dev

- Login con la cuenta owner OK → dashboard de la clínica piloto con 1 paciente / 1 nueva.
- `/pacientes` lista al paciente de prueba con datos correctos (RUT, edad, contacto).
- `/pacientes/:id` ficha completa: saldo **$50.000** ($90.000 plan - $40.000 pago), teléfono, mail, edad.
- Odontograma con 2 marks (caries superseded por obturación en pieza 16 oclusal).
- Plan de tratamiento activo con 2 items (limpieza + obturación).
- Historial de mensajes con el WA enviado.

## Lovable Cloud queda huérfano

- El proyecto Supabase que corre bajo Lovable Cloud (`jysoyttegoxynwrbgnlg.supabase.co`) sigue existiendo pero no lo apunta nadie.
- Cuando prod también migre, se puede pausar/cancelar desde el dashboard de Lovable → ahorro de MAU.
- **NO borrar antes de tener prod migrado y verificado 48 hs** — es el rollback más rápido si algo falla. Esa condición ya se cumplió (prod lleva días corriendo estable contra el propio); borrarlo o no queda a criterio de Walter, no es automático.

## Rollback

Si algo se rompe, revertir el `.env` local desde `.env.lovable-backup.<timestamp>` (se creó automáticamente durante la migración). Para prod, cambiar env vars en Vercel al Lovable Cloud y redeploy.

## Referencias

- Migración de data: `/private/tmp/claude-501/.../scratchpad/migrate/data.sql` (no versionada — puede borrarse).
- Migraciones de schema: `supabase/migrations/` (canónico, versionado en git).
