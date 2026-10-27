-- SEG-01, tercera parte: verificación en dos pasos con un código por correo,
-- además de la app autenticadora (TOTP). Pedido de Walter del 26-oct-2026
-- (esperaba un correo con el código y Esmalia solo usaba Google
-- Authenticator). Detalle y decisiones en docs/MFA.md.
--
-- Por qué no es un factor de Supabase: Supabase Auth solo tiene factores
-- TOTP y teléfono. Un código por correo no sube la sesión a `aal2`, así que
-- la verificación se registra acá, atada al `session_id` del JWT, y
-- `public.sesion_cumple_mfa()` (la que usan las políticas RESTRICTIVE
-- `mfa_exige_aal2` y el guard de las RPC) pasa a aceptar `aal2` O una
-- verificación por correo vigente PARA ESA SESIÓN.
--
--   mfa_email_settings       quién usa el correo como segundo paso y qué
--                            método prefiere al entrar.
--   mfa_email_codes          códigos de 6 dígitos: solo el sha256 (atado a
--                            usuario + sesión + código), 10 minutos, 5
--                            intentos, un solo uso.
--   mfa_email_verifications  sesión (session_id del JWT) que pasó el código.
--                            Vale mientras la sesión exista en auth.sessions
--                            y el usuario tenga el correo activo.
--   mfa_email_events         bitácora: códigos enviados, fallidos,
--                            verificaciones, altas y bajas.
--
-- Las cuatro tablas son de backend: RLS activa SIN políticas (solo
-- service_role). El usuario lee su estado con `mi_estado_mfa()`.
--
-- Funciones que el servidor llama con service_role (nadie más):
--   mfa_correo_emitir_codigo     guarda el hash; límites: 1 por minuto por
--                                sesión, 5 por hora por usuario.
--   mfa_correo_verificar_codigo  valida y, si coincide, marca el código
--                                como usado y registra la sesión.
--
-- Inscribir un TOTP con el correo activo: GoTrue deja inscribir un factor a
-- una sesión `aal1` cuando no hay otro factor de Supabase, así que con solo
-- la contraseña se podía sumar un TOTP propio y subir a `aal2` sin pasar por
-- el correo. El trigger `exigir_correo_para_inscribir_factor` lo frena salvo
-- que una sesión verificada lo haya autorizado en los últimos 10 minutos
-- (`totp_enroll_allowed_until`, lo escribe el servidor).
--
-- Compatible con producción: tablas y funciones nuevas; `sesion_cumple_mfa`
-- conserva exactamente la definición vigente (consultada en producción el
-- 26-oct-2026, igual a 20261019230000) y solo agrega una condición: quien no
-- activó el correo ve el mismo resultado que antes.
--
-- ⚠️ NO APLICADA. Requiere OK de Walter (regla 5 del CLAUDE.md del repo).
-- Reversa al pie.

begin;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.mfa_email_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  preferred_method text not null default 'totp'
    check (preferred_method in ('totp', 'email')),
  enabled_at timestamptz,
  totp_enroll_allowed_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.mfa_email_settings is
  'SEG-01: segundo paso por correo. Backend: sin políticas, solo service_role. Ver docs/MFA.md.';

create table if not exists public.mfa_email_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  purpose text not null check (purpose in ('login', 'activar')),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  ip text,
  user_agent text
);

create index if not exists mfa_email_codes_usuario_idx
  on public.mfa_email_codes (user_id, created_at desc);

comment on table public.mfa_email_codes is
  'SEG-01: códigos por correo (solo el sha256). 10 min, 5 intentos, un solo uso. Backend: solo service_role.';

create table if not exists public.mfa_email_verifications (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now()
);

create index if not exists mfa_email_verifications_usuario_idx
  on public.mfa_email_verifications (user_id);

comment on table public.mfa_email_verifications is
  'SEG-01: sesiones (session_id del JWT) que pasaron el código por correo. Backend: solo service_role.';

create table if not exists public.mfa_email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  event text not null check (event in (
    'codigo_enviado', 'envio_fallido', 'codigo_incorrecto', 'codigo_agotado',
    'verificado', 'correo_activado', 'correo_desactivado', 'metodo_preferido',
    'totp_autorizado'
  )),
  detail text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists mfa_email_events_usuario_idx
  on public.mfa_email_events (user_id, created_at desc);

comment on table public.mfa_email_events is
  'SEG-01: bitácora del segundo paso por correo. Nunca guarda el código. Backend: solo service_role.';

revoke all on public.mfa_email_settings from public, anon, authenticated;
revoke all on public.mfa_email_codes from public, anon, authenticated;
revoke all on public.mfa_email_verifications from public, anon, authenticated;
revoke all on public.mfa_email_events from public, anon, authenticated;
grant all on public.mfa_email_settings to service_role;
grant all on public.mfa_email_codes to service_role;
grant all on public.mfa_email_verifications to service_role;
grant all on public.mfa_email_events to service_role;
alter table public.mfa_email_settings enable row level security;
alter table public.mfa_email_codes enable row level security;
alter table public.mfa_email_verifications enable row level security;
alter table public.mfa_email_events enable row level security;

-- ---------------------------------------------------------------------------
-- ¿Esta sesión pasó el código por correo?
-- ---------------------------------------------------------------------------

create or replace function public.sesion_mfa_por_correo_vigente()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.mfa_email_verifications v
      join public.mfa_email_settings m
        on m.user_id = v.user_id
       and m.enabled
      join auth.sessions s
        on s.id = v.session_id
       and s.user_id = v.user_id
     where v.user_id = auth.uid()
       and v.session_id = (
         case
           when (auth.jwt() ->> 'session_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then (auth.jwt() ->> 'session_id')::uuid
         end
       )
       and (s.not_after is null or s.not_after > now())
  );
$$;

comment on function public.sesion_mfa_por_correo_vigente() is
  'SEG-01: true si la sesión del JWT (session_id) pasó el código por correo, sigue viva y el usuario tiene el correo activo.';

revoke execute on function public.sesion_mfa_por_correo_vigente() from public, anon;
grant execute on function public.sesion_mfa_por_correo_vigente() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sesion_cumple_mfa: definición vigente en producción + el correo
-- ---------------------------------------------------------------------------

create or replace function public.sesion_cumple_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or (
      not exists (
        select 1
          from auth.mfa_factors f
         where f.user_id = auth.uid()
           and f.status = 'verified'
      )
      and not exists (
        select 1
          from public.mfa_email_settings m
         where m.user_id = auth.uid()
           and m.enabled
      )
    )
    or exists (
      select 1
        from auth.users u
       where u.id = auth.uid()
         and lower(coalesce(u.email, '')) = 'demo@esmalia.com'
    )
    or public.sesion_mfa_por_correo_vigente();
$$;

comment on function public.sesion_cumple_mfa() is
  'SEG-01: true si la sesión es aal2, si pasó el código por correo (esta sesión), si el usuario no tiene ningún segundo paso activo, o si es la cuenta demo. La usan las políticas RESTRICTIVE mfa_exige_aal2.';

revoke execute on function public.sesion_cumple_mfa() from public, anon;
grant execute on function public.sesion_cumple_mfa() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Estado para la interfaz (el propio usuario)
-- ---------------------------------------------------------------------------

create or replace function public.mi_estado_mfa()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'correo_activo',
      coalesce((select m.enabled from public.mfa_email_settings m where m.user_id = auth.uid()), false),
    'metodo_preferido',
      coalesce((select m.preferred_method from public.mfa_email_settings m where m.user_id = auth.uid()), 'totp'),
    'tiene_totp',
      exists (
        select 1 from auth.mfa_factors f
         where f.user_id = auth.uid()
           and f.status = 'verified'
           and f.factor_type::text = 'totp'
      ),
    'sesion_verificada_por_correo', public.sesion_mfa_por_correo_vigente(),
    'sesion_cumple', public.sesion_cumple_mfa()
  ) end;
$$;

comment on function public.mi_estado_mfa() is
  'SEG-01: estado del segundo paso del usuario y de su sesión actual (para /auth/verificar y /preferencias).';

revoke execute on function public.mi_estado_mfa() from public, anon;
grant execute on function public.mi_estado_mfa() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Emitir un código (solo service_role)
-- ---------------------------------------------------------------------------

create or replace function public.mfa_correo_emitir_codigo(
  p_user_id uuid,
  p_session_id uuid,
  p_proposito text,
  p_code_hash text,
  p_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activo boolean;
  v_ultimo timestamptz;
  v_en_la_hora integer;
  v_vence timestamptz := now() + interval '10 minutes';
begin
  if p_user_id is null or p_session_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;
  if p_proposito not in ('login', 'activar') then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  -- Serializa los pedidos del mismo usuario (dos clics seguidos).
  perform pg_advisory_xact_lock(hashtextextended('mfa_correo:' || p_user_id::text, 0));

  select m.enabled into v_activo from public.mfa_email_settings m where m.user_id = p_user_id;
  v_activo := coalesce(v_activo, false);
  if p_proposito = 'login' and not v_activo then
    return jsonb_build_object('ok', false, 'motivo', 'no_activo');
  end if;
  if p_proposito = 'activar' and v_activo then
    return jsonb_build_object('ok', false, 'motivo', 'ya_activo');
  end if;

  -- Uno por minuto por sesión; cinco por hora por usuario (todas sus sesiones).
  select max(c.created_at) filter (where c.session_id = p_session_id), count(*)
    into v_ultimo, v_en_la_hora
    from public.mfa_email_codes c
   where c.user_id = p_user_id
     and c.created_at > now() - interval '1 hour';

  if v_ultimo is not null and v_ultimo > now() - interval '60 seconds' then
    return jsonb_build_object(
      'ok', false, 'motivo', 'espera',
      'esperar', greatest(1, ceil(extract(epoch from (v_ultimo + interval '60 seconds' - now())))::int)
    );
  end if;
  if coalesce(v_en_la_hora, 0) >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'demasiados');
  end if;

  -- Un código nuevo anula los anteriores sin usar del usuario.
  update public.mfa_email_codes
     set expires_at = least(expires_at, now())
   where user_id = p_user_id
     and consumed_at is null
     and expires_at > now();

  -- Limpieza: códigos de más de un día.
  delete from public.mfa_email_codes
   where user_id = p_user_id
     and created_at < now() - interval '1 day';

  insert into public.mfa_email_codes (user_id, session_id, purpose, code_hash, expires_at, ip, user_agent)
  values (p_user_id, p_session_id, p_proposito, p_code_hash, v_vence,
          nullif(left(coalesce(p_ip, ''), 64), ''), nullif(left(coalesce(p_user_agent, ''), 400), ''));

  insert into public.mfa_email_events (user_id, session_id, event, detail, ip, user_agent)
  values (p_user_id, p_session_id, 'codigo_enviado', p_proposito,
          nullif(left(coalesce(p_ip, ''), 64), ''), nullif(left(coalesce(p_user_agent, ''), 400), ''));

  return jsonb_build_object('ok', true, 'vence', v_vence);
end;
$$;

revoke all on function public.mfa_correo_emitir_codigo(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.mfa_correo_emitir_codigo(uuid, uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Verificar un código (solo service_role)
-- ---------------------------------------------------------------------------

create or replace function public.mfa_correo_verificar_codigo(
  p_user_id uuid,
  p_session_id uuid,
  p_proposito text,
  p_code_hash text,
  p_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.mfa_email_codes%rowtype;
  v_ip text := nullif(left(coalesce(p_ip, ''), 64), '');
  v_ua text := nullif(left(coalesce(p_user_agent, ''), 400), '');
  v_intentos integer;
  v_tiene_totp boolean;
begin
  if p_user_id is null or p_session_id is null
     or p_proposito not in ('login', 'activar')
     or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  -- El último código sin usar de ESTA sesión y para este propósito.
  select * into c
    from public.mfa_email_codes x
   where x.user_id = p_user_id
     and x.session_id = p_session_id
     and x.purpose = p_proposito
     and x.consumed_at is null
   order by x.created_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sin_codigo');
  end if;
  if c.expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'vencido');
  end if;
  if c.attempts >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'agotado');
  end if;

  if c.code_hash <> p_code_hash then
    v_intentos := c.attempts + 1;
    update public.mfa_email_codes set attempts = v_intentos where id = c.id;
    insert into public.mfa_email_events (user_id, session_id, event, ip, user_agent)
    values (p_user_id, p_session_id,
            case when v_intentos >= 5 then 'codigo_agotado' else 'codigo_incorrecto' end,
            v_ip, v_ua);
    if v_intentos >= 5 then
      return jsonb_build_object('ok', false, 'motivo', 'agotado');
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'incorrecto', 'restantes', 5 - v_intentos);
  end if;

  update public.mfa_email_codes set consumed_at = now() where id = c.id;

  if p_proposito = 'activar' then
    v_tiene_totp := exists (
      select 1 from auth.mfa_factors f
       where f.user_id = p_user_id and f.status = 'verified'
    );
    insert into public.mfa_email_settings (user_id, enabled, preferred_method, enabled_at, updated_at)
    values (p_user_id, true, case when v_tiene_totp then 'totp' else 'email' end, now(), now())
    on conflict (user_id) do update
       set enabled = true,
           preferred_method = case when v_tiene_totp
                                   then public.mfa_email_settings.preferred_method
                                   else 'email' end,
           enabled_at = now(),
           updated_at = now();
    insert into public.mfa_email_events (user_id, session_id, event, ip, user_agent)
    values (p_user_id, p_session_id, 'correo_activado', v_ip, v_ua);
  end if;

  -- Limpieza: verificaciones de sesiones que ya no existen.
  delete from public.mfa_email_verifications v
   where v.user_id = p_user_id
     and not exists (select 1 from auth.sessions s where s.id = v.session_id);

  insert into public.mfa_email_verifications (session_id, user_id, verified_at)
  values (p_session_id, p_user_id, now())
  on conflict (session_id) do update
     set verified_at = now()
   where public.mfa_email_verifications.user_id = excluded.user_id;

  insert into public.mfa_email_events (user_id, session_id, event, detail, ip, user_agent)
  values (p_user_id, p_session_id, 'verificado', p_proposito, v_ip, v_ua);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mfa_correo_verificar_codigo(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.mfa_correo_verificar_codigo(uuid, uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Inscribir un factor de Supabase con el correo activo
-- ---------------------------------------------------------------------------
--
-- Mismo patrón que `bloquear_mfa_cuenta_demo` (20261019140000): trigger en
-- auth.mfa_factors, que solo escribe GoTrue.

create or replace function public.exigir_correo_para_inscribir_factor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.mfa_email_settings m
     where m.user_id = new.user_id
       and m.enabled
       and (m.totp_enroll_allowed_until is null or m.totp_enroll_allowed_until <= now())
  ) then
    raise exception 'Para sumar la app autenticadora, primero verifica tu sesión con el código por correo.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.exigir_correo_para_inscribir_factor() from public, anon, authenticated;

drop trigger if exists exigir_correo_para_inscribir_factor on auth.mfa_factors;
create trigger exigir_correo_para_inscribir_factor
  before insert on auth.mfa_factors
  for each row
  execute function public.exigir_correo_para_inscribir_factor();

commit;

-- Cómo revertir (se pierde la configuración del correo como segundo paso: los
-- usuarios que solo tenían el correo quedan con solo la contraseña). En una
-- transacción, y en este orden (sesion_cumple_mfa primero, porque la versión
-- nueva usa las tablas):
--
-- begin;
-- create or replace function public.sesion_cumple_mfa()
-- returns boolean
-- language sql
-- stable
-- security definer
-- set search_path = ''
-- as $$
--   select
--     coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
--     or not exists (
--       select 1
--         from auth.mfa_factors f
--        where f.user_id = auth.uid()
--          and f.status = 'verified'
--     )
--     or exists (
--       select 1
--         from auth.users u
--        where u.id = auth.uid()
--          and lower(coalesce(u.email, '')) = 'demo@esmalia.com'
--     );
-- $$;
-- drop trigger if exists exigir_correo_para_inscribir_factor on auth.mfa_factors;
-- drop function if exists public.exigir_correo_para_inscribir_factor();
-- drop function if exists public.mfa_correo_verificar_codigo(uuid, uuid, text, text, text, text);
-- drop function if exists public.mfa_correo_emitir_codigo(uuid, uuid, text, text, text, text);
-- drop function if exists public.mi_estado_mfa();
-- drop function if exists public.sesion_mfa_por_correo_vigente();
-- drop table if exists public.mfa_email_events;
-- drop table if exists public.mfa_email_verifications;
-- drop table if exists public.mfa_email_codes;
-- drop table if exists public.mfa_email_settings;
-- commit;
