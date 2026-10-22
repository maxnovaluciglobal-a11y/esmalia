-- AGE-06 (Ola 2): cada profesional de una clínica con un color distinto.
--
-- El PR #145 pasó la agenda a una paleta de 8 tokens (`--prof-1` … `--prof-8`,
-- ver src/lib/clinic-operations/color-profesional.ts) y lleva cada hex viejo
-- al token más cercano. Dos colores viejos parecidos caían en el mismo token
-- (en la demo, el violeta de Dr. Reyes y el celeste de Dr. Soto quedaban los
-- dos en Índigo), y el default de la columna (#0d9488) dejaba a todos los
-- profesionales nuevos de una clínica con el mismo color.
--
-- Qué hace:
--  1. Al crear un profesional, si su color no es de la paleta o ya lo usa
--     otro profesional activo de la clínica, toma el primer color libre de la
--     paleta (en orden). Con los 8 usados, se queda con el que trae.
--     Solo en INSERT: si alguien elige a mano un color repetido al editar,
--     se respeta. El reset diario de la demo inserta, así que también queda
--     corregido.
--  2. Normaliza una vez los profesionales que ya existen con la misma regla,
--     en orden de creación (el primero conserva su color si es de la paleta).
--
-- Compatible con el código en producción: el valor sigue siendo un hex y la
-- app lo pinta igual. Reversa al pie.

begin;

create or replace function public.paleta_profesionales()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- Mismo orden y valores (modo claro) que PALETA_PROFESIONALES.
  select array['#8f621e', '#0f5e63', '#a4452a', '#4f6b2a', '#7a3f73', '#4a4f9c', '#4d5a66', '#a63d5c']
$$;

create or replace function public.professionals_color_distinto()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_paleta text[] := public.paleta_profesionales();
  v_usados text[];
  v_color text;
begin
  select coalesce(array_agg(lower(p.color)), '{}')
    into v_usados
    from public.professionals p
   where p.clinic_id = new.clinic_id
     and p.is_active
     and p.id is distinct from new.id;

  if lower(coalesce(new.color, '')) = any (v_paleta)
     and not (lower(new.color) = any (v_usados)) then
    return new;
  end if;

  foreach v_color in array v_paleta loop
    if not (v_color = any (v_usados)) then
      new.color := v_color;
      return new;
    end if;
  end loop;

  return new; -- los 8 en uso: se queda con el que trae
end;
$$;

revoke all on function public.professionals_color_distinto() from public, anon, authenticated;

drop trigger if exists professionals_color_distinto on public.professionals;
create trigger professionals_color_distinto
  before insert on public.professionals
  for each row execute function public.professionals_color_distinto();

-- Normalización de lo que ya existe, clínica por clínica.
do $$
declare
  v_paleta text[] := public.paleta_profesionales();
  c record;
  p record;
  v_usados text[];
  v_color text;
  v_nuevo text;
  v_cambios integer := 0;
begin
  for c in select distinct clinic_id from public.professionals loop
    v_usados := '{}';
    for p in
      select id, color
        from public.professionals
       where clinic_id = c.clinic_id
       order by is_active desc, created_at, id
    loop
      if lower(p.color) = any (v_paleta) and not (lower(p.color) = any (v_usados)) then
        v_usados := v_usados || lower(p.color);
        continue;
      end if;
      v_nuevo := null;
      foreach v_color in array v_paleta loop
        if not (v_color = any (v_usados)) then
          v_nuevo := v_color;
          exit;
        end if;
      end loop;
      if v_nuevo is not null then
        update public.professionals set color = v_nuevo where id = p.id;
        v_usados := v_usados || v_nuevo;
        v_cambios := v_cambios + 1;
      end if;
    end loop;
  end loop;
  raise notice 'Colores de profesionales normalizados: %', v_cambios;
end
$$;

commit;

-- Cómo revertir (en una migración correctiva):
-- begin;
-- drop trigger if exists professionals_color_distinto on public.professionals;
-- drop function if exists public.professionals_color_distinto();
-- drop function if exists public.paleta_profesionales();
-- commit;
-- (Los colores ya normalizados quedan; eran hex que la app igual mostraba
-- con el token más cercano.)
