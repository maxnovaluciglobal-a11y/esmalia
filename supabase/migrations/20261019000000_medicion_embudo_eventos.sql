-- Embudo medible de punta a punta (auditoría 360 del 18-oct-2026: IA-14,
-- MKT-02, COM-06). Tracking plan: docs/MEDICION.md y
-- src/lib/marketing/medicion.ts (`EVENTOS_DEL_PLAN`; un test compara esa
-- lista con este CHECK).
--
-- Sólo amplía el vocabulario de `marketing_events.name`. Sin columnas nuevas:
-- el tráfico interno va como `props.interno = true` y las consultas lo
-- excluyen. Sin datos personales: la tabla sigue sin policies (solo
-- service_role escribe y lee).
--
-- Hasta aplicar esta migración, los eventos nuevos fallan contra el CHECK y
-- el código los descarta con un warn en el log: no rompe nada.
alter table public.marketing_events
  drop constraint marketing_events_name_valido;

alter table public.marketing_events
  add constraint marketing_events_name_valido
    check (name in (
      -- navegador, anónimos (/api/ev)
      'calculadora_vista',
      'calculadora_usada',
      'lead_enviado',
      'cta_click',
      'page_view',
      -- cuenta: los pide el navegador, los valida y escribe el servidor
      'registro_completado',
      'checkout_iniciado',
      'suscripcion_activada',
      -- servidor
      'lead_intento',
      'onboarding_completado',
      'primera_cita_creada'
    ));
