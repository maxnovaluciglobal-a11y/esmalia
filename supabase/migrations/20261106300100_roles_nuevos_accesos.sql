-- ═══════════════════════════════════════════════════════════════════════════
-- Ola 10 · frente C · EQU-02: qué abre la base a los dos roles nuevos.
-- Requiere 20261106300000 (valores del enum) ya confirmada.
--
-- 1. `has_clinic_role` (redefinida, partiendo de su definición en prod del
--    27-oct-2026): agrega UNA alternativa, "Coordinación cuenta como
--    recepción o contabilidad". Para los seis roles de siempre el resultado es
--    idéntico (la condición original queda tal cual, se suma con OR). Como
--    recepción y contabilidad no figuran en ninguna lista clínica, Coordinación
--    nunca ve historia clínica; sí cobra y ve finanzas, como esos dos roles.
--    Las funciones que miran el rol directo (`clinic_role_of(...) in (...)`,
--    p. ej. `enforce_clinical_note_update`) no la conocen y la dejan afuera.
--
-- 2. Técnico/a dental: políticas PERMISIVAS nuevas (se suman a las que hay,
--    no se tocan las existentes) para leer y actualizar órdenes de laboratorio
--    y leer el inventario. Nada clínico, nada de pagos. Lo demás que ve (agenda,
--    pacientes, tratamientos, catálogo de laboratorio) ya es `is_clinic_member`.
--
-- No escribe datos. Reversa al pie.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. has_clinic_role con Coordinación ───────────────────────────────────

create or replace function public.has_clinic_role(_clinic_id uuid, _roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_members m
    WHERE m.clinic_id = _clinic_id AND m.user_id = auth.uid()
      AND (
        m.role = ANY(_roles)
        -- EQU-02: Coordinación = lo que la base permite a recepción o contabilidad.
        OR (m.role = 'coordinator'::public.app_role
            AND _roles && ARRAY['reception','accounting']::public.app_role[])
      )
  );
$function$;

comment on function public.has_clinic_role(uuid, public.app_role[]) is
  'Rol del usuario en la clínica. EQU-02 (20261106300100): coordinator cuenta como reception o accounting; nunca como rol clínico.';

revoke all on function public.has_clinic_role(uuid, public.app_role[]) from public, anon;
grant execute on function public.has_clinic_role(uuid, public.app_role[]) to authenticated, service_role;

-- ─── 2. Técnico/a dental ───────────────────────────────────────────────────

drop policy if exists lab_orders_select_laboratorio on public.lab_orders;
create policy lab_orders_select_laboratorio on public.lab_orders
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['lab_technician']::public.app_role[]));

drop policy if exists lab_orders_update_laboratorio on public.lab_orders;
create policy lab_orders_update_laboratorio on public.lab_orders
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['lab_technician']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['lab_technician']::public.app_role[]));

drop policy if exists inventory_items_select_laboratorio on public.inventory_items;
create policy inventory_items_select_laboratorio on public.inventory_items
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['lab_technician']::public.app_role[]));

drop policy if exists inventory_stock_select_laboratorio on public.inventory_stock;
create policy inventory_stock_select_laboratorio on public.inventory_stock
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['lab_technician']::public.app_role[]));

drop policy if exists inventory_movements_select_laboratorio on public.inventory_movements;
create policy inventory_movements_select_laboratorio on public.inventory_movements
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['lab_technician']::public.app_role[]));

drop policy if exists inventory_counts_select_laboratorio on public.inventory_counts;
create policy inventory_counts_select_laboratorio on public.inventory_counts
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['lab_technician']::public.app_role[]));

drop policy if exists warehouses_select_laboratorio on public.warehouses;
create policy warehouses_select_laboratorio on public.warehouses
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['lab_technician']::public.app_role[]));

-- ═══ Reversa (no se ejecuta) ════════════════════════════════════════════════
-- Antes de revertir, ningún integrante debe tener rol coordinator ni
-- lab_technician (cambiarlos en Equipo), o quedarían sin acceso.
-- drop policy if exists warehouses_select_laboratorio on public.warehouses;
-- drop policy if exists inventory_counts_select_laboratorio on public.inventory_counts;
-- drop policy if exists inventory_movements_select_laboratorio on public.inventory_movements;
-- drop policy if exists inventory_stock_select_laboratorio on public.inventory_stock;
-- drop policy if exists inventory_items_select_laboratorio on public.inventory_items;
-- drop policy if exists lab_orders_update_laboratorio on public.lab_orders;
-- drop policy if exists lab_orders_select_laboratorio on public.lab_orders;
-- create or replace function public.has_clinic_role(_clinic_id uuid, _roles public.app_role[])
--  returns boolean language sql stable security definer set search_path to 'public'
-- as $f$
--   SELECT EXISTS (
--     SELECT 1 FROM public.clinic_members m
--     WHERE m.clinic_id = _clinic_id AND m.user_id = auth.uid() AND m.role = ANY(_roles)
--   );
-- $f$;
