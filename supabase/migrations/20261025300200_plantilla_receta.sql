-- Ola 4 · Frente Receta (3/3): MKT-05, plantilla "Receta" por clínica.
--
-- Siembra, por clínica, la plantilla de receta del motor de documentos
-- (kind 'receta'), editable en /plantillas-de-documentos como cualquier otra.
-- Usa las variables `receta.*` (src/lib/documentos/receta.ts): la tabla de
-- medicamentos, las alergias registradas y las indicaciones generales.
-- `tests/receta-plantilla.test.ts` lee este archivo y valida que el texto se
-- pueda emitir con el motor tal cual.
--
-- Va en una función y un trigger propios (no redefine
-- `seed_clinic_document_templates`, que puede tocar otro frente de la ola):
-- así las dos siembras conviven sin pisarse.
--
-- Idempotente: la clave (clinic_id, seed_key = 'receta') hace que correrla
-- dos veces no duplique nada, y una plantilla que la clínica ya editó no se
-- toca. Clínicas nuevas: trigger AFTER INSERT en clinics. Existentes: al final.
--
-- Requiere 20261025300100 (kind 'receta' en el CHECK). Reversa al pie.

begin;

create or replace function public.seed_clinic_prescription_template(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
  v_titulo constant text := 'Receta';
  v_cuerpo constant text := $t$# Receta

{{clinica.nombre}}, {{fecha}}

**Paciente:** {{paciente.nombre}}
**{{paciente.tipo_documento}}:** {{paciente.rut}}
**Edad:** {{paciente.edad}}
**Alergias registradas:** {{receta.alergias}}

## Medicamentos indicados

{{receta.medicamentos}}

**Indicaciones generales:** {{receta.indicaciones_generales}}$t$;
begin
  insert into public.document_templates
    (clinic_id, seed_key, source, kind, title, description, created_by)
  values
    (p_clinic_id, 'receta', 'esmalia_model', 'receta', v_titulo,
     'Receta con los medicamentos, la posología, las alergias del paciente y tu registro de la Superintendencia de Salud.',
     null)
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

comment on function public.seed_clinic_prescription_template(uuid) is
  'MKT-05: siembra (idempotente) la plantilla de receta de una clínica.';

revoke execute on function public.seed_clinic_prescription_template(uuid) from public, anon, authenticated;

create or replace function public.seed_clinic_prescription_template_al_crear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_clinic_prescription_template(new.id);
  return new;
end;
$$;

revoke execute on function public.seed_clinic_prescription_template_al_crear() from public, anon, authenticated;

drop trigger if exists on_clinic_created_prescription_template on public.clinics;
create trigger on_clinic_created_prescription_template
  after insert on public.clinics
  for each row execute function public.seed_clinic_prescription_template_al_crear();

-- Clínicas que ya existen.
select public.seed_clinic_prescription_template(id) from public.clinics;

commit;

-- Cómo revertir (la plantilla sembrada se borra si ningún documento la usó;
-- si ya se emitieron recetas, queda, porque las versiones son RESTRICT):
--
-- begin;
-- drop trigger if exists on_clinic_created_prescription_template on public.clinics;
-- drop function if exists public.seed_clinic_prescription_template_al_crear();
-- drop function if exists public.seed_clinic_prescription_template(uuid);
-- delete from public.document_templates t
--  where t.seed_key = 'receta' and t.source = 'esmalia_model'
--    and not exists (select 1 from public.issued_documents d where d.template_id = t.id);
-- commit;
