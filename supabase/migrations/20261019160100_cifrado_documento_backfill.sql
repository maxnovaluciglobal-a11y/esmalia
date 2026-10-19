-- Cifrado del documento de identidad: arreglo, backfill y camino de la demo
-- (hallazgos SEG-03 y GOB-02, auditoría 360 del 18-oct-2026).
--
-- Estado de partida (prod, 18-oct): 11 pacientes con `document_id` en claro
-- y 0 con `document_id_enc`, aunque la clave `esmalia_document_id_key` existe
-- en Vault desde el 11-oct. Tres causas, las tres se arreglan acá:
--
-- 1. set_patient_document_id NO PUEDE CIFRAR. La migración 20260822160000
--    agregó `extensions` al search_path porque Supabase instala pgcrypto en
--    ese schema ("function pgp_sym_encrypt(text, text) does not exist"). La
--    20260901120000 (agregar el chequeo de rol) reescribió la función con el
--    search_path viejo `public, vault`, y la 20261014000000 copió esa versión.
--    Desde el 01-sep, cada llamada de la app falla y el error se queda en un
--    console.error "no bloqueante". (Diagnóstico por lectura del historial de
--    migraciones; no se probó contra la base de producción.)
-- 2. La demo se recrea con SQL directo (reset_demo_clinic inserta en
--    patients) y nunca pasó por el RPC. Son 10 de los 11.
-- 3. Nadie hizo el backfill de las filas anteriores a la clave (1 de 11).
--
-- Qué hace esta migración:
--
--  a. cifrar_documento_id(): UNA sola función que cifra (pgp_sym_encrypt) y
--     arma el blind index (HMAC-SHA256), con `extensions` en el search_path.
--     La usan el trigger, el RPC y el backfill: el search_path ya no se puede
--     desalinear entre copias porque no hay copias.
--  b. Trigger patients_cifrar_documento (BEFORE INSERT OR UPDATE OF
--     document_id): todo alta o edición del documento se cifra en la base,
--     venga de la app, del importador CSV, de reset_demo_clinic o de un
--     script. La demo queda cubierta SIN reescribir reset_demo_clinic (que
--     tocan otras migraciones de la misma tanda).
--  c. set_patient_document_id se mantiene (la app la sigue llamando) pero
--     delega en (a). Mismo chequeo de rol que antes.
--  d. Backfill idempotente de las filas existentes + verificación: si algún
--     documento queda sin cifrar, o alguno no se descifra igual al texto en
--     claro, la transacción entera se revierte.
--
-- Qué NO hace (a propósito, ver el PR): el corte de lectura. `document_id` en
-- claro sigue siendo la fuente de verdad y NO se pone en NULL. Ese paso
-- (Fase 1b) va en una migración aparte, después de confirmar en producción
-- que esta dejó el 100 % cifrado y de respaldar la clave de Vault fuera de
-- Supabase (SEG-10): sin ese respaldo, borrar el texto en claro haría que una
-- clave perdida sea un dato perdido.
--
-- Sin clave en Vault (base local reconstruida, ensayo de restauración): el
-- backfill se saltea con un NOTICE y el trigger deja pasar el alta sin
-- cifrar con un WARNING, en vez de romper la cadena de migraciones o el alta.
-- En producción la clave existe y la verificación final exige el 100 %.

begin;

-- a. Cifrado en un solo lugar --------------------------------------------

CREATE OR REPLACE FUNCTION public.cifrar_documento_id(
  p_document_id text,
  OUT documento_enc bytea,
  OUT documento_hash text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_document_id IS NULL OR btrim(p_document_id) = '' THEN
    RETURN; -- sin documento: las dos salidas quedan en NULL
  END IF;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'esmalia_document_id_key';
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Falta la clave esmalia_document_id_key en Vault.'
      USING ERRCODE = 'P0001', HINT = 'Ver supabase/migrations/20260822150000_security6_fase1_document_id_encryption.sql';
  END IF;

  documento_enc := pgp_sym_encrypt(p_document_id, v_key);
  documento_hash := encode(hmac(lower(btrim(p_document_id)), v_key, 'sha256'), 'hex');
END;
$$;

-- Interna: no valida quién llama. Solo la usan el trigger, el RPC (después
-- de su chequeo de rol) y esta migración. Nadie de la API la ejecuta: sería
-- un oráculo para calcular el blind index de un RUT adivinado.
REVOKE ALL ON FUNCTION public.cifrar_documento_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cifrar_documento_id(text) TO service_role;

-- b. Trigger: cifra en la base, cualquiera sea el camino ------------------

CREATE OR REPLACE FUNCTION public.patients_cifrar_documento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enc bytea;
  v_hash text;
BEGIN
  -- Un UPDATE que no cambia el documento no recalcula: pgp_sym_encrypt no es
  -- determinístico y cada edición del paciente reescribiría el cifrado.
  IF TG_OP = 'UPDATE' AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id THEN
    RETURN NEW;
  END IF;

  -- Un INSERT sin documento en claro respeta lo que traiga la fila: una
  -- restauración de backup inserta el cifrado original y no hay que pisarlo.
  -- (El corte de lectura de la Fase 1b, que deja document_id en NULL, tiene
  -- que revisar este trigger.)
  IF TG_OP = 'INSERT' AND (NEW.document_id IS NULL OR btrim(NEW.document_id) = '') THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT c.documento_enc, c.documento_hash INTO v_enc, v_hash
      FROM public.cifrar_documento_id(NEW.document_id) c;
  EXCEPTION WHEN OTHERS THEN
    -- Sin clave (o pgcrypto roto): no se bloquea el alta ni la edición. La
    -- app lo detecta y avisa a Sentry (vigilarCifradoDeDocumento), y la
    -- verificación de abajo no pasa en una base con clave y documentos sin
    -- cifrar. En un UPDATE el cifrado viejo ya no corresponde al documento
    -- nuevo; en un INSERT se respeta lo que traiga la fila (restauración).
    RAISE WARNING 'patients_cifrar_documento: % (paciente %)', SQLERRM, NEW.id;
    IF TG_OP = 'UPDATE' THEN
      NEW.document_id_enc := NULL;
      NEW.document_id_hash := NULL;
    END IF;
    RETURN NEW;
  END;

  NEW.document_id_enc := v_enc;
  NEW.document_id_hash := v_hash;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.patients_cifrar_documento() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS patients_cifrar_documento ON public.patients;
CREATE TRIGGER patients_cifrar_documento
  BEFORE INSERT OR UPDATE OF document_id ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.patients_cifrar_documento();

-- c. El RPC que llama la app delega en (a) -------------------------------

CREATE OR REPLACE FUNCTION public.set_patient_document_id(p_patient_id uuid, p_document_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_enc bytea;
  v_hash text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_patient_id
      AND public.has_clinic_role(p.clinic_id, ARRAY['owner','admin','dentist','reception']::public.app_role[])
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para modificar este paciente.';
  END IF;

  SELECT c.documento_enc, c.documento_hash INTO v_enc, v_hash
    FROM public.cifrar_documento_id(p_document_id) c;

  UPDATE public.patients
     SET document_id_enc = v_enc,
         document_id_hash = v_hash
   WHERE id = p_patient_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_patient_document_id(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_patient_document_id(uuid, text) TO authenticated, service_role;

-- d. Backfill + verificación ---------------------------------------------

-- El backfill no es una edición del paciente: sin esto, `updated_at` de las
-- filas cifradas saltaría a hoy. Solo dentro de esta transacción.
ALTER TABLE public.patients DISABLE TRIGGER patients_updated_at;

DO $$
DECLARE
  v_key text;
  v_cifrados int;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'esmalia_document_id_key';

  IF v_key IS NULL THEN
    RAISE NOTICE 'Sin esmalia_document_id_key en Vault: backfill salteado (base sin clave).';
    RETURN;
  END IF;

  -- Idempotente: solo filas con documento y sin cifrado. Correrla dos veces
  -- no toca nada la segunda vez.
  UPDATE public.patients p
     SET (document_id_enc, document_id_hash) = (
           SELECT c.documento_enc, c.documento_hash
             FROM public.cifrar_documento_id(p.document_id) c
         )
   WHERE p.document_id IS NOT NULL
     AND btrim(p.document_id) <> ''
     AND p.document_id_enc IS NULL;
  GET DIAGNOSTICS v_cifrados = ROW_COUNT;
  RAISE NOTICE 'Backfill de document_id: % filas cifradas.', v_cifrados;
END
$$;

ALTER TABLE public.patients ENABLE TRIGGER patients_updated_at;

-- Verificación: con clave en Vault, el 100 % de los documentos tiene que
-- estar cifrado, descifrar exactamente al texto en claro y tener el blind
-- index correcto. Cualquier diferencia revierte la migración entera.
DO $$
DECLARE
  v_key text;
  v_total int;
  v_sin_cifrar int;
  v_distintos int;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'esmalia_document_id_key';

  SELECT count(*) INTO v_total
    FROM public.patients
   WHERE document_id IS NOT NULL AND btrim(document_id) <> '';

  IF v_key IS NULL THEN
    IF v_total > 0 THEN
      RAISE WARNING 'Hay % documentos en claro y no hay clave en Vault: quedan SIN cifrar.', v_total;
    END IF;
    RETURN;
  END IF;

  SELECT count(*) INTO v_sin_cifrar
    FROM public.patients
   WHERE document_id IS NOT NULL AND btrim(document_id) <> ''
     AND (document_id_enc IS NULL OR document_id_hash IS NULL);
  IF v_sin_cifrar > 0 THEN
    RAISE EXCEPTION 'Quedan % de % documentos sin cifrar.', v_sin_cifrar, v_total;
  END IF;

  SELECT count(*) INTO v_distintos
    FROM public.patients
   WHERE document_id IS NOT NULL AND btrim(document_id) <> ''
     AND (
       extensions.pgp_sym_decrypt(document_id_enc, v_key) IS DISTINCT FROM document_id
       OR document_id_hash IS DISTINCT FROM
          encode(extensions.hmac(lower(btrim(document_id)), v_key, 'sha256'), 'hex')
     );
  IF v_distintos > 0 THEN
    RAISE EXCEPTION '% de % documentos cifrados no coinciden con el texto en claro.', v_distintos, v_total;
  END IF;

  RAISE NOTICE 'Cifrado de document_id verificado: % de % documentos.', v_total, v_total;
END
$$;

commit;
