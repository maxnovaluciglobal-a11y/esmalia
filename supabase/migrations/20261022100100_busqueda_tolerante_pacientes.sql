-- Ola 1 · PAC-02: búsqueda de pacientes que tolera tildes y errores de tipeo.
-- "jose peres" encuentra a "José Pérez".
--
-- Qué hace:
--  1. Extensiones unaccent y pg_trgm en el schema `extensions` (como las
--     instala Supabase). Si alguna ya estuviera en otro schema, se usa donde
--     esté: el schema se lee de pg_extension y el SQL se arma con format().
--  2. normalizar_busqueda(text): minúsculas, sin tildes y con espacios
--     simples. IMMUTABLE (envuelve unaccent con el diccionario calificado),
--     así se puede indexar. Par de `normalizarTexto` en src/lib/search.ts.
--  3. Índice GIN de trigramas sobre normalizar_busqueda(full_name).
--  4. buscar_pacientes_por_nombre(clinic, término, límite): SECURITY INVOKER,
--     así que la RLS de patients se aplica igual que en un SELECT de la app.
--     Coincide por subcadena, por similitud (%) o por similitud de palabra
--     (<%) y ordena por la mejor de las dos similitudes.
--
-- Solo agrega objetos nuevos: el código en producción no los usa.
-- Reversa al pie.

begin;

create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

do $$
declare
  s_unaccent text;
  s_trgm text;
begin
  select n.nspname into s_unaccent
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'unaccent';
  select n.nspname into s_trgm
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';

  execute format(
    $f$
    create or replace function public.normalizar_busqueda(p_texto text)
    returns text
    language sql
    immutable
    parallel safe
    set search_path = ''
    as $b$
      select lower(btrim(regexp_replace(
        %1$I.unaccent(%2$L::regdictionary, coalesce(p_texto, '')),
        '\s+', ' ', 'g'
      )))
    $b$
    $f$,
    s_unaccent,
    s_unaccent || '.unaccent'
  );

  execute format(
    'create index if not exists patients_nombre_busqueda_trgm_idx on public.patients '
    'using gin (public.normalizar_busqueda(full_name) %I.gin_trgm_ops)',
    s_trgm
  );
end
$$;

comment on function public.normalizar_busqueda(text) is
  'PAC-02: texto en minúsculas, sin tildes y con espacios simples, para buscar e indexar. Par de normalizarTexto (src/lib/search.ts).';

create or replace function public.buscar_pacientes_por_nombre(
  p_clinic_id uuid,
  p_termino text,
  p_limite integer default 8
)
returns table (
  id uuid,
  full_name text,
  document_id text,
  phone text,
  similitud real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with t as (
    select public.normalizar_busqueda(p_termino) as q
  ),
  candidatos as (
    select p.id, p.full_name, p.document_id, p.phone,
           public.normalizar_busqueda(p.full_name) as n
      from public.patients p, t
     where p.clinic_id = p_clinic_id
       and p.archived_at is null
       and char_length(t.q) >= 2
       and (
         public.normalizar_busqueda(p.full_name)
           like '%' || replace(replace(replace(t.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
         or public.normalizar_busqueda(p.full_name) % t.q
         or t.q <% public.normalizar_busqueda(p.full_name)
       )
  )
  select c.id, c.full_name, c.document_id, c.phone,
         greatest(similarity(c.n, t.q), word_similarity(t.q, c.n))::real as similitud
    from candidatos c, t
   order by
     (strpos(c.n, t.q) > 0) desc,
     greatest(similarity(c.n, t.q), word_similarity(t.q, c.n)) desc,
     c.full_name
   limit least(greatest(coalesce(p_limite, 8), 1), 50);
$$;

comment on function public.buscar_pacientes_por_nombre(uuid, text, integer) is
  'PAC-02: pacientes activos de la clínica cuyo nombre coincide con el término, tolerando tildes y errores de tipeo. SECURITY INVOKER: la RLS de patients se aplica.';

revoke execute on function public.buscar_pacientes_por_nombre(uuid, text, integer) from public, anon;
grant execute on function public.buscar_pacientes_por_nombre(uuid, text, integer) to authenticated, service_role;

commit;

-- Cómo revertir (en una migración correctiva, ver el PR):
-- begin;
-- drop function if exists public.buscar_pacientes_por_nombre(uuid, text, integer);
-- drop index if exists public.patients_nombre_busqueda_trgm_idx;
-- drop function if exists public.normalizar_busqueda(text);
-- -- Las extensiones unaccent y pg_trgm se pueden dejar instaladas (no tienen
-- -- datos). Para quitarlas: drop extension if exists pg_trgm; drop extension if exists unaccent;
-- commit;
