-- Ola 9 · Frente C (1/2): laboratorio, LAB-03 a LAB-07.
--
-- Hasta ahora una orden de laboratorio decía qué se mandaba ("Corona
-- metal-porcelana"), para quién y cuándo lo prometieron. Lo que el técnico
-- necesita para hacer el trabajo seguía viajando en un papel aparte:
--
--   LAB-03  color según la guía VITA (classical o 3D-Master);
--   LAB-04  material;
--   LAB-05  margen, el tipo de terminación de la preparación;
--   LAB-06  plazo: ya existía `due_on`; acá se agrega el cálculo de atraso
--           con la zona horaria de la clínica para el portal;
--   LAB-07  catálogo de trabajos por laboratorio (precio de costo y plazo
--           típico) que precarga la orden.
--
-- Todo aditivo y compatible con el código en producción (RUNBOOK regla 3):
-- columnas nullable en `lab_orders`, una tabla nueva, una restricción UNIQUE
-- nueva en `labs` (sobre la PK: no puede fallar con datos existentes) y una
-- función nueva. No escribe datos. Reversa al pie.

begin;

-- ─── Catálogo de trabajos por laboratorio (LAB-07) ──────────────────────
-- Clave compuesta para que un ítem del catálogo no pueda apuntar a un
-- laboratorio de otra clínica: la FK exige (lab_id, clinic_id) juntos.
alter table public.labs
  add constraint labs_id_clinic_key unique (id, clinic_id);

create table if not exists public.lab_catalog_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lab_id uuid not null,
  -- "Corona de zirconia monolítica", "Carilla de disilicato".
  name text not null,
  -- Lo que cobra el laboratorio (precio de costo para la clínica). NULL = sin
  -- dato, no cero (regla 11).
  cost_cents bigint,
  currency text not null,
  -- Días de calendario que el laboratorio suele tardar. Con él la orden
  -- propone la fecha comprometida (envío + días); NULL = sin plazo típico.
  typical_days smallint,
  -- Material por defecto del trabajo (mismos valores que lab_orders.material).
  material text,
  notes text,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lab_catalog_items_lab_fk foreign key (lab_id, clinic_id)
    references public.labs (id, clinic_id) on delete cascade,
  constraint lab_catalog_items_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint lab_catalog_items_cost_check check (cost_cents is null or cost_cents >= 0),
  constraint lab_catalog_items_days_check
    check (typical_days is null or typical_days between 0 and 365),
  constraint lab_catalog_items_material_check check (material is null or material in (
    'zirconia', 'disilicato_litio', 'metal_porcelana', 'ceramica_feldespatica', 'metal_colado',
    'cromo_cobalto', 'titanio', 'pmma', 'resina', 'acrilico', 'otro'
  )),
  constraint lab_catalog_items_notes_check check (notes is null or char_length(notes) <= 500),
  constraint lab_catalog_items_lab_name_key unique (lab_id, name)
);

comment on table public.lab_catalog_items is
  'LAB-07: trabajos que ofrece cada laboratorio (precio de costo y plazo típico). Precargan la orden; la orden guarda su propia copia del nombre. Sin datos de pacientes; no se borra, se desactiva.';

create index if not exists lab_catalog_items_clinic_lab_idx
  on public.lab_catalog_items (clinic_id, lab_id, is_active, name);

drop trigger if exists lab_catalog_items_updated_at on public.lab_catalog_items;
create trigger lab_catalog_items_updated_at
  before update on public.lab_catalog_items
  for each row execute function public.set_updated_at();

-- La moneda nunca viaja desde el cliente (regla 14).
drop trigger if exists moneda_desde_la_clinica on public.lab_catalog_items;
create trigger moneda_desde_la_clinica
  before insert on public.lab_catalog_items
  for each row execute function public.aplicar_moneda_de_la_clinica();

-- Quién lo creó y cuándo no se reescribe desde la app; un ítem no cambia de
-- clínica ni de laboratorio.
create or replace function public.lab_catalog_items_proteger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.clinic_id is distinct from old.clinic_id or new.lab_id is distinct from old.lab_id then
      raise exception 'Un trabajo del catálogo no cambia de laboratorio.' using errcode = '23514';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.currency := old.currency;
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;

revoke execute on function public.lab_catalog_items_proteger() from public, anon, authenticated;

drop trigger if exists lab_catalog_items_proteger on public.lab_catalog_items;
create trigger lab_catalog_items_proteger
  before insert or update on public.lab_catalog_items
  for each row execute function public.lab_catalog_items_proteger();

drop trigger if exists block_demo_writes on public.lab_catalog_items;
create trigger block_demo_writes
  before insert or update or delete on public.lab_catalog_items
  for each row execute function public.block_demo_writes();

grant select, insert, update on public.lab_catalog_items to authenticated;
revoke delete, truncate on public.lab_catalog_items from anon, authenticated;
grant all on public.lab_catalog_items to service_role;
alter table public.lab_catalog_items enable row level security;

-- Mismo criterio que `labs`: lo ve todo el equipo (el costo lo filtra la app
-- con `finance:view`, igual que en lab_orders) y lo configura quien gestiona
-- la clínica.
drop policy if exists lab_catalog_items_select_members on public.lab_catalog_items;
create policy lab_catalog_items_select_members on public.lab_catalog_items
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists lab_catalog_items_insert_managers on public.lab_catalog_items;
create policy lab_catalog_items_insert_managers on public.lab_catalog_items
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists lab_catalog_items_update_managers on public.lab_catalog_items;
create policy lab_catalog_items_update_managers on public.lab_catalog_items
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

-- ─── Detalle técnico de la orden (LAB-03, LAB-04, LAB-05, LAB-07) ───────
alter table public.lab_orders
  add column if not exists catalog_item_id uuid
    references public.lab_catalog_items(id) on delete set null,
  -- Snapshot inmutable (regla 10): si el ítem se renombra o desactiva, la
  -- orden sigue diciendo qué se pidió.
  add column if not exists catalog_name_snapshot text,
  add column if not exists shade_guide text,
  add column if not exists shade text,
  add column if not exists material text,
  add column if not exists margin_type text;

alter table public.lab_orders
  add constraint lab_orders_shade_guide_check
    check (shade_guide is null or shade_guide in ('vita_classical', 'vita_3d_master')),
  -- El color se valida contra la guía en el servidor (lab-orden-detalle.ts);
  -- acá solo que no venga un color sin guía ni un texto libre largo.
  add constraint lab_orders_shade_check
    check (shade is null or (shade_guide is not null and char_length(shade) <= 8)),
  add constraint lab_orders_material_check check (material is null or material in (
    'zirconia', 'disilicato_litio', 'metal_porcelana', 'ceramica_feldespatica', 'metal_colado',
    'cromo_cobalto', 'titanio', 'pmma', 'resina', 'acrilico', 'otro'
  )),
  add constraint lab_orders_margin_type_check check (margin_type is null or margin_type in (
    'chaflan', 'chaflan_profundo', 'hombro', 'hombro_biselado', 'filo_de_cuchillo'
  )),
  add constraint lab_orders_catalog_name_check
    check (catalog_name_snapshot is null or char_length(catalog_name_snapshot) <= 120);

create index if not exists lab_orders_catalog_item_idx
  on public.lab_orders (catalog_item_id) where catalog_item_id is not null;

-- Una orden solo puede citar un trabajo del catálogo de su misma clínica.
-- SECURITY DEFINER para leer el ítem aunque la RLS de quien escribe no lo
-- deje ver (justamente el caso de otra clínica, que tiene que fallar).
create or replace function public.lab_orders_catalogo_de_la_clinica()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.catalog_item_id is not null and not exists (
    select 1 from public.lab_catalog_items i
     where i.id = new.catalog_item_id and i.clinic_id = new.clinic_id
  ) then
    raise exception 'Ese trabajo no está en el catálogo de esta clínica.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.lab_orders_catalogo_de_la_clinica() from public, anon, authenticated;

drop trigger if exists lab_orders_catalogo_de_la_clinica on public.lab_orders;
create trigger lab_orders_catalogo_de_la_clinica
  before insert or update of catalog_item_id, clinic_id on public.lab_orders
  for each row execute function public.lab_orders_catalogo_de_la_clinica();

comment on column public.lab_orders.shade_guide is
  'LAB-03: guía de color (vita_classical | vita_3d_master).';
comment on column public.lab_orders.shade is
  'LAB-03: color dentro de la guía (A2, 2M2…).';
comment on column public.lab_orders.material is 'LAB-04: material del trabajo.';
comment on column public.lab_orders.margin_type is
  'LAB-05: margen, tipo de terminación de la preparación.';
comment on column public.lab_orders.catalog_item_id is
  'LAB-07: trabajo del catálogo del laboratorio que precargó la orden.';

-- ─── Órdenes del portal del laboratorio (LAB-06) ────────────────────────
-- La usa solo el servidor (service_role) después de validar el link firmado
-- del laboratorio. Devuelve únicamente las órdenes de ese laboratorio en esa
-- clínica, sin costo, y el atraso calculado con el "hoy" de la clínica
-- (clinics.timezone), no con el reloj UTC del servidor: a las 22:00 en
-- Santiago ya es mañana en UTC y una orden que vence hoy aparecería tarde.
create or replace function public.portal_laboratorio_ordenes(
  p_clinic_id uuid,
  p_lab_id uuid,
  p_ahora timestamptz default now()
)
returns table (
  id uuid,
  patient_name text,
  description text,
  tooth_numbers smallint[],
  status public.lab_order_status,
  sent_on date,
  due_on date,
  received_on date,
  notes text,
  catalog_name text,
  shade_guide text,
  shade text,
  material text,
  margin_type text,
  hoy_clinica date,
  dias_atraso integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with hoy as (
    select (p_ahora at time zone coalesce(nullif(c.timezone, ''), 'America/Santiago'))::date as d
      from public.clinics c
     where c.id = p_clinic_id
  )
  select o.id,
         p.full_name,
         o.description,
         o.tooth_numbers,
         o.status,
         o.sent_on,
         o.due_on,
         o.received_on,
         o.notes,
         o.catalog_name_snapshot,
         o.shade_guide,
         o.shade,
         o.material,
         o.margin_type,
         hoy.d,
         case
           when o.due_on is not null
            and o.status in ('enviado', 'en_proceso', 'reprocesar')
            and o.due_on < hoy.d
           then hoy.d - o.due_on
         end
    from public.lab_orders o
    join hoy on true
    left join public.patients p on p.id = o.patient_id and p.clinic_id = o.clinic_id
   where o.clinic_id = p_clinic_id
     and o.lab_id = p_lab_id
   order by o.sent_on desc, o.created_at desc;
$$;

comment on function public.portal_laboratorio_ordenes(uuid, uuid, timestamptz) is
  'Portal del laboratorio: sus órdenes en esa clínica (sin costo) con el atraso según el hoy de la clínica. Solo service_role.';

revoke execute on function public.portal_laboratorio_ordenes(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.portal_laboratorio_ordenes(uuid, uuid, timestamptz)
  to service_role;

commit;

-- Cómo revertir (se pierden el catálogo y el detalle técnico de las órdenes;
-- las órdenes y su estado no se tocan):
--
-- begin;
-- drop function if exists public.portal_laboratorio_ordenes(uuid, uuid, timestamptz);
-- drop trigger if exists lab_orders_catalogo_de_la_clinica on public.lab_orders;
-- drop function if exists public.lab_orders_catalogo_de_la_clinica();
-- alter table public.lab_orders
--   drop constraint if exists lab_orders_shade_guide_check,
--   drop constraint if exists lab_orders_shade_check,
--   drop constraint if exists lab_orders_material_check,
--   drop constraint if exists lab_orders_margin_type_check,
--   drop constraint if exists lab_orders_catalog_name_check,
--   drop column if exists catalog_item_id,
--   drop column if exists catalog_name_snapshot,
--   drop column if exists shade_guide,
--   drop column if exists shade,
--   drop column if exists material,
--   drop column if exists margin_type;
-- drop table if exists public.lab_catalog_items;
-- drop function if exists public.lab_catalog_items_proteger();
-- alter table public.labs drop constraint if exists labs_id_clinic_key;
-- commit;
