# Correos de ciclo de vida a la clínica

Esmalia le escribe a la **clínica** (propietarios y administradores) en cinco momentos. **Ningún proceso automático le escribe a pacientes**: los destinatarios salen de `clinic_members`, nunca de `patients`. Spec aprobada: `07 - Clientes y Ventas/2026-10-09-correos-ciclo-de-vida.md` (fuera del repo).

Están construidos y **encendidos en modo de prueba desde el 09-oct-2026** (`LIFECYCLE_EMAILS_ENABLED=true` + `LIFECYCLE_EMAIL_REDIRECT_TO`: todo llega a `maxnovaluciglobal@gmail.com` con el asunto `[PRUEBA → destinatario real]`). Activación y apagado paso a paso: `docs/DOMINIO_RUNBOOK.md`, paso 6b.

## Los cinco correos

| Correo                                       | `kind`                | Disparo                                                                                                                                                                                                          | A quién                                           | Clave de idempotencia (`period_key`)                                                             | ¿Baja?                                                 |
| -------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Bienvenida ("Tu clínica ya está en Esmalia") | `welcome`             | Al terminar `completeClinicSetup` (onboarding)                                                                                                                                                                   | Quien creó la clínica                             | `once`                                                                                           | No (transaccional)                                     |
| La prueba termina en 3 días                  | `trial_t3`            | Cron horario, ventana 8:00-11:59 local                                                                                                                                                                           | Propietarios                                      | fecha local de fin del trial                                                                     | No                                                     |
| La prueba termina hoy                        | `trial_t0`            | Cron horario, ventana 8:00-11:59 local                                                                                                                                                                           | Propietarios                                      | fecha local de fin del trial                                                                     | No                                                     |
| Suscripción activa                           | `subscription_active` | Webhook de Stripe, cuando la suscripción **pasa** a `active` (`checkout.session.completed` sin trial, `customer.subscription.created` activa, o `updated` con `previous_attributes.status` distinto de `active`) | Propietarios                                      | id de la suscripción de Stripe                                                                   | No                                                     |
| Pago fallido                                 | `payment_failed`      | Webhook `invoice.payment_failed`, si la suscripción sigue impaga                                                                                                                                                 | Propietarios                                      | id de la factura de Stripe (Stripe reintenta varias veces la misma factura: sale un solo correo) | No                                                     |
| Tu semana en la clínica                      | `weekly_report`       | Cron horario, lunes 8:00-11:59 local; reporta lunes a domingo anterior                                                                                                                                           | Propietarios y administradores con `finance:view` | el lunes de la semana reportada                                                                  | **Sí**: enlace visible + `List-Unsubscribe` de un clic |

Detalles que importan:

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

`.github/workflows/lifecycle-emails.yml` llama cada hora (minuto 17) a `GET /api/lifecycle-emails` con `Authorization: Bearer $CRON_SECRET`, igual que el resumen diario. Tope de 200 clínicas y 150 correos por corrida. La respuesta y el log (`[lifecycle-emails] revisadas=… enviados=…`) dejan rastro aunque no se envíe nada.

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
