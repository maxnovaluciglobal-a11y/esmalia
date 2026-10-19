> **Archivado el 2026-10-19: histórico, no vigente.** Lo reemplaza [`docs/Esmalia_Documento_Maestro_v2.md`](../Esmalia_Documento_Maestro_v2.md). Era la visión del prototipo de agosto (identidad visual, API pública, predicción de ausencias, facturación electrónica, multi-sucursal): buena parte de lo que describe **no existe** en el producto. Se conserva como registro de cómo se pensó y decidió en su momento; no lo uses como fuente de estado ni de planes. Las rutas `docs/…` que aparecen abajo apuntan a la ubicación anterior (hoy `docs/archivo/`). Motivo: hallazgo GOB-03 de la auditoría 360 del 18-oct-2026.

# Esmalia — Documento maestro de producto

### Software de gestión odontológica cloud-first para Latinoamérica

Versión 1.0 · Documento de arquitectura, producto y estrategia
Marca: **Esmalia** · Dirección visual: _Precision clinical mint_ (teal `#0d9488`, acento IA violeta `#8b5cf6`, tipografía Outfit + Inter)

---

## 1. Visión y posicionamiento

Esmalia es el **sistema operativo de la clínica dental**: una sola plataforma donde ocurre la agenda, la historia clínica, el dinero y la relación con el paciente. No es un ERP con módulos pegados; es un producto con una superficie coherente, rápida y silenciosa.

**Tesis de producto:** el 60–70% del tiempo administrativo de una clínica dental latinoamericana se consume en tres actividades: confirmar/reagendar citas, escribir y buscar registros clínicos, y perseguir cobros. Esmalia ataca esas tres con automatización e IA antes que con más formularios.

**Promesa medible (North Star):** _horas administrativas ahorradas por sillón por semana_. Métricas satélite: tasa de ausencias, ocupación de box, ticket promedio, % de presupuestos aceptados, tiempo medio de registro clínico por consulta.

### Lectura del mercado

| Plataforma            | Fortaleza                                 | Brecha que Esmalia explota                                   |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Dentalink / Dentidesk | Fuerte en LatAm, buen soporte local       | UX con carga cognitiva alta, IA marginal, movilidad limitada |
| Open Dental           | Extensible, económico                     | On-premise, curva de aprendizaje alta, no cloud-native       |
| Dentrix               | Profundidad clínica y de facturación      | Legado Windows, caro, casi solo EE. UU.                      |
| Curve Dental          | Cloud real, UI decente                    | Poca automatización proactiva, débil fuera de EE. UU.        |
| CareStack             | All-in-one con BI                         | Complejo de implementar en clínicas chicas                   |
| NexHealth             | Excelente capa de paciente y agendamiento | Es capa, no sistema de registro                              |

**Diferenciadores de Esmalia:** (1) IA operativa que explica y actúa, no solo transcribe; (2) predicción de ausencias con reagendamiento automático desde lista de espera; (3) historia clínica con autoguardado, versionado y firma digital nativa; (4) multi-tenant real con jerarquía red → sucursal → box; (5) API-first desde el día uno; (6) precio y facturación pensados para LatAm (moneda local, boleta/factura electrónica por país, WhatsApp como canal primario).

---

## 2. Arquitectura del sistema

```text
┌──────────────────────────────────────────────────────────────┐
│  CLIENTES                                                    │
│  Web app (React + TanStack) · PWA móvil · Portal paciente    │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS / RPC tipado
┌───────────────▼──────────────────────────────────────────────┐
│  CAPA DE APLICACIÓN (server functions + rutas API)           │
│  Auth · Autorización por rol y tenant · Validación (Zod)     │
│  Orquestación de dominio · Webhooks públicos firmados        │
└───────┬───────────────────┬───────────────────┬──────────────┘
        │                   │                   │
┌───────▼──────┐   ┌────────▼────────┐   ┌──────▼───────────┐
│ PostgreSQL   │   │ Storage         │   │ Servicios        │
│ RLS por      │   │ imágenes, RX,   │   │ IA Gateway       │
│ clinic_id    │   │ consentimientos │   │ WhatsApp / Email │
│ Auditoría    │   │ URLs firmadas   │   │ Pagos / DTE      │
└──────────────┘   └─────────────────┘   └──────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│  ASÍNCRONO: colas de recordatorios, scoring de ausencia,     │
│  resúmenes clínicos, campañas, forecast, export BI           │
└──────────────────────────────────────────────────────────────┘
```

**Principios:** API-first (toda pantalla consume el mismo contrato público), aislamiento por tenant en la base de datos (no en el código de aplicación), idempotencia en todo endpoint que cobre o notifique, y eventos de dominio (`cita.creada`, `presupuesto.aceptado`, `pago.recibido`) como columna vertebral de automatizaciones e integraciones.

---

## 3. Sitemap y flujo de navegación

```text
/                        Dashboard inteligente
/agenda                  Día · Semana · Mes · Por profesional · Por box
/pacientes               Listado + búsqueda instantánea
/pacientes/:id           Ficha: resumen IA, timeline, saldo, archivos
/pacientes/:id/historia  Historia clínica, odontograma, periodontograma
/tratamientos            Planes activos y avance
/presupuestos            Embudo, firma digital, pago online
/finanzas                Caja, ingresos, gastos, comisiones, forecast
/inventario              Stock, lotes, vencimientos, compras
/marketing               Campañas, inactivos, NPS
/bi                      Dashboards configurables y exportación
/admin                   Roles, sucursales, usuarios, auditoría
/portal                  Portal del paciente (dominio separado)
```

**Flujo troncal (recepción → cobro):**
`Buscar paciente (⌘K) → Agendar → Confirmación automática 48 h y 3 h → Check-in (En sala) → Consulta: notas asistidas por IA + odontograma → Presupuesto → Firma digital → Pago → Próximo control agendado automáticamente → Encuesta NPS`

Cada paso deja un evento de dominio; si un paso se rompe (ausencia, presupuesto no aceptado, saldo impago), una automatización lo recoge.

---

## 4. Modelo de datos (relacional)

Todas las tablas de negocio llevan `clinic_id` (tenant) y, cuando aplica, `branch_id`. RLS obliga la pertenencia al tenant en cada consulta.

```text
clinics 1─┬─< branches 1──< operatories(box)
          ├─< users >──< user_roles >── roles
          ├─< patients 1──< patient_files
          │              1──< clinical_records 1──< record_versions
          │              1──< odontogram_states
          │              1──< consents (firma digital)
          ├─< appointments >── patients, users(profesional), operatories
          │              1──< appointment_reminders
          ├─< waitlist_entries
          ├─< treatment_plans 1──< treatment_items >── procedures(catálogo)
          ├─< quotes 1──< quote_items      (quote → treatment_plan al aceptar)
          ├─< invoices 1──< payments
          ├─< inventory_items 1──< stock_lots, stock_movements
          ├─< suppliers 1──< purchase_orders
          ├─< campaigns 1──< campaign_messages
          ├─< ai_insights   (entidad, tipo, score, explicación, acción sugerida)
          └─< audit_log     (actor, acción, entidad, diff, ip, timestamp)
```

**Decisiones de modelado clave**

- **Roles en tabla aparte** (`user_roles` + función `has_role` con `SECURITY DEFINER`). Nunca un campo `role` en el perfil: es un vector de escalada de privilegios.
- **Historia clínica inmutable**: `clinical_records` guarda el estado vigente; `record_versions` guarda cada guardado con autor y timestamp. Nada se borra; se supersede.
- **Odontograma como estado versionado por pieza y superficie** (`odontogram_states`), no como blob: permite consultas del tipo "piezas con caries no tratada hace más de 6 meses".
- **Dinero en enteros** (centavos/pesos sin decimales) con moneda por sucursal.
- **`ai_insights` separada del dato clínico**: toda salida de IA es una sugerencia trazable con score y origen, nunca un hecho clínico escrito directo en la ficha.

---

## 5. Roles y permisos

| Rol                       | Alcance                  | Permisos clave                                               |
| ------------------------- | ------------------------ | ------------------------------------------------------------ |
| Owner / Director de red   | Todas las sucursales     | Todo, incluida facturación del SaaS y creación de sucursales |
| Administrador de sucursal | Una sucursal             | Usuarios, agenda, finanzas y reportes de su sucursal         |
| Odontólogo                | Sus pacientes y agenda   | Historia clínica, odontograma, presupuestos, firma           |
| Especialista externo      | Interconsultas asignadas | Solo pacientes derivados, ventana de tiempo limitada         |
| Asistente dental          | Box asignado             | Check-in, insumos, adjuntar imágenes; sin acceso financiero  |
| Recepción                 | Sucursal                 | Agenda, pacientes (datos no clínicos), cobros, caja          |
| Contabilidad              | Red                      | Finanzas y exportaciones; sin acceso clínico                 |
| Paciente                  | Sus propios datos        | Portal: reservas, pagos, documentos, resultados              |

Permisos por combinación `rol × recurso × acción`, evaluados en base de datos. El acceso a datos clínicos se registra siempre en `audit_log` (quién vio qué ficha y cuándo).

---

## 6. Casos de uso principales

1. **Recepción agenda una cita en 15 segundos**: ⌘K → nombre → hueco sugerido por el sistema según profesional, box y duración del procedimiento.
2. **El sistema evita una ausencia**: el scoring marca 71% de riesgo → recordatorio reforzado por WhatsApp y oferta del bloque a la lista de espera si no confirma en 12 h.
3. **El odontólogo cierra la ficha antes de que salga el paciente**: dicta o escribe; la IA propone la evolución estructurada; el profesional edita y firma.
4. **Presupuesto aceptado desde el celular**: se envía por WhatsApp, se firma digitalmente y se paga el abono con link; el plan de tratamiento se crea solo.
5. **Paciente perdido recuperado**: sin visita en 11 meses y con tratamiento incompleto → campaña automática con oferta de control.
6. **El director compara sucursales**: rentabilidad por profesional, por tratamiento y por sede, con explicación en lenguaje natural de la variación del mes.
7. **Insumo bajo stock**: consumo descontado automáticamente por procedimiento realizado; se sugiere orden de compra al proveedor habitual.

---

## 7. Wireframes (estructura implementada)

```text
DASHBOARD
┌──────────┬─────────────────────────────────────────────────┐
│ Sidebar  │ Header: título · tema · usuario                 │
│ Esmalia   ├─────────────────────────────────────────────────┤
│ Dashboard│ [KPI][KPI][KPI][Urgencias — bloque teal]        │
│ Agenda   ├──────────────────────────────┬──────────────────┤
│ Pacientes│ Agenda del día               │ Timeline clínico │
│ Tratam.  │ columnas por profesional/box │ paciente activo  │
│          │ bloques con estado y color   │ + análisis IA    │
│ [IA card]│                              │                  │
└──────────┴──────────────────────────────┴──────────────────┘

AGENDA                              FICHA DE PACIENTE
┌─────────────────┬──────────┐      ┌────────────────┬───────────┐
│ Grilla día      │ Lista de │      │ Cabecera+KPIs  │ Resumen IA│
│ por profesional │ espera   │      ├────────────────┤───────────┤
│ drag & drop     ├──────────┤      │ Timeline       │ Accesos:  │
│                 │ Sugeren- │      │ clínica        │ odonto-   │
│                 │ cia IA   │      │                │ grama, RX │
└─────────────────┴──────────┘      └────────────────┴───────────┘
```

**Reglas de UI:** una acción primaria por pantalla; color solo con significado (teal = marca/confirmado, ámbar = en curso/atención, violeta = IA, gris = pasado); densidad alta pero con aire; todo alcanzable por teclado; modo claro y oscuro con los mismos tokens semánticos.

---

## 8. Roadmap

### MVP (meses 0–4) — _implementado en este prototipo la capa de Agenda + Pacientes_

Agenda multi-profesional y multi-box · Ficha de paciente con timeline · Recordatorios automáticos (WhatsApp + email) · Lista de espera · Usuarios y roles · Multi-tenant con RLS · Dashboard con KPIs base.

### V1 (meses 4–9) — clínica completa

Historia clínica versionada con firma digital · Odontograma y periodontograma interactivos · Presupuestos con aceptación y pago online · Planes de tratamiento · Caja y finanzas básicas · Portal del paciente · IA: resumen de consulta y redacción de evolución.

### V2 (meses 9–16) — inteligencia y escala

Predicción de ausencias · Optimización automática de agenda · Inventario y compras con consumo automático · Marketing y automatizaciones · NPS · BI configurable y exportación · Multi-sucursal avanzado · App móvil por rol · Chat interno tipo asistente sobre los datos de la clínica.

### V3 (meses 16–30) — plataforma

Marketplace de integraciones y API pública documentada · Análisis asistido de radiografías (con validación clínica y marco regulatorio) · Forecast financiero y de demanda · Facturación electrónica por país (CL, MX, CO, PE, AR) · Financiamiento de tratamientos · Modo cadena con benchmarking entre sedes.

---

## 9. Backlog priorizado (extracto, RICE)

| #   | Épica        | Historia                                                                      | Prioridad |
| --- | ------------ | ----------------------------------------------------------------------------- | --------- |
| 1   | Agenda       | Arrastrar una cita entre profesional y horario con validación de solapamiento | P0        |
| 2   | Agenda       | Confirmación automática 48 h / 3 h con respuesta por WhatsApp                 | P0        |
| 3   | Pacientes    | Búsqueda global ⌘K por nombre, documento o teléfono                           | P0        |
| 4   | Pacientes    | Ficha con timeline unificada (citas, imágenes, pagos, notas)                  | P0        |
| 5   | Seguridad    | RLS por `clinic_id` y `audit_log` de accesos clínicos                         | P0        |
| 6   | Historia     | Autoguardado + versionado con autor                                           | P1        |
| 7   | Historia     | Odontograma por pieza y superficie                                            | P1        |
| 8   | Presupuestos | Envío, firma digital y abono con link de pago                                 | P1        |
| 9   | IA           | Resumen de consulta editable antes de firmar                                  | P1        |
| 10  | Agenda       | Score de ausencia y oferta automática a lista de espera                       | P2        |
| 11  | Finanzas     | Rentabilidad por profesional, tratamiento y sucursal                          | P2        |
| 12  | Inventario   | Descuento automático de insumos por procedimiento                             | P2        |
| 13  | Marketing    | Segmento "paciente perdido" con campaña automática                            | P2        |
| 14  | BI           | Dashboards configurables + export a Power BI / Looker                         | P3        |

---

## 10. Diseño de API REST

Versionada, con `tenant` implícito en el token y paginación por cursor.

```http
GET    /v1/patients?query=rodriguez&cursor=…&limit=50
POST   /v1/patients
GET    /v1/patients/{id}
PATCH  /v1/patients/{id}

GET    /v1/appointments?from=2026-10-24&to=2026-10-24&provider_id=…
POST   /v1/appointments                 # Idempotency-Key requerido
PATCH  /v1/appointments/{id}            # mover, cambiar estado
POST   /v1/appointments/{id}/check-in

GET    /v1/patients/{id}/clinical-records
POST   /v1/clinical-records             # crea una nueva versión
POST   /v1/clinical-records/{id}/sign

POST   /v1/quotes            GET /v1/quotes/{id}    POST /v1/quotes/{id}/accept
POST   /v1/payments          GET /v1/invoices/{id}
GET    /v1/insights?entity=patient&id=…
POST   /v1/webhooks/subscriptions       # eventos de dominio
```

Convenciones: errores RFC 7807; `429` con `Retry-After`; webhooks firmados con HMAC-SHA256 y verificación en tiempo constante; toda mutación devuelve la entidad completa; sin endpoints que devuelvan PII sin autenticación.

---

## 11. Políticas de seguridad y cumplimiento

- **Aislamiento en la base de datos**: RLS obligatorio; ninguna consulta de aplicación decide el tenant por sí sola. Las claves de servicio nunca llegan al navegador.
- **Mínimo privilegio**: roles en tabla separada, verificación server-side, sin lógica de permisos en `localStorage`.
- **Datos clínicos**: cifrado en tránsito y en reposo, URLs firmadas de corta vida para imágenes y radiografías, y registro de cada lectura de ficha.
- **Trazabilidad**: `audit_log` inmutable con diff por cambio; la historia clínica nunca se borra, se supersede.
- **Consentimiento y retención**: consentimientos firmados versionados; política de retención por país; exportación y eliminación de datos a solicitud del titular.
- **Marco normativo**: Ley 19.628 y Ley 21.719 (Chile), LFPDPPP (México), Ley 1581 (Colombia), Ley 29733 (Perú); diseño compatible con HIPAA para expansión a EE. UU.
- **IA con barandas**: ninguna salida de IA se escribe como hecho clínico sin aprobación humana explícita; los prompts se aíslan por tenant y los datos de un cliente nunca entrenan modelos compartidos.

---

## 12. Arquitectura multi-tenant y escalamiento

**Modelo:** base compartida con RLS por `clinic_id` (óptimo en costo y velocidad de despliegue) y jerarquía `organization → clinic → branch → operatory`. Cadenas grandes o clientes con exigencia regulatoria pueden migrar a esquema o base dedicada sin cambiar el código: el `tenant resolver` es una capa.

**Escala a miles de clínicas:**

1. Índices compuestos con `clinic_id` como primera columna en cada tabla caliente.
2. Particionado por rango temporal en `appointments`, `audit_log` y `stock_movements`.
3. Réplicas de lectura para BI y reportes; nunca reportes sobre la base transaccional.
4. Trabajo asíncrono en colas (recordatorios, IA, campañas) con reintentos e idempotencia.
5. Caché por tenant de catálogos (procedimientos, aranceles) con invalidación por evento.
6. Regionalización: despliegue por región (MX, CL/AR, CO/PE) para latencia y residencia de datos.
7. Presupuesto de rendimiento explícito: agenda del día en menos de 200 ms p95; búsqueda de paciente en menos de 100 ms p95.

---

## 13. Recomendaciones para liderar el mercado LatAm en 10 años

1. **Ganar el punto de entrada, no el módulo completo.** Entrar por agenda y recordatorios (dolor inmediato, migración barata) y expandir desde adentro.
2. **Migración como producto.** Importadores oficiales desde Dentalink, Dentidesk y Open Dental, con migración asistida gratuita. La barrera de salida de la competencia es su mayor activo: disolverla.
3. **WhatsApp como sistema nervioso.** En LatAm el paciente vive ahí: confirmaciones, presupuestos, pagos y encuestas nativos en ese canal.
4. **Cobrar por resultado, no por asiento.** Plan base accesible + módulos de crecimiento (marketing, IA, pagos). Alinear el precio con las ausencias evitadas y el ticket recuperado.
5. **Dominar el cumplimiento local antes que la competencia global.** Facturación electrónica y normativa de datos por país es un foso de 2–3 años que ningún actor de EE. UU. va a cavar.
6. **IA que actúa, no que responde.** El valor no está en un chat: está en que la agenda se reordene sola y el paciente perdido vuelva sin que nadie lo llame.
7. **Educación y comunidad.** Certificación de administradores de clínica, benchmarks anónimos de la industria por país, contenido para dueños jóvenes. El software gana cuando define el vocabulario del rubro.
8. **API pública y marketplace desde V2.** Cada integración de terceros es retención que no cuesta desarrollo propio.
9. **Datos agregados y anónimos como producto separado.** Benchmarking de aranceles, demanda y rentabilidad por región: monetizable y defendible, con consentimiento explícito.
10. **Obsesión con el tiempo de valor.** Meta: clínica de un sillón operando en menos de 30 minutos desde el registro, sin llamada de ventas.

---

_Documento maestro Esmalia v1.0 — acompaña al prototipo navegable de Dashboard, Agenda, Pacientes y Ficha clínica._
