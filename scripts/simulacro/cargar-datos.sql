-- Carga de un backup de Esmalia (JSON de scripts/backup-data.mjs) en una base
-- con el esquema ya migrado. La usan scripts/restore-drill.sh (Postgres pelado)
-- y scripts/simulacro/simulacro.sh (Supabase local efímero).
--
-- Uso: psql -X -v ON_ERROR_STOP=1 -v json=<ruta al JSON> -f scripts/simulacro/cargar-datos.sql
-- Deja public._restore_doc con el JSON (la verificación lo lee). Solo imprime
-- nombres de tabla y conteos, nunca valores.
SET client_min_messages = notice;
\set content `cat :'json'`
CREATE TABLE public._restore_doc AS SELECT :'content'::jsonb AS doc;
\unset content
SET session_replication_role = replica;  -- sin triggers ni chequeo de FKs durante la carga
DO $$
DECLARE
  d jsonb := (SELECT doc FROM public._restore_doc);
  t text; cols text; n bigint; ok int := 0; bad int := 0; missing int := 0;
  stubs bigint := 0; c record; msg text;
BEGIN
  -- Lo que sembraron las migraciones (catálogos, plantillas) se reemplaza por el backup.
  SELECT string_agg(format('public.%I', k), ', ') INTO cols
    FROM jsonb_object_keys(d->'tables') k WHERE to_regclass(format('public.%I', k)) IS NOT NULL;
  EXECUTE 'TRUNCATE ' || cols || ' CASCADE';

  FOR t IN SELECT jsonb_object_keys(d->'tables') ORDER BY 1 LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'SIN TABLA en el schema actual: % (% filas sin destino)', t, jsonb_array_length(d->'tables'->t);
      missing := missing + 1; CONTINUE;
    END IF;
    -- Solo columnas que existen en ambos lados y no son generadas: las columnas
    -- nuevas (posteriores al backup) toman su DEFAULT.
    SELECT string_agg(format('%I', a.attname), ', ') INTO cols
      FROM pg_attribute a
     WHERE a.attrelid = format('public.%I', t)::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attgenerated = ''
       AND a.attname IN (SELECT DISTINCT jsonb_object_keys(e) FROM jsonb_array_elements(d->'tables'->t) e);
    IF cols IS NULL THEN ok := ok + 1; CONTINUE; END IF;  -- tabla vacía
    BEGIN
      EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1)',
                     t, cols, cols, t) USING d->'tables'->t;
      ok := ok + 1;
    EXCEPTION WHEN others THEN
      bad := bad + 1;
      -- Sin DETAIL (trae la fila) y sin valores entre comillas: nada de datos de pacientes.
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      RAISE NOTICE 'FALLÓ %: [%] %', t, SQLSTATE,
        regexp_replace(msg, ':\s+".*$|: .*$', ': <valor omitido>');
    END;
  END LOOP;

  -- auth.users: los del backup (si los trae) + un stub por cada user_id referenciado que falte.
  IF d ? 'auth_users' THEN
    INSERT INTO auth.users (id, email, phone, created_at, email_confirmed_at, last_sign_in_at,
                            raw_user_meta_data, raw_app_meta_data, aud, role)
    SELECT (u->>'id')::uuid, u->>'email', u->>'phone', (u->>'created_at')::timestamptz,
           (u->>'email_confirmed_at')::timestamptz, (u->>'last_sign_in_at')::timestamptz,
           u->'user_metadata', u->'app_metadata', 'authenticated', 'authenticated'
      FROM jsonb_array_elements(d->'auth_users') u
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'auth.users desde el backup: %', n;
  END IF;
  -- Columnas que guardan un id de auth.users: las que tienen FK declarada, más
  -- las que no la tienen pero lo son por convención (profiles.id, *.user_id,
  -- created_by, actor_id…). Sin estos usuarios nadie puede iniciar sesión.
  FOR c IN
    SELECT con.conrelid::regclass AS rel, a.attname AS col
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass
    UNION
    SELECT 'public.profiles'::regclass, 'id'
    UNION
    SELECT a.attrelid::regclass, a.attname
      FROM pg_attribute a JOIN pg_class r ON r.oid = a.attrelid
     WHERE r.relnamespace = 'public'::regnamespace AND r.relkind = 'r' AND NOT a.attisdropped
       AND a.atttypid = 'uuid'::regtype
       AND a.attname IN ('user_id', 'created_by', 'updated_by', 'actor_id', 'confirmed_by', 'counted_by', 'invited_by')
  LOOP
    EXECUTE format(
      'INSERT INTO auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data)
       SELECT DISTINCT %1$I, %1$I::text || ''@restore.invalid'', ''authenticated'', ''authenticated'',
              ''{"restore_stub": true}''::jsonb, ''{}''::jsonb
         FROM %2$s WHERE %1$I IS NOT NULL ON CONFLICT (id) DO NOTHING', c.col, c.rel);
    GET DIAGNOSTICS n = ROW_COUNT;
    stubs := stubs + n;
  END LOOP;
  RAISE NOTICE 'auth.users stub (user_id referenciado sin usuario en el backup): %', stubs;
  RAISE NOTICE 'tablas cargadas: %, con error: %, sin tabla destino: %', ok, bad, missing;
END $$;
SET session_replication_role = origin;

-- Secuencias al máximo cargado, como haría un restore real.
DO $$ DECLARE s record; BEGIN
  FOR s IN SELECT seq.oid::regclass AS seq, d.refobjid::regclass AS rel, a.attname AS col
             FROM pg_class seq JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a','i')
             JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
            WHERE seq.relkind = 'S' AND d.refobjid::regclass::text NOT LIKE 'auth.%' LOOP
    EXECUTE format('SELECT setval(%L, coalesce((SELECT max(%I) FROM %s), 0) + 1, false)', s.seq, s.col, s.rel);
  END LOOP;
END $$;
