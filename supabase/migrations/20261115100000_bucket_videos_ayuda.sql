-- Cierre de fase · Bloque 2: bucket público `videos-ayuda` con los videos de ayuda y Academia.
--
-- Son videos de pantallas de la demo (sin datos de pacientes ni de clínicas
-- reales). Lectura pública (para reproducirlos en la app y en /ayuda); nadie
-- con sesión puede subir ni borrar: solo el service role (el script de
-- publicación). Tope de 50 MB por archivo (límite global del plan actual).
--
-- No escribe datos de negocio. No redefine funciones. Reversa al pie.
-- sin-grant-authenticated: no es tabla del esquema public; la lectura pública es una política de storage.objects.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos-ayuda', 'videos-ayuda', true, 52428800, array['video/mp4'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists videos_ayuda_lectura_publica on storage.objects;
create policy videos_ayuda_lectura_publica on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'videos-ayuda');

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- drop policy if exists videos_ayuda_lectura_publica on storage.objects;
-- delete from storage.buckets where id = 'videos-ayuda';  -- tras vaciarlo
