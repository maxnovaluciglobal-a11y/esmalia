> **Archivado el 2026-10-19: histórico, no vigente.** Lo reemplaza [`docs/ROADMAP.md`](../ROADMAP.md) (única fuente de "qué viene", 90 días) y, para el estado del producto, [`docs/Esmalia_Documento_Maestro_v2.md`](../Esmalia_Documento_Maestro_v2.md). Se conserva como registro de cómo se pensó y decidió en su momento; no lo uses como fuente de estado ni de planes. Las rutas `docs/…` que aparecen abajo apuntan a la ubicación anterior (hoy `docs/archivo/`). Motivo: hallazgo GOB-03 de la auditoría 360 del 18-oct-2026.

## ⚠️ ESTADO REAL AL 27-AGO — leer antes de asumir algo por cerrado

Todo el código de las Oleadas 1 y 2 está escrito, testeado (`tsc`/`eslint`/`vitest` limpios) y pusheado a `main` (8 commits, `ce55cfc`..`dda8c93`). **Pero las migraciones de Supabase escritas HOY (27-ago) todavía NO están aplicadas en el Supabase real** — confirmado con query directa (`patient_medical_history_audit`, `commission_settlements`, `inventory_items.branch_id`, el enum `commission_settled` de `message_templates`: ninguno existe todavía en la base real). El código degrada bien (no rompe nada), pero estas features específicas **no funcionan de verdad hasta que Walter corra el SQL**:

- Auditoría de cambios a alergias/medicación (arq-5/seguridad-3)
- Cerrar período de comisiones / marcar pagado / que el dentist vea su propia comisión (arq-1/arq-8/ops-3/ops-9/ux-3) — si se clickea "Cerrar período" ahora mismo, tira un error de Postgres (tabla inexistente), no crashea la página pero tampoco funciona
- Índice de performance del reporte de comisiones (arq-9)
- Inventario por sucursal (producto-2)
- Aviso por email al cerrar una comisión (F2)

**SQL consolidado listo para pegar en el SQL Editor de Supabase: `docs/PENDIENTES_MIGRACIONES_2026-08-27.sql`** (8 migraciones, ya en el orden correcto). Importante: `20260827060000` (agrega el valor `commission_settled` al enum) tiene que correr y confirmarse ANTES de `20260827060100` (que usa ese valor) — no pegar los dos en la misma sentencia si el editor no separa transacciones, correrlos uno por vez en ese orden.

Las migraciones de F1/F3/F4 (`20260827000000`) ya fueron aplicadas como DATO en vivo con un script puntual el 26-ago para las 2 clínicas existentes — correr esta migración de todos modos es seguro (usa `ON CONFLICT DO NOTHING` / `WHERE body =` exacto) y además la deja funcionando para clínicas NUEVAS que se den de alta después.

---

# Plan de ejecución — Auditoría 360 del 2026-08-26

Implementa los 41 hallazgos con veredicto **agregar** y el 1 con veredicto **sacar** del reporte `docs/AUDITORIA_360_REPORTE_2026-08-26.md` (incluye los 17 hallazgos F1-F8/ops-1 a ops-9 del repaso de Comunicaciones y Operación/GTM, integrados en las oleadas de abajo). No toca los 12 **diferir** ni los 6 **mantener**, salvo donde el reporte pide explícitamente una acción de gestión (fecha de corte de seguridad-2).

Convención de esta ronda: cada oleada agrupa hallazgos que se pueden codear en paralelo sin pisarse archivos. Dentro de una oleada, cada bloque es una sesión/PR independiente. **No pasar a la oleada siguiente sin cerrar las migraciones pendientes de la anterior** (ver regla de dos pasos del CLAUDE.md del repo: archivo versionado + `psql` a mano).

---

## Antes de arrancar — decisiones y accesos que Walter debe resolver primero

Nada de esto lo puedo hacer yo. Bloquea partes puntuales del plan, no todo — están marcadas donde aplica.

| #   | Qué necesito de Walter                                                                                                                                                                                                                                       | Bloquea                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Confirmar si el bucket/cuenta B2 (`b2:gastrocore-backups` es de otro proyecto — Esmalia necesita el suyo propio o un sub-bucket) ya existe. Si no existe, crearlo primero en backblaze.com                                                                   | Oleada 0 (seguridad-1)                                                                                                                     |
| 2   | Pegar `B2_ACCOUNT_ID` / `B2_APPLICATION_KEY` (y el nombre de bucket si difiere) como GitHub Secrets del repo `esmalia`                                                                                                                                       | Oleada 0 (seguridad-1)                                                                                                                     |
| 3   | Decidir la fecha de corte real para el cutover de cifrado (recomendado 1-nov-2026) y confirmar que entra `phone`/`birth_date` en el mismo alcance                                                                                                            | Oleada 0 (seguridad-2, solo gestión) — el cutover de código en sí va en Oleada 3 y necesita la key de cifrado ya cargada en Supabase Vault |
| 4   | Confirmar si ya existe una key en Supabase Vault para `pgp_sym_encrypt`, o hay que generarla                                                                                                                                                                 | Oleada 3 (seguridad-2 cutover)                                                                                                             |
| 5   | Decidir el gate de billing real: ¿self-service pasa a requerir tarjeta desde el día 1, o sigue trial sin tarjeta pero con corte duro a los 14 días? (afecta marketing-2b y pricing-trial-sin-antifraude)                                                     | Oleada 2                                                                                                                                   |
| 6   | Confirmar si "Empieza gratis" se saca del todo (self-service cerrado, solo alta manual por Walter) o se mantiene con gate — el reporte marca marketing-2 como contradicción con `nosotros.tsx`, la resolución es una decisión de producto, no solo de código | Oleada 2                                                                                                                                   |
| 7   | Aprobar redacción del comentario corregido en `pricing-display.ts` (trivial, pero es texto de cara a soporte/Stripe)                                                                                                                                         | Oleada 1                                                                                                                                   |

---

## Oleada 0 — Ya, hoy, antes de cualquier otra cosa (P0, sin dependencias de código)

Estas dos cosas no compiten por archivos con nada más y son las de mayor severidad real del reporte. Se hacen aparte, en paralelo a todo lo demás.

### 0.1 — seguridad-1: backups offsite (P0, bloqueante real)

- **Acción de Walter (no delegable):** cargar `B2_ACCOUNT_ID` y `B2_APPLICATION_KEY` como GitHub Secrets en `walterlamadriz-ai/esmalia` → Settings → Secrets and variables → Actions.
- **Mi verificación después:** `gh run list --workflow=backup.yml -R walterlamadriz-ai/esmalia --limit 3` y `gh run view --log <run-id>` sobre la corrida disparada manualmente (`gh workflow run backup.yml`). Confirmar en el log que el paso "subir a B2" termina en éxito, no en `account not found`. **No dar esto por resuelto solo porque Walter dice que pegó los secrets** — correr y leer el log.
- **0.1b (mismo bloque, esfuerzo trivial):** investigar la corrida colgada 6h01m del 19-ago con `gh run view --log <ese run-id>` antes de asumir que fue ruido de infraestructura de GitHub Actions.

### 0.2 — seguridad-2: fijar fecha de corte (P0, es gestión, no código)

- Escribir en `docs/PLAN_ACCION.md` una entrada nueva: "Cutover cifrado `document_id` (Ley 21.719) — fecha de corte 1-nov-2026, incluye phone/birth_date, bloqueador: key en Supabase Vault (pendiente Walter)". Esto no requiere esperar nada — se hace ya.
- El cutover de código real (migrar el caller a leer/escribir `document_id_enc`) va en Oleada 3, condicionado al punto 4 de la tabla de arriba.

### 0.3 — F1 (Comunicaciones): botón "Email" del aviso de 3h siempre falla (P0, bug ya reproducible en producción)

- Es el único hallazgo de toda la auditoría que ya es un bug real, no un riesgo — priorizarlo con lo de arriba, no esperar a Oleada 1/2.
- Migración de seed: agregar fila `channel='email', kind='appointment_checkin'` a `email_templates` para clínicas existentes (mismo patrón que `20260826190000_email_templates.sql`), o alternativa más rápida: sacar el botón `<EmailButton>` para `appointment_checkin` en `recordatorios.tsx:298-324` hasta tener el template. Elegir con Walter cuál de las dos según cuánto tarde redactar el copy del checkin por email.
- **Verificación:** clickear el botón Email de un aviso de checkin en `/recordatorios` contra Supabase real y confirmar que ya no tira "No hay plantilla de email activa para este tipo de aviso."

### 0.4 — ops-1: actualizar checklist de lanzamiento (P0, solo documentación)

- Agregar a `docs/DEPLOY_PRODUCTION.md` (Wave 3.1 o la sección de checklist) los 3 pasos operativos que faltan: activar producción de email, cargar horarios de profesional, configurar reglas de comisión. Sumar un ítem de smoke-test: verificar que exista al menos un `consent_template` activo antes del go-live de una clínica nueva (el alta en sí ya es self-service, esto es solo un recordatorio de checklist).

---

## Oleada 1 — Fixes aislados, un archivo cada uno, sin migración (P0/P1, 100% paralelizable)

Ningún bloque de esta oleada toca la misma tabla, la misma policy RLS ni el mismo componente que otro. Se pueden repartir en 5-6 sesiones paralelas sin coordinación.

| Bloque | Hallazgos                           | Archivo(s)                                                                                                                                                      | Qué hacer                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.A    | visual-1 + ux-2 (mismo bug, un fix) | `src/components/signature-pad.tsx`                                                                                                                              | `pointerPos()` calcula sobre tamaño renderizado sin factor `canvas.width/rect.width` (`canvas.height/rect.height` para Y). Agregar el factor de escala. Afecta consentimientos y presupuestos — **P0**, es evidencia legal.                                                                        |
| 1.B    | visual-2                            | `src/components/signature-pad.tsx` (mismo archivo que 1.A, hacer en el mismo PR)                                                                                | Sacar el hex fijo del trazo, usar variable CSS/token oklch existente en `styles.css` en vez de color literal.                                                                                                                                                                                      |
| 1.C    | ux-1 (extendido)                    | `src/routes/_authenticated/_clinic/agenda.tsx` (agenda + diálogo de nueva cita, mismo archivo hoy — no hay `NuevaCitaDialog.tsx` separado)                      | Incluir `allergies` en el query/payload que ya arma la agenda, mostrar banner visible al agendar y en la vista de agenda. Mismo query que ya trae el paciente — no requiere endpoint nuevo.                                                                                                        |
| 1.D    | producto-1                          | Vista de check-in / preparación de sala (donde recepción/asistente ven la agenda del día sin abrir la ficha completa)                                           | Mismo dato de alergias que 1.C, segundo punto de renderizado. Hacer junto con 1.C porque comparten el query — **un solo PR para 1.C+1.D**, no dos.                                                                                                                                                 |
| 1.E    | arq-4                               | Flujo de firma de presupuesto (buscar el caller de `signature-pad.tsx` para presupuestos, probablemente en `src/lib/quotes*` o el componente de FinanceSection) | Si falla la subida de la firma, no guardar "accepted": loguear el error y exponer flag `signatureUploadFailed` visible en UI.                                                                                                                                                                      |
| 1.F    | ux-6                                | Componente de archivar documento (`clinical_documents_and_consents`, buscar `archivar` en `src/components`)                                                     | Agregar botón visible además de hover (o al menos visible en focus/touch), `aria-label` en vez de solo `title`, diálogo de confirmación antes de archivar.                                                                                                                                         |
| 1.G    | ux-7                                | Componente de revocar consentimiento (mismo módulo que 1.F)                                                                                                     | Agregar diálogo de confirmación antes de revocar. Se puede hacer en el mismo PR que 1.F si es el mismo componente.                                                                                                                                                                                 |
| 1.H    | visual-8                            | Vista de agenda (`agenda-grid.tsx` / `agenda-views.tsx`)                                                                                                        | Usar el color de profesional ya guardado en la cita/bloque de agenda (feature huérfana — el dato existe, falta consumirlo en el render).                                                                                                                                                           |
| 1.I    | visual-9                            | Toggle de dark mode (buscar `useState(false)` de tema, probablemente en un theme provider o layout raíz)                                                        | Persistir en localStorage + respetar `prefers-color-scheme` inicial vía `matchMedia`.                                                                                                                                                                                                              |
| 1.J    | visual-4                            | `src/lib/odontogram.ts`                                                                                                                                         | Corregir el hex de "ausente" (`#525252`) por uno que pase contraste WCAG en dark mode — no tocar los otros 9 colores del odontograma, el hallazgo está acotado a este único color.                                                                                                                 |
| 1.K    | pricing-stale-comment-drift         | `src/lib/pricing-display.ts`                                                                                                                                    | Corregir el comentario "el cobro real siempre es US$49 flat" para reflejar Solo US$29 / Clínica US$69. Esperar aprobación de redacción de Walter (punto 7 de la tabla previa) antes de mergear — es texto de cara a soporte.                                                                       |
| 1.L    | marketing-9                         | Meta tags de la landing (`src/routes/index.tsx` o layout de `site-chrome.tsx`)                                                                                  | Agregar `og:image`/`twitter:image`.                                                                                                                                                                                                                                                                |
| 1.M    | marketing-8                         | `robots.txt`/sitemap del build de la landing                                                                                                                    | Corregir el sitemap roto. El dominio sin comprar es decisión de negocio de Walter, no bloquea arreglar el sitemap en sí.                                                                                                                                                                           |
| 1.N    | F5 (Comunicaciones)                 | `src/lib/whatsapp.ts` líneas 30-32                                                                                                                              | Corregir el comentario que dice que `nps_survey` es "wa.me-only" — ya está en `META_TEMPLATE_PARAM_ORDER`. Solo texto, evita un envío no controlado el día que se apruebe esa plantilla en Meta.                                                                                                   |
| 1.O    | F6 (Comunicaciones)                 | `src/lib/messaging.functions.ts` (~línea 867, `treatment_followup`)                                                                                             | Agregar una constante `TREATMENT_FOLLOWUP_COOLDOWN_MS` propia en vez de reusar `TREATMENT_FOLLOWUP_MAX_WINDOW_MS`, mismo patrón que ya usa `hygiene_recall` (`AFTER_MS`/`COOLDOWN_MS` separados).                                                                                                  |
| 1.P    | F7 (Comunicaciones)                 | `src/routes/api.whatsapp-webhook.ts` líneas 327-340                                                                                                             | Si falla `sendMetaTextMessage` a un lead nuevo, agregar `Sentry.captureException` (ya integrado y en uso en `__root.tsx:52`) y marcar el lead con un flag visible en `/whatsapp` cuando `auto_replied_at` sigue null pasado un tiempo.                                                             |
| 1.Q    | ops-2 + ops-8 (Operación)           | `src/lib/email-sandbox.ts` líneas 149/157-158                                                                                                                   | Redactar los 3 `reason` de bloqueo por sandbox en lenguaje de clínica, no de desarrollador — ej. "Esta clínica todavía no tiene el email activado — avisale a soporte" en vez de mencionar "sandbox". `email-button.tsx:53` ya muestra ese string tal cual en el toast, no hay que tocar el flujo. |
| 1.R    | ops-5 (Operación)                   | `src/components/app-shell.tsx`                                                                                                                                  | Agregar un link "Reportar un problema" (mailto o wa.me al número de soporte de Walter) visible en el shell autenticado — hoy el único contacto real es un `mailto` en la página pública `nosotros.tsx`.                                                                                            |

**Verificación de esta oleada:** ninguna toca RLS ni borra datos — se verifica con `preview_start({name:"esmalia"})` + navegación real (agenda, firma en tablet emulado con `resize_window`, dark mode toggle, ficha de paciente con alergia cargada). Para 1.A/1.B en particular, probar en un ancho de diálogo distinto de 460px, que es exactamente el caso que el reporte marca como roto.

---

## Oleada 2 — Requiere migración de Supabase + toca lógica de negocio (P0/P1, coordinar orden)

Estos sí tocan schema. Regla del repo: yo escribo el archivo en `supabase/migrations/`, **Walter lo aplica a mano** con `psql` (o me autoriza a correrlo yo si tengo el `.env` con `PGPASSWORD`, a confirmar caso por caso — nunca asumir que puedo). Después de aplicar, yo parcheo `types.ts` a mano (regla 4 del CLAUDE.md, no hay CLI).

### 2.A — seguridad-3 + arq-5: versionar anamnesis/alergias (P0)

- **Depende de:** nada de esta oleada, pero comparte tabla con 2.C (offline queue) — hacer 2.A primero, 2.C después sobre el resultado.
- Migración nueva: convertir `patient_medical_history` al mismo patrón que `clinical_documents_and_consents` (INSERT + trigger que cierra la fila anterior, nunca UPDATE directo). Archivo `supabase/migrations/20260827XXXXXX_patient_medical_history_versioning.sql`.
- Código: `src/lib/medical-history.functions.ts` deja de hacer UPDATE, pasa a INSERT nueva versión. `src/components/medical-history-card.tsx` lee la última versión vigente.
- **Verificación antes de dar por cerrado:** contra Supabase real (no local), insertar dos versiones de alergia de un paciente de prueba, confirmar que la anterior queda con `closed_at` seteado y no se pierde, confirmar que RLS sigue funcionando igual que antes (mismo `clinic_id`/policy, solo cambia el patrón de escritura). Usar un paciente de prueba sintético nuevo, y borrar el dato sintético después si se crea.

### 2.B — arq-2: smoke test de RLS para las 7 tablas Tier 1-3 (P0, sin código de producto)

- Extender `tests/rls-enforcement-smoke.test.ts` con las 7 tablas nuevas: `professional_schedules`, `patient_medical_history`, `email_templates`, `clinical_documents_and_consents`, `inventory_expiration_lots` (y su tabla de lotes si es otra), `commission_rules`, y la de firma de presupuesto (`quote_signature` o como se llame la columna nueva de la migración `20260826250000`).
- Correr contra Supabase real, no mockeado — es lo que ya hace el test existente, seguir el mismo patrón (login con dos usuarios de clínicas distintas, confirmar que ninguno ve datos del otro).
- Esto es lo que en la práctica _verifica_ que 2.A y el resto de RLS sigue sano — hacerlo inmediatamente después de 2.A, antes de seguir.

### 2.C — arq-3: cola offline para anamnesis (Tanda 1 de 2, P1)

- **Depende de:** 2.A cerrado (la cola tiene que escribir contra el patrón nuevo de versionado, no contra el UPDATE viejo).
- Agregar un `OperacionKind` nuevo en `src/lib/offline-queue.ts`/`src/lib/offline-sync.ts` para anamnesis, siguiendo el mismo patrón que notas clínicas (que ya está resuelto). Cambiar `medical-history-card.tsx` de `useMutation` directo a `use-offline-mutation.ts`.
- La Tanda 2 (firmas, blob de imagen en IndexedDB) el propio reporte la separa por mayor riesgo de cuota — no meterla en esta oleada, va a Oleada 4.

### 2.D — arq-1 + arq-8 + ops-3 + ops-9: comisiones — liquidación cerrada, vigencia temporal y "marcar pagado" (P0, un solo módulo, cuatro hallazgos resueltos juntos)

- Migración nueva: `commission_settlements` (`period_from`, `period_to`, `closed_at`, `closed_by`, `paid_at`, líneas congeladas — snapshot de lo calculado, no referencia viva a `commission_rules`) — cierra arq-1/arq-8/ops-3 (dedupe de liquidación + estado "pagado") de una sola vez.
- Misma migración, columnas nuevas en `commission_rules`: `effective_from`/`effective_to` — cierra ops-9 (hoy cambiar una regla altera retroactivamente reportes de meses ya cerrados porque no hay vigencia temporal).
- `src/lib/commissions.functions.ts`: `getCommissionReport` pasa a leer de `commission_settlements` cuando el período ya está cerrado (aplicando la regla vigente en ESE período, no la regla vigente hoy), y solo calcula en vivo para el período abierto actual. Agregar acciones "cerrar período" y "marcar pagado" (solo owner/admin).
- **Verificación:** simular cerrar un período con datos de prueba, confirmar que correr el reporte de nuevo no cambia los montos ya liquidados aunque se edite `commission_rules` después, y confirmar que una regla nueva con `effective_from` futuro no afecta reportes de períodos ya cerrados.

### 2.E — arq-9: índice faltante (P2, trivial, se puede meter en el mismo PR que 2.D)

- Agregar índice a `treatment_items` para el patrón de acceso del reporte de comisiones (columnas exactas: revisar el `WHERE`/`JOIN` real de `getCommissionReport` antes de escribir el índice, no adivinar).

### 2.F — ux-3: comisiones — filtro backend + acceso del dentista (P0, depende de 2.D)

- **Depende de:** 2.D (hay que filtrar sobre la tabla/lógica ya corregida, no sobre la vieja).
- `getCommissionLines` (en `commissions.functions.ts`) no filtra por `professionalId` en el handler — agregar el filtro server-side, no solo en la UI.
- Dar al rol `dentist` acceso de lectura a su propia liquidación (nuevo permiso o condición en `src/lib/access.ts`, ej. "ver solo si `professional_id === userId`").

### 2.G — producto-2: inventario por sucursal (P1, bajo esfuerzo, independiente del resto)

- `branch_id` ya es nullable según el reporte — completar el filtrado en la UI de inventario para cuando haya más de una sucursal. No requiere migración si la columna ya existe (confirmar con `\d inventory_expiration_lots` antes de escribir código).

### 2.H — producto-10: revocación individual del portal (P1, independiente)

- `src/lib/portal-token.server.ts` ya tiene TTL de 7 días (líneas 16 y 67, confirmado en el reporte) — agregar función de revocación manual de un token específico (ej. columna `revoked_at` + chequeo en el validador).

### 2.I — F2 (Comunicaciones): avisos para comisiones liquidadas, documentos por firmar y encuestas (P1, sin migración de schema, sí requiere wiring nuevo)

- **Se hace después de 2.D** (una liquidación de comisión recién existe como evento real una vez que "cerrar período" está implementado — avisar de algo que hoy no tiene estado persistente no tiene sentido).
- Reusar `sendEmailFromTemplate`/`sendWhatsAppFromTemplate` (ya existen en `messaging.functions.ts`) desde el handler de "cerrar período" de comisiones (avisa al profesional) y desde la creación de un documento/consentimiento pendiente de firma (avisa al paciente). Requiere sembrar 2 templates nuevos (`commission_settled`, `document_pending_signature`) — mismo patrón de migración que el resto de templates.
- La encuesta de satisfacción ya envía mensaje (es solo captura lo que falta, ver producto-3/visual-7, diferidos) — no duplicar esfuerzo acá.

### 2.J — F3 (Comunicaciones): fallback de email para presupuesto y recibo de pago (P1, seed de templates)

- Sembrar versión `channel='email'` para `quote_sent` y `payment_receipt` (mismo patrón que la migración `20260826190000` que ya lo hizo para confirmación/recordatorio/NPS).
- `finance-section.tsx:981` agrega un `<EmailButton>` junto al `<WhatsAppButton>` existente, condicionado a que el paciente tenga email cargado — mismo patrón que ya usa `recordatorios.tsx`.

### 2.K — F4 (Comunicaciones): neutralizar voseo en `handle_new_clinic()` completo (P1, contenido, no lógica)

- Alcance correcto según la defensa: NO son solo las 2 migraciones de email nuevas, es TODO el copy sembrado por `handle_new_clinic()` desde Fase 0 (confirmación, recordatorio 3h, presupuesto, saldo, lista de espera, y los 2 templates de email nuevos).
- Migración de corrección de copy: reemplazar "respondé/tenés/podés/avisanos/te lo ofrecemos/me decís" por fraseo neutro ("responde/tienes/puedes/avísanos/te lo ofrecemos/dime") en los templates ya sembrados via `UPDATE ... WHERE body LIKE`, y corregir el seed de `handle_new_clinic()` para que las clínicas nuevas ya nazcan con el copy neutro.
- Priorizar antes de sumar la primera clínica piloto fuera de Chile/Argentina — es cosmético hasta entonces.

**Verificación transversal de la Oleada 2:** todo lo que toca RLS o dinero (2.A, 2.D, 2.F) se prueba contra Supabase real con al menos dos usuarios/roles distintos antes de mergear, nunca solo "compila". Nada de esto se toca en Supabase producción sin que el archivo de migración esté commiteado primero (mismo orden que exige el CLAUDE.md del repo).

---

## Oleada 3 — Cifrado Ley 21.719, cutover real (P0 legal, depende de Walter)

**Bloqueada hasta que Walter confirme el punto 4 de la tabla inicial** (key en Supabase Vault).

- Migrar el caller real: donde hoy se lee/escribe `patients.document_id` en texto plano, pasar a `document_id_enc` (cifrado) + `document_id_hash` (para búsquedas exactas, si así está diseñado — revisar la migración `20260822150000` antes de tocar código, no asumir la forma exacta del esquema).
- Extender el mismo patrón a `phone` y `birth_date` en la misma pasada (así lo pide el reporte).
- Migración de backfill: cifrar los datos existentes de las 3-5 clínicas piloto ya cargadas. **Esto es destructivo si sale mal** (texto plano se pierde si el cifrado falla a mitad de camino) — hacer backup manual pre-migración (además del backup automático de Oleada 0) antes de correr el backfill, y correrlo primero contra un dump/copia, no directo en prod.
- **Verificación obligatoria antes de considerar esto cerrado:** leer un registro real post-migración con la key correcta y confirmar que decodifica al valor original; confirmar que sin la key (ej. con `service_role` pero sin `pgp_sym_decrypt`) el dato se ve cifrado; correr el smoke test de RLS (2.B) de nuevo después de este cambio, porque toca la tabla de pacientes que probablemente ya tiene test propio (`patients-rls` o similar, si existe).
- Actualizar `docs/PLAN_ACCION.md` marcando la Fase 1b como cerrada solo cuando esto esté verificado, no cuando el código esté escrito.

---

## Oleada 4 — Negocio: billing gate, antifraude, seats (P0, depende de decisión de Walter)

**Bloqueada hasta que Walter resuelva los puntos 5 y 6 de la tabla inicial** (self-service se cierra o se gatea, y con qué criterio).

### 4.A — pricing-seat-limit-no-enforced (P0, es la llave que destraba todo el bloque de pricing)

- Instrumentar conteo real de profesionales/sillones activos por clínica. Tabla o columna calculada (revisar si ya existe algo parecido en `billing.ts`/`billing.functions.ts` antes de crear de cero).
- Validar contra el límite del plan (`solo`=1, `clinica`=hasta 3) en el server function que da de alta un profesional nuevo — hoy no hay ningún control, según el reporte.
- **No requiere migración de Supabase necesariamente** si se puede calcular con un `count()` sobre una tabla existente — confirmar antes de asumir que hace falta columna nueva.

### 4.B — marketing-2b + marketing-2: gate de billing real en self-service (P0)

- **Depende de:** decisión de Walter (punto 5/6) y de 4.A (el gate necesita saber cuántos seats está usando la clínica para decidir si bloquea).
- `trial-banner.tsx` hoy documenta "acceso libre hasta que el owner active el plan" — esto deja de ser así: implementar el corte real (bloqueo de funciones o redirect a checkout) al vencer el trial o al superar el seat limit sin plan pago.
- Si Walter decide cerrar el self-service en vez de gatearlo (alternativa del punto 6), esta tarea cambia de alcance: en vez de gate, se saca el botón "Empieza gratis" de la landing y el alta pasa a ser manual — coordinarlo con `src/routes/index.tsx`/`nosotros.tsx` para que dejen de contradecirse entre sí.

### 4.C — pricing-trial-sin-antifraude (P0, depende de 4.B)

- Dedupe de trial por email (y opcionalmente por dominio de email) en el signup. Si Walter elige "tarjeta desde el día 1" en 4.B, este hallazgo se resuelve solo (Stripe ya dedupea por método de pago) — confirmar con Walter si igual quiere el dedupe por email como capa extra.

### 4.D — marketing-1: analytics mínimo en landing/app (P1, independiente del resto de esta oleada, se puede adelantar)

- No depende de las decisiones de negocio de arriba — se puede hacer en paralelo a todo. Instrumentar algo simple (Plausible/PostHog/GA4, decisión de Walter sobre cuál) en landing y en el signup flow como mínimo.

### 4.E — pricing-founder-sin-criterio-de-cierre (P1, depende de 4.A tener datos)

- Es una decisión de Walter con soporte de los datos de 4.A (cuántos seats/clínicas hay hoy), no algo que yo resuelva solo con código — mi entregable acá es armar el resumen de uso real (output de 4.A) para que Walter decida fecha/cupo de cierre del precio fundador, y dejarlo escrito en `docs/PLAN_ACCION.md`.

**No pasar a Stripe Live** (pendiente heredado, ver §5 del reporte) hasta que 4.A, 4.B y 4.C estén cerrados y verificados — es la recomendación explícita del reporte.

---

## Oleada 5 — Marketing/contenido, sin código de producto (P1/P2, se puede hacer en cualquier momento en paralelo)

No compite con nada de arriba. Requiere trabajo de Walter (fotos, testimonios, canal de contacto) más que código.

- **marketing-3:** agregar canal WhatsApp de contacto en la landing (botón wa.me, mismo patrón que ya usa el resto del producto) — bajo esfuerzo, código simple.
- **marketing-4:** pedir 2-3 testimonios reales a las pilotos amigas (llamada de Walter, no delegable) y maquetarlos en la landing.
- **marketing-5:** reemplazar fotos stock por fotos reales de las clínicas piloto (con permiso) — depende de que Walter consiga las fotos.
- **marketing-6:** agregar cupo/fecha de cierre visible al "precio fundador" en la landing — depende de la decisión de 4.E, hacer después.
- **marketing-7:** agregar tour guiado a la demo (`/demo`), enfocado en los dolores que la landing promete resolver. Confirmado por el reporte que la demo es read-only por trigger DB, no expone PHI — el fix es puramente de UX/copy, no de seguridad.
- **visual-3:** corregir el mockup de landing: sacar el estado de cita inventado ("Recordado", que no existe en `Cita["estado"]"`) y/o dejar de simularlo con chrome de navegador como si fuera captura real.

---

## Oleada 6 — Descartes y correcciones de foco (sin trabajo de código)

- **sacar — pricing-concentracion-proveedor-pago:** no hacer nada. Dejar constancia en este plan de que se evaluó y se descartó (esfuerzo alto, desproporcionado a la etapa).
- **diferir — F8 (Comunicaciones), sin límite de frecuencia cruzada entre tipos de outreach:** no hacer nada por ahora. El staff despacha a mano y puede notar duplicados; anotarlo para cuando escale el volumen de pacientes por clínica (un contador simple de outreach enviado por paciente en 7 días alcanzaría el día que haga falta).
- **mantener — ops-6/ops-7:** onboarding automatizado y el diagnóstico de que el cuello de botella es proceso humano, no automatización rota — no requieren acción, quedan registrados en el reporte como fortalezas confirmadas.

---

## Resumen de orden de ejecución sugerido

```
Oleada 0 (ya)         → seguridad-1/ops-4 (Walter+yo verifico) + seguridad-2 gestión
                         + F1 (bug ya en prod) + ops-1 (checklist, solo docs)
Oleada 1 (paralelo)   → 18 fixes aislados, sin migración de schema
Oleada 2 (secuencial  → 2.A → 2.B → 2.C
  entre sub-bloques      2.D (+ops-3/ops-9) → 2.E → 2.F → 2.I
  dependientes,           2.G, 2.H, 2.J, 2.K en paralelo al resto
  resto paralelo)
Oleada 3 (bloqueada)  → cutover cifrado, espera key de Walter
Oleada 4 (bloqueada)  → 4.A → 4.B → 4.C; 4.D en paralelo; 4.E al final
Oleada 5 (paralelo,   → contenido/marketing, en cualquier momento
  sin prisa)
Oleada 6              → sin código, solo registro de descartes/diferidos
```

**P0 real de esta ronda (bloqueante para sumar clínica piloto nueva o pasar a Stripe Live):** 0.1, 0.2, 0.3 (F1), 0.4 (ops-1), 1.A, 1.C+1.D, 2.A, 2.B, 2.D, 2.F, Oleada 3 completa, Oleada 4 completa (4.A/4.B/4.C).

**Todo lo demás es P1/P2** — mejora la calidad del producto pero no bloquea la operación actual con las 3-5 pilotos amigas. Auditoría 360 ya cubre las 9 áreas con contenido real (Comunicaciones y Operación/GTM se repitieron y están integradas arriba) — no queda pendiente de proceso.
