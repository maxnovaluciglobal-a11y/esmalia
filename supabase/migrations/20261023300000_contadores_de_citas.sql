-- Contadores de citas en la ficha del paciente (FIC-12, Ola 2).
--
-- La ficha muestra cuántas citas atendió el paciente, cuántas faltó (con %),
-- cuántas se anularon, cuántas tiene por delante, y la fecha de la última
-- visita y de la próxima cita. Se cuenta en Postgres y no trayendo las citas
-- a JS: PostgREST corta toda respuesta en `max_rows` (1000) sin avisar, y un
-- paciente de ortodoncia de varios años puede pasar ese número sumando las
-- de sus fichas fusionadas.
--
-- SECURITY INVOKER: corre con los permisos de quien llama, así que la RLS de
-- `appointments` (incluida `mfa_exige_aal2`) se aplica igual que en un SELECT
-- por REST. No agrega ni cambia ninguna política.
--
-- Reglas (las mismas que usa la app):
--   atendidas      = status 'finalizada'
--   inasistencias  = status 'ausente'
--   anuladas       = status 'cancelada'
--   próximas       = empiezan después de ahora y siguen abiertas
--                    ('tentativa', 'confirmada', 'en-sala')
--   sin cerrar     = terminaron antes de ahora y siguen abiertas (PAN-05)
--   última visita  = inicio de la atendida más reciente
--   próxima cita   = inicio de la próxima abierta
-- "Ahora" es un instante (`now()`), igual en todos los husos: una cita de las
-- 10:00 en Santiago terminó o no terminó, sin importar el reloj del servidor.

create or replace function public.patient_appointment_counters(
  p_clinic_id uuid,
  p_patient_id uuid
)
returns table (
  attended integer,
  no_show integer,
  cancelled integer,
  upcoming integer,
  past_open integer,
  last_visit_at timestamptz,
  next_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where a.status = 'finalizada')::integer as attended,
    count(*) filter (where a.status = 'ausente')::integer as no_show,
    count(*) filter (where a.status = 'cancelada')::integer as cancelled,
    count(*) filter (
      where a.starts_at > now()
        and a.status in ('tentativa', 'confirmada', 'en-sala')
    )::integer as upcoming,
    count(*) filter (
      where a.ends_at < now()
        and a.status in ('tentativa', 'confirmada', 'en-sala')
    )::integer as past_open,
    max(a.starts_at) filter (where a.status = 'finalizada') as last_visit_at,
    min(a.starts_at) filter (
      where a.starts_at > now()
        and a.status in ('tentativa', 'confirmada', 'en-sala')
    ) as next_at
  from public.appointments a
  where a.clinic_id = p_clinic_id
    and a.patient_id = p_patient_id;
$$;

comment on function public.patient_appointment_counters(uuid, uuid) is
  'Contadores de citas de un paciente (FIC-12). SECURITY INVOKER: respeta la RLS de appointments.';

revoke all on function public.patient_appointment_counters(uuid, uuid) from public, anon;
grant execute on function public.patient_appointment_counters(uuid, uuid) to authenticated, service_role;

-- Reversa:
-- drop function if exists public.patient_appointment_counters(uuid, uuid);
