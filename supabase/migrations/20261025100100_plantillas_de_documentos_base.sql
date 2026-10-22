-- Ola 4 · Frente Motor de plantillas y documentos (2/3): DOC-02 y MKT-04.
--
-- Siembra, por clínica, las plantillas base de documentos: certificado de
-- atención, certificado de reposo, derivación o interconsulta, alta
-- odontológica, informe odontológico, declaración y consentimiento simple, y
-- el formulario de reembolso para seguro complementario (MKT-04). Textos
-- redactados por Esmalia en español de Chile; son un MODELO para que cada
-- clínica los revise y adapte (la interfaz lo dice), no un documento revisado
-- por un abogado.
--
-- Idempotente: la clave (clinic_id, seed_key) hace que correrla dos veces no
-- duplique nada, y una plantilla que la clínica ya editó no se toca (solo se
-- inserta la que falta). Cada plantilla nace con su versión 1. Las variables
-- de los textos son las del motor (src/lib/documentos/variables.ts):
-- `tests/plantillas-documentos.test.ts` lee este archivo y valida que todas
-- existan.
--
-- Clínicas nuevas: trigger AFTER INSERT en clinics. Existentes: al final.
--
-- Reversa al pie.

begin;

create or replace function public.seed_clinic_document_templates(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plantilla record;
  v_template_id uuid;
  v_insertadas integer := 0;
begin
  for v_plantilla in
    select * from (values
      (
        'certificado-atencion',
        'certificado_atencion',
        'Certificado de atención',
        'Acredita que el paciente se atendió en la clínica en una fecha.',
        $t$# Certificado de atención odontológica

{{clinica.nombre}}, {{fecha}}

Certifico que **{{paciente.nombre}}**, {{paciente.tipo_documento}} {{paciente.rut}}, recibió atención odontológica en esta clínica el {{campo.fecha_atencion}}.

**Motivo de la atención:** {{campo.motivo}}

Se extiende el presente certificado a solicitud de la persona interesada, para los fines que estime convenientes.$t$
      ),
      (
        'reposo',
        'reposo',
        'Certificado de reposo',
        'Indica días de reposo después de una atención o un procedimiento.',
        $t$# Certificado de reposo

{{clinica.nombre}}, {{fecha}}

Certifico que **{{paciente.nombre}}**, {{paciente.tipo_documento}} {{paciente.rut}}, recibió atención odontológica el {{campo.fecha_atencion}} y requiere reposo por **{{campo.dias_reposo}} días**, desde el {{campo.reposo_desde}} hasta el {{campo.reposo_hasta}}, ambos inclusive.

**Diagnóstico:** {{campo.diagnostico}}

**Indicaciones:** {{campo.indicaciones}}

Este certificado no reemplaza la licencia médica cuando corresponde tramitarla.$t$
      ),
      (
        'derivacion',
        'derivacion',
        'Derivación o interconsulta',
        'Deriva al paciente a otro profesional o especialidad con sus antecedentes.',
        $t$# Interconsulta

{{clinica.nombre}}, {{fecha}}

**Paciente:** {{paciente.nombre}}, {{paciente.tipo_documento}} {{paciente.rut}}
**Edad:** {{paciente.edad}}
**Previsión:** {{paciente.prevision}}

**Se deriva a:** {{campo.derivado_a}}

**Motivo de la derivación:** {{campo.motivo}}

**Antecedentes relevantes:** {{campo.antecedentes}}

**Lo que se solicita:** {{campo.solicitud}}

Agradeceré la evaluación del paciente y la contrarreferencia con sus indicaciones.$t$
      ),
      (
        'alta',
        'alta',
        'Alta odontológica',
        'Deja constancia de que el tratamiento terminó, con las indicaciones de control.',
        $t$# Alta odontológica

{{clinica.nombre}}, {{fecha}}

Certifico que **{{paciente.nombre}}**, {{paciente.tipo_documento}} {{paciente.rut}}, terminó el tratamiento odontológico indicado y queda de alta a contar del {{campo.fecha_alta}}.

**Tratamiento realizado:** {{campo.tratamiento_realizado}}

**Indicaciones y controles:** {{campo.indicaciones}}

Ante cualquier molestia, sangrado o duda, el paciente puede consultar en la clínica antes del próximo control.$t$
      ),
      (
        'informe',
        'informe',
        'Informe odontológico',
        'Resume motivo de consulta, hallazgos, diagnóstico y plan de tratamiento.',
        $t$# Informe odontológico

{{clinica.nombre}}, {{fecha}}

**Paciente:** {{paciente.nombre}}, {{paciente.tipo_documento}} {{paciente.rut}}
**Edad:** {{paciente.edad}}
**Previsión:** {{paciente.prevision}}

## Motivo de consulta

{{campo.motivo}}

## Hallazgos clínicos

{{campo.hallazgos}}

## Diagnóstico

{{campo.diagnostico}}

## Plan de tratamiento

{{campo.plan_tratamiento}}

## Observaciones

{{campo.observaciones}}$t$
      ),
      (
        'consentimiento-simple',
        'consentimiento',
        'Declaración y consentimiento simple',
        'Declaración breve del paciente para un procedimiento sencillo. Para un consentimiento informado completo, usa Consentimientos.',
        $t$# Declaración y consentimiento

Yo, **{{paciente.nombre}}**, {{paciente.tipo_documento}} {{paciente.rut}}, declaro que {{profesional.nombre}} me explicó en palabras claras el procedimiento **{{campo.procedimiento}}**, para qué sirve, sus riesgos más frecuentes y las alternativas que existen, y que pude hacer todas mis preguntas.

Acepto que se realice el procedimiento indicado. Sé que puedo retirar este consentimiento antes de que se realice, sin dar explicaciones.

{{clinica.nombre}}, {{fecha}}

Firma del paciente o de su representante legal: ______________________________$t$
      ),
      (
        'reembolso-seguro',
        'reembolso',
        'Reembolso de seguro complementario',
        'Detalla las prestaciones realizadas y lo pagado en un período, para presentar a la aseguradora.',
        $t$# Detalle de prestaciones para reembolso

**Prestador:** {{clinica.razon_social}}
**RUT:** {{clinica.rut}}
**Giro:** {{clinica.giro}}
**Dirección:** {{clinica.direccion_tributaria}}

**Paciente:** {{paciente.nombre}}, {{paciente.tipo_documento}} {{paciente.rut}}
**Previsión:** {{paciente.prevision}}
**Aseguradora:** {{campo.aseguradora}}
**N.º de póliza:** {{campo.numero_poliza}}

Prestaciones odontológicas realizadas entre el {{campo.periodo_desde}} y el {{campo.periodo_hasta}}:

{{reembolso.prestaciones}}

**Total pagado por el paciente en el período:** {{reembolso.total_pagado}}

Certifico que las prestaciones detalladas fueron realizadas en esta clínica en las fechas indicadas y que los montos corresponden a lo pagado por el paciente.

{{clinica.nombre}}, {{fecha}}$t$
      )
    ) as v(seed_key, kind, title, description, body)
  loop
    insert into public.document_templates
      (clinic_id, seed_key, source, kind, title, description, created_by)
    values
      (p_clinic_id, v_plantilla.seed_key, 'esmalia_model', v_plantilla.kind,
       v_plantilla.title, v_plantilla.description, null)
    on conflict (clinic_id, seed_key) where seed_key is not null do nothing
    returning id into v_template_id;

    if v_template_id is not null then
      insert into public.document_template_versions (clinic_id, template_id, version, title, body)
      values (p_clinic_id, v_template_id, 1, v_plantilla.title, v_plantilla.body);
      v_insertadas := v_insertadas + 1;
    end if;
    v_template_id := null;
  end loop;

  return v_insertadas;
end;
$$;

comment on function public.seed_clinic_document_templates(uuid) is
  'DOC-02: siembra (idempotente) las plantillas base de documentos de una clínica.';

-- Solo la llaman el trigger y esta migración, nunca un usuario por RPC.
revoke execute on function public.seed_clinic_document_templates(uuid) from public, anon, authenticated;

create or replace function public.seed_clinic_document_templates_al_crear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_clinic_document_templates(new.id);
  return new;
end;
$$;

revoke execute on function public.seed_clinic_document_templates_al_crear() from public, anon, authenticated;

drop trigger if exists on_clinic_created_document_templates on public.clinics;
create trigger on_clinic_created_document_templates
  after insert on public.clinics
  for each row execute function public.seed_clinic_document_templates_al_crear();

-- Clínicas que ya existen.
select public.seed_clinic_document_templates(id) from public.clinics;

commit;

-- Cómo revertir (las plantillas sembradas que ningún documento usa se
-- borran; las usadas quedan, porque las versiones son RESTRICT):
--
-- begin;
-- drop trigger if exists on_clinic_created_document_templates on public.clinics;
-- drop function if exists public.seed_clinic_document_templates_al_crear();
-- drop function if exists public.seed_clinic_document_templates(uuid);
-- delete from public.document_templates t
--  where t.source = 'esmalia_model'
--    and not exists (select 1 from public.issued_documents d where d.template_id = t.id);
-- commit;
