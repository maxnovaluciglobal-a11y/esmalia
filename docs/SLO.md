# SLO de Esmalia: disponibilidad, RPO/RTO y presupuesto de error

**Versión:** 1 · 19-oct-2026 · **Dueño:** Walter · **Mide y reporta:** Claude · **Origen:** hallazgos OPS-14, OPS-04 y OPS-09 de la auditoría 360 del 18-oct-2026, ítem 48 del [ROADMAP](ROADMAP.md).

Es un **objetivo interno**, no un SLA. Los términos de servicio dicen que no hay un nivel de servicio formal, y eso se mantiene. Este número sirve para dos cosas: decidir cuándo se frenan las features para arreglar confiabilidad, y responder con datos "¿qué tan estable es?" en una venta. Un SLA contractual de 99,5 % para el plan Clínica recién se evalúa con **3 meses seguidos** de cumplimiento medido.

---

## 1. Qué se mide

| Qué                        | Cómo                                                                                                                                                                    | Dónde                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **SLI de disponibilidad**  | Monitor de uptime de Sentry que hace `GET https://esmalia.com/api/health` **cada 1 minuto** y avisa por correo                                                          | Sentry → Uptime (configurado el 10-oct-2026) |
| Qué responde `/api/health` | `200 {"status":"ok"}` si el proceso está vivo **y** la base responde (consulta de 1 fila a `clinics`). `503 {"status":"error"}` si la base no responde. No expone datos | `src/routes/api.health.ts`                   |
| **Minuto bueno**           | El check devolvió 2xx dentro del timeout del monitor                                                                                                                    | —                                            |
| **Minuto malo**            | El check devolvió algo distinto de 2xx (incluido el 503 de base caída), dio timeout o no hubo conexión                                                                  | —                                            |

**Ventana:** mes calendario en UTC. **Disponibilidad del mes** = minutos buenos ÷ minutos medidos.

**Lo que este SLI no ve** (límites conocidos, se aceptan por ahora):

- Fallas funcionales con el servidor sano: login roto, agenda que no guarda, el webhook de Stripe fallando. Las cubren Sentry (errores) y el runbook de incidentes (`04 - Esmalia/08 - Operaciones/runbook-incidentes.md`, fuera del repo).
- La disponibilidad del dominio `.vercel.app` original, que sigue como alias.
- Problemas de red de un país en particular: el monitor mira desde las regiones que use Sentry, no desde Chile.

> ⚠️ El monitor está registrado como configurado en el tablero (`PENDIENTES.md`, 10-oct), pero la auditoría no pudo confirmarlo por API porque no hay token de Sentry. Primera tarea de la revisión del 1-nov: abrir Sentry → Uptime, confirmar intervalo, destinatarios y umbral de alerta, y anotarlo acá.

## 2. Objetivos

| SLO                                  | Objetivo                                                                               | Presupuesto de error                                                                                                       | Estado hoy                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Disponibilidad de `/api/health`**  | **≥ 99,5 % mensual**                                                                   | 0,5 % del mes: **216 min** (3 h 36 min) en un mes de 30 días, **223 min** en uno de 31 y **201 min** en febrero de 28 días | Sin historial medido todavía. Primera medición: 1-nov-2026 (mes de octubre parcial, desde el 10-oct)                                      |
| Backup diario                        | 1 backup propio exitoso cada **≤ 26 h**, todos los días                                | 0 días sin backup                                                                                                          | Sin cumplir en horario: la corrida programada a las 07:15 UTC sale entre 4 y 9 h tarde (OPS-04). Hay backup todos los días                |
| Resumen diario a tiempo (secundario) | ≥ 99 % de los días-clínica con el resumen entregado entre las 8:00 y las 11:59 locales | 1 %                                                                                                                        | **No se cumple:** en Chile faltó 7 de 13 días (OPS-02). Se mide recién cuando haya clínicas externas y el disparo salga de GitHub Actions |

**Por qué 99,5 % y no más:** es lo que sostiene la infraestructura de hoy: una sola región de Vercel en plan Hobby, Supabase sin réplicas ni PITR y una sola persona de guardia. Prometer 99,9 % (43 min por mes) obligaría a tener guardia y alternativa probada, y no hay ninguna de las dos.

## 3. RPO y RTO reales

El **RPO** es cuántos datos se pueden perder. El **RTO** es cuánto tarda el servicio en volver. "Medido" quiere decir ensayado; "estimado" quiere decir que no se ensayó.

| Escenario                                                                     | RPO real                                                                                                 | RTO real                                                                                                                                                                  | Objetivo           | Cómo se recupera                                                                                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Base corrupta o borrada, con restauración del **snapshot diario de Supabase** | **≤ 24 h** (snapshot nativo a las ~08:20 UTC; sin PITR)                                                  | **Minutos (estimado, sin ensayar)**                                                                                                                                       | RPO 24 h · RTO 1 h | Dashboard de Supabase → Database → Backups → restaurar. Es el camino rápido y el runbook de DR todavía no lo pone primero (OPS-09) |
| Base corrupta o borrada, con restauración desde el **backup propio en B2**    | **≤ 33 h** (la corrida sale entre las 11:38 y las 16:45 UTC, no a las 07:15)                             | **Horas (estimado)**. La carga de datos se midió en **3 s** en un ensayo local (10-oct, 63 tablas, 0 huérfanos); recrear el proyecto, los usuarios y Storage no se ensayó | RPO 24 h · RTO 4 h | `docs/BACKUPS.md` + `scripts/restore-drill.sh`. Requiere la clave privada `age`                                                    |
| Deploy roto                                                                   | 0                                                                                                        | **~15 min** (rollback al deploy anterior en Vercel)                                                                                                                       | 15 min             | Vercel → Deployments → Promote / Instant Rollback                                                                                  |
| Vercel caído o **cuenta suspendida** (Hobby prohíbe el uso comercial)         | 0                                                                                                        | **Sin validar**: no hay alternativa probada (el Dockerfile y el VPS nunca se ensayaron para Esmalia)                                                                      | 4 h                | Hoy no hay camino probado. Lo resuelve D5 (Vercel Pro o Cloudflare) más un ensayo cronometrado                                     |
| Credenciales comprometidas                                                    | 0                                                                                                        | Sin validar                                                                                                                                                               | 1 h                | `DISASTER_RECOVERY.md`, escenario 3: rotar las claves y redeploy                                                                   |
| **Clave `age` perdida** (única copia en el iCloud de Walter)                  | Los backups de B2 quedan **ilegibles**. Solo queda el snapshot de Supabase (≤ 24 h, 7 días de retención) | —                                                                                                                                                                         | Que no pase        | Segunda copia fuera de iCloud, con prueba de descifrado (`08 - Operaciones/continuidad/`, ítem 30)                                 |

Cuando cambie la infraestructura (PITR, bucket dedicado, staging, Vercel Pro, disparos fuera de GitHub) o haya un ensayo nuevo, esta tabla se actualiza en el mismo PR.

## 4. Presupuesto de error: qué hacer al consumirlo

El presupuesto es de **216 minutos** en un mes de 30 días. Se consume con cada minuto malo, **incluidas las interrupciones planificadas**: si la clínica no puede entrar, cuenta igual.

| Consumo del mes                   | Qué se hace                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **< 50 %** (menos de ~108 min)    | Normal. Se sigue con el roadmap                                                                                                                                                                                                                                                                                                                                         |
| **≥ 50 %**                        | En la revisión del lunes se mira la causa de cada caída. Todo incidente de más de 15 min lleva un post-mortem corto en `docs/post-mortems/AAAA-MM-DD-<tema>.md` (qué pasó, impacto, causa, qué cambia). No se hacen deploys los viernes ni fuera de horario hasta fin de mes                                                                                            |
| **≥ 100 %** (presupuesto agotado) | **Se congelan las features hasta que termine el mes.** Solo entran arreglos de confiabilidad, seguridad y bugs que afecten a clínicas. Post-mortem obligatorio. Se avisa a las clínicas piloto afectadas con la plantilla del runbook. En la siguiente revisión se decide qué inversión adelantar: Vercel Pro (D5), staging (#28), protección de `main` (OPS-07) o PITR |
| **Agotado 2 meses seguidos**      | Decisión explícita en `DECISIONES.md`: o se invierte en infraestructura, o se baja el objetivo con el porqué. No se deja el número escrito si nadie lo cumple                                                                                                                                                                                                           |

**Alertas durante el mes** (además del aviso de Sentry en cada caída):

- **Caída de 5 min seguidos** = SEV1 del runbook: aviso a las clínicas dentro de los 30 min.
- **Más de 60 min acumulados en 24 h** (~28 % del presupuesto en un día): se pausan los deploys hasta entender la causa.

## 5. Cómo se reporta

El día 1 de cada mes, junto con la rutina de higiene del workspace:

1. Exportar de Sentry → Uptime los checks fallidos del mes anterior y sumar los minutos malos.
2. Agregar una fila a la tabla de abajo y el resumen a `00 - Gestion/ESTADO.md` (fuera del repo).
3. Si se consumió ≥ 50 %, enlazar los post-mortems.

| Mes                        | Minutos medidos | Minutos malos | Disponibilidad | Presupuesto consumido | Incidentes |
| -------------------------- | --------------- | ------------- | -------------- | --------------------- | ---------- |
| Oct-2026 (desde el 10-oct) | —               | —             | —              | —                     | —          |

## 6. Referencias

- [`DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md): pasos técnicos. Está desactualizado (OPS-09) y lo reemplaza la tabla de la sección 3 hasta que se reescriba.
- [`BACKUPS.md`](BACKUPS.md): backup diario, cifrado y ensayo de restauración.
- Runbook de incidentes y brechas: `04 - Esmalia/08 - Operaciones/runbook-incidentes.md` (fuera del repo).
