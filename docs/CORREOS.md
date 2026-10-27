# Correos de ciclo de vida a la clínica

Esmalia le escribe a la **clínica** (propietarios y administradores) en siete momentos. Los correos de ciclo de vida nunca le escriben a pacientes: los destinatarios salen de `clinic_members`, nunca de `patients`. Los correos **automáticos al paciente** (Ola 7) son otro proceso, con sus propios frenos: ver [Correos automáticos al paciente](#correos-automáticos-al-paciente-ola-7) al final. Los que envía una persona desde la app (presupuesto y copia de documentos) están en `docs/DOCUMENTOS.md`. Spec aprobada: `07 - Clientes y Ventas/2026-10-09-correos-ciclo-de-vida.md` (fuera del repo).

Están construidos y **encendidos en modo de prueba desde el 09-oct-2026** (`LIFECYCLE_EMAILS_ENABLED=true` + `LIFECYCLE_EMAIL_REDIRECT_TO`: todo llega a `maxnovaluciglobal@gmail.com` con el asunto `[PRUEBA → destinatario real]`). Activación y apagado paso a paso: `docs/DOMINIO_RUNBOOK.md`, paso 6b.

## Los correos

| Correo                                       | `kind`                    | Disparo                                                                                                                                                                                                          | A quién                                           | Clave de idempotencia (`period_key`)                                                             | ¿Baja?                                                 |
| -------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Bienvenida ("Tu clínica ya está en Esmalia") | `welcome`                 | Al terminar `completeClinicSetup` (onboarding)                                                                                                                                                                   | Quien creó la clínica                             | `once`                                                                                           | No (transaccional)                                     |
| Llamada de puesta en marcha pendiente        | `onboarding_call_pending` | Cron horario, ventana 8:00-20:59 local, cuando `correspondeAvisoLlamada` lo dice (ver abajo)                                                                                                                     | Propietarios y administradores                    | `once` (sale **una sola vez** por destinatario)                                                  | No (transaccional)                                     |
| La prueba termina en 3 días                  | `trial_t3`                | Cron horario, ventana 8:00-20:59 local                                                                                                                                                                           | Propietarios                                      | fecha local de fin del trial                                                                     | No                                                     |
| La prueba termina hoy                        | `trial_t0`                | Cron horario, ventana 8:00-20:59 local                                                                                                                                                                           | Propietarios                                      | fecha local de fin del trial                                                                     | No                                                     |
| Suscripción activa                           | `subscription_active`     | Webhook de Stripe, cuando la suscripción **pasa** a `active` (`checkout.session.completed` sin trial, `customer.subscription.created` activa, o `updated` con `previous_attributes.status` distinto de `active`) | Propietarios                                      | id de la suscripción de Stripe                                                                   | No                                                     |
| Pago fallido                                 | `payment_failed`          | Webhook `invoice.payment_failed`, si la suscripción sigue impaga                                                                                                                                                 | Propietarios                                      | id de la factura de Stripe (Stripe reintenta varias veces la misma factura: sale un solo correo) | No                                                     |
| Tu semana en la clínica                      | `weekly_report`           | Cron horario, lunes 8:00-20:59 local; reporta lunes a domingo anterior                                                                                                                                           | Propietarios y administradores con `finance:view` | el lunes de la semana reportada                                                                  | **Sí**: enlace visible + `List-Unsubscribe` de un clic |

Detalles que importan:

- **Llamada pendiente** (`correspondeAvisoLlamada` en `src/lib/email/ciclo-de-vida.ts`): reusa la regla de `/admin/clinicas` (`horasConLlamadaPendiente`: pasaron `HORAS_LLAMADA_PENDIENTE` = 24 h desde el alta y `clinics.onboarding_call_at` sigue vacío) y además exige `subscriptions.status = 'trialing'` (solo en prueba la llamada destraba algo, `requiereLlamadaOSuscripcion`; sin fila de suscripción es una piloto anterior y no se toca), que no sea la demo y que la clínica tenga **menos de `DIAS_MAX_AVISO_LLAMADA` (7) días** de alta: al desplegar, las clínicas más viejas no reciben un aviso tardío. Frecuencia: una vez; si la clínica no agenda, no se insiste. El texto de qué se activa es el mismo de la bienvenida (`LO_QUE_ACTIVA_LA_LLAMADA`) y el botón usa `enlacePuestaEnMarcha()` (Calendly → WhatsApp de ventas → correo). Un administrador que se suma después, dentro de los 7 días, también lo recibe una vez. Requiere la migración `20261020030000_correo_llamada_pendiente.sql` (suma el kind al CHECK de `lifecycle_emails`); sin ella el CHECK rechaza el INSERT y el freno 6 lo deja en `skipped` sin enviar nada (falla cerrado).
- **Fin de prueba** solo para `subscriptions.status = 'trialing'` **sin** `stripe_subscription_id` (si ya pasó por el checkout, Stripe lleva su propio calendario). El T-3 abre con un dato real de la clínica (citas agendadas, pacientes cargados). Lo que dice sobre el vencimiento es lo que hace el código: la agenda, los pacientes y las fichas siguen; los informes quedan en pausa (`trialInformesBloqueados`).
- **Pago fallido** describe el gating real (`accesoPorSuscripcion` en `src/lib/billing.ts`, desde #69): nadie queda afuera de la app. Durante `GRACIA_PAGO_FALLIDO_DIAS` (7) todo sigue igual; después se pausan solo los informes. La agenda, los pacientes y la ficha clínica nunca se bloquean. El botón lleva a `/suscripcion` para cambiar la tarjeta (portal de Stripe).
- **Reporte semanal**: los números salen de `src/lib/finance/finance-reports.compute.ts`, las mismas funciones que usan Reportes, Finanzas y Morosidad (las server functions validan el permiso y delegan ahí), y las ausencias de `tasaDeAusencia` (Efectividad). El rango se pasa como fechas YYYY-MM-DD, igual que la pantalla. No sale si la semana no tuvo actividad. Una sola "acción sugerida", por reglas fijas en este orden: presupuestos enviados hace +7 días sin seguimiento (mismo criterio que la cola de `/recordatorios`, solo pacientes con WhatsApp habilitado) → ausencias en alza (≥2 y más que la semana anterior) → deudas de más de 90 días. Si la clínica nunca registró un pago, "Cobrado" dice "Sin datos" y aparece el gancho de activación; nunca un cero inventado.

## Frenos del envío (`src/lib/email/envio.server.ts`)

1. `LIFECYCLE_EMAILS_ENABLED=true` o no hace nada (ni toca la base).
2. Destinatario válido y fuera de dominios reservados (`example.com/.org/.net`, `*.test`, `*.invalid`, `localhost`).
3. `RESEND_API_KEY` + `EMAIL_FROM`.
4. Nunca la clínica demo (`clinics.is_demo`).
5. El reporte semanal respeta `notification_preferences.email_enabled = false` o `unsubscribed_at` (sin fila = se envía) y no sale sin `EMAIL_UNSUBSCRIBE_SECRET`.
6. Idempotencia: inserta la fila en `lifecycle_emails` como `pending` **antes** de llamar a Resend; si choca con el `UNIQUE(clinic_id, kind, period_key, recipient)`, no envía. Un `error` se reintenta hasta 3 veces. Si la tabla no existe (migración sin aplicar), registra en el log y **no envía**.
7. `LIFECYCLE_EMAIL_REDIRECT_TO`: modo de prueba, todo va a esa casilla con el asunto `[PRUEBA → original]`. Lo enviado así ocupa la clave igual que un envío real.

Nada de esto lanza hacia quien llama: el onboarding y el webhook de Stripe nunca fallan por un correo. Ambos esperan como mucho 6 s (`conTope`) en vez de soltar la promesa, porque en serverless lo que queda corriendo después de responder puede congelarse.

## Baja

- Token JWT HS256 (`src/lib/email/baja-token.server.ts`, mismo patrón que el portal) con el usuario y el grupo (`reporte_semanal`), firmado con `EMAIL_UNSUBSCRIBE_SECRET`, válido un año.
- Enlace visible → `/correos/baja?token=…`: muestra qué se da de baja y aplica al **confirmar** (los filtros de correo abren enlaces solos; un GET nunca da de baja).
- Header `List-Unsubscribe` → `POST /api/correos/baja?token=…` (RFC 8058, un clic desde Gmail/Apple Mail).
- Las dos escriben `email_enabled = false` + `unsubscribed_at` en `notification_preferences`. `/preferencias` lo muestra y "Volver a suscribirme" lo revierte en un clic.

## Programación

**Ventana de envío: 8:00 a 20:59 hora de la clínica** (`esVentanaDeCorreos`). Antes era 8:00-11:59, pero el disparo de GitHub Actions es poco fiable (3 a 7 corridas por día entre el 11 y el 18-oct) y el lunes 12 ninguna cayó en la ventana de ningún país: no salió ni el reporte semanal ni un aviso de fin de prueba (hallazgo CS-03). Como cada envío es idempotente, abrir la ventana no puede duplicar correos, solo evita perderlos. El resumen diario sigue con 8:00-11:59.

Vercel Cron llama cada hora (minuto 47, `vercel.json`) a `GET /api/lifecycle-emails` con `Authorization: Bearer $CRON_SECRET`; `.github/workflows/lifecycle-emails.yml` repite la llamada de respaldo en el minuto 17. Lo mismo para el resumen diario (minutos 37 y 7). Con el team en Pro (19-oct-2026) el disparo de Vercel es el principal y el de GitHub queda por si falla; como todo es idempotente, el doble disparo no duplica correos. Tope de 200 clínicas y 150 correos por corrida. La respuesta y el log (`[lifecycle-emails] revisadas=… enviados=…`) dejan rastro aunque no se envíe nada.

## Ver cómo se ven (muestras de QA)

```sh
node scripts/email-muestras.mjs                     # logo desde producción
node scripts/email-muestras.mjs --app-url http://localhost:8080
```

Escribe `.email-muestras/*.html` y `*.txt` (gitignored) llamando a **las mismas** funciones de `src/lib/email/plantillas.ts` que usa el envío real. No toca la base ni envía nada. Para ver el logo con `--app-url` local hay que servir `public/` en ese puerto (`npm run dev` o `python3 -m http.server 8080` dentro de `public/`).

## Archivos

| Archivo                                                                                   | Qué es                                                                                                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/email/layout.ts`                                                                 | Diseño compartido (tablas + estilos en línea, paleta de Esmalia, wordmark PNG) y texto plano a partir de los mismos bloques |
| `src/lib/email/plantillas.ts`                                                             | Las cinco plantillas, puras                                                                                                 |
| `src/lib/email/ciclo-de-vida.ts`                                                          | Reglas puras: calendario en el huso de la clínica, fin de prueba, semana, acción sugerida, dominios reservados              |
| `src/lib/email/envio.server.ts`                                                           | `sendClinicEmail` y sus frenos                                                                                              |
| `src/lib/email/ciclo-de-vida.server.ts`                                                   | Destinatarios, datos y disparadores (bienvenida, Stripe, cron)                                                              |
| `src/lib/email/baja*.ts`, `src/routes/correos.baja.tsx`, `src/routes/api.correos.baja.ts` | Baja                                                                                                                        |
| `src/routes/api.lifecycle-emails.ts`                                                      | Endpoint del cron                                                                                                           |
| `public/brand/esmalia-wordmark-email.png`                                                 | Wordmark 300×84 (se muestra a 150×42) con el fondo de la tarjeta: Gmail no muestra SVG                                      |
| `supabase/migrations/20261012000000_lifecycle_emails.sql`                                 | Tabla de registro e idempotencia (RLS sin políticas: solo service role)                                                     |
| `tests/correos-ciclo-de-vida.test.ts`                                                     | Tests puros (no tocan Postgres ni Resend)                                                                                   |

# Correos automáticos al paciente (Ola 7)

Desde la Ola 7 (frente B) Esmalia **sí** le escribe sola al paciente, por correo y nunca por WhatsApp (WhatsApp sigue siendo a mano desde `/recordatorios`: nada de WhatsApp sale desde un cron). Decisión de la ola: sale automático, pero respeta el modo de prueba de la clínica, la baja, el tutor y la configuración de cada clínica.

| Correo                      | ID     | `kind` / franja                                  | Cuándo                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Confirmación al agendar     | REC-03 | `confirmation` / `once`                          | Cita futura (`tentativa` o `confirmada`) creada después de encender la confirmación, hace menos de 72 h, que empieza en más de 1 h. Cubre agenda, reserva en línea e importación; las citas importadas con `reminders_muted` no la reciben.                                                                              |
| Recordatorio                | REC-02 | `reminder` / `24h`, `2h`…                        | Hasta dos franjas por clínica (1 a 72 h). Ventanas sin solaparse: con [24, 2], el de 24 h sale cuando faltan entre 2 y 24 h y el de 2 h entre 30 min y 2 h. Si la cita se creó adentro de la ventana de una franja, esa franja no sale (ya la avisó la confirmación).                                                    |
| Encuesta NPS                | MKT-08 | `nps` / `once`                                   | Cita `finalizada`, N horas (1 a 72) después de `ends_at`, hasta 72 h más; una por paciente cada 30 días. Página `/encuesta/:token` (0-10 + comentario, vale 14 días). A los promotores (9-10) se les muestra el link de reseña de Google de la clínica o, si no hay, el de la sucursal de la cita; sin link, no se pide. |
| Formulario antes de la cita | MKT-07 | va adentro de la confirmación o del recordatorio | Página `/formulario/:token`: datos de contacto y el mismo cuestionario de anamnesis de la ficha. Lo enviado queda `respondido` y **no toca la ficha**: un rol clínico lo acepta (eligiendo contacto y/o anamnesis) o lo descarta desde la pestaña Anamnesis. Vale hasta la hora de la cita.                              |

Cada correo de cita lleva los botones "Confirmar asistencia" / "Cancelar o reagendar" hacia `/mi-cita/:token` (REC-11, página del frente A: `enlaceGestionCita` de `src/lib/reserva/enlace-cita.server.ts`, que se inyecta en `src/routes/api.patient-emails.ts`). Sin ese enlace el correo sale sin botones y dice "avísale a la clínica por el canal de siempre". Ningún correo lleva datos clínicos (ni el tratamiento): cuándo, con quién y dónde.

## Configuración (REC-07, REC-09)

`/notificaciones-a-pacientes` (Ajustes → Mensajería), solo owner/admin (`settings:manage`, igual que la RLS: `can_manage_clinic`). Tabla `patient_notification_settings`, una fila por clínica: **sin fila, todo apagado**. Un trigger fija `confirmation_enabled_at` y `nps_enabled_at` al encender (no se escribe por citas anteriores). La pantalla muestra el modo del correo de la clínica, el resumen NPS de 90 días, los envíos de 30 días, los últimos comentarios y WhatsApp automático deshabilitado con su motivo (`AccionDeshabilitada`).

## Frenos (`src/lib/notificaciones-pacientes/cron.server.ts`)

1. `PATIENT_EMAILS_ENABLED=true` en Vercel o el endpoint responde `{"habilitado":false}` sin tocar la base. **Hoy apagado**: encenderlo es decisión de Walter.
2. Configuración de la clínica (todo apagado por defecto) y ventana local 8:00-20:59 (`esVentanaDeCorreos`).
3. Nunca la clínica demo. Sin `EMAIL_UNSUBSCRIBE_SECRET` (sin baja firmable) no sale nada.
4. Baja del paciente (`email_opt_out_at`), ficha archivada o fusionada: no se le escribe. Sin correo, tampoco.
5. Destinatario: el paciente o, si es menor con tutor vigente, el tutor (`resolverDestinatario`, CLI-11).
6. Idempotencia: se reclama la fila en `patient_email_dispatches` (UNIQUE `appointment_id, kind, slot`) **antes** de crear links o enviar. Choca = no se envía. Un `error` se reintenta hasta 3 veces con un UPDATE condicional.
7. Modo de prueba de la clínica (`email_sandbox_config`): si bloquea, la fila queda `skipped` con el motivo y no se envía; si desvía, llega a la casilla de pruebas con el asunto prefijado (`redirected_to`).
8. Tope de 200 clínicas y 300 correos por corrida.

Cada correo lleva el enlace de baja del paciente (`correos_paciente`, el mismo de la Ola 4). Lo enviado queda también en `messages` (sin el cuerpo, que lleva links personales): la cola de `/recordatorios` ve que el recordatorio por correo ya salió y lo cuenta "Resultados del piloto".

## Programación

Vercel Cron llama a `GET /api/patient-emails` en el minuto 27 (`vercel.json`) y `.github/workflows/patient-emails.yml` repite en el minuto 57, los dos con `CRON_SECRET`. Log: `[patient-emails] revisadas=… enviados=… omitidos=… duplicados=… errores=…`. Límite conocido: el disparo es horario, así que un recordatorio de 2 h para una cita de las 8:00-8:30 no llega a salir (cae fuera de la ventana de la mañana).

## Archivos

| Archivo                                                                 | Qué es                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/lib/notificaciones-pacientes/reglas.ts`                            | Reglas puras: qué correo le toca a qué cita, configuración, resumen NPS |
| `src/lib/notificaciones-pacientes/plantillas.ts`                        | Las tres plantillas (confirmación, recordatorio, encuesta)              |
| `src/lib/notificaciones-pacientes/cron.server.ts`                       | La corrida y sus frenos                                                 |
| `src/lib/notificaciones-pacientes/*.functions.ts`                       | Configuración, formulario y encuesta (staff y páginas públicas)         |
| `src/routes/api.patient-emails.ts`                                      | Endpoint del cron                                                       |
| `src/routes/formulario.$token.tsx`, `src/routes/encuesta.$token.tsx`    | Páginas públicas (`noindex`)                                            |
| `supabase/migrations/20261028200000_*.sql`, `20261028200100_*.sql`      | Tablas, RLS y funciones de las páginas públicas (solo `service_role`)   |
| `tests/correos-pacientes.test.ts`, `tests/correos-pacientes-db.test.ts` | Tests puros y contra la base                                            |
