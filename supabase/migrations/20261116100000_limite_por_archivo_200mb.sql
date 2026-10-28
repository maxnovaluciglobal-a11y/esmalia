-- Imágenes grandes: un CBCT real pesa 100-500 MB y un escaneo intraoral STL 20-80 MB.
--
-- Decisión de Walter (28-oct-2026): hacerlo funcionar dentro del plan Pro actual,
-- sin ampliar nada de pago. El límite global de archivo del proyecto Supabase se
-- sube a 200 MB (ajuste gratuito del plan Pro, se hace aparte en el panel/API);
-- el espacio total sigue acotado por el cupo por clínica (15 GB Solo / 45 GB Clínica).
--
--   * límite por archivo de CBCT y escaneos: 200 MB (antes 50); fotos y
--     radiografías siguen en 20 MB;
--   * techo del bucket `clinical-exams`: 200 MB.
--
-- Redefine `limite_por_archivo_de_examen` (misma firma y atributos que en
-- producción, partiendo de su definición vigente) y escribe datos (UPDATE de
-- configuración del bucket). Requiere que el límite global del proyecto Supabase
-- ya sea >= 200 MB; si no, el bucket queda con el menor de los dos.
-- Reversa al pie.

begin;

create or replace function public.limite_por_archivo_de_examen(p_kind text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind in ('cbct_dicom', 'escaneo_intraoral') then 209715200::bigint -- 200 MB
    else 20971520::bigint                                                     -- 20 MB
  end;
$$;

update storage.buckets set file_size_limit = 209715200 where id = 'clinical-exams';

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- update storage.buckets set file_size_limit = 52428800 where id = 'clinical-exams';
-- (volver a crear la función con 52428800 para cbct_dicom / escaneo_intraoral)
