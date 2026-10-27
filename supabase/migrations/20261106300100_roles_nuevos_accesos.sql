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
-- 2. Técnico/a dental: se agrega el rol a las políticas existentes de lectura
--    y actualización de órdenes de laboratorio y de lectura del inventario
--    (ALTER POLICY, solo se suma el rol nuevo). Nada clínico, nada de pagos. Lo demás que ve (agenda,
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
-- Se suma 'lab_technician' a la lista de roles de 7 políticas existentes
-- (ALTER POLICY, mismo nombre y mismo comando). Las listas parten de
-- pg_policies de prod del 27-oct-2026 y solo se les AGREGA el rol nuevo:
-- ningún rol existente gana ni pierde nada. No se crean políticas
-- permisivas paralelas para no tener dos por (rol, comando)
-- (tests/rls-politicas-por-comando.test.ts). Ninguna es clínica ni de pagos.

alter policy lab_orders_select_operativo on public.lab_orders
  using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','accounting','lab_technician']::public.app_role[]));

alter policy lab_orders_update_operativo on public.lab_orders
  using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','accounting','lab_technician']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','accounting','lab_technician']::public.app_role[]));

alter policy inventory_items_select_clinical on public.inventory_items
  using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','lab_technician']::public.app_role[]));

alter policy inventory_stock_select_clinical on public.inventory_stock
  using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','lab_technician']::public.app_role[]));

alter policy inventory_movements_select_clinical on public.inventory_movements
  using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','lab_technician']::public.app_role[]));

alter policy inventory_counts_select_clinical on public.inventory_counts
  using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','lab_technician']::public.app_role[]));

alter policy warehouses_select_clinical on public.warehouses
  using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','lab_technician']::public.app_role[]));

-- ═══ Reversa (no se ejecuta) ════════════════════════════════════════════════
-- Antes de revertir, ningún integrante debe tener rol coordinator ni
-- lab_technician (cambiarlos en Equipo), o quedarían sin acceso.
-- alter policy lab_orders_select_operativo on public.lab_orders using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','accounting']::public.app_role[]));
-- alter policy lab_orders_update_operativo on public.lab_orders using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','accounting']::public.app_role[])) with check (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception','accounting']::public.app_role[]));
-- alter policy inventory_items_select_clinical on public.inventory_items using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception']::public.app_role[]));
-- alter policy inventory_stock_select_clinical on public.inventory_stock using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception']::public.app_role[]));
-- alter policy inventory_movements_select_clinical on public.inventory_movements using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception']::public.app_role[]));
-- alter policy inventory_counts_select_clinical on public.inventory_counts using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception']::public.app_role[]));
-- alter policy warehouses_select_clinical on public.warehouses using (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception']::public.app_role[]));
-- create or replace function public.has_clinic_role(_clinic_id uuid, _roles public.app_role[])
--  returns boolean language sql stable security definer set search_path to 'public'
-- as $f$
--   SELECT EXISTS (
--     SELECT 1 FROM public.clinic_members m
--     WHERE m.clinic_id = _clinic_id AND m.user_id = auth.uid() AND m.role = ANY(_roles)
--   );
-- $f$;
