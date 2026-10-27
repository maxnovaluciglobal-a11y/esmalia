-- Ola 11 · frente A (2/2): informes guardados del constructor libre (INF-04).
--
-- Una fila = una configuración (métrica, cortes, período relativo, filtros)
-- con nombre. No guarda resultados: al abrirla se vuelve a calcular con los
-- permisos de quien la abre, así que compartir un informe de montos con
-- alguien sin finanzas no le muestra montos (la lectura falla con 42501).
--
-- Quién ve qué:
--   - Cada miembro ve los suyos y los que alguien marcó "compartido".
--   - Solo quien lo creó lo edita o lo borra; owner/admin (can_manage_clinic)
--     también pueden borrar uno compartido.
--   - MFA: política restrictiva `mfa_exige_aal2` como el resto
--     (TABLAS_CON_AAL2 en src/lib/auth/mfa-rls.ts).
--   - La demo es de solo lectura (block_demo_writes).
--
-- Solo agrega una tabla: no escribe datos ni redefine funciones. Reversa al pie.

begin;

create table public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- { metrica, corte, corte2, periodo, desde?, hasta?, sucursal?, profesional?, comparar? }
  -- La valida la app (zod) al guardar y al abrir; acá solo se exige un objeto chico.
  config jsonb not null check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 4096),
  shared boolean not null default false,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.saved_reports is
  'INF-04: informes guardados del constructor libre (configuración, no resultados). Se recalculan con los permisos de quien los abre.';

create index saved_reports_clinic_idx on public.saved_reports (clinic_id, created_at desc);

create trigger saved_reports_updated_at before update on public.saved_reports
  for each row execute function public.set_updated_at();

create trigger block_demo_writes
  before insert or update or delete on public.saved_reports
  for each row execute function public.block_demo_writes();

grant select, insert, update, delete on public.saved_reports to authenticated;
revoke truncate on public.saved_reports from anon, authenticated;
grant all on public.saved_reports to service_role;
alter table public.saved_reports enable row level security;

create policy saved_reports_select_members on public.saved_reports
  for select to authenticated
  using (
    public.is_clinic_member(clinic_id)
    and (shared or created_by = (select auth.uid()))
  );
create policy saved_reports_insert_own on public.saved_reports
  for insert to authenticated
  with check (
    public.is_clinic_member(clinic_id)
    and created_by = (select auth.uid())
  );
create policy saved_reports_update_own on public.saved_reports
  for update to authenticated
  using (public.is_clinic_member(clinic_id) and created_by = (select auth.uid()))
  with check (public.is_clinic_member(clinic_id) and created_by = (select auth.uid()));
create policy saved_reports_delete_own_or_manager on public.saved_reports
  for delete to authenticated
  using (
    public.is_clinic_member(clinic_id)
    and (created_by = (select auth.uid()) or (shared and public.can_manage_clinic(clinic_id)))
  );

drop policy if exists mfa_exige_aal2 on public.saved_reports;
create policy mfa_exige_aal2 on public.saved_reports
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- drop policy if exists mfa_exige_aal2 on public.saved_reports;
-- drop table if exists public.saved_reports;
