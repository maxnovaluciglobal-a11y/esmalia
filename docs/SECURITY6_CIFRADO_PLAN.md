# security-6 — Cifrado de columna para PII/PHI

## Estado al 19-oct-2026 (auditoría 360, SEG-03 / GOB-02)

La sección "Estado real" de abajo quedó vieja otra vez. Lo que pasó y lo que
cambia con la migración `20261019160100_cifrado_documento_backfill.sql`
(versionada, **se aplica con OK de Walter**):

- **Causa raíz de los 0 documentos cifrados:** la clave de Vault existe desde
  el 11-oct, pero `set_patient_document_id` no puede cifrar desde el 01-sep.
  La migración `20260901120000` (chequeo de rol) reescribió la función con
  `search_path = public, vault` y perdió el `extensions` que había agregado
  `20260822160000` (pgcrypto vive en `extensions` en Supabase). La
  `20261014000000` copió esa versión. Cada alta fallaba y el error quedaba en
  un `console.error` "no bloqueante". Además la demo (10 de los 11 pacientes)
  se recrea con SQL directo y nunca pasó por el RPC.
- **Ahora cifra la base, no la app:** `cifrar_documento_id()` es la única
  función que cifra (pgp_sym_encrypt + HMAC como blind index) y el trigger
  `patients_cifrar_documento` (BEFORE INSERT OR UPDATE OF document_id) la
  aplica a todo alta o cambio, venga de la app, del importador CSV, de
  `reset_demo_clinic` o de un script. `set_patient_document_id` delega en ella.
  `tests/cifrado-documento.test.ts` falla si una redefinición futura vuelve a
  sacar `extensions` del search_path.
- **Backfill idempotente + verificación** en la misma migración: si con la
  clave presente queda un documento sin cifrar, o alguno no descifra igual al
  texto en claro, la transacción se revierte.
- **Alerta:** después de un alta, una edición o una importación con
  documento, la app relee la fila y, si quedó en claro sin `document_id_enc`,
  manda un error a Sentry (sin el documento: solo cuántos y en qué operación).
  Ver `src/lib/patients/documento-cifrado.server.ts`.

**Lo que sigue (Fase 1b, cutover), en este orden y en PRs aparte:**

1. Aplicar `20261019160100` y comprobar en producción:
   `select count(*) filter (where document_id is not null and btrim(document_id) <> '' and document_id_enc is null) from patients;` → 0.
2. Respaldar la clave `esmalia_document_id_key` fuera de Supabase (SEG-10).
   Sin ese respaldo, borrar el texto en claro convierte una clave perdida en
   un dato perdido.
3. Leer el documento solo con `get_patient_document_id` (ficha, exportaciones,
   CSV) y deduplicar el importador por `document_id_hash`.
4. Revisar el trigger `patients_cifrar_documento` (con `document_id` en NULL
   cambia su lógica de INSERT), poner `document_id` en NULL y, más adelante,
   quitar la columna. Quitar también el UPDATE directo de
   `document_id_enc`/`document_id_hash` a `authenticated` (hoy un miembro de la
   clínica podría escribir basura en esas columnas de sus propios pacientes).
5. Decidir con el abogado si `phone` y `birth_date` entran (Fases 2 y 3 de
   abajo).

## ⚠️ Estado real, corregido 2026-09-01 (auditoría externa) — este doc quedó desactualizado

Este archivo decía "plan, no implementación" pero la migración de Fase 1
(`supabase/migrations/20260822150000_security6_fase1_document_id_encryption.sql`)
**se aplicó igual, 17 minutos después de escribirse este doc, el mismo día**
(22-ago). El resto del plan de abajo sigue siendo la discusión real que llevó a
esa decisión — solo el título y esta nota estaban mintiendo sobre si se había
ejecutado o no.

**Lo que hay hoy en la base real** (verificado con PostgREST, service_role,
2026-09-01): las columnas `patients.document_id_enc`/`document_id_hash` y las
funciones `set_patient_document_id`/`get_patient_document_id` existen. Pero
**el 100% de los pacientes con `document_id` tienen ambas columnas en NULL** —
la Fase 1 nunca llegó a poblar nada. Causa más probable: la clave
`esmalia_document_id_key` nunca se creó en Supabase Vault (`set_patient_document_id`
tira `RAISE EXCEPTION` si falta, y las 3 llamadas del código son "no
bloqueantes" — el error queda en un `console.error` que nadie mira).

**Único paso que falta, y que solo puede hacer Walter** (necesita acceso
directo a Postgres — psql con la password real, o el SQL Editor del dashboard
de Supabase; no hay forma de crearlo vía la `service_role` key ni por
PostgREST, el schema `vault` no está expuesto en la API REST):

```sql
select vault.create_secret(encode(gen_random_bytes(32),'hex'), 'esmalia_document_id_key');
```

Y confirmar que quedó (mismo SQL Editor):

```sql
select name from vault.decrypted_secrets where name = 'esmalia_document_id_key';
```

**Con eso, la Fase 1 empieza a andar sola** para pacientes nuevos o editados —
`createPatient`/`updatePatient`/`importPatients` (los 3 puntos de escritura, el
gap de `importPatients` se cerró el 01-sep) ya llaman al RPC. Lo que **NO** se
resuelve solo con crear la clave: los pacientes que ya existen hoy (creados
antes de que la clave exista) quedan con `document_id_enc` NULL para siempre a
menos que alguien corra un backfill — eso es la Fase 1b, deliberadamente no
construida, ver el resto de este doc y `docs/PLAN_ACCION.md`.

**Antes de avanzar a Fase 1b (cutover: leer solo del campo cifrado, backfill de
pacientes existentes) sigue pendiente la confirmación legal** de si el cifrado
en reposo de infraestructura alcanza para la Ley 21.719 o si hace falta cifrado
de aplicación explícito — ver más abajo. No se avanzó en esto solo porque
existiera el gap técnico.

---

**Por qué este doc y no un commit directo:** de los 41 hallazgos de la auditoría 360, este es el único que decidí NO implementar a ciegas hoy. Los otros 24 items ejecutados fueron cambios acotados y reversibles. Este toca cómo se guardan los datos de pacientes reales de la clínica piloto, con trade-offs de producto que no me corresponde decidir solo — y un fix apurado acá es peor que ningún fix.

## Qué pide el hallazgo

Ley 21.719 (Chile, protección de datos) exige cifrado explícito de datos sensibles, con vigencia plena el 1-dic-2026. Hoy ninguna columna de `patients` (`document_id`, `birth_date`, `phone`, `email`, `full_name`) tiene cifrado a nivel de columna — solo el cifrado en reposo que Supabase ya aplica a nivel de disco (infraestructura, no aplicación).

## Primer punto importante: separar dos cosas distintas

1. **Cifrado en reposo a nivel de infraestructura** — Supabase/Postgres ya lo hace por defecto en el storage subyacente (todo proveedor cloud serio lo hace). Esto protege contra alguien robando el disco físico, no contra alguien con acceso a la DB (service_role key filtrada, un dump, un query directo).
2. **Cifrado a nivel de columna en la aplicación** — lo que pide el hallazgo. Protege incluso si alguien tiene acceso de lectura a la base (ej. `service_role` key comprometida, un `pg_dump` que se filtra).

La Ley 21.719 puede satisfacerse totalmente con (1) dependiendo de la interpretación — **esto hay que confirmarlo con un abogado o asesor de compliance, no asumirlo por código**. No soy la fuente correcta para esa determinación legal. Si (1) alcanza, el trabajo de código baja de "Alto esfuerzo" a "revisar y documentar la política de retención/backup ya existente". Si hace falta (2), sigue el resto de este plan.

**Actualización 2026-08-22 (búsqueda web, no asesoría legal formal):** varias fuentes (Prey, Confidata, XMS LatAm) coinciden en que la interpretación esperada es cifrado explícito **a nivel de columna en la base de datos** para campos como RUT/nombre/teléfono/historial clínico — no solo el cifrado en reposo de infraestructura. Esto inclina la balanza hacia que sí hace falta (2), pero sigue sin ser una fuente oficial (blogs de consultoras, no el texto de la ley ni un dictamen). No arranco la Fase 1 sin que Walter lo confirme con un abogado — la lectura de un blog no reemplaza eso cuando el dato en juego es RUT/historial clínico real.

## Por qué (2) no es un fix chico

Revisé el schema real de `patients` (`supabase/migrations/20260811120000_...sql:7-27`). Los candidatos a cifrar y su uso real en el código:

| Columna       | Uso real en el código                                                         | Efecto de cifrarla                                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full_name`   | `listPatients` ordena `.order("full_name", ascending)`, búsqueda por nombre   | Cifrado rompe el orden alfabético y la búsqueda — habría que reconstruir ambos con un índice separado o aceptar perderlos                                                                                                                                                                                           |
| `document_id` | Dedup exacto en `importPatients` (CSV)                                        | Cifrado **determinístico** (mismo texto → mismo cifrado) preserva el dedup por igualdad. Candidato más seguro para cifrar primero — sin romper nada.                                                                                                                                                                |
| `phone`       | Lookup exacto para WhatsApp/webhook (`whatsapp_leads`, `findReferrerByCode`)  | Cifrado determinístico también preserva esto — segundo candidato razonable                                                                                                                                                                                                                                          |
| `birth_date`  | `birthday_greeting` hace match de mes/día en SQL (`EXTRACT`), cálculo de edad | Cifrado (determinístico o no) rompe la posibilidad de filtrar por mes/día en SQL directo — requeriría desencriptar todas las filas en la app para comparar, inviable a escala. Candidato a NO cifrar, o cifrar con una arquitectura distinta (columna separada solo con mes/día en claro + fecha completa cifrada). |
| `email`       | Poco usado hoy, bajo riesgo relativo                                          | Candidato de baja prioridad                                                                                                                                                                                                                                                                                         |

**Conclusión:** cifrar `patients` entera de un saque rompe búsqueda, orden, y el matching de cumpleaños — tres funciones que ya están en producción con la clínica piloto real. Esto no es "un ALTER TABLE", es un cambio de arquitectura con pérdida de funcionalidad real si se hace mal.

## Propuesta concreta (para decidir, no aplicada)

**Fase 1 (bajo riesgo, esfuerzo medio):** cifrar solo `document_id` con `pgsodium.crypto_aead_det_encrypt` (cifrado determinístico, Supabase lo soporta nativo vía la extensión `pgsodium` ya disponible en todo proyecto Supabase). Mantiene el dedup del importador CSV funcionando. Es el campo de mayor sensibilidad (cédula/RUT/pasaporte) y el de menor superficie de uso en el código — el candidato de menor riesgo para ir primero.

**Fase 2 (esfuerzo medio):** mismo tratamiento para `phone`, coordinado con el flujo de WhatsApp (`normalizeToWaMe`, `findReferrerByCode`, el webhook) — necesita más cuidado porque hay más código que lo toca.

**Fase 3 (esfuerzo alto, requiere rediseño):** `birth_date` — separar en `birth_month_day` (claro, solo para el match de cumpleaños) + `birth_date_enc` (cifrado, para el resto). No recomendable apurar esto.

**`full_name`:** no cifrar en esta ronda — es el campo más usado en UI/búsqueda/orden y cifrarlo tiene el mayor costo de reingeniería para el menor beneficio marginal (ya está protegido por RLS multi-tenant, que es el control real contra el escenario más probable: otro cliente/clínica viendo estos datos).

## Qué falta antes de tocar código

1. **Confirmación legal**: ¿alcanza el cifrado en reposo de infraestructura, o la ley exige cifrado a nivel de aplicación explícitamente? Esto cambia todo el alcance.
2. **Gestión de claves**: `pgsodium` necesita una clave maestra gestionada por Supabase Vault — hay que decidir rotación, quién tiene acceso, y qué pasa si se pierde (los datos cifrados quedan irrecuperables).
3. **Ventana de migración**: cifrar datos ya existentes de la clínica piloto real requiere un backfill cuidadoso, probado primero contra datos sintéticos.

## Fecha límite

La ley tiene vigencia plena el **1-dic-2026** — quedan ~3.3 meses desde la fecha de la auditoría. Sugiero:

- Esta semana: confirmar con asesor legal si aplica cifrado de aplicación o alcanza infraestructura.
- Si aplica: dedicar una sesión completa a Fase 1 (`document_id`) con tiempo para probar el backfill contra datos sintéticos antes de tocar producción.
