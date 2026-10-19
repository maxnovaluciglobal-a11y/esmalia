-- Auditoría 360 (18-oct-2026), CLI-12 y CLI-13.
--
-- CLI-12 · Consentimiento informado: había 0 plantillas en producción y cada
-- clínica tenía que redactar sus textos desde cero. El registro firmado no
-- guardaba el procedimiento, el profesional que informó (recorded_by es quien
-- cargó la firma, no quien explicó) ni un hash del texto firmado.
--   1. consent_templates gana campos estructurados (procedimiento, riesgos,
--      alternativas) y una marca de origen: las plantillas que siembra
--      Esmalia son `esmalia_model`, "modelo para revisar por la clínica",
--      hasta que alguien de la clínica las marque como revisadas.
--   2. Siembra idempotente de 8 modelos para cada clínica nueva (trigger) y
--      para las existentes (al final de este archivo). La clave
--      (clinic_id, seed_key) hace que correrla dos veces no duplique nada.
--   3. patient_consents registra procedimiento, riesgos y alternativas como
--      snapshot, el profesional informante (nombre y registro copiados por la
--      base, no por el cliente), quién firma (paciente o representante: el
--      vínculo `guardian_id` queda preparado para el PR de tutores) y un
--      sha256 del contenido firmado que calcula la base.
--
-- CLI-13 · Recetas: tabla nueva `prescriptions`. La emite un profesional con
-- su propia cuenta (professionals.user_id = auth.uid()) y con su número de
-- registro cargado; la base copia los datos del profesional, de la clínica y
-- del paciente, asigna el correlativo y calcula el hash. Una receta emitida no
-- se edita: solo se anula, y la anulación queda registrada.
--
-- Los textos de las plantillas son un MODELO razonable, no un documento
-- revisado por un abogado ni por un odontólogo de cada país: la interfaz lo
-- dice y no promete validez legal.
--
-- Re-ejecutable: ADD COLUMN IF NOT EXISTS, CREATE ... IF NOT EXISTS, DROP
-- POLICY/TRIGGER IF EXISTS antes de crear, y la siembra con ON CONFLICT.

-- ---------------------------------------------------------------
-- 1. consent_templates: campos estructurados y origen
-- ---------------------------------------------------------------
ALTER TABLE public.consent_templates
  ALTER COLUMN created_by DROP NOT NULL, -- NULL = lo sembró el sistema
  ADD COLUMN IF NOT EXISTS procedure text,
  ADD COLUMN IF NOT EXISTS risks text,
  ADD COLUMN IF NOT EXISTS alternatives text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'clinic',
  ADD COLUMN IF NOT EXISTS seed_key text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.consent_templates
  DROP CONSTRAINT IF EXISTS consent_templates_source_check;
ALTER TABLE public.consent_templates
  ADD CONSTRAINT consent_templates_source_check CHECK (source IN ('clinic', 'esmalia_model'));

CREATE UNIQUE INDEX IF NOT EXISTS consent_templates_seed_key_uniq
  ON public.consent_templates (clinic_id, seed_key)
  WHERE seed_key IS NOT NULL;

-- Quién marcó la plantilla como revisada lo estampa la base: el cliente no
-- puede atribuirle la revisión a otra persona.
CREATE OR REPLACE FUNCTION public.consent_templates_estampar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_by := NULL;
    ELSE
      NEW.reviewed_at := now();
      NEW.reviewed_by := auth.uid();
    END IF;
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
  END IF;
  -- El origen y la clave de siembra no se reescriben desde la app.
  NEW.source := OLD.source;
  NEW.seed_key := OLD.seed_key;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consent_templates_estampar ON public.consent_templates;
CREATE TRIGGER consent_templates_estampar
  BEFORE UPDATE ON public.consent_templates
  FOR EACH ROW EXECUTE FUNCTION public.consent_templates_estampar();

-- ---------------------------------------------------------------
-- 2. Siembra de modelos (idempotente)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_clinic_consent_templates(p_clinic_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_insertadas integer;
BEGIN
  INSERT INTO public.consent_templates
    (clinic_id, seed_key, source, title, procedure, body, risks, alternatives, created_by)
  SELECT p_clinic_id, v.seed_key, 'esmalia_model', v.title, v.procedure, v.body, v.risks, v.alternatives, NULL
  FROM (VALUES
    (
      'exodoncia',
      'Consentimiento para exodoncia (extracción dental)',
      'Exodoncia (extracción de una o más piezas dentales)',
      $t$El profesional me explicó que la pieza o las piezas indicadas no se pueden conservar o que conviene retirarlas por motivos de salud, ortodoncia o rehabilitación. El procedimiento consiste en separar el diente del hueso y la encía, con anestesia local, y retirarlo; a veces hace falta dividir el diente, retirar algo de hueso o poner puntos de sutura.

Después del procedimiento debo seguir las indicaciones que me entregue la clínica: morder la gasa el tiempo indicado, no enjuagarme con fuerza ni fumar las primeras 24 horas, evitar alimentos muy calientes o duros, y tomar solo los medicamentos indicados. Debo consultar de inmediato si tengo sangrado que no se detiene, fiebre, hinchazón que aumenta después del tercer día o dolor intenso que no cede con lo indicado.

Declaro que informé mis enfermedades, alergias, medicamentos (en especial anticoagulantes, antiagregantes o medicamentos para los huesos) y si estoy o podría estar embarazada. Pude hacer preguntas y me las respondieron. Sé que puedo retirar este consentimiento antes del procedimiento sin dar explicaciones.$t$,
      $t$Frecuentes: dolor, hinchazón y moretones por algunos días; sangrado leve; limitación para abrir la boca. Menos frecuentes: alveolitis (inflamación dolorosa del alvéolo), infección, fractura de la raíz con restos que pueden quedar o requerir otra intervención, daño a dientes vecinos o restauraciones. Poco frecuentes pero importantes: comunicación con el seno maxilar en piezas superiores, adormecimiento temporal o, rara vez, permanente del labio, mentón o lengua por cercanía de un nervio, y fractura del maxilar.$t$,
      $t$Según el caso: conservar la pieza con un tratamiento de conducto, una restauración o tratamiento periodontal, cuando es posible; controlar sin intervenir por ahora. No tratarme puede llevar a dolor, infección que se extiende, pérdida de hueso o daño a piezas vecinas.$t$
    ),
    (
      'endodoncia',
      'Consentimiento para endodoncia (tratamiento de conducto)',
      'Endodoncia (tratamiento de conducto)',
      $t$El profesional me explicó que el nervio (pulpa) de la pieza indicada está inflamado, infectado o necrótico, o que hay que tratarlo por motivos de rehabilitación. El tratamiento consiste en abrir la pieza con anestesia local, limpiar y desinfectar los conductos y sellarlos. Puede requerir más de una sesión y, al terminar, la pieza necesita una restauración definitiva (en muchos casos una corona) para no fracturarse.

Debo seguir las indicaciones de la clínica entre sesiones y después del tratamiento, evitar morder fuerte con la pieza hasta la restauración definitiva y asistir a los controles. Debo consultar si tengo hinchazón, fiebre o dolor intenso que no cede.

Declaro que informé mis enfermedades, alergias y medicamentos, y si estoy o podría estar embarazada. Pude hacer preguntas y me las respondieron. Sé que puedo retirar este consentimiento antes del procedimiento sin dar explicaciones.$t$,
      $t$Frecuentes: molestia o dolor al morder por algunos días después de cada sesión. Menos frecuentes: reagudización con hinchazón entre sesiones, fractura de la pieza, oscurecimiento del diente. Poco frecuentes: fractura de un instrumento dentro del conducto, perforación de la raíz, paso de material o solución de irrigación fuera del diente, conductos que no se pueden tratar por completo. Aun con un tratamiento bien hecho, la lesión puede no sanar y requerir retratamiento, cirugía apical o la extracción.$t$,
      $t$Extraer la pieza y, si corresponde, reemplazarla después (implante, puente o prótesis removible). No tratarme puede llevar a dolor, infección que se extiende y pérdida de la pieza.$t$
    ),
    (
      'implante',
      'Consentimiento para implante dental',
      'Implante dental (colocación quirúrgica de implante)',
      $t$El profesional me explicó que se propone reemplazar una o más piezas perdidas con implantes: tornillos de titanio u otro material biocompatible que se colocan en el hueso, con anestesia local, y sobre los que después se fija una corona o prótesis. El tratamiento tiene varias etapas y meses de espera para que el implante se integre al hueso; puede requerir injertos de hueso o encía, que se me explicarán antes de hacerlos.

Debo seguir las indicaciones postoperatorias, mantener una higiene cuidadosa, no fumar (el tabaco aumenta el riesgo de que el implante falle) y asistir a los controles, también después de terminado el tratamiento. Debo consultar si tengo sangrado persistente, fiebre, hinchazón que aumenta o movilidad del implante.

Declaro que informé mis enfermedades (en especial diabetes, osteoporosis o tratamientos con radioterapia de cabeza y cuello), alergias, medicamentos (en especial anticoagulantes, bifosfonatos u otros medicamentos para los huesos), si fumo y si estoy o podría estar embarazada. Entiendo que el resultado depende también de mi biología y de mis cuidados, y que no se puede garantizar. Pude hacer preguntas y me las respondieron. Sé que puedo retirar este consentimiento antes del procedimiento sin dar explicaciones.$t$,
      $t$Frecuentes: dolor, hinchazón y moretones por algunos días. Menos frecuentes: infección, que el implante no se integre al hueso y haya que retirarlo, pérdida de hueso alrededor del implante (periimplantitis) con el tiempo, aflojamiento o fractura de piezas de la prótesis. Poco frecuentes pero importantes: adormecimiento temporal o permanente del labio, mentón o lengua por lesión de un nervio, comunicación con el seno maxilar o la nariz, daño a dientes vecinos, fractura del hueso.$t$,
      $t$Puente fijo apoyado en dientes vecinos, prótesis removible, o no reemplazar la pieza. No reemplazarla puede llevar a que los dientes vecinos se muevan, a cambios en la mordida y a pérdida de hueso en la zona.$t$
    ),
    (
      'blanqueamiento',
      'Consentimiento para blanqueamiento dental',
      'Blanqueamiento dental',
      $t$El profesional me explicó que el blanqueamiento aclara el color de los dientes con un gel (peróxido de hidrógeno o de carbamida), aplicado en la clínica o en casa con cubetas a medida, según lo indicado. Es un tratamiento estético: el resultado varía de persona a persona, no es permanente y no cambia el color de coronas, carillas ni restauraciones, que pueden quedar de otro tono y requerir recambio.

Debo seguir las indicaciones de uso, evitar alimentos y bebidas que tiñen durante el tratamiento y suspenderlo y avisar si tengo dolor o irritación intensa.

Declaro que informé mis enfermedades, alergias y medicamentos, y si estoy o podría estar embarazada o en lactancia (en esos casos se recomienda no hacer el blanqueamiento). Pude hacer preguntas y me las respondieron. Sé que puedo retirar este consentimiento en cualquier momento sin dar explicaciones.$t$,
      $t$Frecuentes: sensibilidad dental al frío o al calor durante el tratamiento y unos días después; irritación de encías o labios. Menos frecuentes: resultado disparejo o menor al esperado, manchas blancas transitorias, recidiva del color con el tiempo. La sensibilidad suele ser transitoria.$t$,
      $t$Limpieza y pulido profesional, carillas o coronas estéticas, o no hacer el tratamiento. No hacerlo no tiene consecuencias para la salud.$t$
    ),
    (
      'ortodoncia',
      'Consentimiento para tratamiento de ortodoncia',
      'Ortodoncia (aparatos fijos, removibles o alineadores)',
      $t$El profesional me explicó el diagnóstico y que el tratamiento busca mover los dientes y, en algunos casos, guiar el crecimiento de los maxilares, con aparatos fijos (brackets), removibles o alineadores. El tratamiento dura meses o años, requiere controles periódicos y, al terminar, el uso de retenedores para que los dientes no vuelvan a moverse. Puede requerir extracciones, otros tratamientos o, en algunos casos, cirugía, que se me explicarán por separado.

Debo mantener una higiene muy cuidadosa, seguir las indicaciones de alimentación y de uso de los aparatos, asistir a los controles y usar los retenedores como se indique. El resultado depende en gran parte de mi colaboración.

Declaro que informé mis enfermedades, alergias (incluida alergia al níquel o al látex) y medicamentos. Si el paciente es menor de edad, firma su representante legal. Pude hacer preguntas y me las respondieron. Sé que puedo retirar este consentimiento sin dar explicaciones.$t$,
      $t$Frecuentes: molestias y dolor después de cada activación, llagas por roce de los aparatos. Menos frecuentes: manchas blancas o caries por higiene insuficiente, inflamación de encías, reabsorción de la raíz de algunos dientes, molestias de la articulación de la mandíbula, desprendimiento o rotura de aparatos. Con el tiempo los dientes pueden volver a moverse (recidiva), sobre todo si no se usan los retenedores. La duración puede extenderse más de lo estimado.$t$,
      $t$Según el caso: otro tipo de aparato, tratamiento limitado a una zona, rehabilitación o cirugía ortognática, o no tratarse. No tratarse puede mantener o agravar problemas de mordida, de limpieza de los dientes o estéticos.$t$
    ),
    (
      'anestesia-local',
      'Consentimiento para anestesia local',
      'Anestesia local odontológica',
      $t$El profesional me explicó que para el procedimiento indicado se usará anestesia local: un medicamento que se inyecta en la encía o cerca de un nervio para que la zona no duela durante el tratamiento. El adormecimiento del labio, la lengua o la mejilla dura algunas horas.

Mientras dure el efecto no debo comer ni masticar para no morderme, y debo evitar bebidas muy calientes. Debo avisar de inmediato si siento palpitaciones, mareo, dificultad para respirar o picazón en el cuerpo.

Declaro que informé mis enfermedades (en especial cardíacas, hipertensión, diabetes o problemas de tiroides), alergias (incluidas reacciones previas a anestesia dental), medicamentos y si estoy o podría estar embarazada. Pude hacer preguntas y me las respondieron. Sé que puedo retirar este consentimiento antes del procedimiento sin dar explicaciones.$t$,
      $t$Frecuentes: dolor leve en el punto de la inyección, adormecimiento que dura algunas horas. Menos frecuentes: moretón o hinchazón en la zona, palpitaciones o sensación de ansiedad transitoria, mordedura del labio o la lengua mientras dura el efecto, que la anestesia no haga efecto completo. Poco frecuentes pero importantes: reacción alérgica, adormecimiento prolongado o, rara vez, permanente por lesión de un nervio, parálisis facial transitoria.$t$,
      $t$Hacer el procedimiento sin anestesia cuando es posible y tolerable, o con otras técnicas de manejo del dolor o de la ansiedad que el profesional me explique. No hacer el procedimiento que requiere la anestesia tiene las consecuencias que se me explicaron para ese procedimiento.$t$
    ),
    (
      'periodontal',
      'Consentimiento para tratamiento periodontal',
      'Tratamiento periodontal (raspado y alisado radicular o cirugía periodontal)',
      $t$El profesional me explicó que tengo una enfermedad de las encías y del hueso que sostiene los dientes (gingivitis o periodontitis). El tratamiento consiste en eliminar el sarro y la placa por encima y por debajo de la encía (raspado y alisado radicular), con anestesia local cuando hace falta, y puede requerir varias sesiones, cirugía periodontal o medicamentos, que se me explicarán antes.

La periodontitis es una enfermedad crónica: el resultado depende en gran parte de mi higiene diaria, de no fumar, del control de enfermedades como la diabetes y de asistir a las mantenciones periódicas.

Declaro que informé mis enfermedades, alergias, medicamentos, si fumo y si estoy o podría estar embarazada. Pude hacer preguntas y me las respondieron. Sé que puedo retirar este consentimiento antes del procedimiento sin dar explicaciones.$t$,
      $t$Frecuentes: sensibilidad al frío, molestias y sangrado leve por algunos días; al desinflamarse la encía, los dientes pueden verse más largos y quedar espacios entre ellos. Menos frecuentes: aumento transitorio de la movilidad, infección, que la enfermedad avance a pesar del tratamiento y haya que extraer piezas.$t$,
      $t$Solo limpieza supragingival y controles, cirugía periodontal directamente, o no tratarse. No tratarse puede llevar a pérdida de hueso, movilidad y pérdida de dientes, mal aliento y sangrado persistente.$t$
    ),
    (
      'imagenes-radiografias',
      'Consentimiento para toma y uso de fotografías y radiografías',
      'Toma y uso de imágenes clínicas (fotografías, radiografías y escáneres)',
      $t$El profesional me explicó que para diagnosticar, planificar y controlar mi tratamiento se pueden tomar fotografías de mi cara y de mi boca, radiografías (periapicales, panorámicas u otras), tomografías o escáneres intraorales. Estas imágenes forman parte de mi ficha clínica, se guardan con la misma confidencialidad que el resto de mis datos de salud y solo las ve el equipo que me atiende.

Cualquier otro uso, por ejemplo docencia, publicaciones o redes sociales de la clínica, requiere una autorización aparte, expresa y por escrito; si la doy, las imágenes se usarán sin datos que me identifiquen, salvo que yo autorice lo contrario. Puedo retirar esa autorización en cualquier momento.

Declaro que informé si estoy o podría estar embarazada. Pude hacer preguntas y me las respondieron.$t$,
      $t$Las radiografías y tomografías usan radiación ionizante en dosis bajas; se toman solo cuando aportan al diagnóstico y con protección según corresponda. Como todo dato de salud, las imágenes tienen un riesgo de acceso no autorizado, que la clínica reduce con controles de acceso y resguardo de la ficha.$t$,
      $t$No tomar las imágenes, lo que puede limitar el diagnóstico y la planificación del tratamiento; o autorizar solo su uso clínico, sin ningún otro uso.$t$
    )
  ) AS v(seed_key, title, procedure, body, risks, alternatives)
  ON CONFLICT (clinic_id, seed_key) WHERE seed_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_insertadas = ROW_COUNT;
  RETURN v_insertadas;
END;
$$;

-- Solo la llaman el trigger y esta migración, nunca un usuario por RPC.
REVOKE EXECUTE ON FUNCTION public.seed_clinic_consent_templates(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_clinic_consent_templates_al_crear()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_clinic_consent_templates(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_clinic_created_consent_templates ON public.clinics;
CREATE TRIGGER on_clinic_created_consent_templates
  AFTER INSERT ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.seed_clinic_consent_templates_al_crear();

-- ---------------------------------------------------------------
-- 3. patient_consents: procedimiento, informante, firmante y hash
-- ---------------------------------------------------------------
ALTER TABLE public.patient_consents
  ADD COLUMN IF NOT EXISTS procedure_snapshot text,
  ADD COLUMN IF NOT EXISTS risks_snapshot text,
  ADD COLUMN IF NOT EXISTS alternatives_snapshot text,
  ADD COLUMN IF NOT EXISTS treatment_item_id uuid REFERENCES public.treatment_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tooth_numbers smallint[],
  ADD COLUMN IF NOT EXISTS informed_by_professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS informed_by_name_snapshot text,
  ADD COLUMN IF NOT EXISTS informed_by_license_snapshot text,
  ADD COLUMN IF NOT EXISTS signer_kind text NOT NULL DEFAULT 'patient',
  -- Preparado para el PR de tutores (CLI-11): la FK a patient_guardians la
  -- agrega esa migración. Acá solo queda el campo.
  ADD COLUMN IF NOT EXISTS guardian_id uuid,
  ADD COLUMN IF NOT EXISTS signer_relationship text,
  ADD COLUMN IF NOT EXISTS signature_sha256 text,
  ADD COLUMN IF NOT EXISTS content_sha256 text;

ALTER TABLE public.patient_consents
  DROP CONSTRAINT IF EXISTS patient_consents_signer_kind_check;
ALTER TABLE public.patient_consents
  ADD CONSTRAINT patient_consents_signer_kind_check CHECK (signer_kind IN ('patient', 'guardian'));
ALTER TABLE public.patient_consents
  DROP CONSTRAINT IF EXISTS patient_consents_guardian_relationship_check;
ALTER TABLE public.patient_consents
  ADD CONSTRAINT patient_consents_guardian_relationship_check
  CHECK (signer_kind = 'patient' OR nullif(btrim(signer_relationship), '') IS NOT NULL);

CREATE INDEX IF NOT EXISTS patient_consents_informed_by_idx
  ON public.patient_consents (informed_by_professional_id)
  WHERE informed_by_professional_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS patient_consents_treatment_item_idx
  ON public.patient_consents (treatment_item_id)
  WHERE treatment_item_id IS NOT NULL;

-- Completa lo que la base sabe mejor que el cliente: la fecha, quién lo
-- registró, los datos del profesional informante y el hash. El cliente no
-- puede fechar hacia atrás ni atribuirle la explicación a otra persona.
CREATE OR REPLACE FUNCTION public.patient_consents_completar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prof record;
BEGIN
  NEW.signed_at := now();
  IF auth.uid() IS NOT NULL THEN
    NEW.recorded_by := auth.uid();
  END IF;

  IF nullif(btrim(NEW.procedure_snapshot), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el procedimiento que se consiente.';
  END IF;

  IF NEW.informed_by_professional_id IS NULL THEN
    RAISE EXCEPTION 'Indica el profesional que informó al paciente.';
  END IF;
  SELECT full_name, license_number INTO v_prof
    FROM public.professionals
   WHERE id = NEW.informed_by_professional_id AND clinic_id = NEW.clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El profesional informante no pertenece a esta clínica.';
  END IF;
  NEW.informed_by_name_snapshot := v_prof.full_name;
  NEW.informed_by_license_snapshot := nullif(btrim(v_prof.license_number), '');

  IF NEW.treatment_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.treatment_items ti
      JOIN public.treatment_plans tp ON tp.id = ti.plan_id
     WHERE ti.id = NEW.treatment_item_id
       AND ti.clinic_id = NEW.clinic_id
       AND tp.patient_id = NEW.patient_id
  ) THEN
    RAISE EXCEPTION 'El ítem del plan no corresponde a este paciente.';
  END IF;

  IF NEW.signer_kind = 'patient' THEN
    NEW.signer_relationship := NULL;
    NEW.guardian_id := NULL;
  END IF;

  NEW.content_sha256 := encode(sha256(convert_to(concat_ws(
    E'\x1f',
    NEW.clinic_id::text,
    NEW.patient_id::text,
    coalesce(NEW.title_snapshot, ''),
    coalesce(NEW.procedure_snapshot, ''),
    coalesce(NEW.body_snapshot, ''),
    coalesce(NEW.risks_snapshot, ''),
    coalesce(NEW.alternatives_snapshot, ''),
    coalesce(array_to_string(NEW.tooth_numbers, ','), ''),
    coalesce(NEW.informed_by_name_snapshot, ''),
    coalesce(NEW.informed_by_license_snapshot, ''),
    NEW.signer_kind,
    coalesce(NEW.signer_relationship, ''),
    coalesce(NEW.signed_by_name, ''),
    coalesce(NEW.signature_sha256, ''),
    to_char(NEW.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ), 'UTF8')), 'hex');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patient_consents_completar ON public.patient_consents;
CREATE TRIGGER patient_consents_completar
  BEFORE INSERT ON public.patient_consents
  FOR EACH ROW EXECUTE FUNCTION public.patient_consents_completar();

-- La inmutabilidad ahora cubre también las columnas nuevas: lo único
-- editable sigue siendo la revocación.
CREATE OR REPLACE FUNCTION public.enforce_patient_consent_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
    OR NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.title_snapshot IS DISTINCT FROM OLD.title_snapshot
    OR NEW.body_snapshot IS DISTINCT FROM OLD.body_snapshot
    OR NEW.signature_storage_path IS DISTINCT FROM OLD.signature_storage_path
    OR NEW.signed_by_name IS DISTINCT FROM OLD.signed_by_name
    OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
    OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
    OR NEW.procedure_snapshot IS DISTINCT FROM OLD.procedure_snapshot
    OR NEW.risks_snapshot IS DISTINCT FROM OLD.risks_snapshot
    OR NEW.alternatives_snapshot IS DISTINCT FROM OLD.alternatives_snapshot
    OR NEW.tooth_numbers IS DISTINCT FROM OLD.tooth_numbers
    OR NEW.informed_by_name_snapshot IS DISTINCT FROM OLD.informed_by_name_snapshot
    OR NEW.informed_by_license_snapshot IS DISTINCT FROM OLD.informed_by_license_snapshot
    OR NEW.signer_kind IS DISTINCT FROM OLD.signer_kind
    OR NEW.guardian_id IS DISTINCT FROM OLD.guardian_id
    OR NEW.signer_relationship IS DISTINCT FROM OLD.signer_relationship
    OR NEW.signature_sha256 IS DISTINCT FROM OLD.signature_sha256
    OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
    -- Las FK con ON DELETE SET NULL sí pueden pasar a NULL (se borró el
    -- profesional o el ítem): el snapshot conserva el dato.
    OR (NEW.treatment_item_id IS DISTINCT FROM OLD.treatment_item_id AND NEW.treatment_item_id IS NOT NULL)
    OR (NEW.informed_by_professional_id IS DISTINCT FROM OLD.informed_by_professional_id
        AND NEW.informed_by_professional_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Un consentimiento firmado solo se puede revocar, no editar.';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------
-- 4. prescriptions: recetas inmutables
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  -- Correlativo por clínica y año (next_clinic_counter, kind 'prescription').
  year integer NOT NULL,
  number integer NOT NULL,
  professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL,
  professional_name_snapshot text NOT NULL,
  professional_license_snapshot text NOT NULL,
  professional_specialty_snapshot text,
  clinic_name_snapshot text NOT NULL,
  clinic_legal_name_snapshot text,
  clinic_tax_id_snapshot text,
  clinic_address_snapshot text,
  clinic_phone_snapshot text,
  patient_name_snapshot text NOT NULL,
  patient_birth_date_snapshot date,
  -- [{ medication, presentation?, dose, frequency, duration, instructions? }]
  items jsonb NOT NULL,
  instructions text,
  signature_storage_path text,
  signature_sha256 text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid NOT NULL DEFAULT auth.uid(),
  content_sha256 text NOT NULL,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  CONSTRAINT prescriptions_items_check CHECK (
    jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 10
  ),
  CONSTRAINT prescriptions_void_reason_check CHECK (
    voided_at IS NULL OR nullif(btrim(void_reason), '') IS NOT NULL
  ),
  CONSTRAINT prescriptions_number_uniq UNIQUE (clinic_id, year, number)
);

CREATE INDEX IF NOT EXISTS prescriptions_patient_idx
  ON public.prescriptions (clinic_id, patient_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_patient_id_idx
  ON public.prescriptions (patient_id);
CREATE INDEX IF NOT EXISTS prescriptions_professional_idx
  ON public.prescriptions (professional_id)
  WHERE professional_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.prescriptions TO authenticated;
GRANT ALL ON public.prescriptions TO service_role;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prescriptions_select" ON public.prescriptions;
CREATE POLICY "prescriptions_select" ON public.prescriptions
  FOR SELECT TO authenticated USING (
    public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant']::public.app_role[])
  );

-- Recetar es un acto del profesional: solo roles clínicos que prescriben, y
-- el trigger exige además que la ficha de profesional sea la del usuario.
DROP POLICY IF EXISTS "prescriptions_insert" ON public.prescriptions;
CREATE POLICY "prescriptions_insert" ON public.prescriptions
  FOR INSERT TO authenticated WITH CHECK (
    public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist']::public.app_role[])
    AND issued_by = (select auth.uid())
  );

-- El único UPDATE es anular; el trigger decide quién y qué columnas.
DROP POLICY IF EXISTS "prescriptions_update_void" ON public.prescriptions;
CREATE POLICY "prescriptions_update_void" ON public.prescriptions
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist']::public.app_role[]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist']::public.app_role[]));

-- Sin DELETE para authenticated: una receta emitida es parte de la ficha.

CREATE OR REPLACE FUNCTION public.prescriptions_emitir()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prof record;
  v_clinic record;
  v_branch record;
  v_patient record;
  v_item jsonb;
BEGIN
  -- Rol de servicio o scripts sin usuario: no hay a quién atribuir la receta.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Una receta la emite un profesional con su propia cuenta.';
  END IF;
  NEW.issued_by := auth.uid();
  NEW.issued_at := now();
  NEW.voided_at := NULL;
  NEW.voided_by := NULL;
  NEW.void_reason := NULL;

  SELECT p.full_name, p.license_number, p.user_id, p.branch_id, s.name AS specialty
    INTO v_prof
    FROM public.professionals p
    LEFT JOIN public.specialties s ON s.id = p.specialty_id
   WHERE p.id = NEW.professional_id AND p.clinic_id = NEW.clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Elige un profesional de esta clínica.';
  END IF;
  IF v_prof.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solo puedes emitir recetas con tu propia ficha de profesional.';
  END IF;
  IF nullif(btrim(v_prof.license_number), '') IS NULL THEN
    RAISE EXCEPTION 'Carga tu número de registro profesional antes de emitir recetas.';
  END IF;

  SELECT name, legal_name, tax_id, timezone INTO v_clinic
    FROM public.clinics WHERE id = NEW.clinic_id;

  -- Dirección y teléfono: la sucursal del profesional, o la primera activa.
  SELECT address, city, phone INTO v_branch
    FROM public.branches
   WHERE clinic_id = NEW.clinic_id
   ORDER BY (id = v_prof.branch_id) DESC, is_active DESC, created_at
   LIMIT 1;

  SELECT full_name, birth_date INTO v_patient
    FROM public.patients WHERE id = NEW.patient_id AND clinic_id = NEW.clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El paciente no pertenece a esta clínica.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    IF jsonb_typeof(v_item) <> 'object'
      OR nullif(btrim(v_item->>'medication'), '') IS NULL
      OR nullif(btrim(v_item->>'dose'), '') IS NULL
      OR nullif(btrim(v_item->>'frequency'), '') IS NULL
      OR nullif(btrim(v_item->>'duration'), '') IS NULL
    THEN
      RAISE EXCEPTION 'Cada medicamento necesita nombre, dosis, frecuencia y duración.';
    END IF;
  END LOOP;

  NEW.professional_name_snapshot := v_prof.full_name;
  NEW.professional_license_snapshot := btrim(v_prof.license_number);
  NEW.professional_specialty_snapshot := v_prof.specialty;
  NEW.clinic_name_snapshot := v_clinic.name;
  NEW.clinic_legal_name_snapshot := v_clinic.legal_name;
  NEW.clinic_tax_id_snapshot := v_clinic.tax_id;
  NEW.clinic_address_snapshot := nullif(concat_ws(', ', nullif(btrim(v_branch.address), ''), nullif(btrim(v_branch.city), '')), '');
  NEW.clinic_phone_snapshot := nullif(btrim(v_branch.phone), '');
  NEW.patient_name_snapshot := v_patient.full_name;
  NEW.patient_birth_date_snapshot := v_patient.birth_date;

  -- Año en la hora de la clínica, no en UTC (misma lección que presupuestos).
  NEW.year := extract(year FROM now() AT TIME ZONE coalesce(v_clinic.timezone, 'America/Santiago'))::integer;
  NEW.number := public.next_clinic_counter(NEW.clinic_id, 'prescription', NEW.year);

  NEW.content_sha256 := encode(sha256(convert_to(concat_ws(
    E'\x1f',
    NEW.clinic_id::text,
    NEW.patient_id::text,
    NEW.year::text,
    NEW.number::text,
    NEW.professional_name_snapshot,
    NEW.professional_license_snapshot,
    coalesce(NEW.patient_name_snapshot, ''),
    NEW.items::text,
    coalesce(NEW.instructions, ''),
    coalesce(NEW.signature_sha256, ''),
    to_char(NEW.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ), 'UTF8')), 'hex');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prescriptions_emitir ON public.prescriptions;
CREATE TRIGGER prescriptions_emitir
  BEFORE INSERT ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.prescriptions_emitir();

CREATE OR REPLACE FUNCTION public.prescriptions_solo_anular()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- El ON DELETE SET NULL de la FK del profesional (se borró su ficha): el
  -- snapshot conserva nombre y registro. Pasa aunque la receta esté anulada.
  IF NEW.professional_id IS NULL AND OLD.professional_id IS NOT NULL
     AND (to_jsonb(NEW) - 'professional_id') = (to_jsonb(OLD) - 'professional_id')
  THEN
    RETURN NEW;
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta receta ya está anulada.';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['voided_at','voided_by','void_reason'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['voided_at','voided_by','void_reason'])
     OR NEW.voided_at IS NULL
  THEN
    RAISE EXCEPTION 'Una receta emitida no se edita: si hay un error, anúlala y emite otra.';
  END IF;
  IF auth.uid() IS NOT NULL
     AND OLD.issued_by IS DISTINCT FROM auth.uid()
     AND NOT public.can_manage_clinic(OLD.clinic_id)
  THEN
    RAISE EXCEPTION 'Solo quien emitió la receta o un administrador puede anularla.';
  END IF;
  NEW.voided_at := now();
  NEW.voided_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prescriptions_solo_anular ON public.prescriptions;
CREATE TRIGGER prescriptions_solo_anular
  BEFORE UPDATE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.prescriptions_solo_anular();

-- La clínica demo pública es de solo lectura (migración 20260815180000).
DROP TRIGGER IF EXISTS block_demo_writes ON public.prescriptions;
CREATE TRIGGER block_demo_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.block_demo_writes();

-- Funciones de trigger: sin EXECUTE para usuarios (ver 20261013000100).
REVOKE EXECUTE ON FUNCTION public.consent_templates_estampar() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_clinic_consent_templates_al_crear() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.patient_consents_completar() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_patient_consent_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prescriptions_emitir() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prescriptions_solo_anular() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 5. Siembra para las clínicas que ya existen
-- ---------------------------------------------------------------
SELECT public.seed_clinic_consent_templates(id) FROM public.clinics;
