-- Una política permisiva por (rol, comando) (20-oct-2026).
--
-- Corrige los 43 avisos `multiple_permissive_policies` del advisor de
-- performance de Supabase sin cambiar quién puede hacer qué:
--
-- (a) En 26 tablas, una política de escritura `FOR ALL` se superponía con la
--     de SELECT: Postgres evaluaba DOS políticas permisivas en cada lectura.
--     Cada `FOR ALL` se reemplaza por tres políticas (INSERT / UPDATE /
--     DELETE) con EXACTAMENTE las mismas expresiones USING / WITH CHECK y los
--     mismos roles. La lectura queda en la política SELECT de siempre.
--     Perder la contribución del `FOR ALL` al SELECT no cambia nada: en las
--     26 tablas el USING de escritura (has_clinic_role / can_manage_clinic
--     con un subconjunto de roles) implica el USING de lectura
--     (is_clinic_member o has_clinic_role con un superconjunto de roles).
-- (b) En 3 tablas había dos políticas SELECT permisivas (managers + "lo
--     propio"). Se unen en una sola con OR, que es lo mismo que hace Postgres
--     con dos permisivas.
-- (c) `vital_signs_insert_clinical` y `patient_guardians_insert_staff` llaman
--     `auth.uid()` sin envolver: se evaluaba por fila. Se recrean con
--     `(select auth.uid())` (advisor `auth_rls_initplan`), misma lógica.
--
-- Las políticas RESTRICTIVE `mfa_exige_aal2` no se tocan. Sin tablas nuevas:
-- `scripts/backup-tables.mjs` no cambia. Lo vigila
-- `tests/rls-politicas-por-comando.test.ts` (estructura + matriz de acceso
-- por rol, generada contra la base previa a esta migración).
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE, en una sola
-- transacción (un error a mitad no deja ninguna tabla sin políticas).
--
-- Cómo revertir: recrear las políticas `*_write*` FOR ALL y los SELECT
-- separados tal como quedaron en las migraciones anteriores (mismas
-- expresiones que las de acá) y borrar las `*_insert*`, `*_update*`,
-- `*_delete*` creadas abajo. La semántica es idéntica en ambos sentidos.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) FOR ALL de escritura -> INSERT / UPDATE / DELETE
-- ---------------------------------------------------------------------------

-- agreement_coverage: agreement_coverage_write_managers (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "agreement_coverage_write_managers" ON public.agreement_coverage;
DROP POLICY IF EXISTS "agreement_coverage_insert_managers" ON public.agreement_coverage;
DROP POLICY IF EXISTS "agreement_coverage_update_managers" ON public.agreement_coverage;
DROP POLICY IF EXISTS "agreement_coverage_delete_managers" ON public.agreement_coverage;
CREATE POLICY "agreement_coverage_insert_managers" ON public.agreement_coverage
  FOR INSERT TO authenticated
  WITH CHECK ((public.can_manage_clinic(clinic_id) AND public.misma_clinica_agreement(clinic_id, agreement_id) AND public.misma_clinica_procedure(clinic_id, procedure_id)));
CREATE POLICY "agreement_coverage_update_managers" ON public.agreement_coverage
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK ((public.can_manage_clinic(clinic_id) AND public.misma_clinica_agreement(clinic_id, agreement_id) AND public.misma_clinica_procedure(clinic_id, procedure_id)));
CREATE POLICY "agreement_coverage_delete_managers" ON public.agreement_coverage
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- appointment_statuses: appointment_statuses_write_managers (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "appointment_statuses_write_managers" ON public.appointment_statuses;
DROP POLICY IF EXISTS "appointment_statuses_insert_managers" ON public.appointment_statuses;
DROP POLICY IF EXISTS "appointment_statuses_update_managers" ON public.appointment_statuses;
DROP POLICY IF EXISTS "appointment_statuses_delete_managers" ON public.appointment_statuses;
CREATE POLICY "appointment_statuses_insert_managers" ON public.appointment_statuses
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "appointment_statuses_update_managers" ON public.appointment_statuses
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "appointment_statuses_delete_managers" ON public.appointment_statuses
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- branches: branches_write (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "branches_write" ON public.branches;
DROP POLICY IF EXISTS "branches_insert" ON public.branches;
DROP POLICY IF EXISTS "branches_update" ON public.branches;
DROP POLICY IF EXISTS "branches_delete" ON public.branches;
CREATE POLICY "branches_insert" ON public.branches
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "branches_update" ON public.branches
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "branches_delete" ON public.branches
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- commission_rules: commission_rules_write (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "commission_rules_write" ON public.commission_rules;
DROP POLICY IF EXISTS "commission_rules_insert" ON public.commission_rules;
DROP POLICY IF EXISTS "commission_rules_update" ON public.commission_rules;
DROP POLICY IF EXISTS "commission_rules_delete" ON public.commission_rules;
CREATE POLICY "commission_rules_insert" ON public.commission_rules
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "commission_rules_update" ON public.commission_rules
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "commission_rules_delete" ON public.commission_rules
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- consent_templates: consent_templates_write (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "consent_templates_write" ON public.consent_templates;
DROP POLICY IF EXISTS "consent_templates_insert" ON public.consent_templates;
DROP POLICY IF EXISTS "consent_templates_update" ON public.consent_templates;
DROP POLICY IF EXISTS "consent_templates_delete" ON public.consent_templates;
CREATE POLICY "consent_templates_insert" ON public.consent_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "consent_templates_update" ON public.consent_templates
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "consent_templates_delete" ON public.consent_templates
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- email_sandbox_config: email_sandbox_config_write (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "email_sandbox_config_write" ON public.email_sandbox_config;
DROP POLICY IF EXISTS "email_sandbox_config_insert" ON public.email_sandbox_config;
DROP POLICY IF EXISTS "email_sandbox_config_update" ON public.email_sandbox_config;
DROP POLICY IF EXISTS "email_sandbox_config_delete" ON public.email_sandbox_config;
CREATE POLICY "email_sandbox_config_insert" ON public.email_sandbox_config
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "email_sandbox_config_update" ON public.email_sandbox_config
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "email_sandbox_config_delete" ON public.email_sandbox_config
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- message_templates: message_templates_write_managers (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "message_templates_write_managers" ON public.message_templates;
DROP POLICY IF EXISTS "message_templates_insert_managers" ON public.message_templates;
DROP POLICY IF EXISTS "message_templates_update_managers" ON public.message_templates;
DROP POLICY IF EXISTS "message_templates_delete_managers" ON public.message_templates;
CREATE POLICY "message_templates_insert_managers" ON public.message_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role]));
CREATE POLICY "message_templates_update_managers" ON public.message_templates
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role]));
CREATE POLICY "message_templates_delete_managers" ON public.message_templates
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role]));

-- messages: messages_write_operators (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "messages_write_operators" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_operators" ON public.messages;
DROP POLICY IF EXISTS "messages_update_operators" ON public.messages;
DROP POLICY IF EXISTS "messages_delete_operators" ON public.messages;
CREATE POLICY "messages_insert_operators" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "messages_update_operators" ON public.messages
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "messages_delete_operators" ON public.messages
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));

-- operatories: operatories_write (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "operatories_write" ON public.operatories;
DROP POLICY IF EXISTS "operatories_insert" ON public.operatories;
DROP POLICY IF EXISTS "operatories_update" ON public.operatories;
DROP POLICY IF EXISTS "operatories_delete" ON public.operatories;
CREATE POLICY "operatories_insert" ON public.operatories
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "operatories_update" ON public.operatories
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "operatories_delete" ON public.operatories
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- ortho_cases: ortho_cases_write_clinical_roles (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "ortho_cases_write_clinical_roles" ON public.ortho_cases;
DROP POLICY IF EXISTS "ortho_cases_insert_clinical_roles" ON public.ortho_cases;
DROP POLICY IF EXISTS "ortho_cases_update_clinical_roles" ON public.ortho_cases;
DROP POLICY IF EXISTS "ortho_cases_delete_clinical_roles" ON public.ortho_cases;
CREATE POLICY "ortho_cases_insert_clinical_roles" ON public.ortho_cases
  FOR INSERT TO public
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'assistant'::public.app_role]));
CREATE POLICY "ortho_cases_update_clinical_roles" ON public.ortho_cases
  FOR UPDATE TO public
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'assistant'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'assistant'::public.app_role]));
CREATE POLICY "ortho_cases_delete_clinical_roles" ON public.ortho_cases
  FOR DELETE TO public
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'assistant'::public.app_role]));

-- ortho_controls: ortho_controls_write_clinical_roles (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "ortho_controls_write_clinical_roles" ON public.ortho_controls;
DROP POLICY IF EXISTS "ortho_controls_insert_clinical_roles" ON public.ortho_controls;
DROP POLICY IF EXISTS "ortho_controls_update_clinical_roles" ON public.ortho_controls;
DROP POLICY IF EXISTS "ortho_controls_delete_clinical_roles" ON public.ortho_controls;
CREATE POLICY "ortho_controls_insert_clinical_roles" ON public.ortho_controls
  FOR INSERT TO public
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'assistant'::public.app_role]));
CREATE POLICY "ortho_controls_update_clinical_roles" ON public.ortho_controls
  FOR UPDATE TO public
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'assistant'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'assistant'::public.app_role]));
CREATE POLICY "ortho_controls_delete_clinical_roles" ON public.ortho_controls
  FOR DELETE TO public
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'assistant'::public.app_role]));

-- payment_methods: payment_methods_write_managers (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "payment_methods_write_managers" ON public.payment_methods;
DROP POLICY IF EXISTS "payment_methods_insert_managers" ON public.payment_methods;
DROP POLICY IF EXISTS "payment_methods_update_managers" ON public.payment_methods;
DROP POLICY IF EXISTS "payment_methods_delete_managers" ON public.payment_methods;
CREATE POLICY "payment_methods_insert_managers" ON public.payment_methods
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "payment_methods_update_managers" ON public.payment_methods
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "payment_methods_delete_managers" ON public.payment_methods
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- payments: payments_write_finance_roles (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "payments_write_finance_roles" ON public.payments;
DROP POLICY IF EXISTS "payments_insert_finance_roles" ON public.payments;
DROP POLICY IF EXISTS "payments_update_finance_roles" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_finance_roles" ON public.payments;
CREATE POLICY "payments_insert_finance_roles" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "payments_update_finance_roles" ON public.payments
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "payments_delete_finance_roles" ON public.payments
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));

-- procedure_supplies: procedure_supplies_write_managers (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "procedure_supplies_write_managers" ON public.procedure_supplies;
DROP POLICY IF EXISTS "procedure_supplies_insert_managers" ON public.procedure_supplies;
DROP POLICY IF EXISTS "procedure_supplies_update_managers" ON public.procedure_supplies;
DROP POLICY IF EXISTS "procedure_supplies_delete_managers" ON public.procedure_supplies;
CREATE POLICY "procedure_supplies_insert_managers" ON public.procedure_supplies
  FOR INSERT TO public
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));
CREATE POLICY "procedure_supplies_update_managers" ON public.procedure_supplies
  FOR UPDATE TO public
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));
CREATE POLICY "procedure_supplies_delete_managers" ON public.procedure_supplies
  FOR DELETE TO public
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));

-- procedures: procedures_write_managers (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "procedures_write_managers" ON public.procedures;
DROP POLICY IF EXISTS "procedures_insert_managers" ON public.procedures;
DROP POLICY IF EXISTS "procedures_update_managers" ON public.procedures;
DROP POLICY IF EXISTS "procedures_delete_managers" ON public.procedures;
CREATE POLICY "procedures_insert_managers" ON public.procedures
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));
CREATE POLICY "procedures_update_managers" ON public.procedures
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));
CREATE POLICY "procedures_delete_managers" ON public.procedures
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));

-- professional_schedules: professional_schedules_write (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "professional_schedules_write" ON public.professional_schedules;
DROP POLICY IF EXISTS "professional_schedules_insert" ON public.professional_schedules;
DROP POLICY IF EXISTS "professional_schedules_update" ON public.professional_schedules;
DROP POLICY IF EXISTS "professional_schedules_delete" ON public.professional_schedules;
CREATE POLICY "professional_schedules_insert" ON public.professional_schedules
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "professional_schedules_update" ON public.professional_schedules
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "professional_schedules_delete" ON public.professional_schedules
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- professionals: professionals_write (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "professionals_write" ON public.professionals;
DROP POLICY IF EXISTS "professionals_insert" ON public.professionals;
DROP POLICY IF EXISTS "professionals_update" ON public.professionals;
DROP POLICY IF EXISTS "professionals_delete" ON public.professionals;
CREATE POLICY "professionals_insert" ON public.professionals
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "professionals_update" ON public.professionals
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "professionals_delete" ON public.professionals
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- quote_items: quote_items_write_finance_roles (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "quote_items_write_finance_roles" ON public.quote_items;
DROP POLICY IF EXISTS "quote_items_insert_finance_roles" ON public.quote_items;
DROP POLICY IF EXISTS "quote_items_update_finance_roles" ON public.quote_items;
DROP POLICY IF EXISTS "quote_items_delete_finance_roles" ON public.quote_items;
CREATE POLICY "quote_items_insert_finance_roles" ON public.quote_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "quote_items_update_finance_roles" ON public.quote_items
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "quote_items_delete_finance_roles" ON public.quote_items
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));

-- quotes: quotes_write_finance_roles (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "quotes_write_finance_roles" ON public.quotes;
DROP POLICY IF EXISTS "quotes_insert_finance_roles" ON public.quotes;
DROP POLICY IF EXISTS "quotes_update_finance_roles" ON public.quotes;
DROP POLICY IF EXISTS "quotes_delete_finance_roles" ON public.quotes;
CREATE POLICY "quotes_insert_finance_roles" ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "quotes_update_finance_roles" ON public.quotes
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "quotes_delete_finance_roles" ON public.quotes
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));

-- specialties: specialties_write (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "specialties_write" ON public.specialties;
DROP POLICY IF EXISTS "specialties_insert" ON public.specialties;
DROP POLICY IF EXISTS "specialties_update" ON public.specialties;
DROP POLICY IF EXISTS "specialties_delete" ON public.specialties;
CREATE POLICY "specialties_insert" ON public.specialties
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "specialties_update" ON public.specialties
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "specialties_delete" ON public.specialties
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- treatment_items: treatment_items_write_finance_roles (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "treatment_items_write_finance_roles" ON public.treatment_items;
DROP POLICY IF EXISTS "treatment_items_insert_finance_roles" ON public.treatment_items;
DROP POLICY IF EXISTS "treatment_items_update_finance_roles" ON public.treatment_items;
DROP POLICY IF EXISTS "treatment_items_delete_finance_roles" ON public.treatment_items;
CREATE POLICY "treatment_items_insert_finance_roles" ON public.treatment_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "treatment_items_update_finance_roles" ON public.treatment_items
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "treatment_items_delete_finance_roles" ON public.treatment_items
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));

-- treatment_plans: treatment_plans_write_finance_roles (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "treatment_plans_write_finance_roles" ON public.treatment_plans;
DROP POLICY IF EXISTS "treatment_plans_insert_finance_roles" ON public.treatment_plans;
DROP POLICY IF EXISTS "treatment_plans_update_finance_roles" ON public.treatment_plans;
DROP POLICY IF EXISTS "treatment_plans_delete_finance_roles" ON public.treatment_plans;
CREATE POLICY "treatment_plans_insert_finance_roles" ON public.treatment_plans
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "treatment_plans_update_finance_roles" ON public.treatment_plans
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "treatment_plans_delete_finance_roles" ON public.treatment_plans
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));

-- waitlist_entries: waitlist_write_agenda_roles (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "waitlist_write_agenda_roles" ON public.waitlist_entries;
DROP POLICY IF EXISTS "waitlist_insert_agenda_roles" ON public.waitlist_entries;
DROP POLICY IF EXISTS "waitlist_update_agenda_roles" ON public.waitlist_entries;
DROP POLICY IF EXISTS "waitlist_delete_agenda_roles" ON public.waitlist_entries;
CREATE POLICY "waitlist_insert_agenda_roles" ON public.waitlist_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "waitlist_update_agenda_roles" ON public.waitlist_entries
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "waitlist_delete_agenda_roles" ON public.waitlist_entries
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));

-- warehouses: warehouses_write_managers (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "warehouses_write_managers" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_insert_managers" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_update_managers" ON public.warehouses;
DROP POLICY IF EXISTS "warehouses_delete_managers" ON public.warehouses;
CREATE POLICY "warehouses_insert_managers" ON public.warehouses
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "warehouses_update_managers" ON public.warehouses
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "warehouses_delete_managers" ON public.warehouses
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- whatsapp_accounts: wa_accounts_write_owners (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "wa_accounts_write_owners" ON public.whatsapp_accounts;
DROP POLICY IF EXISTS "wa_accounts_insert_owners" ON public.whatsapp_accounts;
DROP POLICY IF EXISTS "wa_accounts_update_owners" ON public.whatsapp_accounts;
DROP POLICY IF EXISTS "wa_accounts_delete_owners" ON public.whatsapp_accounts;
CREATE POLICY "wa_accounts_insert_owners" ON public.whatsapp_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role]));
CREATE POLICY "wa_accounts_update_owners" ON public.whatsapp_accounts
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role]));
CREATE POLICY "wa_accounts_delete_owners" ON public.whatsapp_accounts
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role]));

-- whatsapp_leads: whatsapp_leads_write_agenda_roles (FOR ALL) -> INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "whatsapp_leads_write_agenda_roles" ON public.whatsapp_leads;
DROP POLICY IF EXISTS "whatsapp_leads_insert_agenda_roles" ON public.whatsapp_leads;
DROP POLICY IF EXISTS "whatsapp_leads_update_agenda_roles" ON public.whatsapp_leads;
DROP POLICY IF EXISTS "whatsapp_leads_delete_agenda_roles" ON public.whatsapp_leads;
CREATE POLICY "whatsapp_leads_insert_agenda_roles" ON public.whatsapp_leads
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "whatsapp_leads_update_agenda_roles" ON public.whatsapp_leads
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));
CREATE POLICY "whatsapp_leads_delete_agenda_roles" ON public.whatsapp_leads
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role, 'reception'::public.app_role]));

-- ---------------------------------------------------------------------------
-- (b) SELECT duplicados -> uno solo con OR
-- ---------------------------------------------------------------------------

-- clinic_data_exports: managers ven todas; cada miembro ve las que hizo.
DROP POLICY IF EXISTS "clinic_data_exports_select_managers" ON public.clinic_data_exports;
DROP POLICY IF EXISTS "clinic_data_exports_select_own" ON public.clinic_data_exports;
DROP POLICY IF EXISTS "clinic_data_exports_select" ON public.clinic_data_exports;
CREATE POLICY "clinic_data_exports_select" ON public.clinic_data_exports
  FOR SELECT TO authenticated
  USING (
    public.can_manage_clinic(clinic_id)
    OR (actor_id = (select auth.uid()) AND public.is_clinic_member(clinic_id))
  );

-- commission_rules: owner/admin/accounting ven todas; el profesional, las suyas.
DROP POLICY IF EXISTS "commission_rules_select_own" ON public.commission_rules;
DROP POLICY IF EXISTS "commission_rules_select" ON public.commission_rules;
CREATE POLICY "commission_rules_select" ON public.commission_rules
  FOR SELECT TO authenticated
  USING (
    public.has_clinic_role(clinic_id, ARRAY['owner','admin','accounting']::public.app_role[])
    OR professional_id IN (
      SELECT professionals.id FROM public.professionals
      WHERE professionals.user_id = (select auth.uid())
    )
  );

-- commission_settlements: igual que commission_rules.
DROP POLICY IF EXISTS "commission_settlements_select_managers" ON public.commission_settlements;
DROP POLICY IF EXISTS "commission_settlements_select_own" ON public.commission_settlements;
DROP POLICY IF EXISTS "commission_settlements_select" ON public.commission_settlements;
CREATE POLICY "commission_settlements_select" ON public.commission_settlements
  FOR SELECT TO authenticated
  USING (
    public.has_clinic_role(clinic_id, ARRAY['owner','admin','accounting']::public.app_role[])
    OR professional_id IN (
      SELECT professionals.id FROM public.professionals
      WHERE professionals.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- (c) auth.uid() -> (select auth.uid())
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "vital_signs_insert_clinical" ON public.patient_vital_signs;
CREATE POLICY "vital_signs_insert_clinical" ON public.patient_vital_signs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant']::public.app_role[])
    AND recorded_by = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = patient_vital_signs.patient_id AND p.clinic_id = patient_vital_signs.clinic_id
    )
    AND (
      appointment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.id = patient_vital_signs.appointment_id
          AND a.clinic_id = patient_vital_signs.clinic_id
          AND a.patient_id = patient_vital_signs.patient_id
      )
    )
  );

DROP POLICY IF EXISTS "patient_guardians_insert_staff" ON public.patient_guardians;
CREATE POLICY "patient_guardians_insert_staff" ON public.patient_guardians
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception']::public.app_role[])
    AND created_by = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = patient_guardians.patient_id AND p.clinic_id = patient_guardians.clinic_id
    )
  );

COMMIT;
