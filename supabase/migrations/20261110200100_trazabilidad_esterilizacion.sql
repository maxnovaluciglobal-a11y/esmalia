-- Ola 14 · frente B (2/2): trazabilidad de esterilización (MKT-10).
--
--   sterilization_cycles    ciclos de autoclave: equipo, fecha y hora, n.º
--                           de ciclo (correlativo por clínica y año), tipo,
--                           parámetros (temperatura, presión, tiempo),
--                           indicador químico y biológico, resultado y
--                           responsable.
--   sterilization_packages  paquetes/lotes de instrumental de un ciclo, con
--                           código propio (etiqueta con QR), contenido,
--                           vencimiento del estéril y, al usarse, el paciente
--                           y la cita en que se abrió.
--
-- Para qué: si un ciclo falla (indicador biológico positivo días después),
-- saber a qué pacientes se les usó instrumental de ese ciclo. Es lo que pide
-- la autorización sanitaria (registro de ciclos y trazabilidad).
--
-- Reglas en la base (todo gate de la UI tiene su par acá):
--   · correlativos con next_clinic_counter (regla 8): kinds
--     'sterilization_cycle' y 'sterilization_package', por año de la clínica.
--   · un indicador fallido deja el ciclo fallido; un ciclo se aprueba solo con
--     el indicador químico aprobado (o "no aplica") y el biológico no fallido.
--   · cerrado el resultado, los parámetros no se editan; el biológico se puede
--     leer después (24-48 h) y, si falla, el ciclo pasa a fallido.
--   · un ciclo fallido retira sus paquetes disponibles; los ya usados quedan
--     como están y salen en el rastreo.
--   · un paquete se usa una sola vez, solo si su ciclo está aprobado y el
--     estéril no venció (fecha de la clínica), con un paciente de la clínica y,
--     si se indica, una cita de ese paciente (o una cita grupal donde está
--     inscrito). Un paquete usado no vuelve atrás.
--   · las pruebas del equipo (Bowie-Dick, Helix, vacío) no llevan paquetes.
--   · nada se borra (sin DELETE): se descarta o se retira con motivo.
--
-- Permisos: ven quienes ven el inventario (todos menos contabilidad);
-- registran owner/admin/dentist/assistant. Verificación en dos pasos
-- (mfa_exige_aal2).
--
-- No escribe datos. No redefine funciones existentes. Reversa al pie.

begin;

-- ── Ciclos ────────────────────────────────────────────────────────────────
create table if not exists public.sterilization_cycles (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  year integer not null,
  number integer not null,
  equipment text not null,
  equipment_serial text,
  run_at timestamptz not null,
  cycle_type text not null,
  temperature_c numeric(5,1),
  pressure_bar numeric(5,2),
  exposure_minutes numeric(5,1),
  chemical_indicator text not null default 'pendiente',
  chemical_indicator_class text,
  biological_indicator text not null default 'no_aplica',
  biological_lot text,
  biological_read_at timestamptz,
  result text not null default 'pendiente',
  result_at timestamptz,
  failure_reason text,
  responsible_name text not null,
  notes text,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sterilization_cycles_number_key unique (clinic_id, year, number),
  constraint sterilization_cycles_equipment_check check (char_length(btrim(equipment)) between 2 and 120),
  constraint sterilization_cycles_serial_check check (equipment_serial is null or char_length(equipment_serial) <= 80),
  constraint sterilization_cycles_type_check check (
    cycle_type in ('envuelto', 'sin_envolver', 'prion', 'bowie_dick', 'helix', 'prueba_vacio', 'otro')
  ),
  constraint sterilization_cycles_temperature_check check (temperature_c is null or temperature_c between 50 and 200),
  constraint sterilization_cycles_pressure_check check (pressure_bar is null or pressure_bar between 0 and 10),
  constraint sterilization_cycles_exposure_check check (exposure_minutes is null or exposure_minutes between 0 and 600),
  constraint sterilization_cycles_chemical_check check (
    chemical_indicator in ('pendiente', 'aprobado', 'fallido', 'no_aplica')
  ),
  constraint sterilization_cycles_chemical_class_check check (
    chemical_indicator_class is null or char_length(chemical_indicator_class) <= 40
  ),
  constraint sterilization_cycles_biological_check check (
    biological_indicator in ('pendiente', 'aprobado', 'fallido', 'no_aplica')
  ),
  constraint sterilization_cycles_biological_lot_check check (
    biological_lot is null or char_length(biological_lot) <= 60
  ),
  constraint sterilization_cycles_result_check check (result in ('pendiente', 'aprobado', 'fallido')),
  constraint sterilization_cycles_aprobado_check check (
    result <> 'aprobado'
    or (chemical_indicator in ('aprobado', 'no_aplica') and biological_indicator <> 'fallido')
  ),
  constraint sterilization_cycles_failure_check check (failure_reason is null or char_length(failure_reason) <= 500),
  constraint sterilization_cycles_responsible_check check (char_length(btrim(responsible_name)) between 2 and 120),
  constraint sterilization_cycles_notes_check check (notes is null or char_length(notes) <= 1000)
);

create index if not exists sterilization_cycles_clinic_idx
  on public.sterilization_cycles (clinic_id, run_at desc);

comment on table public.sterilization_cycles is
  'MKT-10: ciclos de autoclave con parámetros, indicadores, resultado y responsable. No se borran.';

-- ── Paquetes ──────────────────────────────────────────────────────────────
create table if not exists public.sterilization_packages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  cycle_id uuid not null references public.sterilization_cycles(id) on delete restrict,
  year integer not null,
  number integer not null,
  code text not null,
  contents text not null,
  shelf_life_days integer not null,
  expires_on date not null,
  status text not null default 'disponible',
  used_at timestamptz,
  used_by uuid,
  used_patient_id uuid references public.patients(id) on delete restrict,
  used_appointment_id uuid references public.appointments(id) on delete set null,
  discarded_at timestamptz,
  discarded_by uuid,
  discard_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sterilization_packages_number_key unique (clinic_id, year, number),
  constraint sterilization_packages_code_key unique (clinic_id, code),
  constraint sterilization_packages_contents_check check (char_length(btrim(contents)) between 2 and 200),
  constraint sterilization_packages_shelf_check check (shelf_life_days between 1 and 730),
  constraint sterilization_packages_status_check check (
    status in ('disponible', 'usado', 'descartado', 'retirado')
  ),
  constraint sterilization_packages_uso_check check (
    (status = 'usado') = (used_patient_id is not null and used_at is not null)
  ),
  constraint sterilization_packages_baja_check check (
    status not in ('descartado', 'retirado')
    or (discard_reason is not null and char_length(btrim(discard_reason)) between 3 and 300)
  )
);

create index if not exists sterilization_packages_cycle_idx
  on public.sterilization_packages (cycle_id);
create index if not exists sterilization_packages_patient_idx
  on public.sterilization_packages (clinic_id, used_patient_id) where used_patient_id is not null;
create index if not exists sterilization_packages_appointment_idx
  on public.sterilization_packages (used_appointment_id) where used_appointment_id is not null;

comment on table public.sterilization_packages is
  'MKT-10: paquetes de instrumental de un ciclo (código para etiqueta/QR, vencimiento del estéril) y el paciente/cita donde se usaron. No se borran.';

-- ── Permisos de tabla ─────────────────────────────────────────────────────
revoke all on public.sterilization_cycles from anon, authenticated;
grant select, insert, update on public.sterilization_cycles to authenticated;
grant all on public.sterilization_cycles to service_role;
alter table public.sterilization_cycles enable row level security;

revoke all on public.sterilization_packages from anon, authenticated;
grant select, insert, update on public.sterilization_packages to authenticated;
grant all on public.sterilization_packages to service_role;
alter table public.sterilization_packages enable row level security;

drop policy if exists sterilization_cycles_select on public.sterilization_cycles;
create policy sterilization_cycles_select on public.sterilization_cycles
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant','reception','lab_technician']::public.app_role[])
  );

drop policy if exists sterilization_cycles_insert on public.sterilization_cycles;
create policy sterilization_cycles_insert on public.sterilization_cycles
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists sterilization_cycles_update on public.sterilization_cycles;
create policy sterilization_cycles_update on public.sterilization_cycles
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]));

drop policy if exists sterilization_packages_select on public.sterilization_packages;
create policy sterilization_packages_select on public.sterilization_packages
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant','reception','lab_technician']::public.app_role[])
  );

drop policy if exists sterilization_packages_insert on public.sterilization_packages;
create policy sterilization_packages_insert on public.sterilization_packages
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists sterilization_packages_update on public.sterilization_packages;
create policy sterilization_packages_update on public.sterilization_packages
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.sterilization_cycles;
create policy mfa_exige_aal2 on public.sterilization_cycles
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.sterilization_packages;
create policy mfa_exige_aal2 on public.sterilization_packages
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ── Correlativo (regla 8) ─────────────────────────────────────────────────
-- next_clinic_counter exige una sesión miembro de la clínica: el rol de
-- servicio (demo, tests de semilla) no la tiene. Mismo upsert atómico.
create or replace function public.correlativo_de_esterilizacion(p_clinic_id uuid, p_kind text, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if auth.uid() is not null then
    return public.next_clinic_counter(p_clinic_id, p_kind, p_year);
  end if;
  insert into public.clinic_counters (clinic_id, kind, year, next_value)
  values (p_clinic_id, p_kind, p_year, 2)
  on conflict (clinic_id, kind, year)
  do update set next_value = clinic_counters.next_value + 1, updated_at = now()
  returning next_value - 1 into v_n;
  return v_n;
end;
$$;

revoke all on function public.correlativo_de_esterilizacion(uuid, text, integer) from public, anon, authenticated;

-- ── Reglas del ciclo ──────────────────────────────────────────────────────
create or replace function public.validar_ciclo_de_esterilizacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_cerrado boolean;
begin
  if tg_op = 'INSERT' then
    select coalesce(timezone, 'America/Santiago') into v_tz from public.clinics where id = new.clinic_id;
    if new.branch_id is not null and not exists (
      select 1 from public.branches b where b.id = new.branch_id and b.clinic_id = new.clinic_id
    ) then
      raise exception 'La sucursal no es de esta clínica.' using errcode = '42501';
    end if;
    new.year := extract(year from new.run_at at time zone v_tz)::integer;
    new.number := public.correlativo_de_esterilizacion(new.clinic_id, 'sterilization_cycle', new.year);
    if auth.uid() is not null then
      new.recorded_by := auth.uid();
    end if;
    new.created_at := now();
  else
    if new.clinic_id is distinct from old.clinic_id
       or new.year is distinct from old.year
       or new.number is distinct from old.number
       or new.recorded_by is distinct from old.recorded_by then
      raise exception 'La clínica, el número del ciclo y quién lo registró no se cambian.'
        using errcode = '42501';
    end if;
    new.created_at := old.created_at;

    v_cerrado := old.result <> 'pendiente';
    if v_cerrado and (
      new.equipment is distinct from old.equipment
      or new.equipment_serial is distinct from old.equipment_serial
      or new.run_at is distinct from old.run_at
      or new.cycle_type is distinct from old.cycle_type
      or new.temperature_c is distinct from old.temperature_c
      or new.pressure_bar is distinct from old.pressure_bar
      or new.exposure_minutes is distinct from old.exposure_minutes
      or new.chemical_indicator is distinct from old.chemical_indicator
      or new.chemical_indicator_class is distinct from old.chemical_indicator_class
      or new.branch_id is distinct from old.branch_id
      or new.responsible_name is distinct from old.responsible_name
    ) then
      raise exception 'El ciclo ya tiene resultado: sus parámetros no se editan (puedes registrar el indicador biológico y notas).'
        using errcode = '23514';
    end if;
    if old.result = 'fallido' and new.result <> 'fallido' then
      raise exception 'Un ciclo fallido no vuelve atrás: registra uno nuevo.' using errcode = '23514';
    end if;
    if old.biological_indicator in ('aprobado', 'fallido')
       and new.biological_indicator is distinct from old.biological_indicator then
      raise exception 'La lectura del indicador biológico ya quedó registrada.' using errcode = '23514';
    end if;
  end if;

  -- Un indicador fallido deja el ciclo fallido.
  if new.chemical_indicator = 'fallido' or new.biological_indicator = 'fallido' then
    new.result := 'fallido';
    new.failure_reason := coalesce(
      nullif(btrim(new.failure_reason), ''),
      case when new.biological_indicator = 'fallido' then 'Indicador biológico positivo.'
           else 'Indicador químico sin viraje.' end
    );
  end if;
  if new.result = 'aprobado'
     and not (new.chemical_indicator in ('aprobado', 'no_aplica') and new.biological_indicator <> 'fallido') then
    raise exception 'Para aprobar el ciclo, el indicador químico tiene que estar aprobado.'
      using errcode = '23514';
  end if;
  if new.result = 'fallido' and nullif(btrim(coalesce(new.failure_reason, '')), '') is null then
    raise exception 'Indica por qué falló el ciclo.' using errcode = '23514';
  end if;

  if new.biological_indicator in ('aprobado', 'fallido')
     and (tg_op = 'INSERT' or old.biological_indicator not in ('aprobado', 'fallido')) then
    new.biological_read_at := coalesce(new.biological_read_at, now());
  end if;
  if new.result <> 'pendiente' and (tg_op = 'INSERT' or new.result is distinct from old.result) then
    new.result_at := now();
  elsif new.result = 'pendiente' then
    new.result_at := null;
  else
    new.result_at := old.result_at;
  end if;

  new.equipment := btrim(new.equipment);
  new.responsible_name := btrim(new.responsible_name);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validar_ciclo_de_esterilizacion() from public, anon, authenticated;

drop trigger if exists sterilization_cycles_validar on public.sterilization_cycles;
create trigger sterilization_cycles_validar
  before insert or update on public.sterilization_cycles
  for each row execute function public.validar_ciclo_de_esterilizacion();

-- Ciclo fallido → sus paquetes disponibles quedan retirados.
create or replace function public.retirar_paquetes_de_ciclo_fallido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.result = 'fallido' and (tg_op = 'INSERT' or old.result is distinct from 'fallido') then
    update public.sterilization_packages
       set status = 'retirado',
           discard_reason = left('Ciclo fallido: ' || coalesce(new.failure_reason, 'sin motivo'), 300)
     where cycle_id = new.id
       and status = 'disponible';
  end if;
  return null;
end;
$$;

revoke all on function public.retirar_paquetes_de_ciclo_fallido() from public, anon, authenticated;

drop trigger if exists sterilization_cycles_retirar_paquetes on public.sterilization_cycles;
create trigger sterilization_cycles_retirar_paquetes
  after insert or update of result on public.sterilization_cycles
  for each row execute function public.retirar_paquetes_de_ciclo_fallido();

-- ── Reglas del paquete ────────────────────────────────────────────────────
create or replace function public.validar_paquete_de_esterilizacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ciclo record;
  v_tz text;
  v_hoy date;
begin
  select c.clinic_id, c.result, c.cycle_type, c.run_at into v_ciclo
    from public.sterilization_cycles c
   where c.id = new.cycle_id;
  if not found then
    raise exception 'El ciclo no existe.' using errcode = '23503';
  end if;
  select coalesce(timezone, 'America/Santiago') into v_tz from public.clinics where id = v_ciclo.clinic_id;
  v_hoy := (now() at time zone v_tz)::date;

  if tg_op = 'INSERT' then
    if new.clinic_id is distinct from v_ciclo.clinic_id then
      raise exception 'El ciclo no es de esta clínica.' using errcode = '42501';
    end if;
    if v_ciclo.cycle_type in ('bowie_dick', 'helix', 'prueba_vacio') then
      raise exception 'Una prueba del equipo no lleva paquetes de instrumental.' using errcode = '23514';
    end if;
    if v_ciclo.result = 'fallido' then
      raise exception 'El ciclo falló: no se etiquetan paquetes de ese ciclo.' using errcode = '23514';
    end if;
    new.year := extract(year from v_ciclo.run_at at time zone v_tz)::integer;
    new.number := public.correlativo_de_esterilizacion(new.clinic_id, 'sterilization_package', new.year);
    new.code := 'E' || new.year::text || '-' || lpad(new.number::text, 5, '0');
    new.status := 'disponible';
    new.used_at := null;
    new.used_by := null;
    new.used_patient_id := null;
    new.used_appointment_id := null;
    new.discarded_at := null;
    new.discarded_by := null;
    new.discard_reason := null;
    if v_uid is not null then
      new.created_by := v_uid;
    end if;
    new.created_at := now();
  else
    if new.clinic_id is distinct from old.clinic_id
       or new.cycle_id is distinct from old.cycle_id
       or new.year is distinct from old.year
       or new.number is distinct from old.number
       or new.code is distinct from old.code
       or new.created_by is distinct from old.created_by then
      raise exception 'El ciclo, el código del paquete y quién lo etiquetó no se cambian.'
        using errcode = '42501';
    end if;
    new.created_at := old.created_at;

    if old.status <> 'disponible' then
      if new.status is distinct from old.status
         or new.contents is distinct from old.contents
         or new.shelf_life_days is distinct from old.shelf_life_days
         or new.used_patient_id is distinct from old.used_patient_id
         or new.used_appointment_id is distinct from old.used_appointment_id
         or new.used_at is distinct from old.used_at then
        raise exception 'Este paquete ya fue usado o dado de baja: no se modifica.'
          using errcode = '23514';
      end if;
    elsif new.status = 'usado' then
      if v_ciclo.result <> 'aprobado' then
        raise exception 'El ciclo de este paquete no está aprobado: no se puede usar.'
          using errcode = '23514';
      end if;
      if old.expires_on < v_hoy then
        raise exception 'El estéril de este paquete venció el %: reprocésalo.', to_char(old.expires_on, 'DD-MM-YYYY')
          using errcode = '23514';
      end if;
      if new.used_patient_id is null or not exists (
        select 1 from public.patients p
         where p.id = new.used_patient_id and p.clinic_id = new.clinic_id
      ) then
        raise exception 'Indica un paciente de esta clínica.' using errcode = '42501';
      end if;
      if new.used_appointment_id is not null and not exists (
        select 1 from public.appointments a
         where a.id = new.used_appointment_id
           and a.clinic_id = new.clinic_id
           and (
             a.patient_id = new.used_patient_id
             or exists (
               select 1 from public.appointment_group_participants gp
                where gp.appointment_id = a.id
                  and gp.patient_id = new.used_patient_id
                  and gp.withdrawn_at is null
             )
           )
      ) then
        raise exception 'La cita no es de ese paciente.' using errcode = '42501';
      end if;
      new.used_at := now();
      new.used_by := v_uid;
      new.contents := old.contents;
      new.shelf_life_days := old.shelf_life_days;
    elsif new.status in ('descartado', 'retirado') then
      new.discarded_at := now();
      new.discarded_by := v_uid;
      new.discard_reason := nullif(btrim(coalesce(new.discard_reason, '')), '');
      if new.discard_reason is null then
        raise exception 'Indica el motivo de la baja del paquete.' using errcode = '23514';
      end if;
    else
      -- Disponible: se corrige el contenido o la vida útil.
      if new.used_patient_id is not null or new.used_appointment_id is not null then
        raise exception 'Para usar el paquete, márcalo como usado.' using errcode = '23514';
      end if;
    end if;
  end if;

  -- Vencimiento del estéril: día del ciclo (hora de la clínica) + vida útil.
  new.expires_on := (v_ciclo.run_at at time zone v_tz)::date + new.shelf_life_days;
  new.contents := btrim(new.contents);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validar_paquete_de_esterilizacion() from public, anon, authenticated;

drop trigger if exists sterilization_packages_validar on public.sterilization_packages;
create trigger sterilization_packages_validar
  before insert or update on public.sterilization_packages
  for each row execute function public.validar_paquete_de_esterilizacion();

commit;

-- ── Reversa ────────────────────────────────────────────────────────────────
-- begin;
-- drop table if exists public.sterilization_packages;
-- drop table if exists public.sterilization_cycles;
-- drop function if exists public.validar_paquete_de_esterilizacion();
-- drop function if exists public.retirar_paquetes_de_ciclo_fallido();
-- drop function if exists public.validar_ciclo_de_esterilizacion();
-- drop function if exists public.correlativo_de_esterilizacion(uuid, text, integer);
-- delete from public.clinic_counters where kind in ('sterilization_cycle', 'sterilization_package');
-- -- drop policy if exists mfa_exige_aal2 on public.sterilization_packages;
-- -- drop policy if exists mfa_exige_aal2 on public.sterilization_cycles;
-- commit;
