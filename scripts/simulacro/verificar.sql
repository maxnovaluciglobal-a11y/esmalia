-- Mediciones del simulacro de restauración sobre la base efímera ya cargada.
-- Imprime UNA línea de JSON que lee scripts/simulacro/evaluar.mjs:
--   { conteos, fksRevisadas, fksRotas, usuariosRestaurados, usuariosStub, objetos }
-- Requiere public._restore_doc (lo deja cargar-datos.sql).
-- Sin valores de filas: solo nombres de tabla, conteos, ids de usuario (que
-- evaluar.mjs reduce a un conteo) y rutas/tamaños de Storage (idem).
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
SET client_min_messages = warning;

CREATE TEMP TABLE _sim_conteos (tabla text PRIMARY KEY, filas bigint);
CREATE TEMP TABLE _sim_fks (tabla text, columna text, referencia text, huerfanos bigint);
CREATE TEMP TABLE _sim_meta (clave text PRIMARY KEY, valor bigint);

DO $$
DECLARE
  d jsonb := (SELECT doc FROM public._restore_doc);
  t text; n bigint; c record; revisadas int := 0;
BEGIN
  -- Conteo real de cada tabla que trae el backup (NULL si no existe en el esquema).
  FOR t IN SELECT jsonb_object_keys(d->'tables') LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      INSERT INTO _sim_conteos VALUES (t, NULL);
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      INSERT INTO _sim_conteos VALUES (t, n);
    END IF;
  END LOOP;

  -- Integridad referencial: FKs de una columna del esquema public.
  FOR c IN SELECT con.conrelid::regclass AS rel, a.attname AS col,
                  con.confrelid::regclass AS ref, ra.attname AS refcol
             FROM pg_constraint con
             JOIN pg_attribute a  ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
             JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = con.confkey[1]
            WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
              AND con.connamespace = 'public'::regnamespace LOOP
    revisadas := revisadas + 1;
    EXECUTE format('SELECT count(*) FROM %s x WHERE x.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s y WHERE y.%I = x.%I)',
                   c.rel, c.col, c.ref, c.refcol, c.col) INTO n;
    IF n > 0 THEN INSERT INTO _sim_fks VALUES (c.rel::text, c.col, c.ref::text, n); END IF;
  END LOOP;
  INSERT INTO _sim_meta VALUES ('fks_revisadas', revisadas);
END $$;

SELECT json_build_object(
  'conteos', (SELECT coalesce(json_object_agg(tabla, filas), '{}'::json) FROM _sim_conteos),
  'fksRevisadas', (SELECT valor FROM _sim_meta WHERE clave = 'fks_revisadas'),
  'fksRotas', (SELECT coalesce(json_agg(json_build_object(
                 'tabla', tabla, 'columna', columna, 'referencia', referencia, 'huerfanos', huerfanos)), '[]'::json)
               FROM _sim_fks),
  -- Usuario restaurado = mismo id y mismo correo que en el backup, y no es un stub de la carga.
  'usuariosRestaurados', (SELECT coalesce(json_agg(u.id), '[]'::json)
                            FROM auth.users u
                            JOIN jsonb_array_elements(coalesce((SELECT doc->'auth_users' FROM public._restore_doc), '[]')) b
                              ON (b->>'id')::uuid = u.id
                             AND (b->>'email') IS NOT DISTINCT FROM u.email::text
                           WHERE NOT coalesce(u.raw_app_meta_data ? 'restore_stub', false)),
  'usuariosStub', (SELECT count(*) FROM auth.users
                    WHERE raw_app_meta_data ? 'restore_stub'
                      AND id <> '139dd209-8495-415c-b6cd-6bbc63367bad'),
  'objetos', (SELECT coalesce(json_object_agg(bucket_id, objs), '{}'::json) FROM (
                SELECT bucket_id, json_agg(json_build_object('path', name, 'size', (metadata->>'size')::bigint)) AS objs
                  FROM storage.objects GROUP BY bucket_id) s)
);
