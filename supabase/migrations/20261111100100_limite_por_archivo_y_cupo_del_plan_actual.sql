-- Cierre de fase · Bloque 1 (ajuste): capacidades que el plan actual de Supabase sí aguanta.
--
-- Decisión de Walter (27-oct-2026): sin clientes todavía, no se amplía nada en
-- Supabase. El plan Pro incluye 100 GB de archivos para TODO el proyecto y el
-- límite global por archivo del proyecto es 50 MB. Por eso:
--   * límite por archivo de exámenes pesados (CBCT, escaneos): 50 MB (antes 200);
--     el de fotos y radiografías sigue en 20 MB;
--   * techo del bucket `clinical-exams`: 50 MB;
--   * cupo por clínica: Solo 15 GB y Clínica 45 GB (antes 25 / 75), para que
--     varias clínicas llenas quepan en los 100 GB incluidos.
-- Cuando haya clientes se sube todo con un UPDATE y el ajuste del proyecto.
--
-- Escribe datos (UPDATE de configuración). Redefine
-- `limite_por_archivo_de_examen` (misma firma y atributos que en producción).
-- Reversa al pie.

begin;

create or replace function public.limite_por_archivo_de_examen(p_kind text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind in ('cbct_dicom', 'escaneo_intraoral') then 52428800::bigint -- 50 MB
    else 20971520::bigint                                                    -- 20 MB
  end;
$$;

update storage.buckets set file_size_limit = 52428800 where id = 'clinical-exams';

update public.storage_quota_plans set quota_bytes = 16106127360, updated_at = now() where plan = 'solo';     -- 15 GB
update public.storage_quota_plans set quota_bytes = 48318382080, updated_at = now() where plan = 'clinica';  -- 45 GB

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- update storage.buckets set file_size_limit = 209715200 where id = 'clinical-exams';
-- update public.storage_quota_plans set quota_bytes = 26843545600 where plan = 'solo';
-- update public.storage_quota_plans set quota_bytes = 80530636800 where plan = 'clinica';
-- (volver a crear la función con 209715200 para cbct_dicom / escaneo_intraoral)
