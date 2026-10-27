-- Ola 12 · frente A (1/2): progreso de la ayuda (ONB-03, ONB-04, NAV-10).
--
-- Una fila = algo que la persona ya hizo en la ayuda:
--   - kind 'tour':     vio (o saltó) el recorrido guiado de una pantalla;
--   - kind 'leccion':  marcó como vista una lección de la Academia;
--   - kind 'novedad':  leyó una novedad (la marca de "no leído" es su ausencia).
-- `item_key` es el id estable del contenido (src/content/ayuda/*.ts).
--
-- Es de la PERSONA, no de la clínica: el recorrido de la agenda es el mismo
-- en todas sus clínicas, así que no lleva clinic_id (y por eso no entra en la
-- exportación de la clínica, que exige clinic_id). Sin datos de pacientes.
--
-- Quién ve qué: cada usuario solo sus filas (user_id = auth.uid()), para
-- leer, marcar y desmarcar. Nadie ve el progreso de otro.
-- La demo comparte un usuario entre visitantes: la app guarda su progreso en
-- el navegador y no escribe acá (no hace falta block_demo_writes: la tabla
-- no es de la clínica).
--
-- MFA: sin `mfa_exige_aal2` (TABLAS_SIN_AAL2 en src/lib/auth/mfa-rls.ts):
-- son marcas propias sin datos de salud ni dinero, como notification_preferences.
--
-- Solo agrega una tabla: no escribe datos ni redefine funciones. Reversa al pie.

begin;

create table public.help_progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('tour', 'leccion', 'novedad')),
  item_key text not null check (item_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  done_at timestamptz not null default now(),
  primary key (user_id, kind, item_key)
);

comment on table public.help_progress is
  'ONB-03/ONB-04/NAV-10: recorridos vistos, lecciones de la Academia vistas y novedades leídas, por persona.';

grant select, insert, update, delete on public.help_progress to authenticated;
revoke truncate on public.help_progress from anon, authenticated;
grant all on public.help_progress to service_role;
alter table public.help_progress enable row level security;

create policy help_progress_select_own on public.help_progress
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy help_progress_insert_own on public.help_progress
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy help_progress_update_own on public.help_progress
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy help_progress_delete_own on public.help_progress
  for delete to authenticated
  using (user_id = (select auth.uid()));

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- drop table if exists public.help_progress;
