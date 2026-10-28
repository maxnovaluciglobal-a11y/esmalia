# Setup de Stripe — Esmalia

## Cuenta propia de Esmalia (decidido 10-oct-2026)

Hasta oct-2026 Esmalia cobraba desde la cuenta de Stripe que comparte con DypOS (entidad legal MAXNOVA & LUCI Global LLC, nombre público "DypOS"), así que el Checkout de una clínica decía "DypOS". La separación:

| Cuenta en la organización Stripe de la LLC          | Uso                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| Cuenta actual (nombre público "DypOS", con Connect) | **Solo DypOS** (y el histórico de Invest/FinanceOS). No se toca. |
| **Esmalia** (nueva)                                 | Suscripciones de Esmalia                                         |
| MOY IQ (ya existía)                                 | MOY IQ                                                           |

**Pasos (Walter, en el dashboard; ~20 min + la revisión de Stripe):**

1. Selector de cuentas (arriba a la izquierda) → **New account** → nombre "Esmalia", país Estados Unidos, la misma LLC. Si ofrece copiar los datos de la cuenta actual, aceptar.
2. Activar la cuenta: datos de la empresa (EIN de la LLC), representante, cuenta bancaria para los pagos. Datos públicos:
   - Public business name: **Esmalia**; website `https://esmalia.com`; soporte `soporte@esmalia.com`, URL `https://esmalia.com/docs`.
   - Statement descriptor: **ESMALIA** (shortened: ESMALIA).
   - Branding (Settings → Branding): ícono y logo de `public/brand/` (monograma E), color principal `#7d5411`, color de acento `#f3f2f2`.
3. Developers → API keys (modo live) → copiar la **secret key** y correr, desde el repo:
   ```bash
   read -s STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY && node scripts/stripe-setup-esmalia.mjs --vercel
   ```
   Crea los productos (Solo US$19,99, Clínica US$49,99, mensuales), el portal de facturación y el webhook `https://esmalia.com/api/stripe/webhook`, y carga en Vercel los 4 IDs de precio y el signing secret (sin mostrarlo). Es idempotente.
4. En Vercel (production) reemplazar a mano `STRIPE_SECRET_KEY` (la misma secret key) y `VITE_STRIPE_PUBLISHABLE_KEY` (pk_live de la cuenta nueva). Redeploy.
5. Verificar: entrar a `/suscripcion` con una cuenta de prueba, abrir el Checkout (tiene que decir **Esmalia**), y en el dashboard → Webhooks ver el evento entregado. No completar un pago real si no hace falta: el trial de 14 días deja el checkout en $0.
6. En la cuenta vieja (DypOS): archivar los productos viejos de Esmalia y **deshabilitar** (no borrar) el webhook el dominio `.vercel.app` original, después de confirmar que no hay suscripciones activas de Esmalia ahí. Si las hay, se dejan hasta que venzan o se migran con el soporte de Stripe.

Los `stripe_customer_id` guardados en `subscriptions` son de la cuenta vieja: un cliente que ya pagó allá no existe en la nueva. Hoy no hay clínicas pagando, así que no hace falta migrar nada.

## ⚠️ Corrección 2026-09-01 (auditoría externa) — la línea de abajo estaba mal

Esta línea decía "Live conectado y verificado" y "las 4 env vars están en Vercel
producción" — verificado en vivo, **ninguna de las dos cosas era cierta hasta
hoy**: `STRIPE_SECRET_KEY` de Vercel producción sigue siendo de **test**
(`sk_test_...`), y solo 1 de las 4 env vars de price ID estaba cargada
(`STRIPE_PRICE_ID_CLINIC_MONTHLY`) — faltaban las otras 3, así que el checkout
del plan Solo tiraba error de servidor. Además **no existía ningún webhook
endpoint de Esmalia en el dashboard de Stripe** (el único configurado en toda la
cuenta era el de GastroCore360) — el `STRIPE_WEBHOOK_SECRET` que había en
Vercel no correspondía a nada real.

**Arreglado hoy (todo en modo TEST, nada en Live todavía):** las 3 env vars de
price ID que faltaban se cargaron con los price IDs reales que ya existían en
Stripe test (`price_1U7EiDRxn4y6AU3rmyBTh8AZ` Solo, `price_1U7EiDRxn4y6AU3reNFlzGSo`
Clínica); se creó el webhook endpoint real (`we_1UAprHRxn4y6AU3r4BNjvOY9`) apuntando
a el dominio `.vercel.app` original con los 5 eventos que el
código maneja, y `STRIPE_WEBHOOK_SECRET` en Vercel se reemplazó por el signing
secret real de ese endpoint nuevo.

**Sigue pendiente, de verdad esta vez:** repetir producto+precios+webhook en
modo **Live** cuando se quiera cobrar de verdad (pasos 2 y 4 de abajo, en el
toggle Live del dashboard) — hoy todo lo que funciona es test-mode, cero
capacidad de cobro real todavía.

---

Test configurado y verificado en vivo (01-sep-2026, ver corrección arriba). Live NO está configurado todavía. Este doc queda como referencia de cómo se hizo y para cuando se quiera pasar a Live.

## Pricing decidido (actualizado 27-oct-2026)

**Vigente (decisión de Walter, 27-oct-2026):** Solo **US$19,99/mes** y Clínica **US$49,99/mes** (hasta 3 profesionales), en USD para todos los países. Precio fundador: 50 % durante 12 meses = US$9,99 y US$24,99 (cupón `FUNDADOR50`, 50 % por 12 meses). Los precios de abajo (US$29/US$69) quedan como historia.

**Cómo pasar a los precios nuevos sin romper nada** (no hay suscripciones pagando hoy):

1. En la cuenta Esmalia (`acct_1UOxuTRqTMSzyMrr`), en los productos existentes, crear un precio mensual recurrente en USD de **19,99** (Solo) y otro de **49,99** (Clínica), con la clave de búsqueda (`lookup_key`) `esmalia_solo_monthly_1999` / `esmalia_clinic_monthly_4999` y el metadata `plan=solo` / `plan=clinica`. Los precios viejos NO se borran: se archivan cuando no haya suscripciones en ellos.
2. Cargar los IDs en Vercel (Production): `STRIPE_PRICE_ID_SOLO_MONTHLY` y `STRIPE_PRICE_ID_CLINIC_MONTHLY` (y las `VITE_…` equivalentes que usa la pantalla Suscripción) y redeployar.
3. Crear el cupón `FUNDADOR50`: 50 % de descuento, duración 12 meses (`duration=repeating`, `duration_in_months=12`).
   El plan de cada suscripción se guarda en `subscriptions.plan` (lo escribe el webhook desde el metadata del checkout), así que el cupo de almacenamiento y la pantalla Suscripción no dependen del ID del precio.

## Pricing anterior (2026-08-22)

- **Modelo**: dos tiers de fundador, no un flat único (reemplaza el US$49 flat original).
  - **Solo** — US$29/mes (regular US$49, tachado en la UI como promocional) — 1 profesional/sillón.
  - **Clínica** — US$69/mes (regular US$99, tachado) — hasta 3 profesionales/sillones.
  - Arriba de 3 sillones: sin SKU todavía (`pricing-4` de la auditoría, add-on por profesional extra queda diferido).
- **Precio viejo US$49 flat**: archivado en Stripe (`active=false`, ya no se ofrece en checkouts nuevos), pero cualquier suscripción existente con ese price sigue funcionando sin cambios — Stripe no migra suscripciones activas al archivar un price.
- **Trial**: 14 días (`billing.functions.ts`, `subscription_data.trial_period_days`).
- **Moneda**: **USD** para el cobro real. La UI muestra una conversión aproximada a CLP/MXN/COP solo informativa (`src/lib/pricing-display.ts`), nunca cambia el monto cobrado.
- **Ciclo anual**: no implementado — diferido hasta la primera renovación real (`pricing-5` de la auditoría).

## 1. Cuenta Stripe

**Ya existe** — es la misma cuenta de Maxnova & Luci LLC que ya procesa otros productos (GastroCore360). Esmalia es un producto nuevo dentro de esa cuenta, no una cuenta separada. No hay que registrar nada nuevo ni repetir KYC.

## 2. Crear producto y precio (dentro de la cuenta existente)

En el dashboard de Stripe, **empezar en modo Test** (toggle arriba a la derecha) para probar el flujo completo antes de tocar Live:

1. Products → el producto "Esmalia Clínica" ya existe (`prod_V5QKNBePgv0Gdm` en test) — no crear uno nuevo, se reusa para los dos precios.
2. Add price → **Recurring / Monthly / USD / $29.00** (nickname "Esmalia Solo (fundador)", metadata `plan=solo`). Repetir con **$69.00** (nickname "Esmalia Clínica (fundador)", metadata `plan=clinica`).
3. Copiar cada **Price ID** — van a `STRIPE_PRICE_ID_SOLO_MONTHLY` y `STRIPE_PRICE_ID_CLINIC_MONTHLY` respectivamente (y sus gemelas `VITE_` para que el cliente muestre el plan activo).
4. El price viejo de $49 (default price anterior del producto) ya está archivado (`active=false`) en test — si existe un equivalente en Live, archivarlo ahí también recién cuando los dos nuevos estén verificados.
5. Opcional pero recomendado: en el producto, setear un **statement descriptor suffix** (ej. "ESMALIA") para que el cargo en el resumen de tarjeta de la clínica diga algo distinguible de GastroCore, ya que comparten la misma cuenta/entidad.
6. Repetir los pasos 1-3 en **modo Live** cuando el flujo de test ya esté verificado end-to-end y quieras empezar a cobrar de verdad con los tiers nuevos.

## 3. Configurar env vars

**En `.env` local** (para dev) y **en Vercel Env Vars** (para producción):

```
STRIPE_SECRET_KEY=sk_test_...      # o sk_live_ en producción
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...    # se obtiene en el paso 4
STRIPE_PRICE_ID_SOLO_MONTHLY=price_...
STRIPE_PRICE_ID_CLINIC_MONTHLY=price_...
VITE_STRIPE_PRICE_ID_SOLO_MONTHLY=price_...      # mismo valor que arriba
VITE_STRIPE_PRICE_ID_CLINIC_MONTHLY=price_...    # mismo valor que arriba
```

⚠️ **Solo las variables `VITE_*` se exponen al navegador** (las `VITE_STRIPE_PRICE_ID_*` son intencional — son IDs de price, no secretos, y el cliente las necesita para mostrar qué plan está activo sin pedirle nada al server). `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, y las versiones sin `VITE_` de los price IDs son server-only.

## 4. Configurar webhook

⚠️ **Cuenta compartida con GastroCore360**: este webhook tiene que ser un endpoint **nuevo y separado** del que ya existe para GastroCore — cada uno con su propio signing secret. No reutilizar el `STRIPE_WEBHOOK_SECRET` de otro proyecto acá.

En el dashboard de Stripe → Developers → Webhooks (en el mismo modo, Test o Live, en el que creaste el producto):

1. Add endpoint → URL: el dominio `.vercel.app` original (se mantiene después del dominio propio `esmalia.com`: el alias no redirige `/api/*`) (proyecto Vercel real, `prj_2qH7NKthOoML1ZsCKLbKDV8rzan2`) — no hace falta esperar al dominio `esmalia.com`, se puede migrar el endpoint el día que exista.
2. Eventos a escuchar:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`
   - `customer.subscription.trial_will_end`
3. Copiar el **Signing secret** (`whsec_...`) a `STRIPE_WEBHOOK_SECRET`.

Para dev local: usar `stripe listen --forward-to localhost:8080/api/stripe/webhook` (Stripe CLI) — esto genera su propio `whsec_...` de test, distinto al del endpoint de producción.

### Reembolsos y disputas (19-oct-2026)

Qué hace el webhook (`src/lib/stripe-webhook.server.ts`):

| Evento                                                      | Qué pasa                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `charge.refunded` con el cobro **reembolsado por completo** | Cancela la suscripción **en Stripe** (de inmediato, sin prorrateo, clave de idempotencia `cancelar-reembolso-total-<cobro>`), guarda el estado que devuelve Stripe y avisa al staff. Un reembolso parcial no toca nada. |
| `charge.dispute.created`                                    | Marca la suscripción (`disputed_at`, `dispute_id`) y avisa al staff con la fecha límite de evidencia. **No** cambia el acceso ni el cobro.                                                                              |
| `charge.dispute.closed`                                     | Quita la marca. Si la disputa se **perdió** (`lost`), además cancela la suscripción en Stripe como en el reembolso total (clave `cancelar-disputa-perdida-<disputa>`).                                                  |

La suscripción que se cancela es la **del cobro** (cobro → factura vía InvoicePayments → suscripción). Si no se puede leer, se usa la de la fila de la clínica y el aviso al staff pide confirmarla. Si el cobro era de otra suscripción (una duplicada), la fila de la clínica no se toca. Cancelar no bloquea nada: con `canceled` se pausan los informes; agenda, pacientes y ficha siguen abiertos.

**Decisión pendiente de Walter: pausar el cobro durante una disputa abierta.** BIL-02 recomienda `pause_collection` mientras la disputa está abierta. **No está implementado a propósito**: es una decisión comercial (¿se le sigue cobrando a quien disputa?) y una suscripción con el cobro pausado no se reanuda sola, alguien tiene que acordarse de reanudarla al cerrar la disputa. Hoy, durante la disputa la clínica sigue cobrándose normalmente; si la disputa se pierde, la suscripción se cancela. Si se decide pausar, es una llamada a `subscriptions.update(id, { pause_collection: { behavior: "void" } })` en `charge.dispute.created` y otra que la quite en `charge.dispute.closed` (cuando se gana).

Permisos de la clave restringida (`rk_live_...`): además de los de arriba, este flujo lee **Charges** y **Invoices** (InvoicePayments) y escribe **Subscriptions** (cancelar). Si falta la lectura de InvoicePayments, el webhook cae a la suscripción de la fila y lo reporta a Sentry.

## 5. Verificar

- En `/suscripcion` (ya existe): elige un plan (Solo/Clínica) y el botón "Activar suscripción · US$19,99/mes" (o el que corresponda) llama `createCheckoutSession` con ese `plan` → redirige a Stripe.
- Completar el checkout con tarjeta de test `4242 4242 4242 4242`.
- Verificar en la DB: `SELECT * FROM subscriptions WHERE clinic_id = ...` — debe aparecer con `status = trialing` y `trial_end` a 14 días.
- Verificar en la DB: `SELECT * FROM stripe_events ORDER BY received_at DESC` — el evento debe estar registrado y con `processed_at` no nulo.
- Botón "Gestionar facturación" en la misma página → debe abrir el portal de Stripe.

## Rotación de keys (cuenta compartida con GastroCore)

`STRIPE_SECRET_KEY` en Live es una **restricted key** (`rk_live_...`), no la key por defecto de la cuenta — se creó así a propósito para no tocar la key que ya usa GastroCore para cobrar. Permisos: Checkout Sessions (Write), Subscriptions (Write), Customers (Write), Billing Portal (Write), Invoices (Read). Si hay que rotarla, crear una restricted key nueva con los mismos permisos — nunca usar "Roll key" sobre la key default de la cuenta.

## Dónde vive cada cosa

- **`.env` local**: valores de **Test mode** — para desarrollar sin tocar Live.
- **Vercel env vars (producción)**: valores de **Live mode** — cargadas 2026-08-16, confirmadas con `vercel env ls`.

## Estado del código

Ya no falta nada de código — esto quedó completo en Wave B y sesiones posteriores: `/suscripcion` (UI completa: estado, días de trial, activar/reactivar, portal de facturación), el gate de suscripción en `_authenticated/_clinic/route.tsx`, y el webhook con los 5 eventos. Lo único pendiente es esta configuración de cuenta.

## Schema aplicado

Migración `20260814120000_*.sql` ya en el Supabase real:

- `subscriptions` — 1 fila por clínica, espejo del estado Stripe. RLS: miembros leen la de su clínica; solo el webhook escribe (service_role).
- `stripe_events` — ledger idempotente. Sin policy: nadie desde authenticated. Solo service_role via webhook.
  - **Reclamo atómico (28-oct-2026):** antes de aplicar un evento, el webhook lo reclama con la RPC `claim_stripe_event` (`INSERT … ON CONFLICT`, migración `20261117100000`). Devuelve `claimed` (esta entrega lo aplica y después marca `processed_at`), `duplicate` (ya procesado: 200 `ok (dup)`) o `in_progress` (otra entrega lo tiene: 409, Stripe reintenta). Si aplicar falla, se borra el reclamo sin marcar y se responde 500; si la función se corta, el reclamo vence a los 300 s (`LEASE_RECLAMO_EVENTO_SEGUNDOS`). Antes la marca iba después de aplicar y dos entregas simultáneas aplicaban dos veces. Tests: `tests/stripe-webhook-concurrencia.test.ts` (base falsa) y `tests/stripe-claim-db.test.ts` (Postgres real con conexiones concurrentes).
  - **Orden de despliegue:** aplicar la migración ANTES de mergear el código; si el código llega primero el webhook responde 500 hasta que se aplique.
  - Cómo ver un evento colgado: `select id, type, claimed_at, processed_at from stripe_events where processed_at is null;` (un reclamo sin marcar con más de 5 min es una entrega que se cortó; el próximo reintento de Stripe lo retoma solo).
- `has_active_subscription(clinic_id)` — helper SECURITY DEFINER para el gate.
