-- Ola 4 · Frente Presupuesto PDF y correo (2/3): PLA-08, plantilla del presupuesto.
--
-- Siembra, por clínica, la plantilla "Presupuesto" del motor de documentos
-- (kind 'presupuesto', seed_key 'presupuesto'). Es la que usa el PDF del
-- presupuesto (descarga y correo al paciente) y se edita en
-- /plantillas-de-documentos como cualquier otra: editar crea una versión
-- nueva. Texto modelo redactado por Esmalia en español de Chile, para que
-- cada clínica lo revise y adapte.
--
-- El texto es el mismo que `PLANTILLA_PRESUPUESTO` de
-- src/lib/documentos/presupuesto.ts (lo vigila
-- tests/presupuesto-documento.test.ts), que es además el respaldo si la
-- clínica desactiva su plantilla.
--
-- Función y trigger PROPIOS (no se toca seed_clinic_document_templates):
-- el frente Receta siembra la suya en paralelo y así no chocan.
--
-- Idempotente: (clinic_id, seed_key) único; una plantilla que la clínica ya
-- tiene no se toca. Clínicas nuevas: trigger AFTER INSERT en clinics.
-- Existentes: al final. Requiere 20261025200000 (kind 'presupuesto').
--
-- Reversa al pie.

begin;

create or replace function public.seed_clinic_quote_template(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
  v_titulo constant text := 'Presupuesto';
  v_cuerpo constant text := $t$# Presupuesto {{presupuesto.numero}}

{{clinica.nombre}}, {{presupuesto.fecha}}

**Paciente:** {{paciente.nombre}}, {{paciente.tipo_documento}} {{paciente.rut}}
**Previsión:** {{paciente.prevision}}
**Profesional tratante:** {{presupuesto.profesional}}

## Prestaciones

{{presupuesto.prestaciones}}

{{presupuesto.totales}}

## Condiciones

- **Validez:** {{presupuesto.validez}}. Pasada esa fecha, los valores pueden cambiar.
- Si durante el tratamiento aparece algo que no se veía en la evaluación, el cambio se conversa y se presupuesta antes de hacerlo.
- La cobertura del convenio o de la previsión es un estimado: la confirma la institución al momento de la atención.
- Para aceptar este presupuesto, avísale a la clínica o fírmalo en tu próxima visita.

**Observaciones:** {{presupuesto.notas}}$t$;
begin
  insert into public.document_templates
    (clinic_id, seed_key, source, kind, title, description, created_by)
  values
    (p_clinic_id, 'presupuesto', 'esmalia_model', 'presupuesto', v_titulo,
     'PDF del presupuesto que se descarga o se envía por correo al paciente.', null)
  on conflict (clinic_id, seed_key) where seed_key is not null do nothing
  returning id into v_template_id;

  if v_template_id is null then
    return 0;
  end if;
  insert into public.document_template_versions (clinic_id, template_id, version, title, body)
  values (p_clinic_id, v_template_id, 1, v_titulo, v_cuerpo);
  return 1;
end;
$$;

comment on function public.seed_clinic_quote_template(uuid) is
  'PLA-08: siembra (idempotente) la plantilla del PDF del presupuesto de una clínica.';

-- Solo la llaman el trigger y esta migración, nunca un usuario por RPC.
revoke execute on function public.seed_clinic_quote_template(uuid) from public, anon, authenticated;

create or replace function public.seed_clinic_quote_template_al_crear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_clinic_quote_template(new.id);
  return new;
end;
$$;

revoke execute on function public.seed_clinic_quote_template_al_crear() from public, anon, authenticated;

drop trigger if exists on_clinic_created_quote_template on public.clinics;
create trigger on_clinic_created_quote_template
  after insert on public.clinics
  for each row execute function public.seed_clinic_quote_template_al_crear();

-- Clínicas que ya existen.
select public.seed_clinic_quote_template(id) from public.clinics;

commit;

-- Cómo revertir (la plantilla sembrada se borra con sus versiones; ningún
-- documento emitido la usa, porque el presupuesto no se emite):
--
-- begin;
-- drop trigger if exists on_clinic_created_quote_template on public.clinics;
-- drop function if exists public.seed_clinic_quote_template_al_crear();
-- drop function if exists public.seed_clinic_quote_template(uuid);
-- update public.document_templates set current_version_id = null
--  where kind = 'presupuesto'
--    and not exists (select 1 from public.issued_documents d where d.template_id = document_templates.id);
-- delete from public.document_template_versions v using public.document_templates t
--  where v.template_id = t.id and t.kind = 'presupuesto'
--    and not exists (select 1 from public.issued_documents d where d.template_id = t.id);
-- delete from public.document_templates t
--  where t.kind = 'presupuesto'
--    and not exists (select 1 from public.issued_documents d where d.template_id = t.id);
-- commit;
