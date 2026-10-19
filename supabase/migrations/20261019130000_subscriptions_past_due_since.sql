-- Auditoría 360 (18-oct-2026), BIL-01: gracia de 7 días después de un cobro
-- fallido. Para contarlos hace falta saber DESDE CUÁNDO la suscripción está
-- en `past_due`; `updated_at` no sirve porque cada reintento fallido de
-- Stripe vuelve a escribir la fila y lo corre hacia adelante.
--
-- Lo mantiene un trigger y no la app, por la misma razón que
-- `moneda_desde_la_clinica`: el webhook escribe la fila por dos caminos
-- (upsert de la suscripción completa y update de estado), y un trigger hace
-- imposible que alguno se olvide.
--
--   * entra a past_due (INSERT, o UPDATE desde otro estado) → now()
--   * sigue en past_due → conserva la fecha original
--   * sale de past_due → NULL
--
-- La app lee la columna con `select('*')` y tolera que no exista: este
-- archivo se puede aplicar después del deploy sin romper nada. Sin la
-- columna, una `past_due` se trata como dentro de la gracia.

alter table public.subscriptions
  add column if not exists past_due_since timestamptz;

comment on column public.subscriptions.past_due_since is
  'Desde cuándo la suscripción está en past_due (trigger subscriptions_past_due_since). NULL si no está en past_due.';

-- Backfill ANTES de crear el trigger (si no, el trigger lo pisaría con now()).
-- Para las filas que ya están en past_due, la mejor aproximación disponible
-- es su última escritura.
update public.subscriptions
   set past_due_since = updated_at
 where status = 'past_due'
   and past_due_since is null;

create or replace function public.subscriptions_marcar_past_due_since()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'past_due' then
    if tg_op = 'INSERT' or old.status is distinct from 'past_due' then
      new.past_due_since := now();
    else
      new.past_due_since := coalesce(old.past_due_since, now());
    end if;
  else
    new.past_due_since := null;
  end if;
  return new;
end;
$$;

revoke all on function public.subscriptions_marcar_past_due_since() from public, anon;

drop trigger if exists subscriptions_past_due_since on public.subscriptions;
create trigger subscriptions_past_due_since
  before insert or update on public.subscriptions
  for each row execute function public.subscriptions_marcar_past_due_since();
