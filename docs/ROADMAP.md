# Roadmap de Esmalia (19-oct-2026 al 18-ene-2027)

**Única fuente de "qué viene".** Reemplaza a [`archivo/PLAN_ACCION.md`](archivo/PLAN_ACCION.md) y a [`archivo/PLAN_EJECUCION_AUDITORIA_2026-08-26.md`](archivo/PLAN_EJECUCION_AUDITORIA_2026-08-26.md), que quedan como histórico. Lo que el producto hace hoy está en [`Esmalia_Documento_Maestro_v2.md`](Esmalia_Documento_Maestro_v2.md).

- **Origen:** plan de acción de la auditoría 360 total del 18-oct-2026, que tiene 51 actividades (fuera del repo: `04 - Esmalia/00 - Gestion/auditorias/2026-10-18-auditoria-360-total/PLAN-DE-ACCION.md`). Los números `#N` remiten a ese plan. Acá entran las actividades de producto, seguridad, operación y cumplimiento, y las comerciales que condicionan al producto.
- **Revisión:** cada lunes, 30 minutos (#16), y de fondo el 18-nov, el 18-dic y el 18-ene. Al cerrar o cambiar un ítem se actualiza esta tabla en el mismo PR que lo cierra.
- **Regla de coherencia:** todo lo que la web o `/llms.txt` prometen como "en el roadmap" o "en habilitación" tiene que estar en este archivo. Y al revés: si algo sale de esta lista, se saca también de esos textos.
- **Regla de orden:**
  1. Primero lo que expone datos de salud o hace falsa una promesa publicada.
  2. Después lo que destraba la primera venta.
  3. Al final, la paridad de producto.
     Con 0 clínicas externas, la restricción número uno es conseguir pilotos, no escribir código.

**Estados:** ✅ en producción · 🔄 en curso (PR abierto o por abrir, **no** en producción) · ⏳ pendiente · ⛔ bloqueado (dice por qué).

---

## Metas al 18-ene-2027

| Métrica                          | 18-nov | 18-dic | 18-ene     |
| -------------------------------- | ------ | ------ | ---------- |
| Clínicas contactadas (acumulado) | 300    | —      | —          |
| Demos 1 a 1                      | 10     | —      | 40         |
| Pilotos activos                  | 3-5    | —      | 10 activas |
| Clínicas pagando                 | —      | 1+     | 8          |
| MRR                              | —      | —      | ≥ US$400   |
| Testimonios con permiso escrito  | —      | 3-5    | 5          |

## Fase 0: esta semana (19 al 25-oct)

| #     | Qué                                                                                                                     | Dueño                       | Estado                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| 1     | Apagar Patty en producción (interruptor `AI_ENABLED`). Los términos de Gemini prohíben el uso clínico incluso pagando   | Walter decide (D3) / Claude | ✅ 19-oct (#70)                                             |
| 2     | Repo de GitHub a privado, después de verificar el deploy y los minutos de Actions                                       | Walter / Claude             | ⏳ decisión D4                                              |
| 3     | Rotar la contraseña de la cuenta dueña de la clínica piloto y borrar la tabla de contraseñas de la memoria              | Walter / Claude             | ⏳                                                          |
| 4     | Numverify por HTTPS y sin la clave en la URL                                                                            | Claude                      | ✅ #66. Falta declararlo en privacidad y DPA o reemplazarlo |
| 5     | Webhook de Stripe: `livemode`, errores de escritura y tolerancia de renovación                                          | Claude                      | ✅ #69                                                      |
| 6     | `.env` local con las claves de prueba de la cuenta Stripe de Esmalia                                                    | Walter                      | ⏳                                                          |
| 7     | Calendly con nombre de Esmalia                                                                                          | Walter / Claude             | ⏳                                                          |
| 8     | Copys alineados con el producto (sin "automático", sin exportación inexistente, 4 pasos de onboarding, periodontograma) | Claude                      | ✅ #64                                                      |
| 9     | Teléfonos por país (E.164) para WhatsApp                                                                                | Claude                      | ✅ #66                                                      |
| 10    | Dominios defensivos `esmalia.app`, `.cl`, `.mx` y `.com.ar` con 301                                                     | Walter / Claude             | ⏳                                                          |
| 11    | Decisión de foco (D1) y país de entrada (D2, recomendado Chile)                                                         | Walter                      | ⏳                                                          |
| 12-14 | Kit de piloto, CRM y lista de 50 clínicas de Santiago                                                                   | Claude                      | ✅ fuera del repo (`07 - Clientes y Ventas/kit-piloto/`)    |
| 15    | Recontactar a la clínica piloto de julio con la oferta fundadora                                                        | Walter                      | ⏳                                                          |
| 16    | Metas y revisión semanal de los lunes                                                                                   | Walter / Claude             | ⏳                                                          |

## Fase 1: 30 días (al 18-nov). Primeros pilotos y bases de confianza

| #   | Qué                                                                                                                                                            | Dueño                       | Estado                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 17  | 300 contactos, 10 demos y 3-5 pilotos firmados                                                                                                                 | Walter + Claude             | ⏳ desde el 20-oct                                                                                                   |
| 19  | `/nosotros` con historia real y sección "Clínicas fundadoras"                                                                                                  | Claude                      | ⏳                                                                                                                   |
| 20  | Exportación completa de la clínica (ZIP)                                                                                                                       | Claude                      | ✅ #67                                                                                                               |
| 21  | Archivar pacientes en vez de borrarlos y quitar las cascadas hacia datos clínicos                                                                              | Claude                      | 🔄 integridad clínica, migración `20261019150000` (requiere OK)                                                      |
| 22  | Pago fallido no bloquea la ficha: gracia de 7 días, sin suscripciones duplicadas                                                                               | Claude                      | ✅ #69. Falta el modo solo lectura completo y que las disputas congelen la cuenta (🔄 billing y WhatsApp pendientes) |
| 23  | Baja de WhatsApp efectiva en recordatorios                                                                                                                     | Claude                      | ✅ #66. Falta bloquear en el servidor el envío a pacientes dados de baja (🔄)                                        |
| 24  | **Recordatorios automáticos de WhatsApp.** Hoy se promete "en habilitación". Con Meta: plantilla 24 h antes con confirmación. Sin Meta: cola diaria de un clic | Walter decide (D6) / Claude | ⛔ app de Meta (Walter)                                                                                              |
| 25  | Integridad clínica: alergias al fusionar, adenda en vez de reabrir notas firmadas, firma con nombre y matrícula                                                | Claude                      | 🔄 integridad clínica                                                                                                |
| 26  | Recorrido visual de la app autenticada antes de la primera demo                                                                                                | Claude                      | ⏳ requiere OK para usar `/demo`                                                                                     |
| 27  | MFA TOTP: obligatorio para el staff de `/admin`, recomendado para owners                                                                                       | Claude                      | ✅ #65                                                                                                               |
| 27b | Policy RLS que exija `aal2` a quien tiene MFA (hoy el MFA protege la interfaz, no la API)                                                                      | Claude                      | 🔄 migración `20261019200000`                                                                                        |
| 28  | Tests fuera de producción, freno si el host es prod y limpieza de perfiles de prueba                                                                           | Claude                      | 🔄 rama `ci/tests-sin-produccion`. El borrado requiere OK (D10)                                                      |
| 29  | Vercel Hobby prohíbe el uso comercial: pasar a Pro (US$20/mes) o migrar a Cloudflare                                                                           | Walter decide (D5) / Claude | ⏳ antes del primer cobro                                                                                            |
| 30  | Continuidad: inventario de cuentas, segunda copia de la clave `age` y contacto de emergencia                                                                   | Walter                      | 🔄 plantillas listas en `08 - Operaciones/continuidad/`                                                              |
| 31  | Correo de privacidad y soporte en Google Workspace                                                                                                             | Walter                      | ⏳                                                                                                                   |
| 32  | Abogado en Chile: revisión de privacidad v3, términos v2 y DPA v1 con el inventario real de subencargados                                                      | Walter / Claude             | ⏳                                                                                                                   |
| 33  | Marca "Esmalia": búsqueda formal y solicitud en INAPI (clases 9, 42 y 44)                                                                                      | Walter                      | ⏳                                                                                                                   |
| 34  | Odontólogo revisor: valida el modelo clínico y firma las 5 guías en borrador                                                                                   | Walter                      | ⏳                                                                                                                   |
| 35  | Embudo medible sin cookies con UTM y eventos de registro, activación, checkout y pago                                                                          | Claude                      | ✅ #68. Falta `suscripcion_activada` desde el webhook                                                                |
| 36  | Entidad de marca: LinkedIn, Instagram, YouTube, `SAME_AS` y Wikidata                                                                                           | Walter / Claude             | ⏳                                                                                                                   |

## Fase 2: 60 días (al 18-dic). Ley 21.719 y pricing real

| #   | Qué                                                                                                                                                                                                                  | Dueño                       | Estado                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| 37  | **Cifrado del documento de identidad** con backfill y alerta si queda NULL; evaluar `phone` y `birth_date`. Plazo legal: **1-dic-2026** (meta interna, 1-nov)                                                        | Claude                      | 🔄 migración `20261019160000` (requiere OK, D9)                                 |
| 38  | Registro de lecturas de ficha (quién vio qué y cuándo) con vista para el owner                                                                                                                                       | Claude                      | 🔄 mismo PR que el 37                                                           |
| 39  | Transferencias internacionales (cláusulas tipo de Chile) y evaluación de impacto de datos de salud                                                                                                                   | Abogado + Claude            | ⏳ depende del 32                                                               |
| 40  | Modelo clínico para el piloto: odontograma con varias condiciones y estado, anamnesis estructurada, tutor del menor, plantillas de consentimiento y recetas                                                          | Claude                      | 🔄 migraciones `…170000`, `…180000` y `…190000`. Validación con el revisor (34) |
| 41  | Pricing Chile en CLP: anual con 2 meses gratis, fundador con cupo y fecha, profesional extra, puesta en marcha pagada y planes que **sí** limitan                                                                    | Walter decide (D7) / Claude | ⏳ después de 10 entrevistas                                                    |
| 42  | Fiscal: matriz de IVA a servicios digitales (Chile primero), Stripe Tax y RUT en el checkout                                                                                                                         | Walter (contador) / Claude  | ⏳ depende del 41                                                               |
| 43  | Directorios (Capterra, G2, ComparaSoftware) con las primeras reseñas                                                                                                                                                 | Walter + Claude             | ⏳ depende del 17                                                               |
| 44  | Patty con un proveedor apto para uso clínico (Vertex AI con DPA u otro), datos minimizados, evals y rótulo "generado por IA". Habilita también la **lectura de pedidos de hora por WhatsApp**, hoy "en habilitación" | Claude                      | ⏳ depende del 32                                                               |

## Fase 3: 90 días (al 18-ene-2027). 10 clínicas activas y 8 pagando

| #   | Qué                                                                                                       | Dueño                         | Estado                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| 45  | 20 registradas, 10 activas, 8 pagando, 5 testimonios y MRR ≥ US$400                                       | Walter + Claude               | ⏳                                                                                                  |
| 46  | Search Console y medición GEO mensual; comparativas de Medilink y Dentidesk                               | Claude                        | ⏳                                                                                                  |
| 47  | Documentos al día: Documento Maestro v2, este ROADMAP como fuente única, planes viejos archivados         | Claude                        | ✅ este PR                                                                                          |
| 48  | Operación: status page pública, SLO de disponibilidad, runbook de incidentes y de notificación de brechas | Claude                        | ✅ SLO ([`SLO.md`](SLO.md)) y runbook (`08 - Operaciones/`). ⏳ status page en `status.esmalia.com` |
| 49  | Presupuesto y P&L, registro de riesgos y data room básico                                                 | Claude arma / Walter completa | ✅ plantillas el 19-oct (fuera del repo). Faltan los montos                                         |
| 50  | Seguro de ciberriesgo y E&O cotizado                                                                      | Walter                        | ⏳                                                                                                  |
| 51  | Prototipos de `/funciones` y Caja/Cierre del día (benchmark de 21st.dev)                                  | Claude                        | ⏳ requiere OK                                                                                      |

## Operación técnica (hallazgos de infraestructura sin número en el plan)

| Qué                                                                                    | Hallazgo          | Estado                   |
| -------------------------------------------------------------------------------------- | ----------------- | ------------------------ |
| Sacar los disparos horarios de GitHub Actions (pg_cron + pg_net o Cloudflare Cron)     | OPS-02            | ⏳                       |
| Dead-man switch para backup y crons (Sentry Cron Monitors)                             | OPS-08            | ⏳                       |
| Proteger `main` con CI obligatorio                                                     | OPS-07            | ⏳ depende del 28        |
| Bucket B2 dedicado con Object Lock y clave sin permiso de borrar                       | OPS-11            | ⏳ Walter crea el bucket |
| Reescribir `DISASTER_RECOVERY.md` (snapshot de Supabase primero) y sacar el IP del VPS | OPS-09            | ⏳                       |
| DMARC a `p=quarantine`                                                                 | OPS-19            | ⏳ desde el 23-oct       |
| Borrar `src/lib/compat/nombres-anteriores.ts`                                          | DECISIONES 11-oct | ⏳ desde el 12-nov       |

## Sin fecha comprometida

| Tema                                                                                            | Decidido            | Notas                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facturación electrónica (SII Chile, SUNAT Perú, SAT México, DIAN Colombia, AFIP/ARCA Argentina) | 07-oct-2026, Walter | La web la anuncia "en el roadmap, sin fecha". En Chile el dentista independiente emite boleta de honorarios gratis en el SII, así que no bloquea el beachhead. Para el segundo país, un proveedor (Alegra o Facturama) antes de entrar, no una integración propia (MER-08) |
| Número propio de WhatsApp conectado a Meta                                                      | 12-oct-2026, Walter | Código listo (#63). "En habilitación" en la web. ⛔ App de Meta y verificación del negocio (Walter). Habilita el ítem 24                                                                                                                                                   |

## Decisiones pendientes de Walter

| #   | Decisión                                                                              | Recomendación                                              | Bloquea           |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------- |
| D1  | Lugar de Esmalia entre los 8 proyectos hasta el 31-dic y horas por semana para vender | Foco 1 o compartido, con 2 bloques fijos de 2 h por semana | Todo lo comercial |
| D2  | País de entrada                                                                       | Chile                                                      | 14, 41, 42        |
| D3  | Apagar Patty                                                                          | Sí, hoy                                                    | 1, 44             |
| D4  | Repo a privado                                                                        | Sí, después del chequeo de deploy y minutos                | 2                 |
| D5  | Vercel Pro o Cloudflare                                                               | Decidir antes del primer cobro                             | 29                |
| D6  | Recordatorios automáticos                                                             | Sí                                                         | 24                |
| D7  | Pricing en CLP                                                                        | Propuesta de `hallazgos/08`, a validar                     | 41                |
| D8  | Tope de gasto mensual                                                                 | Fijar un número (hoy ~US$16-26 directo)                    | 29, 32, 34        |
| D9  | Fecha de corte del cifrado y OK de migración                                          | Meta interna 1-nov, plazo legal 1-dic                      | 37                |
| D10 | Borrar perfiles de prueba, clínicas duplicadas y ramas mergeadas                      | Sí                                                         | 28                |

## Lo que NO se hace en estos 90 días

Ads pagos en Meta, stands en congresos, más páginas SEO a volumen, factura electrónica propia, multisede, marketplace de laboratorios, pagos integrados para pacientes, IA de imágenes, expansión comercial a MX, CO, PE o AR (solo SEO) y Perú antes de tener 20 clínicas pagando en Chile.
