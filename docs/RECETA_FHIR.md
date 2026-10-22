# Receta: vademécum, emisión y mapeo a FHIR

**Versión:** 1 · 22-oct-2026 · Ola 4 (MKT-05). Migraciones `20261025300000`, `20261025300100` y `20261025300200`.

La receta se emite desde la tarjeta **Recetas** de la pestaña Documentos de la ficha y sale con el mismo motor que el resto de los documentos (`docs/DOCUMENTOS.md`): plantilla "Receta" editable en `/plantillas-de-documentos`, folio, firma del profesional, huella, anulación con motivo, PDF e impresión. Además queda guardada de forma estructurada para poder enviarla algún día como FHIR R4 `MedicationRequest`. **No hay integración con el Minsal**: el JSON solo se arma (y se puede descargar desde la tarjeta, botón "FHIR").

## Qué se guarda

Cada receta nueva son dos filas que escribe `emitir_receta` en una sola transacción, con la identidad y la RLS de quien emite:

| Tabla                              | Qué guarda                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issued_documents` (kind `receta`) | El documento como se imprime: bloques y HTML del motor, folio (`next_clinic_counter(…, 'document', …)`), firma y huella. Es lo que se abre en `/documentos/:id`, se descarga y se anula.                                         |
| `prescriptions`                    | La receta estructurada: medicamentos (`items`), indicaciones generales, RUT y fecha de nacimiento del paciente, nombre y registro SIS del profesional (los copia la base), avisos de alergia confirmados y `issued_document_id`. |

Anular una anula la otra con el mismo motivo (trigger `recetas_anular_juntas`). Las recetas anteriores a MKT-05 (sin `issued_document_id`) siguen con su PDF propio.

Cada medicamento de `items` (`src/lib/clinical/receta-estructurada.ts`):

| Clave                                                                     | Origen                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `medication`, `presentation`                                              | Lo que escribió el profesional (principio activo y presentación)                                                  |
| `dose`, `frequency`, `duration`, `instructions`                           | Posología en palabras: es lo que se imprime y lo que manda                                                        |
| `route`                                                                   | Vía elegida (`oral`, `sublingual`, `enjuague_bucal`, `topica_bucal`, `dental`, `cutanea`); la base la exige       |
| `catalog`, `ingredient`, `concentration`, `form`, `atc`                   | Del vademécum, solo si el nombre sigue siendo el del ítem elegido                                                 |
| `group`                                                                   | Familia para el aviso de alergias (del vademécum o deducida del nombre)                                           |
| `dose_quantity`, `timing`, `as_needed`, `duration_value`, `duration_unit` | La posología interpretada por el servidor al emitir. Si una frase no se entiende, esa parte queda solo como texto |

## Vademécum

- **Base** (`src/lib/clinical/vademecum.ts`): 38 medicamentos de uso dental frecuente en Chile (antibióticos, AINE, analgésicos, un opioide, corticoides, clorhexidina, antifúngicos, antivirales, un anestésico tópico de uso en casa, flúor de alta concentración y omeprazol), con principio activo, presentación, concentración, vía, código ATC y una posología sugerida de adulto. En las presentaciones pediátricas la dosis va vacía: depende del peso y la receta no se emite sin escribirla.
- **De la clínica** (`clinic_medications`): lo agregan y editan owner, admin y dentist (botón "Vademécum" de la tarjeta, o "Guardar en el vademécum de la clínica" desde una receta). No se borra, se desactiva.
- Las dosis las redactó Esmalia a partir de las dosis habituales de cada principio activo, sin copiar ninguna fuente con derechos. **Son sugerencias para que el profesional decida, no indicaciones**, y conviene una revisión clínica del catálogo (ver Límites).

## Alergias

Al recetar se muestran las alergias de la anamnesis (también las de fichas fusionadas) y cada medicamento se compara por nombre y por familia (`alertasDeAlergia`, con reacción cruzada penicilinas ↔ cefalosporinas). Si hay avisos, la receta solo se emite si el profesional marca que los revisó; el servidor recalcula los avisos y los guarda en `prescriptions.allergy_alerts`. El látex no choca con ningún medicamento. Es una ayuda, no un control: la anamnesis es texto libre.

## Quién puede

- Emitir: owner, admin y dentist, con su propia ficha de profesional (UI, server function con `requireClinicRole`, RLS de las dos tablas y el trigger `prescriptions_emitir`). En clínicas de Chile exige el número del Registro Nacional de Prestadores Individuales de la Superintendencia de Salud (`professionals.sis_registry_number`); en otros países alcanza el registro profesional.
- Ver: los roles clínicos (owner, admin, dentist, assistant). Política `mfa_exige_aal2` en las dos tablas.
- Anular: quien la emitió o un administrador. No se edita ni se borra.

## Mapeo a FHIR R4

`recetaAFhir(receta)` (`src/lib/clinical/receta-fhir.ts`, probado en `tests/receta-fhir.test.ts`) devuelve un `Bundle` de tipo `collection` con un `Patient`, un `Practitioner` y un `MedicationRequest` por medicamento.

| FHIR                                                     | Esmalia                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Bundle.identifier`, `MedicationRequest.groupIdentifier` | Folio de la receta (`2026-0012`)                                                                                                           |
| `MedicationRequest.identifier`                           | Folio + número de medicamento (`2026-0012-1`)                                                                                              |
| `MedicationRequest.status`                               | `active`; `cancelled` si está anulada, con `statusReason.text` = motivo                                                                    |
| `MedicationRequest.intent`                               | `order`                                                                                                                                    |
| `medicationCodeableConcept.coding`                       | Código ATC (`http://www.whocc.no/atc`) si el medicamento salió del vademécum                                                               |
| `medicationCodeableConcept.text`                         | Medicamento + presentación                                                                                                                 |
| `subject`                                                | `Patient/<patient_id>`                                                                                                                     |
| `Patient.identifier`                                     | RUT sin puntos (`12345678-5`), tipo `NI` de `v2-0203`, `use: official`; pasaporte → `PPN`                                                  |
| `Patient.birthDate`                                      | Fecha de nacimiento al emitir                                                                                                              |
| `requester`                                              | `Practitioner/<professional_id>`                                                                                                           |
| `Practitioner.identifier`                                | Registro SIS (tipo `PRN`) y, si es distinto, el registro profesional (tipo `LN`)                                                           |
| `authoredOn`                                             | Fecha y hora de emisión                                                                                                                    |
| `note`                                                   | Indicaciones generales                                                                                                                     |
| `dosageInstruction.text`                                 | "1 cápsula, vía oral, cada 8 horas, por 7 días"                                                                                            |
| `dosageInstruction.patientInstruction`                   | Indicaciones del medicamento                                                                                                               |
| `dosageInstruction.timing.repeat`                        | `frequency`/`period`/`periodUnit` ("cada 8 horas" → 1 cada 8 h; "2 veces al día" → 2 por día) y `boundsDuration` en UCUM (`d`, `wk`, `mo`) |
| `dosageInstruction.asNeededBoolean`                      | `true` si la frecuencia dice "si hay dolor", "SOS", "en caso de dolor"                                                                     |
| `dosageInstruction.route`                                | SNOMED CT: oral 26643006, sublingual 37839007, enjuague o tópica en la boca 372473007 (oromucosa), dental 372449004, cutánea 448598008     |
| `dosageInstruction.doseAndRate.doseQuantity`             | "1 cápsula" → `{ value: 1, unit: "cápsula" }`, "15 mL" → `{ value: 15, unit: "mL" }`                                                       |

Los `system` de los identificadores (folio, RUT, registro SIS) usan un espacio de nombres de Esmalia (`https://esmalia.com/fhir/sid/...`, constante `SISTEMAS_FHIR`) mientras no exista la integración: el día que se conecte con la receta electrónica del Minsal se cambian por los de la guía nacional (HL7 Chile, CL Core) en ese único lugar, y el código de medicamento debería pasar a la Terminología Farmacéutica Chilena (TFC) además del ATC.

## Límites

- No se envía a nadie: no hay integración con la receta electrónica del Minsal ni con farmacias. Las recetas retenidas (psicotrópicos, estupefacientes) no tienen un formato especial.
- Las dosis del vademécum base necesitan revisión de un odontólogo antes de presentarlas como catálogo validado; hoy son sugerencias editables y el diálogo lo dice.
- Firma simple (Ley 19.799), la misma del motor de documentos.
- El aviso de alergias compara texto: una alergia mal escrita en la anamnesis puede no avisar.
