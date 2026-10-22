-- Ola 3 · Frente Arancel: realinear precios del arancel en lote (ADM-04).
--
-- La clínica sube o baja precios de muchas prestaciones a la vez (por
-- porcentaje o por monto, por especialidad o por selección), ve el antes y
-- el después, confirma, y queda registro de quién lo hizo y qué cambió.
--
-- El cálculo (porcentaje, monto, redondeo) vive en TypeScript
-- (`src/lib/arancel/realineacion.ts`, con tests) y es el mismo que dibuja la
-- vista previa. A la base llega la lista explícita de cambios con el precio
-- que la clínica vio ANTES de confirmar: si alguno ya no coincide (otra
-- persona lo editó mientras tanto), no se aplica ninguno.
--
-- Los presupuestos y planes ya emitidos no cambian: `quote_items` y
-- `treatment_items` guardan su propio precio (snapshot, regla 10).
--
-- Compatible con el código en producción (RUNBOOK regla 3): una tabla nueva
-- y una función nueva. Reversa al pie.

begin;

-- 1. Historial de realineaciones -------------------------------------------

create table if not exists public.procedure_price_realignments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  -- La fija el trigger moneda_desde_la_clinica (regla 14).
  currency text not null,
  mode text not null check (mode in ('percent', 'amount')),
  -- Porcentaje aplicado (5 = +5 %, -3.5 = -3,5 %). Solo en modo 'percent'.
  percent numeric(7, 3) check (percent is null or (percent > -100 and percent <= 1000)),
  -- Monto sumado o restado a cada precio, en cents. Solo en modo 'amount'.
  amount_cents bigint,
  -- Paso de redondeo en cents (100 = a la centena en CLP). NULL = sin redondeo.
  rounding_cents bigint check (rounding_cents is null or rounding_cents > 0),
  -- Qué se eligió, en palabras ("Endodoncia", "12 prestaciones elegidas").
  scope_label text not null check (char_length(scope_label) between 1 and 200),
  affected_count integer not null check (affected_count between 1 and 2000),
  -- [{procedure_id, name, old_cents, new_cents}, ...]: el antes y el después
  -- de cada prestación, congelado (regla 10).
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  constraint procedure_price_realignments_modo_valor check (
    (mode = 'percent' and percent is not null and amount_cents is null)
    or (mode = 'amount' and amount_cents is not null and percent is null)
  )
);

comment on table public.procedure_price_realignments is
  'ADM-04: cada realineación de precios del arancel: quién, cuándo, cómo y el antes/después de cada prestación. Solo inserción.';

create index if not exists procedure_price_realignments_clinic_idx
  on public.procedure_price_realignments (clinic_id, created_at desc);

drop trigger if exists moneda_desde_la_clinica on public.procedure_price_realignments;
create trigger moneda_desde_la_clinica
  before insert on public.procedure_price_realignments
  for each row execute function public.aplicar_moneda_de_la_clinica();

drop trigger if exists block_demo_writes on public.procedure_price_realignments;
create trigger block_demo_writes
  before insert or update or delete on public.procedure_price_realignments
  for each row execute function public.block_demo_writes();

grant select, insert on public.procedure_price_realignments to authenticated;
grant all on public.procedure_price_realignments to service_role;
alter table public.procedure_price_realignments enable row level security;

-- Una política por comando. Leer: cualquier miembro (son precios de lista,
-- sin datos de pacientes). Escribir: quien administra la clínica, y siempre a
-- su nombre. Sin UPDATE ni DELETE: el historial no se reescribe.
drop policy if exists "procedure_price_realignments_select_members"
  on public.procedure_price_realignments;
create policy "procedure_price_realignments_select_members"
  on public.procedure_price_realignments
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists "procedure_price_realignments_insert_managers"
  on public.procedure_price_realignments;
create policy "procedure_price_realignments_insert_managers"
  on public.procedure_price_realignments
  for insert to authenticated
  with check (
    public.can_manage_clinic(clinic_id)
    and created_by = (select auth.uid())
  );

-- 2. Aplicar una realineación ------------------------------------------------

-- SECURITY INVOKER: corre con la RLS de quien llama, así que solo puede
-- tocar precios quien ya podía editarlos uno por uno (can_manage_clinic), y
-- el trigger de la demo la frena igual que a un UPDATE por REST. Todo pasa
-- en una transacción: o cambian todos los precios y queda el registro, o no
-- cambia nada.
--
-- p_cambios: [{"procedure_id": uuid, "old_cents": int, "new_cents": int}, ...]
create or replace function public.realinear_precios(
  p_clinic_id uuid,
  p_mode text,
  p_percent numeric,
  p_amount_cents bigint,
  p_rounding_cents bigint,
  p_scope_label text,
  p_cambios jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cambio jsonb;
  v_items jsonb := '[]'::jsonb;
  v_id uuid;
  v_nombre text;
  v_nuevo bigint;
  v_viejo bigint;
  v_proc uuid;
begin
  if not public.can_manage_clinic(p_clinic_id) then
    raise exception 'No tienes permisos' using errcode = '42501';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'array'
     or jsonb_array_length(p_cambios) = 0 then
    raise exception 'No hay precios que cambiar.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_cambios) > 2000 then
    raise exception 'Son demasiadas prestaciones de una vez (máximo 2000).' using errcode = '22023';
  end if;

  for v_cambio in select * from jsonb_array_elements(p_cambios) loop
    v_proc := (v_cambio ->> 'procedure_id')::uuid;
    v_viejo := (v_cambio ->> 'old_cents')::bigint;
    v_nuevo := (v_cambio ->> 'new_cents')::bigint;
    if v_proc is null or v_viejo is null or v_nuevo is null or v_nuevo < 0 then
      raise exception 'Cambio de precio inválido.' using errcode = '22023';
    end if;

    update public.procedures p
       set default_price_cents = v_nuevo
     where p.id = v_proc
       and p.clinic_id = p_clinic_id
       and p.default_price_cents = v_viejo
    returning p.name into v_nombre;

    if not found then
      raise exception 'Un precio cambió mientras revisabas la vista previa. Vuelve a calcularla.'
        using errcode = '40001';
    end if;

    v_items := v_items || jsonb_build_object(
      'procedure_id', v_proc,
      'name', v_nombre,
      'old_cents', v_viejo,
      'new_cents', v_nuevo
    );
  end loop;

  insert into public.procedure_price_realignments (
    clinic_id, mode, percent, amount_cents, rounding_cents,
    scope_label, affected_count, items
  ) values (
    p_clinic_id, p_mode,
    case when p_mode = 'percent' then p_percent end,
    case when p_mode = 'amount' then p_amount_cents end,
    p_rounding_cents,
    p_scope_label, jsonb_array_length(v_items), v_items
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.realinear_precios(uuid, text, numeric, bigint, bigint, text, jsonb) is
  'ADM-04: aplica una realineación de precios del arancel (todo o nada) y la registra. SECURITY INVOKER: respeta la RLS de procedures.';

revoke all on function public.realinear_precios(uuid, text, numeric, bigint, bigint, text, jsonb)
  from public, anon;
grant execute on function public.realinear_precios(uuid, text, numeric, bigint, bigint, text, jsonb)
  to authenticated, service_role;

commit;

-- Cómo revertir:
-- drop function if exists public.realinear_precios(uuid, text, numeric, bigint, bigint, text, jsonb);
-- drop table if exists public.procedure_price_realignments;
-- (Los precios ya realineados quedan como están: el historial dice el valor
-- anterior de cada prestación por si hay que volver atrás a mano.)
