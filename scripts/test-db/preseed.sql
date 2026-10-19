-- Fixtures que en producción existen desde antes de las migraciones.
-- Se cargan en la base efímera de tests ANTES de aplicar supabase/migrations/.

-- Cuenta de la demo pública (demo@esmalia.com). Las migraciones de demo
-- (reset_demo_clinic) la referencian por id fijo desde columnas con FK a
-- auth.users. Sin contraseña: en la base de tests nadie inicia sesión con ella.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '139dd209-8495-415c-b6cd-6bbc63367bad',
  'authenticated', 'authenticated', 'demo@esmalia.com', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
) ON CONFLICT (id) DO NOTHING;

-- Privilegios por defecto del esquema public como en producción.
-- Las imágenes recientes de Supabase local ya no otorgan SELECT/INSERT/UPDATE/
-- DELETE a anon/authenticated/service_role sobre tablas nuevas, ni EXECUTE
-- sobre funciones nuevas. El proyecto de producción es anterior a ese cambio
-- y conserva el esquema clásico (las migraciones lo dan por hecho: varias
-- tablas no tienen GRANT explícito y el service role las escribe). Sin esto,
-- la réplica falla con "permission denied" donde producción no falla.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated, service_role;
