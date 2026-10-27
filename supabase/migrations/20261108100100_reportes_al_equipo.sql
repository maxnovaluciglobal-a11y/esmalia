-- Ola 12 · frente A (2/2): reportar un problema o sugerir algo desde la app (ONB-09).
--
-- Una fila = un mensaje de una persona de la clínica al equipo de Esmalia,
-- con la pantalla donde estaba y, si quiso, una captura (tapada donde ella
-- eligió). La captura vive en el bucket privado `reportes-de-ayuda`, que no
-- tiene políticas: solo la sube y la lee el servidor (service_role).
--
-- Quién ve qué:
--   - Un miembro de la clínica puede CREAR un reporte suyo para su clínica.
--   - Nadie de la clínica lo lee, cambia ni borra (ni quien lo escribió): es
--     para el equipo de Esmalia, que lo ve en /admin/reportes con el cliente
--     de servicio detrás de la allowlist ESMALIA_STAFF_EMAILS + aal2.
--   - Por eso a `authenticated` solo se le otorga INSERT.
--   - MFA: política restrictiva `mfa_exige_aal2` (la captura puede mostrar
--     datos de un paciente si la persona no la tapó).
--   - La demo es de solo lectura (block_demo_writes).
--
-- Escribe datos solo en storage.buckets (crea el bucket privado, idempotente).
-- No redefine funciones. Reversa al pie.

begin;

create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('problema', 'sugerencia')),
  message text not null check (char_length(btrim(message)) between 5 and 4000),
  -- Solo la ruta (sin query string): "/pacientes/<uuid>", nunca un nombre.
  screen_path text check (screen_path is null or (screen_path ~ '^/' and char_length(screen_path) <= 300)),
  screen_label text check (screen_label is null or char_length(screen_label) <= 120),
  screenshot_path text check (screenshot_path is null or char_length(screenshot_path) <= 200),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  viewport text check (viewport is null or char_length(viewport) <= 20),
  status text not null default 'nuevo' check (status in ('nuevo', 'visto', 'resuelto')),
  created_at timestamptz not null default now()
);

comment on table public.feedback_reports is
  'ONB-09: problemas y sugerencias enviados desde la app al equipo de Esmalia. Solo el servidor los lee.';

create index feedback_reports_created_idx on public.feedback_reports (created_at desc);
create index feedback_reports_clinic_idx on public.feedback_reports (clinic_id, created_at desc);

create trigger block_demo_writes
  before insert or update or delete on public.feedback_reports
  for each row execute function public.block_demo_writes();

grant insert on public.feedback_reports to authenticated;
revoke truncate on public.feedback_reports from anon, authenticated;
grant all on public.feedback_reports to service_role;
alter table public.feedback_reports enable row level security;

create policy feedback_reports_insert_own on public.feedback_reports
  for insert to authenticated
  with check (
    public.is_clinic_member(clinic_id)
    and created_by = (select auth.uid())
    and status = 'nuevo'
  );

drop policy if exists mfa_exige_aal2 on public.feedback_reports;
create policy mfa_exige_aal2 on public.feedback_reports
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reportes-de-ayuda',
  'reportes-de-ayuda',
  false,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- (vaciar antes el bucket desde el panel de Storage si tiene capturas)
-- delete from storage.buckets where id = 'reportes-de-ayuda';
-- drop policy if exists mfa_exige_aal2 on public.feedback_reports;
-- drop table if exists public.feedback_reports;
