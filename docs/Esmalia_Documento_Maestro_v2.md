# Esmalia — Documento maestro v2

**Versión:** 2.0 · **Fecha de corte:** 19-oct-2026 · **Reemplaza a:** [`archivo/Esmalia_Documento_Maestro_v1.md`](archivo/Esmalia_Documento_Maestro_v1.md) (13-ago-2026, visión del prototipo, no vigente) · **Próxima revisión:** 18-nov-2026 o cuando entre la primera clínica piloto, lo que pase primero.

Este documento describe **lo que Esmalia es y hace hoy**, verificado contra el código de `main` y contra producción. No describe intenciones. Lo que viene está en una sola fuente: [`ROADMAP.md`](ROADMAP.md). Las metas de disponibilidad están en [`SLO.md`](SLO.md).

Fuente de la verificación: auditoría 360 total del 18-oct-2026 (14 dimensiones + 2 verificaciones adversariales, fuera del repo en `04 - Esmalia/00 - Gestion/auditorias/2026-10-18-auditoria-360-total/`) y los PRs #64 a #69, mergeados el 19-oct.

---

## 1. En una página

- **Qué es:** software de gestión para consultorios y clínicas dentales chicas de Latinoamérica: agenda, ficha clínica con odontograma, presupuestos, cobros y recordatorios por WhatsApp. Funciona en el navegador. Lo opera MAXNOVA & LUCI Global LLC (Estados Unidos) y lo construye su fundador, Walter La Madriz.
- **Estado del producto:** en producción en `https://esmalia.com` desde el 09-oct-2026. Técnicamente sano: CI en verde, backups diarios cifrados, RLS en las 64 tablas y Sentry activo.
- **Estado comercial: cero.** 0 clínicas externas, 0 leads externos, US$0 de ingresos. Las 6 clínicas de la base de producción son la demo, 4 duplicadas de prueba y 1 piloto de julio, dormida desde el 26-ago.
- **Restricción número uno:** conseguir las primeras clínicas piloto, no escribir más código. El kit de piloto y una lista de 50 clínicas de Santiago están listos (fuera del repo, `07 - Clientes y Ventas/kit-piloto/`). Los primeros contactos están programados desde el 20-oct.
- **Madurez promedio de la auditoría 360:** 2,0 de 5. El producto está más avanzado que el negocio.

## 2. Para quién

- **Hoy en la web:** consultorios de 1 profesional y clínicas de hasta 3 en Chile, Perú, México, Colombia y Argentina. Las redes con varias sedes se cotizan a medida.
- **Cliente ideal propuesto (sin decidir, decisión D2 de Walter):** odontólogo dueño de una consulta particular de 1 a 3 sillones en Chile, con 80 a 300 citas al mes, que hoy agenda en papel o en Google Calendar y confirma a mano por su WhatsApp personal. El resto de los países queda solo con SEO hasta tener 20 clínicas pagando en Chile.
- **No es para:** redes de más de 3 sedes, clínicas de estética, clínicas que necesitan factura electrónica integrada o convenios masivos con aseguradoras.

## 3. Qué hace hoy (en producción, verificado)

### Operación diaria

- **Agenda** por día y semana, por profesional y por sucursal, en la hora local de la clínica. Estados de cita configurables, lista de espera con aviso al paciente y bandeja de solicitudes de hora que llegan del portal.
- **Pacientes:** alta, búsqueda, importación desde planilla CSV con mapeo de columnas y fusión de fichas duplicadas.
- **Ficha clínica:**
  - Notas clínicas versionadas, con revisión entre pares, firma y auditoría que escribe la base (no se puede fabricar un "firmó").
  - Odontograma FDI (ISO 3950) versionado e inmutable, con dentición temporal y 5 superficies.
  - Periodontograma.
  - Antecedentes médicos y alergias, consentimientos con copia del texto firmado, documentos adjuntos y ortodoncia.
- **Dinero:** presupuestos que se convierten en plan de tratamiento, pagos que descuentan el saldo del paciente, caja diaria y varias cajas, morosidad, gastos, aranceles, convenios, medios de pago y comisiones por profesional. El dinero se guarda en enteros y la moneda la fija la base según el país de la clínica.
- **Laboratorios:** órdenes de laboratorio y un portal para el laboratorio con link firmado de 30 días.
- **Inventario** y **reportes**, incluida la pantalla `/efectividad` (ausencias con y sin recordatorio, sobre 90 días, con muestra mínima de 20 casos antes de mostrar porcentajes).
- **Funciona sin conexión** y sincroniza al volver.

### Pacientes y mensajería

- **WhatsApp en modo manual:** Esmalia arma los recordatorios de 48 h y 3 h y las colas de seguimiento (recall, presupuestos, cumpleaños, referidos). Una persona de la clínica envía cada mensaje con un toque desde su WhatsApp (`wa.me`). **Ningún mensaje a pacientes sale solo.**
- **Baja de WhatsApp:** el paciente que escribe BAJA/STOP queda fuera de los recordatorios (#66). Los teléfonos se normalizan según el país de la clínica (#66).
- **Portal del paciente** con link firmado: ver sus citas y pedir hora (hasta 3 pedidos cada 24 h).
- **Correos a pacientes:** se envían a mano desde la ficha. Cada clínica arranca en modo sandbox.
- **Resumen diario** para el equipo, dentro de la app. No le escribe a ningún paciente.

### Cuenta, datos y cobro

- **Registro self-serve** con Google o correo, 14 días de prueba sin tarjeta, asistente de 4 pasos y checklist "Activa tu clínica".
- **Roles:** owner, admin, dentist, assistant, reception y accounting. Cada permiso de la interfaz tiene su par en el servidor. Hay simulación de rol para probar.
- **Verificación en dos pasos (TOTP)** (#65): obligatoria para el staff de `/admin`, recomendada para los owners y opcional para el resto ([`MFA.md`](MFA.md)).
- **Exportación completa de la clínica** (#67): ZIP con 25 CSV y los archivos, desde Configuración. Queda registrada.
- **Suscripción con Stripe** en USD (#69): webhook que rechaza eventos del modo equivocado y reintenta si falla una escritura, 7 días de gracia ante un pago fallido y checkout sin suscripciones duplicadas. **Ningún estado de pago bloquea la agenda, los pacientes, la ficha clínica ni la exportación.** Al vencer el trial o la gracia se bloquean solo los informes.
- **Medición del embudo sin cookies ni terceros** (#68), con North Star "citas gestionadas por clínica activa por semana" ([`MEDICION.md`](MEDICION.md)).

### Patty, la IA (con una advertencia)

Pasa los apuntes del profesional a una nota SOAP, pule la redacción, resume la nota y extrae diagnósticos y tratamientos para que el profesional los confirme. Propone y no decide: no firma notas, no le escribe a pacientes y no mueve la agenda.

⚠️ **Al 19-oct corre sobre la clave de Gemini en el nivel gratuito.** Eso contradice la política de privacidad, y los términos de Gemini prohíben el uso en práctica clínica incluso pagando (hallazgos LEG-01, SEG-04 e IA-01). Pausarla está en curso (decisión D3 de Walter). Volverá solo con un proveedor que tenga DPA y permita el uso clínico.

## 4. Qué NO hace (y no hay que prometer)

| No hace                                                                                    | Situación                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Factura electrónica o documentos tributarios (SII, SUNAT, CFDI, DIAN, ARCA)                | En el roadmap **sin fecha**. La web lo dice en cada página de país                                                           |
| Enviar WhatsApp automáticamente                                                            | El código de Meta Cloud API está hecho (#63), pero falta la app de Meta (bloqueada en Walter). La web dice "en habilitación" |
| Lectura de pedidos de hora por WhatsApp con IA                                             | Depende de lo anterior y de un proveedor de IA apto. "En habilitación"                                                       |
| Recetas, certificados, diagnóstico CIE-10                                                  | No existen. Recetas en curso (tanda 2)                                                                                       |
| Anamnesis estructurada con signos vitales y tutor del menor                                | En curso (tanda 2)                                                                                                           |
| Odontograma con varias condiciones por pieza y estado existente o planificado              | Hoy es una condición por superficie. En curso (tanda 2)                                                                      |
| Plantillas de consentimiento precargadas y firma con nombre y matrícula obligatoria        | En curso (tanda 2)                                                                                                           |
| Archivar pacientes en vez de borrarlos                                                     | Hoy un owner o admin puede borrar un paciente y la cascada se lleva su historia (CLI-05). En curso (tanda 2)                 |
| Registro de quién abrió qué ficha                                                          | No existe (SEG-02). En curso (tanda 2)                                                                                       |
| Cifrado del documento de identidad                                                         | Construido, pero 0 de 11 pacientes cifrados. Plazo legal: 1-dic-2026 (Ley 21.719)                                            |
| Límites por plan                                                                           | Solo (US$29) y Clínica (US$69) habilitan lo mismo (MER-01)                                                                   |
| Precio en moneda local, plan anual, profesional adicional                                  | Solo cobro mensual en USD. Propuesta en CLP pendiente (D7)                                                                   |
| Cobro online a pacientes, links de pago, integración con aseguradoras                      | No existen                                                                                                                   |
| Multisede avanzada, API pública, app móvil nativa, predicción de ausencias, IA de imágenes | No existen y no están en los próximos 90 días                                                                                |
| SLA contractual o status page pública                                                      | No hay SLA. Hay un SLO interno ([`SLO.md`](SLO.md)). La status page está en el roadmap                                       |

"En curso (tanda 2)" significa un PR abierto o por abrir el 19-oct. **No está en producción** hasta que Walter lo mergee y, si trae migración, la apruebe.

## 5. Precios publicados

| Plan    | Precio    | Qué dice la web                                                               |
| ------- | --------- | ----------------------------------------------------------------------------- |
| Solo    | US$29/mes | 1 profesional: agenda, ficha, recordatorios, caja, presupuestos e importación |
| Clínica | US$69/mes | Hasta 3 profesionales; suma comisiones, roles y portal de pacientes           |
| Red     | A medida  | Varias sedes, por WhatsApp                                                    |

14 días gratis sin tarjeta y cobro en USD vía Stripe. El "precio fundador" no tiene cupo ni fecha (MER-06). La propuesta para Chile (CLP, anual con 2 meses gratis, puesta en marcha pagada) está en la auditoría, `hallazgos/08`, y espera validación con 10 entrevistas.

## 6. Stack e infraestructura

| Capa                           | Qué                                                                                                        | Nota                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Aplicación                     | TanStack Start (SSR) + React 19 + Vite 8 + TypeScript + Tailwind 4 + shadcn/ui                             | Server functions con middleware de auth y validación Zod                     |
| Base, auth y archivos          | Supabase (Postgres, Auth, Storage, Realtime), proyecto `esmalia-prod` en `sa-east-1` (São Paulo), plan Pro | Org compartida con otros 2 proyectos de la empresa. Sin PITR                 |
| Hosting                        | Vercel, funciones en `gru1` (São Paulo)                                                                    | **Plan Hobby, que prohíbe el uso comercial** (OPS-01). Decisión D5 pendiente |
| DNS, dominio y correo entrante | Cloudflare (registrar, DNS, Email Routing)                                                                 | `esmalia.com` vence el 09-oct-2027                                           |
| Correo saliente                | Resend (plan gratis), SPF, DKIM y DMARC `p=none`                                                           |                                                                              |
| Pagos                          | Stripe, cuenta propia de Esmalia                                                                           | Checkout alojado (SAQ A)                                                     |
| Errores y monitoreo            | Sentry (plan gratis), monitor de `/api/health` cada 1 min                                                  | Alerta por correo a una sola persona                                         |
| Backups                        | GitHub Actions → JSON cifrado con `age` → Backblaze B2, diario, más el snapshot diario de Supabase         | Bucket compartido, sin Object Lock                                           |
| Tareas programadas             | GitHub Actions (backup, resumen diario y correos de ciclo de vida)                                         | Los disparos horarios corren 3 a 7 veces por día (OPS-02)                    |
| IA                             | Gateway propio: Gemini, con OpenAI como alternativa                                                        | Ver la advertencia de Patty                                                  |
| Validación de teléfonos        | Numverify por HTTPS (#66)                                                                                  | Todavía no figura en el DPA                                                  |
| WhatsApp                       | `wa.me` manual. Meta Cloud API con Embedded Signup v4 construida, sin activar                              | Token por clínica cifrado (AES-256-GCM)                                      |

Costo directo estimado: **~US$16-26 por mes** (US$36-46 con Vercel Pro). El costo marginal por clínica es casi cero hasta unas 50 clínicas. El detalle de presupuesto y P&L vive fuera del repo, en `02 - Finanzas/`.

## 7. Seguridad (estado al 19-oct)

**Lo que está:**

- RLS en 64 de 64 tablas, sin policies `using (true)`, y aislamiento entre clínicas probado en vivo.
- CSP con nonce por request, HSTS y webhooks firmados con comparación en tiempo constante.
- Tokens de WhatsApp cifrados en una tabla que solo lee el service role.
- MFA TOTP (#65), backups diarios cifrados con restauración ensayada en local (10-oct) y cero secretos en el historial de git.

**Lo que falta, por prioridad:**

1. Patty sobre Gemini gratuito (en pausa, D3).
2. El MFA de las clínicas protege la interfaz, no la API: falta la policy RLS que exija `aal2` (tanda 2).
3. Cifrado del documento de identidad sin poblar (plazo 1-dic-2026).
4. Sin registro de lecturas de ficha.
5. Repo de GitHub **público** (D4), sin pentest externo ni escaneo de secretos.
6. CI y previews usan la base de producción, y `main` no tiene protección.
7. Continuidad: la clave de backups y las cuentas dependen de una sola persona (plan en `08 - Operaciones/continuidad/`, fuera del repo).

## 8. Cumplimiento

> No es asesoría legal. Lo valida un abogado (pendiente, ítem 32 del plan).

- **Textos publicados el 10-oct:** privacidad v3, términos v2 y DPA v1. Son honestos y casi siempre coinciden con el código, pero **ningún abogado los revisó**. Dos afirmaciones de privacidad no se cumplen hasta pausar Patty y declarar o reemplazar Numverify.
- **Chile, Ley 21.719:** vigencia plena el 1-dic-2026. Faltan el cifrado del documento, el registro de lecturas, las cláusulas tipo para transferencias internacionales y la evaluación de impacto (EIPD) de datos de salud.
- **Historia clínica:** ningún estado de pago bloquea la ficha ni la exportación, porque la clínica es la custodia legal (CL Ley 20.584, MX NOM-004, CO Res. 1995). Falta impedir el borrado de pacientes (tanda 2).
- **Pendiente formal:** DPAs firmados con los subencargados, marca "Esmalia" sin registrar en ningún país, la LLC sin inscribir para el IVA a servicios digitales, sin seguro de ciberriesgo y repo sin licencia.

## 9. Roadmap

La única fuente es [`ROADMAP.md`](ROADMAP.md): 90 días en 4 fases (esta semana, 30, 60 y 90 días), con dueño y estado de cada ítem. En resumen:

1. Cerrar la exposición de datos y las promesas falsas.
2. Conseguir 3 a 5 pilotos en Chile.
3. Ponerse en regla con la Ley 21.719 antes del 1-dic.
4. Llegar a 10 clínicas activas y 8 pagando al 18-ene-2027.

## 10. Métricas que importan

| Métrica                                                     | Hoy                  | Meta a 90 días (18-ene-2027)           |
| ----------------------------------------------------------- | -------------------- | -------------------------------------- |
| Clínicas externas activas                                   | 0                    | 10                                     |
| Clínicas pagando                                            | 0                    | 8                                      |
| MRR                                                         | US$0                 | ≥ US$400                               |
| Testimonios con permiso escrito                             | 0                    | 5                                      |
| North Star: citas gestionadas por clínica activa por semana | Sin clínicas activas | Línea de base con los primeros pilotos |
| Disponibilidad de `/api/health` (30 días)                   | Medida por Sentry    | ≥ 99,5 % ([`SLO.md`](SLO.md))          |

## 11. Historial de este documento

- **v2.0 (19-oct-2026):** reescrito desde cero contra el código y producción (hallazgo GOB-03). Saca las promesas que el producto no cumplía: predicción de ausencias con reagendamiento automático, API-first, facturación electrónica por país, confirmación automática por WhatsApp, multisucursal con jerarquía de red e identidad visual teal y violeta (la marca hoy es papel, tinta y ocre: [`MARCA.md`](MARCA.md)).
- **v1.0 (13-ago-2026):** visión del prototipo importado de Lovable. Archivado en `archivo/`.
