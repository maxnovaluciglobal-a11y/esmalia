-- Ola 3 · Frente Arancel: especialidades del arancel (ADM-02) y campos del
-- catálogo chileno propio (ADM-03).
--
-- ADM-02. `specialties` existe desde julio (la usan profesionales y el
-- onboarding) pero sin una lista estándar: cada clínica escribió la suya. Acá
-- se le agrega `slug`, la clave estable de las once especialidades que
-- siembra Esmalia (más "Odontología general", que ya era el primer preset del
-- onboarding), y cada prestación del arancel pasa a pertenecer a una
-- (`procedures.specialty_id`). La lista sigue siendo editable: la clínica
-- renombra, agrega o desactiva; el slug solo sirve para que el catálogo
-- semilla sepa dónde poner cada prestación al importarla.
--
-- La siembra NO va en un trigger AFTER INSERT de `clinics`: el onboarding que
-- está en producción inserta "Endodoncia", "Ortodoncia"… justo después de
-- crear la clínica, y chocaría contra UNIQUE (clinic_id, name). Se siembra:
--   1. ahora, para todas las clínicas existentes (backfill al pie);
--   2. después, a demanda, con `asegurar_especialidades(clinic_id)` cuando
--      se abre el arancel. Es idempotente: no duplica ni pisa nombres.
--
-- ADM-03. El catálogo semilla vive en el código (`src/lib/arancel/
-- catalogo-chile.ts`, redactado por Esmalia) y se copia al arancel con un
-- clic (regla 10: copia, no FK viva). De cada ítem importado quedan en la
-- prestación el código Fonasa (opcional), la marca MAI y un rango de precio
-- de referencia que la clínica puede editar y que nunca se impone.
--
-- Compatible con el código en producción (RUNBOOK regla 3): columnas
-- nullable o con default, un índice, un trigger de integridad y dos
-- funciones. Nada se renombra ni se borra. Reversa al pie.

begin;

-- 1. specialties: slug estándar y orden ------------------------------------

alter table public.specialties
  add column if not exists slug text
    check (slug in (
      'general', 'operatoria', 'endodoncia', 'periodoncia', 'ortodoncia',
      'implantologia', 'odontopediatria', 'rehabilitacion', 'cirugia',
      'estetica', 'radiologia', 'otra'
    )),
  add column if not exists position smallint not null default 0;

comment on column public.specialties.slug is
  'ADM-02: clave estándar de la especialidad sembrada por Esmalia. NULL = especialidad propia de la clínica.';

create unique index if not exists specialties_clinic_slug_key
  on public.specialties (clinic_id, slug)
  where slug is not null;

-- 2. procedures: especialidad y campos del catálogo -------------------------

alter table public.procedures
  add column if not exists specialty_id uuid
    references public.specialties(id) on delete set null,
  add column if not exists fonasa_code text
    check (fonasa_code is null or char_length(fonasa_code) between 1 and 20),
  add column if not exists is_mai boolean not null default false,
  add column if not exists suggested_min_cents bigint
    check (suggested_min_cents is null or suggested_min_cents >= 0),
  add column if not exists suggested_max_cents bigint
    check (suggested_max_cents is null or suggested_max_cents >= 0),
  add column if not exists catalog_key text
    check (catalog_key is null or char_length(catalog_key) between 1 and 60);

alter table public.procedures
  drop constraint if exists procedures_rango_sugerido_ordenado;
alter table public.procedures
  add constraint procedures_rango_sugerido_ordenado check (
    suggested_min_cents is null
    or suggested_max_cents is null
    or suggested_min_cents <= suggested_max_cents
  );

comment on column public.procedures.specialty_id is
  'ADM-02: especialidad a la que pertenece la prestación. NULL = sin especialidad.';
comment on column public.procedures.fonasa_code is
  'ADM-03: código Fonasa (MLE) de la prestación, si la clínica lo usa. Opcional.';
comment on column public.procedures.is_mai is
  'ADM-03: la prestación tiene equivalente en la Modalidad de Atención Institucional de Fonasa.';
comment on column public.procedures.suggested_min_cents is
  'ADM-03: piso del rango de referencia que ve la clínica. Solo orientativo, nunca se impone. NULL = sin dato.';
comment on column public.procedures.suggested_max_cents is
  'ADM-03: techo del rango de referencia que ve la clínica. Solo orientativo, nunca se impone. NULL = sin dato.';
comment on column public.procedures.catalog_key is
  'ADM-03: clave del ítem del catálogo semilla del que se copió. No es FK: el catálogo vive en el código.';

create index if not exists procedures_clinic_specialty_idx
  on public.procedures (clinic_id, specialty_id);

-- La especialidad tiene que ser de la misma clínica. SECURITY INVOKER a
-- propósito: con la RLS de quien escribe, una especialidad de otra clínica ni
-- se ve, así que el EXISTS falla igual que si no existiera.
create or replace function public.procedures_especialidad_misma_clinica()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.specialty_id is not null and not exists (
    select 1 from public.specialties s
    where s.id = new.specialty_id and s.clinic_id = new.clinic_id
  ) then
    raise exception 'La especialidad no pertenece a esta clínica.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists procedures_especialidad_misma_clinica on public.procedures;
create trigger procedures_especialidad_misma_clinica
  before insert or update of specialty_id, clinic_id on public.procedures
  for each row execute function public.procedures_especialidad_misma_clinica();

-- 3. Siembra idempotente ---------------------------------------------------

-- Nombre libre ("Cirugía maxilofacial", "PRÓTESIS") → slug estándar, o NULL.
-- Sin mayúsculas, tildes ni espacios de más. La usan la siembra y el
-- backfill de prestaciones por categoría.
create or replace function public.slug_de_especialidad(p_nombre text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case translate(lower(btrim(coalesce(p_nombre, ''))), 'áéíóúüñ', 'aeiouun')
    when 'odontologia general' then 'general'
    when 'general' then 'general'
    when 'prevencion' then 'general'
    when 'diagnostico' then 'general'
    when 'diagnostico y prevencion' then 'general'
    when 'operatoria' then 'operatoria'
    when 'operatoria dental' then 'operatoria'
    when 'restauradora' then 'operatoria'
    when 'odontologia restauradora' then 'operatoria'
    when 'endodoncia' then 'endodoncia'
    when 'periodoncia' then 'periodoncia'
    when 'ortodoncia' then 'ortodoncia'
    when 'ortopedia' then 'ortodoncia'
    when 'ortodoncia y ortopedia' then 'ortodoncia'
    when 'implantologia' then 'implantologia'
    when 'implantes' then 'implantologia'
    when 'odontopediatria' then 'odontopediatria'
    when 'pediatria' then 'odontopediatria'
    when 'rehabilitacion oral' then 'rehabilitacion'
    when 'rehabilitacion' then 'rehabilitacion'
    when 'protesis' then 'rehabilitacion'
    when 'protesis fija' then 'rehabilitacion'
    when 'protesis removible' then 'rehabilitacion'
    when 'cirugia' then 'cirugia'
    when 'cirugia oral' then 'cirugia'
    when 'cirugia bucal' then 'cirugia'
    when 'cirugia maxilofacial' then 'cirugia'
    when 'estetica' then 'estetica'
    when 'estetica dental' then 'estetica'
    when 'radiologia' then 'radiologia'
    when 'radiologia oral' then 'radiologia'
    when 'imagenologia' then 'radiologia'
    when 'otra' then 'otra'
    when 'otras' then 'otra'
  end;
$$;

comment on function public.slug_de_especialidad(text) is
  'ADM-02: nombre de especialidad o categoría → slug estándar (sin mayúsculas ni tildes), o NULL.';

-- Hace el trabajo; no se expone por RPC (sin EXECUTE para authenticated).
-- a) A las especialidades que la clínica ya tiene y coinciden con un nombre
--    conocido les pone el slug (una fila por slug: la más vieja).
-- b) Crea las que falten. Si el nombre estándar ya existe (con otro slug o
--    sin él), no la crea: nunca pisa ni duplica.
-- c) Solo si en esta llamada se asignó o creó algún slug, ubica por su
--    categoría las prestaciones que todavía no tienen especialidad. Así un
--    arancel que la clínica ya ordenó a mano no se vuelve a tocar en cada
--    visita.
-- Devuelve cuántos slugs asignó o creó.
create or replace function public.sembrar_especialidades(p_clinic_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_asignados integer := 0;
  v_n integer;
begin
  -- a) slug a las que ya existen.
  with candidatas as (
    select distinct on (public.slug_de_especialidad(s.name))
           s.id, public.slug_de_especialidad(s.name) as slug
    from public.specialties s
    where s.clinic_id = p_clinic_id
      and s.slug is null
      and public.slug_de_especialidad(s.name) is not null
      and not exists (
        select 1 from public.specialties x
        where x.clinic_id = p_clinic_id
          and x.slug = public.slug_de_especialidad(s.name)
      )
    order by public.slug_de_especialidad(s.name), s.created_at, s.id
  )
  -- La posición sigue el orden estándar, así el arancel agrupa igual en
  -- todas las clínicas (la clínica puede tener otras propias después).
  update public.specialties s
     set slug = c.slug,
         position = array_position(array[
           'general', 'operatoria', 'endodoncia', 'periodoncia', 'ortodoncia',
           'implantologia', 'odontopediatria', 'rehabilitacion', 'cirugia',
           'estetica', 'radiologia', 'otra'
         ], c.slug) - 1
    from candidatas c
   where s.id = c.id;
  get diagnostics v_n = row_count;
  v_asignados := v_asignados + v_n;

  -- b) crea las que faltan.
  insert into public.specialties (clinic_id, name, slug, position, default_duration_min)
  select p_clinic_id, e.nombre, e.slug, e.posicion, e.duracion
  from (values
    ('general',         'Odontología general', 0::smallint, 30),
    ('operatoria',      'Operatoria',          1::smallint, 45),
    ('endodoncia',      'Endodoncia',          2::smallint, 60),
    ('periodoncia',     'Periodoncia',         3::smallint, 45),
    ('ortodoncia',      'Ortodoncia',          4::smallint, 30),
    ('implantologia',   'Implantología',       5::smallint, 90),
    ('odontopediatria', 'Odontopediatría',     6::smallint, 30),
    ('rehabilitacion',  'Rehabilitación oral', 7::smallint, 60),
    ('cirugia',         'Cirugía',             8::smallint, 45),
    ('estetica',        'Estética',            9::smallint, 45),
    ('radiologia',      'Radiología',          10::smallint, 15),
    ('otra',            'Otra',                11::smallint, 30)
  ) as e(slug, nombre, posicion, duracion)
  where not exists (
    select 1 from public.specialties x
    where x.clinic_id = p_clinic_id and x.slug = e.slug
  )
  on conflict (clinic_id, name) do nothing;
  get diagnostics v_n = row_count;
  v_asignados := v_asignados + v_n;

  -- c) ubica por categoría las prestaciones sin especialidad.
  if v_asignados > 0 then
    update public.procedures p
       set specialty_id = s.id
      from public.specialties s
     where p.clinic_id = p_clinic_id
       and p.specialty_id is null
       and p.category is not null
       and s.clinic_id = p_clinic_id
       and s.slug = public.slug_de_especialidad(p.category);
  end if;

  return v_asignados;
end;
$$;

comment on function public.sembrar_especialidades(uuid) is
  'ADM-02: siembra idempotente de las especialidades estándar de una clínica. Interna: la llama asegurar_especialidades y el backfill.';

revoke all on function public.sembrar_especialidades(uuid) from public, anon, authenticated;
grant execute on function public.sembrar_especialidades(uuid) to service_role;

-- Puerta por RPC. SECURITY DEFINER porque la clínica demo es de solo lectura
-- por trigger (block_demo_writes) y se resetea cada día: sin esto, después de
-- un reset nadie podría volver a sembrarle las especialidades. Sembrar una
-- lista estándar no da acceso a nada, así que alcanza con ser miembro.
create or replace function public.asegurar_especialidades(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_clinic_member(p_clinic_id) then
    raise exception 'No tienes permisos' using errcode = '42501';
  end if;
  return public.sembrar_especialidades(p_clinic_id);
end;
$$;

comment on function public.asegurar_especialidades(uuid) is
  'ADM-02: siembra a demanda las especialidades estándar de la clínica (idempotente). Solo miembros.';

revoke all on function public.asegurar_especialidades(uuid) from public, anon;
grant execute on function public.asegurar_especialidades(uuid) to authenticated, service_role;

-- 4. Backfill: todas las clínicas existentes ---------------------------------

select public.sembrar_especialidades(c.id) from public.clinics c;

commit;

-- Cómo revertir (en este orden):
-- drop function if exists public.asegurar_especialidades(uuid);
-- drop function if exists public.sembrar_especialidades(uuid);
-- drop function if exists public.slug_de_especialidad(text);
-- drop trigger if exists procedures_especialidad_misma_clinica on public.procedures;
-- drop function if exists public.procedures_especialidad_misma_clinica();
-- drop index if exists public.procedures_clinic_specialty_idx;
-- alter table public.procedures drop constraint if exists procedures_rango_sugerido_ordenado;
-- alter table public.procedures
--   drop column if exists catalog_key, drop column if exists suggested_max_cents,
--   drop column if exists suggested_min_cents, drop column if exists is_mai,
--   drop column if exists fonasa_code, drop column if exists specialty_id;
-- drop index if exists public.specialties_clinic_slug_key;
-- alter table public.specialties drop column if exists position, drop column if exists slug;
-- Las especialidades sembradas quedan como filas normales de la clínica (no
-- se borran: los profesionales pueden haberlas tomado).
