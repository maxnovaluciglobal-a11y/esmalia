-- Cierre de la demo completa: notas clínicas de ejemplo para TODAS las fichas de la demo.
--
-- `reset_demo_clinic()` deja notas firmadas solo en 4 de los 10 pacientes, así que la pestaña
-- Notas, la línea de tiempo y "Notas sin firmar" salen vacías en el resto de las fichas. Una
-- nota clínica son dos filas (la nota y su versión 1) y el disparador `clinical_notes_exigir_version`
-- es diferido: exige la versión al COMMIT, o sea en la MISMA transacción. El reseteo de la app
-- escribe por la API REST (una transacción por fila), así que no puede crearlas; la aplicación
-- real las escribe con el RPC `guardar_nota_clinica`, que necesita una sesión humana.
--
-- Esta migración AGREGA una función nueva (no redefine ninguna existente, no escribe datos al
-- aplicarse): `public.sembrar_notas_de_la_demo()`. La llama `/api/demo-reset` con el rol de
-- servicio y solo opera sobre la clínica demo (`clinics.is_demo`), solo en pacientes sin notas
-- y de forma idempotente. Texto genérico (SOAP corto), sin datos de nadie.
--
-- EXECUTE solo para el rol de servicio (SECURITY DEFINER: revoca a PUBLIC, anon y authenticated).
--
-- Reversa al pie.

begin;

create or replace function public.sembrar_notas_de_la_demo()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
  v_owner uuid;
  v_pat record;
  v_note uuid;
  v_n integer := 0;
  v_i integer := 0;
  v_titulos text[] := array[
    'Primera consulta', 'Control y limpieza', 'Obturación con resina', 'Evaluación de ortodoncia',
    'Extracción simple', 'Blanqueamiento dental', 'Aplicación de sellantes'
  ];
  v_contenidos text[] := array[
    E'S: Consulta por revisión general, sin dolor.\nO: Buena higiene oral, sin lesiones en mucosa.\nA: Paciente sano; sin patología aguda.\nP: Se indica control y limpieza en 6 meses.',
    E'S: Sin molestias, viene a su control semestral.\nO: Placa bacteriana leve; encías sin inflamación.\nA: Estado periodontal estable.\nP: Profilaxis realizada y refuerzo de técnica de cepillado.',
    E'S: Sensibilidad al frío en una pieza posterior.\nO: Caries oclusal pequeña, sin compromiso pulpar.\nA: Caries incipiente.\nP: Se realiza obturación con resina; se cita a control en 2 semanas.',
    E'S: Consulta por apiñamiento dental.\nO: Mordida cruzada leve, buena salud periodontal.\nA: Maloclusión clase I con apiñamiento.\nP: Se explican alternativas de tratamiento y se solicitan registros.',
    E'S: Pieza con movilidad y dolor al masticar.\nO: Movilidad grado II, sin absceso.\nA: Pieza no recuperable.\nP: Extracción simple con anestesia local; indicaciones postoperatorias entregadas.',
    E'S: Desea aclarar el color de sus dientes.\nO: Tinciones leves por café; sin caries activas.\nA: Apto para blanqueamiento.\nP: Se realiza la primera sesión; se indica evitar pigmentos 48 horas.',
    E'S: Control preventivo.\nO: Surcos profundos en molares permanentes sin caries.\nA: Riesgo de caries moderado.\nP: Se aplican sellantes en molares y se refuerza la higiene.'
  ];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Solo el rol de servicio siembra las notas de la demo.' using errcode = '42501';
  end if;

  select c.id, c.created_by into v_clinic, v_owner
    from public.clinics c
   where c.is_demo
   order by c.created_at
   limit 1;
  if v_clinic is null then
    return 0;
  end if;

  for v_pat in
    select p.id, p.full_name
      from public.patients p
     where p.clinic_id = v_clinic
       and p.archived_at is null
       and p.merged_into is null
       and not exists (
         select 1 from public.clinical_notes n
          where n.clinic_id = v_clinic and n.patient_ref = p.id::text
       )
     order by p.created_at, p.full_name
  loop
    v_i := v_i + 1;
    v_note := gen_random_uuid();
    insert into public.clinical_notes
      (id, clinic_id, patient_ref, patient_name, title, content, summary, status, created_by, created_at)
    values
      (v_note, v_clinic, v_pat.id::text, v_pat.full_name,
       v_titulos[1 + (v_i - 1) % array_length(v_titulos, 1)],
       v_contenidos[1 + (v_i - 1) % array_length(v_contenidos, 1)],
       split_part(v_contenidos[1 + (v_i - 1) % array_length(v_contenidos, 1)], E'\n', 4),
       'signed', v_owner, now() - make_interval(days => 2 + v_i * 3));
    insert into public.clinical_note_versions
      (note_id, clinic_id, version, title, content, summary, ai_assisted, author_id)
    values
      (v_note, v_clinic, 1,
       v_titulos[1 + (v_i - 1) % array_length(v_titulos, 1)],
       v_contenidos[1 + (v_i - 1) % array_length(v_contenidos, 1)],
       split_part(v_contenidos[1 + (v_i - 1) % array_length(v_contenidos, 1)], E'\n', 4),
       false, v_owner);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.sembrar_notas_de_la_demo() from public, anon, authenticated;
grant execute on function public.sembrar_notas_de_la_demo() to service_role;

commit;

-- Reversa: drop function public.sembrar_notas_de_la_demo();
