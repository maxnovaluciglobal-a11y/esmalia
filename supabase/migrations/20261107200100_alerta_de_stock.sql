-- ═══════════════════════════════════════════════════════════════════════════
-- Ola 11 · frente B · REC-10: aviso cuando un insumo baja del mínimo.
--
-- Usa lo que ya hay en inventario: `inventory_items.min_stock` (null = sin
-- alerta) y `current_stock`, que mantiene el trigger `apply_inventory_movement`
-- con cada movimiento. Mismo criterio que la pantalla (`belowMinStock`):
-- en el mínimo o por debajo.
--
-- Cuándo avisa: solo al CRUZAR el umbral (antes estaba sobre el mínimo, o
-- inactivo, o sin mínimo; ahora está en o bajo el mínimo). Cada salida
-- posterior mientras sigue bajo no vuelve a avisar; si se repone y vuelve a
-- bajar, es un episodio nuevo y avisa de nuevo.
--
-- A quién: propietario, administración y técnico/a dental (los que reponen).
-- Un aviso por persona: además del cruce, no se inserta si esa persona ya
-- tiene un aviso sin leer del mismo insumo (idempotente ante dos updates en
-- la misma transacción o un recálculo).
--
-- Respeta la preferencia de avisos: inserta en `notifications`, así que el
-- trigger `notifications_respetar_preferencia` (BEFORE INSERT) descarta el
-- aviso de quien apagó "Avisos dentro de Esmalia".
--
-- Aditiva: un trigger nuevo AFTER UPDATE; no cambia el stock ni redefine
-- funciones existentes. Nada de WhatsApp ni correo: solo la campana.
--
-- Cómo revertir:
--   drop trigger if exists inventory_items_avisar_stock_bajo on public.inventory_items;
--   drop function if exists public.avisar_stock_bajo();
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.avisar_stock_bajo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_link text;
  v_cantidad text;
  v_minimo text;
begin
  if not (new.is_active and new.min_stock is not null and new.current_stock <= new.min_stock) then
    return new;
  end if;
  if old.is_active and old.min_stock is not null and old.current_stock <= old.min_stock then
    return new; -- ya estaba bajo: no es un cruce
  end if;

  v_link := '/inventario?insumo=' || new.id::text;
  -- "3.500" → "3.5", "10" → "10" (solo se recortan ceros decimales).
  v_cantidad := case when new.current_stock::text like '%.%'
                     then trim(trailing '.' from trim(trailing '0' from new.current_stock::text))
                     else new.current_stock::text end;
  v_minimo := case when new.min_stock::text like '%.%'
                   then trim(trailing '.' from trim(trailing '0' from new.min_stock::text))
                   else new.min_stock::text end;

  insert into public.notifications (clinic_id, recipient_id, actor_id, kind, title, body, link)
  select distinct
         new.clinic_id,
         m.user_id,
         null::uuid,
         'stock_low',
         'Stock bajo: ' || new.name,
         'Quedan ' || v_cantidad || ' ' || new.unit
           || ' (mínimo ' || v_minimo || '). Conviene reponer.',
         v_link
    from public.clinic_members m
   where m.clinic_id = new.clinic_id
     and m.role in ('owner', 'admin', 'lab_technician')
     and not exists (
       select 1 from public.notifications n
        where n.recipient_id = m.user_id
          and n.clinic_id = new.clinic_id
          and n.kind = 'stock_low'
          and n.link = v_link
          and n.read_at is null);

  return new;
end;
$function$;

comment on function public.avisar_stock_bajo() is
  'REC-10 (Ola 11): avisa en la campana a owner/admin/técnico dental cuando un insumo cruza su stock mínimo. Sin duplicar: solo en el cruce y si no hay un aviso sin leer del mismo insumo.';

revoke all on function public.avisar_stock_bajo() from public, anon, authenticated;

drop trigger if exists inventory_items_avisar_stock_bajo on public.inventory_items;
create trigger inventory_items_avisar_stock_bajo
  after update of current_stock, min_stock, is_active on public.inventory_items
  for each row execute function public.avisar_stock_bajo();
