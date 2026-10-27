-- Ola 12 · Frente B (NAV-02): avance de la puesta en marcha.
--
-- El indicador de avance se calcula con datos reales (sucursales, horarios,
-- equipo, arancel, reserva en línea, correos a pacientes, pacientes…) y no
-- necesita tabla. Lo único que hay que guardar es que el propietario o el
-- administrador lo descartó, para que no vuelva a aparecer en ningún equipo
-- ni a otra persona de la clínica. Es un dato de la clínica, por eso va en
-- `clinics` y no en el navegador.
--
-- Aditiva y compatible con el código en producción: dos columnas nullable sin
-- default que nadie lee todavía. No toca políticas: la escritura pasa por la
-- política existente "clinics_update_managers" (can_manage_clinic = owner y
-- admin), la lectura por "clinics_select_members". Columnas nuevas de una
-- tabla existente heredan sus GRANT de tabla (no hace falta GRANT explícito:
-- la regla del 30-oct aplica a tablas nuevas). No escribe datos.
--
-- Exportación: excluidas con motivo en `exportacion-clinica.ts` (estado de la
-- guía dentro de Esmalia, no un dato de la clínica), igual que
-- onboarding_completed y onboarding_call_at.
--
-- Cómo revertir:
--   alter table public.clinics
--     drop column if exists setup_guide_dismissed_at,
--     drop column if exists setup_guide_dismissed_by;

begin;

alter table public.clinics
  add column if not exists setup_guide_dismissed_at timestamptz null,
  add column if not exists setup_guide_dismissed_by uuid null
    references auth.users (id) on delete set null;

comment on column public.clinics.setup_guide_dismissed_at is
  'NAV-02: cuándo se descartó el avance de la puesta en marcha. null = se muestra mientras quede algo pendiente.';
comment on column public.clinics.setup_guide_dismissed_by is
  'NAV-02: quién lo descartó (owner/admin).';

commit;
