# Medición del embudo

Embudo de punta a punta medido con herramienta propia, **sin cookies y sin terceros** (lo promete `src/routes/privacidad.tsx`, sección 10). Origen: auditoría 360 del 18-oct-2026, hallazgos IA-14, IA-15, IA-16, MKT-02 y COM-06.

- Tabla: `public.marketing_events` (`name`, `props jsonb`, `session_hash`, `created_at`). RLS activa sin policies: solo `service_role` lee y escribe.
- Vocabulario: `src/lib/marketing/medicion.ts` (`EVENTOS_DEL_PLAN`) = CHECK `marketing_events_name_valido` (migración `20261019000000_medicion_embudo_eventos.sql`) = la tabla de abajo. `tests/medicion-embudo.test.ts` falla si se desalinean.
- Nunca va en un evento: IP, email, nombre, teléfono, id de usuario o de clínica, cifras de la clínica, URL completa de referencia.

## North Star

**Citas gestionadas por clínica activa por semana.**

- _Cita gestionada_: cita con `starts_at` en la semana (hora de la clínica) cuyo estado es `confirmada`, `en-sala`, `finalizada` o `ausente`; o sea, que la clínica llevó en Esmalia (no quedó `tentativa` ni se canceló).
- _Clínica activa_: no es demo (`clinics.is_demo = false`), tiene suscripción `trialing` o `active` y al menos una cita gestionada en la semana.
- Valor = citas gestionadas ÷ clínicas activas. Se mira junto al número de clínicas activas: el cociente solo no dice si el negocio crece.

Por qué esta: es el valor que se vende (sillas ocupadas y ausencias registradas) y solo sube si hay clínicas que usan la agenda de verdad. Métricas de entrada: visitas por canal, % de sesiones con lead, registros, activación en 72 h, checkouts y suscripciones.

## Tracking plan

Origen: **C** = navegador a `/api/ev` (anónimo). **A** = lo pide el navegador con sesión y lo valida y escribe el servidor (`eventos-cuenta.functions.ts`). **S** = solo servidor.

| Etapa      | Evento                  | Origen | Cuándo                                                                                                                         | Propiedades                                                                                                                                                                                                |
| ---------- | ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visita     | `page_view`             | C      | Cada cambio de ruta en una página pública de la lista blanca (`esRutaMedible`). Nunca app ni portal                            | `path`; en la primera vista de la pestaña además `entrada: true`, `ref_host` (dominio o `directo`), `utm_source`, `utm_medium`, `utm_campaign`; `pais` (lo agrega el servidor desde `x-vercel-ip-country`) |
| Interés    | `calculadora_vista`     | C      | Se abre la calculadora                                                                                                         | —                                                                                                                                                                                                          |
| Interés    | `calculadora_usada`     | C      | Se usa la calculadora                                                                                                          | `lugar`, buckets                                                                                                                                                                                           |
| Interés    | `cta_click`             | C      | Clic en un CTA                                                                                                                 | `cta`, `lugar`                                                                                                                                                                                             |
| Demo/lead  | `lead_enviado`          | C      | El formulario de captación respondió OK                                                                                        | `source`, `pais`                                                                                                                                                                                           |
| Demo/lead  | `lead_intento`          | S      | Cada intento que pasa el honeypot (alimenta el rate limit; no es conversión)                                                   | —                                                                                                                                                                                                          |
| Registro   | `registro_completado`   | A      | `SIGNED_IN` de una cuenta creada o confirmada hace ≤ 30 min (email, Google o enlace de confirmación)                           | `metodo` (`email`/`google`)                                                                                                                                                                                |
| Onboarding | `onboarding_completado` | S      | `completeClinicSetup` terminó                                                                                                  | `pais`, `profesionales`, `especialidades` (conteos)                                                                                                                                                        |
| Activación | `primera_cita_creada`   | S      | La clínica pasa de 0 a ≥ 1 cita (alta manual o importación)                                                                    | `origen` (`manual`/`importacion`), `horas_desde_alta`, `dentro_72h`                                                                                                                                        |
| Pago       | `checkout_iniciado`     | A      | Antes de redirigir a Stripe Checkout                                                                                           | `plan` (`solo`/`clinica`)                                                                                                                                                                                  |
| Pago       | `suscripcion_activada`  | A      | Vuelta de Stripe con `?checkout=success` y la fila de `subscriptions` ya tiene `stripe_subscription_id` en `trialing`/`active` | `estado`, `fuente: retorno_checkout`                                                                                                                                                                       |

Todas pueden llevar `interno: true` (ver abajo). `session_hash` une los eventos de una misma pestaña: así un registro se atribuye a la visita de entrada que lo trajo. Los eventos **S** van sin `session_hash`.

### Sesión, sin cookies

`session_hash` es un id aleatorio de 32 hex guardado en `sessionStorage` (`esmalia:ev-sesion`): dura lo que la pestaña, sobrevive a la vuelta de Google OAuth y de Stripe, y se borra al cerrarla. Mismo patrón que `plan-intent.ts`. No hay identificador persistente entre visitas.

### Tráfico interno (IA-15)

Se marca `props.interno = true` y las consultas lo excluyen:

- Usuarios cuyo email está en `ESMALIA_STAFF_EMAILS`, la cuenta demo (`demo@esmalia.com`) y dominios de prueba (`.invalid`, `.test`, `example.com`…), resuelto en el servidor (`esCorreoInterno`).
- Clínicas demo (`is_demo`).
- En el navegador: `?qa=1` en cualquier URL (dura la pestaña; `?qa=0` lo apaga), navegadores automatizados (`navigator.webdriver`, Playwright y agentes) y los equipos del staff: abrir `/admin/leads` o `/admin/clinicas` deja `esmalia:medicion-interna = 1` en el `localStorage` de ese equipo (un sí/no, sin identificador; nunca se escribe en el navegador de un visitante).

Los eventos anteriores a este cambio no tienen la marca: los del 07-oct y 09-oct son ruido conocido de auditorías (ver IA-15). Borrarlos queda a decisión de Walter.

### Pendiente

- **`suscripcion_activada` desde el webhook de Stripe** (fuente autoritativa). Hoy sale de la vuelta del checkout, validada contra `subscriptions`; si el usuario cierra la pestaña en Stripe no se cuenta. Se movió fuera de este cambio porque otro PR está modificando el webhook. Para el conteo real de suscripciones, usar `subscriptions` (consulta de la North Star).
- `ia_usada` y `clinica_semana_activa` (propuestos en la auditoría) no están implementados.

## Consultas

Semanas de lunes a domingo en hora de Chile. Correr con `psql` contra producción (solo lectura).

### Embudo semanal

```sql
with ev as (
  select date_trunc('week', created_at at time zone 'America/Santiago')::date as semana,
         name, session_hash, props
  from public.marketing_events
  where created_at >= now() - interval '12 weeks'
    and coalesce((props->>'interno')::boolean, false) = false
)
select
  semana,
  count(distinct session_hash) filter (where name = 'page_view')            as sesiones,
  count(*)                     filter (where name = 'page_view')            as paginas_vistas,
  count(distinct session_hash) filter (where name = 'cta_click')            as sesiones_con_cta,
  count(distinct session_hash) filter (where name = 'lead_enviado')         as sesiones_con_lead,
  count(*) filter (where name = 'registro_completado')                      as registros,
  count(*) filter (where name = 'onboarding_completado')                    as onboardings,
  count(*) filter (where name = 'primera_cita_creada')                      as activaciones,
  count(*) filter (where name = 'primera_cita_creada'
                     and (props->>'dentro_72h')::boolean)                   as activaciones_72h,
  count(*) filter (where name = 'checkout_iniciado')                        as checkouts,
  count(*) filter (where name = 'suscripcion_activada')                     as suscripciones
from ev
group by semana
order by semana desc;
```

Un lead es un contacto único: para contarlos, `marketing_leads` (`count(*)` por `created_at`), no los eventos `lead_enviado` (el mismo contacto puede reenviar el formulario).

### Canal de entrada → lead → registro (últimos 28 días)

```sql
with entradas as (
  select session_hash,
         coalesce(props->>'utm_source', props->>'ref_host', 'directo') as canal,
         props->>'utm_campaign' as campana
  from public.marketing_events
  where name = 'page_view'
    and (props->>'entrada')::boolean
    and coalesce((props->>'interno')::boolean, false) = false
    and created_at >= now() - interval '28 days'
)
select e.canal, e.campana,
       count(distinct e.session_hash) as sesiones,
       count(distinct l.session_hash) as con_lead,
       count(distinct r.session_hash) as con_registro
from entradas e
left join public.marketing_events l
  on l.session_hash = e.session_hash and l.name = 'lead_enviado'
left join public.marketing_events r
  on r.session_hash = e.session_hash and r.name = 'registro_completado'
group by e.canal, e.campana
order by sesiones desc;
```

### North Star

```sql
with citas as (
  select date_trunc('week', a.starts_at at time zone c.timezone)::date as semana,
         a.clinic_id,
         count(*) as gestionadas
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  join public.subscriptions s on s.clinic_id = c.id
  where not c.is_demo
    and s.status in ('trialing', 'active')
    and a.status in ('confirmada', 'en-sala', 'finalizada', 'ausente')
    and a.starts_at >= now() - interval '12 weeks'
    and a.starts_at < now()
  group by 1, 2
)
select semana,
       count(*)                                              as clinicas_activas,
       sum(gestionadas)                                      as citas_gestionadas,
       round(sum(gestionadas)::numeric / nullif(count(*), 0), 1) as citas_por_clinica_activa
from citas
group by semana
order by semana desc;
```

Límite: usa el estado **actual** de la suscripción (no hay historial de estados), así que una clínica que canceló desaparece también de las semanas pasadas. Las clínicas de prueba que no tienen `is_demo` (ver IA-13) hay que excluirlas a mano por id hasta que se marquen.
