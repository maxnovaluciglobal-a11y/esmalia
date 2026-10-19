> **Archivado el 2026-10-19: histórico, no vigente.** Lo reemplaza [`docs/ROADMAP.md`](../ROADMAP.md) (única fuente de "qué viene", 90 días) y, para el estado del producto, [`docs/Esmalia_Documento_Maestro_v2.md`](../Esmalia_Documento_Maestro_v2.md). Se conserva como registro de cómo se pensó y decidió en su momento; no lo uses como fuente de estado ni de planes. Las rutas `docs/…` que aparecen abajo apuntan a la ubicación anterior (hoy `docs/archivo/`). Motivo: hallazgo GOB-03 de la auditoría 360 del 18-oct-2026.

# Esmalia — Plan de acción

_Auditado y escrito el 2026-08-11, tras importar el proyecto de Lovable y correrlo en local._

## 1. Estado real (no el que sugiere la demo)

Se auditó el código, no solo el doc maestro. Diferencia importante entre lo que
**parece** funcionar navegando la demo y lo que **efectivamente** pega contra la
base de datos:

### Real, con backend Supabase + RLS, testeado

| Módulo                     | Evidencia                                                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth + creación de clínica | `onboarding.tsx` real, `useQuery(["my-clinics"])` contra Supabase                                                                                                                                                                               |
| Equipo y permisos          | `clinic_members`, enum `app_role`, helpers `is_clinic_member` / `has_clinic_role` / `can_manage_clinic` (SECURITY DEFINER)                                                                                                                      |
| **Notas clínicas**         | El módulo más maduro del proyecto: versionado inmutable, flujo de revisión/aprobación por par, extracción de entidades por IA, auditoría, export a PDF, comparador de versiones, **test de RLS en Vitest** (`tests/clinical-notes-rls.test.ts`) |
| Notificaciones             | Realtime vía canal de Supabase, marcado de lectura                                                                                                                                                                                              |
| Compliance export          | Consulta real sobre `clinical_note_audit` + `clinical_note_reviews`, export CSV/PDF                                                                                                                                                             |
| Dominio/email              | Subsistema completo de verificación DNS, sandbox de envío, pruebas — construido para producción, no demo                                                                                                                                        |

### Fachada — UI real, datos 100% hardcodeados, cero tabla en la base

| Ruta                           | Fuente de datos                                 |
| ------------------------------ | ----------------------------------------------- |
| `/dashboard`                   | `kpis`, `pacientes` desde `clinic-data.ts`      |
| `/agenda`                      | `citas`, `profesionales` desde `clinic-data.ts` |
| `/pacientes`, `/pacientes/:id` | `getPaciente()` sobre el mismo fixture          |
| `/tratamientos`                | ídem                                            |

`clinic-data.ts` (583 líneas) tiene un comentario literal: _"Fecha de referencia
del prototipo (jueves)"_. No existen las tablas `patients` ni `appointments` en
ninguna de las 13 migraciones. El propio doc maestro lo admite en la sección de
roadmap: _"MVP — implementado en este prototipo la capa de Agenda + Pacientes"_
se refiere a la capa visual, no a datos reales.

### No existe ni como boceto de código (solo visión en el doc maestro)

Odontograma/periodontograma, presupuestos, planes de tratamiento reales, caja/
facturación, inventario/compras, marketing/campañas, BI configurable, WhatsApp,
facturación electrónica por país, forecast, marketplace de integraciones.

**Conclusión:** no es "un MVP casi terminado al que le faltan módulos". Es un
**vertical productivo muy sólido (notas clínicas + equipo + compliance + email)**
envuelto en una **demo de agenda/pacientes sin persistencia real**. El primer
trabajo no es sumar módulos nuevos del roadmap — es reemplazar el fixture por
datos reales, porque todo lo demás (odontograma, presupuestos, IA de ausencias)
depende de que exista un paciente y una cita de verdad.

## 2. Decisiones ya tomadas (no bloquean, se documentan)

- **Marca = Esmalia.** "Aurora Dental OS" es solo el nombre de proyecto en Lovable;
  en código, `.env`, doc maestro y la propia UI (`<title>Esmalia`, logo) todo dice
  Esmalia. `package.json` y `README.md` ya corregidos en este repo.
- **Un solo lockfile.** Se eliminó `bun.lock`; el proyecto usa `npm` (coincide
  con `vercel.json` → `installCommand: npm install`).
- **`.env` fuera de git.** El `.gitignore` de Lovable no lo excluía; corregido.
- El proyecto **corre en local** (`npm run dev`, puerto 8080) contra el Supabase
  que hostea Lovable (`jysoyttegoxynwrbgnlg`). Landing y login verificados
  visualmente, sin errores de consola.

## 3. Fases

### Fase 0 — Higiene (hecho en esta sesión)

- [x] Rename `package.json` → `esmalia`
- [x] README real (estado, cómo correr, links)
- [x] `.gitignore` con `.env`
- [x] `launch.json` local para preview

### Fase 1 — Pacientes y Agenda reales ✅ código completo, ⚠️ pendiente de aplicar

**Hecho (2026-08-11):**

- Migración `supabase/migrations/20260811120000_...sql`: tablas `patients`,
  `appointments`, `waitlist_entries` + enums `patient_status`/`appointment_status`
  - columna `professionals.default_operatory_id`. RLS calcada del patrón
    existente (mismo set de roles que ya definía `patients:manage`/`agenda:manage`
    en `access.ts`).
- Server functions nuevas: `patients.functions.ts`, `appointments.functions.ts`,
  `waitlist.functions.ts`, `clinic-catalog.functions.ts` (branches/professionals,
  la tabla `professionals` ya existía pero nunca se había leído desde código).
- 4 rutas reescritas para leer datos reales: `dashboard.tsx`, `agenda.tsx`,
  `pacientes.index.tsx`, `pacientes.$pacienteId.tsx`. Con alta de paciente y de
  cita (diálogos simples, sin drag-and-drop todavía — tampoco lo tenía la demo).
- `saldo`/`riesgoAusencia`/`resumenIA` quedaron nullable y explícitamente
  "Sin datos" en vez de fabricar un 0% o un texto de IA falso.
- Guard de `/pacientes/:id` cambiado de `clinical:view` a `patients:view`
  (bug real que encontramos: bloqueaba a recepción de ver hasta el teléfono
  del paciente); las notas clínicas siguen gateadas por `clinical:view` aparte.
- `clinical_notes.patient_ref` no necesitó migración — ya era `text` libre.
- Typecheck (`tsc --noEmit`) y lint limpios en los 8 archivos nuevos/reescritos.
  `types.ts` (generado por Supabase) parcheado a mano con las tablas nuevas
  hasta que se pueda correr `supabase gen types` de verdad.

**⚠️ Bloqueador real — falta aplicar la migración:**
No tenemos `SUPABASE_DB_URL` ni `SUPABASE_SERVICE_ROLE_KEY` en este entorno, así
que la migración SQL está escrita pero **no aplicada** contra el Supabase que
hostea Lovable. Verificado en local: build, typecheck y landing/auth funcionan
contra el proyecto real; una cuenta de prueba se creó de punta a punta. Pero
`/dashboard`, `/agenda`, `/pacientes` van a fallar en runtime hasta que la
migración se aplique, porque las tablas no existen todavía. Dos formas de
desbloquear:

1. Pegar el contenido del `.sql` en el SQL Editor de Supabase (cero credenciales
   nuevas, la vía más simple).
2. Agregar `SUPABASE_DB_URL` al `.env` local (no compartido en el chat) para
   correr la migración por `psql`/CLI.

**Deliberadamente fuera de esta fase:** odontograma/periodontograma,
presupuestos, `treatment_plans` reales, inventario — igual que decía el punto 4
de la sección "Qué NO hacer todavía".

**Por qué primero:** notas clínicas ya cuelga de un `Paciente` — hoy ese
paciente es fake. Odontograma, presupuestos, IA de ausencias, timeline
unificado: todo lo del roadmap asume que `/pacientes/:id` es un registro real.

### Fase 2 — Odontograma versionado ✅ (2026-08-12, commit `4ecea43`)

Tabla `odontogram_marks` + enums `tooth_surface`/`tooth_condition`, numeración
FDI (11-48 permanentes + 51-85 primarios). Trigger SECURITY DEFINER
`close_previous_odontogram_mark` cierra la marca vigente al insertar una nueva
para el mismo (paciente, pieza, superficie) — nunca se UPDATE. RLS: lectura
para clínicos (dentist/assistant/admin/owner), escritura solo con
`clinical:write` (assistant no marca). Componente `<Odontogram>` con SVG por
pieza (cuatro triángulos periféricos + oclusal central), popover Radix con
condiciones filtradas por superficie, toggle "Ver historia".

Periodontograma y consentimientos firmados quedan para Fase 2B/futuro cuando
aparezca demanda concreta.

### Fase 3A — Presupuestos → Planes ✅ (2026-08-12, commit `b15338c`)

5 tablas nuevas: `procedures` (catálogo editable), `quotes` + `quote_items`
(con estado y correlativo `P-YYYY-NNNN`), `treatment_plans` +
`treatment_items` (con status por ítem). Trigger SECURITY DEFINER
`convert_accepted_quote_to_plan` corre en BEFORE UPDATE de quotes: cuando el
status pasa a 'accepted', copia todos los items al plan y marca el quote como
'converted' en el mismo update. La app solo llama a `setQuoteStatus`, cero
código de conversión en JS. Snapshots inmutables (`name_snapshot`) — renombrar
un procedimiento no afecta presupuestos existentes. `<FinanceSection>` en la
ficha del paciente con diálogo de creación (catálogo + alta inline), aceptar/
rechazar en presupuestos colapsables, plan con progreso.

### Fase 3B — Pagos + saldo real ✅ (2026-08-13, commit `49aedc0`)

Tabla `payments` + enum `payment_method` (cash/debit_card/credit_card/
transfer/other). FK opcional a `treatment_plan_id` (null = pago a cuenta) y
`treatment_item_id` reservada para futuro. `getPatient` actualizado para
calcular `saldo` en runtime como `sum(treatment_items.price_cents) −
sum(payments.amount_cents)` — sobrescribe el campo nullable
`patients.balance_cents` que quedó de Fase 1. El header del paciente muestra
saldo real sin cambios de UI. Diálogo `<NuevoPagoDialog>` con monto pre-lleno
al saldo pendiente. Bloque summary Facturado/Pagado/Saldo pendiente en
`FinanceSection`.

### Fase 3C — Facturación electrónica por país (pendiente)

VeriFactu (adaptación desde GastroCore España), Openfactura para SII Chile,
DTE en otros. Requerido para operación legal — necesario si aparece el primer
cliente pago real. Scope grande por país; se puede empezar por CL solo.

### Fase 4A — WhatsApp por wa.me ✅ (2026-08-13, commit `31012a0`)

2 tablas: `message_templates` (catálogo editable por clínica, seed con 4
defaults: appointment_reminder/confirmation, quote_sent, payment_receipt) y
`messages` (historial completo con FK a appointment/quote/template).
Enfoque de bajo costo: `sendWhatsAppFromTemplate` renderiza el template, guarda
el message con status='sent', y devuelve URL `wa.me/{numero}?text=...` que el
cliente abre en tab nueva. El operador manda desde SU WhatsApp — sin
proveedor, sin approval Meta. `<WhatsAppButton>` reutilizable, integrado en
cada fila de la agenda (recordatorio) y en cada presupuesto expandido (envío
del quote). `<MessagesHistory>` nueva sección en la ficha del paciente.

El diseño de la tabla `messages` ya soporta SMS/email/API real (`direction=
inbound`, `external_id`, `delivered_at`, `read_at`) — Fase 4B lo aprovecha
sin migración adicional.

### Fase 4B — Automatización + Twilio API (pendiente)

Cron automático de recordatorios 24h/3h antes de cada cita (opciones: pg_cron
en Supabase, Vercel Cron, EventBridge). Integración Twilio WhatsApp Business
API para envío no-manual (requiere approval Meta, cuenta pagada). Webhooks de
respuestas del paciente para marcar delivered/read y parsear "SÍ"/"RE" para
auto-confirmar o disparar reagendamiento. UI para editar templates.

### Fase 5 — Inventario / marketing / BI (pendiente)

Consumo automático de insumos por procedimiento, campañas a "paciente perdido",
dashboards configurables. Menor urgencia — dependen de que exista actividad
real (tratamientos, citas) para tener datos que consumir.

### Fase 6 — Endurecimiento y operación (en curso 2026-08-13)

- Auditoría multi-agente: 3 agentes en background auditando (a) seguridad+RLS,
  (b) correctitud+bugs, (c) reuso+simplificación+performance. Findings se
  aplican después. Es el paso previo antes de abrir a clínicas reales — evita
  descubrir un bug de RLS con PHI real de por medio.
- Backups: Supabase Cloud (Lovable-hosted) hace backups automáticos por su
  cuenta (Free tier: snapshots diarios 7 días; Pro: PITR 14 días). No hay
  acceso al VPS para agregar `age` + offsite como en GastroCore. Alternativa:
  script de export a JSON encriptado que se puede correr desde CI — pendiente
  hasta que haya clínicas reales.
- Test automatizado de aislamiento multi-tenant (RLS): crear 2 clínicas
  ficticias con service_role y verificar que un user de A no ve B. Pendiente.
- Decisión Lovable sync: local/GitHub es la fuente de verdad; editar en
  Lovable solo si se quiere prototipar UI nueva antes de portarla. Nada de
  force-push en `main` (rompe el sync — AGENTS.md).

### Fase 6b — Cifrado columna PII/PHI (Ley 21.719, Chile)

Fase 1 (dual-write no bloqueante de `document_id`) construida y aplicada
2026-08-22 (`security-6`, ver auditoría 360 del 21-ago). **Fecha de corte para
la Fase 1b (cutover real: leer solo del campo cifrado, extender a
`phone`/`birth_date`): 1-nov-2026** — vigencia plena de la Ley 21.719 es
1-dic-2026, esto deja ~1 mes de margen real. Bloqueador: confirmar si ya
existe una key en Supabase Vault para `pgp_sym_encrypt` o si hay que
generarla (decisión de Walter, ver auditoría 360 v2 del 26-ago,
`docs/PLAN_EJECUCION_AUDITORIA_2026-08-26.md` Oleada 3). No arrancar el
cutover de código sin esa key confirmada — es una migración destructiva si
sale mal a mitad de camino.

### Fase 7 — Go-to-market

Ambiente de demo público con datos de ejemplo realistas (mismo patrón que
`demo_chile_data.php` de GastroCore), importadores desde Dentalink/Dentidesk/
Open Dental (diferenciador #2 del doc maestro: "la migración como producto"),
landing propia.

## 4. Qué NO hacer todavía

- No migrar a self-host / Supabase propio hasta que aparezca la primera
  clínica pago real que lo justifique — Supabase Cloud (Lovable) alcanza
  para todo el desarrollo actual y la fase de prueba.
- No integrar Twilio API real (Fase 4B) hasta que el flujo manual de wa.me
  haya validado la utilidad de los mensajes con clínicas reales — el approval
  de Meta para WhatsApp Business API tarda y cuesta plata.
- No arrancar Fase 3C (facturación electrónica) especulativamente — cada
  país es un proveedor distinto (Openfactura CL, SAT MX, DIAN CO, SUNAT PE);
  arrancar por el país donde aparezca la primera venta real.

## 5. Patrones establecidos (usar en fases nuevas)

- **RLS obligatoria** en toda tabla con helpers `is_clinic_member(id)`,
  `has_clinic_role(id, roles[])`, `can_manage_clinic(id)` (SECURITY DEFINER).
- **Triggers de dominio SECURITY DEFINER** hacen el trabajo pesado, la app
  solo dispara. Ejemplos: conversión de quote a plan, cierre de marca de
  odontograma. Patrón repetible para historia clínica versionada.
- **Snapshots inmutables** cuando un ítem depende de un catálogo — copiar
  el nombre al momento de crear, con FK `ON DELETE SET NULL`. Renombrar el
  catálogo no muta el histórico.
- **Nunca UPDATE de eventos versionados** — nueva fila con
  `superseded_at` NULL + trigger cierra la anterior. Usado en `odontogram_marks`.
- **Placeholders nullable** (`saldo`, `no_show_risk`, `ai_summary`) en vez de
  fabricar cero. UI muestra "Sin datos" cuando null.
- **Server functions** en `src/lib/*.functions.ts` con
  `createServerFn().middleware([requireSupabaseAuth]).inputValidator(zod).handler(...)`.
  Queries separadas + join con `Map` en JS (evitar embedded selects que los
  tipos generados no siempre pillan).
- **types.ts se parchea a MANO** cuando se agrega tabla/enum — no hay
  Supabase CLI configurado.
- **Diálogos**: Radix Dialog + `useMutation` + `queryClient.invalidateQueries`
  - `toast`. Reset de campos en `onSuccess`.
- **Route guards**: `beforeLoad: requirePermission("perm")` con permisos
  definidos en `src/lib/access.ts`.
- **Fechas**: usar `hoyISO(timeZone)` de `clinic-data.ts` — nunca
  `new Date().toISOString().slice(0,10)` que da timezone del server.
