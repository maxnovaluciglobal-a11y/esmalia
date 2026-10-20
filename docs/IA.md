# Patty (IA de Esmalia): estado, proveedores y cómo reactivarla

## Estado: PAUSADA desde el 19-oct-2026

Patty no llama a ningún modelo de IA. El interruptor de servidor `AI_ENABLED` está apagado por defecto: si la variable no existe, está vacía o tiene cualquier valor que no sea `true`, Patty queda apagada aunque haya claves cargadas.

Qué pasa con el interruptor apagado:

| Dónde                                  | Comportamiento                                                                                                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai-gateway.server.ts`         | `gatewayChat` lanza `IaPausadaError` (`code: "AI_DISABLED"`) antes de validar la configuración o armar el request: no hay `fetch`. `resolverProveedorIa(uso)` devuelve `null`.                                                            |
| Notas clínicas (`notas-clinicas.tsx`)  | En lugar de los botones de Patty se ve "Patty está en habilitación…". Escribir, guardar, firmar, revisar y exportar funcionan igual. `generateNoteText` y `extractNoteEntities` cortan antes de consultar al paciente o llamar al modelo. |
| WhatsApp (`intencion-de-agenda-ia.ts`) | `interpretarConIA` devuelve `null` sin llamar al modelo. El webhook sigue con las reglas deterministas y, si no alcanzan, con el aviso genérico al equipo.                                                                                |
| Páginas públicas, `/llms.txt`, schema  | Patty figura "en habilitación", en futuro. Las páginas no se borraron.                                                                                                                                                                    |

Lo prueban `tests/patty-pausada.test.ts` y `tests/ia-proveedores.test.ts` (puros: espía de `fetch`, sin red ni base).

## Por qué está pausada

Hallazgos de la auditoría 360 del 18-oct-2026 (`00 - Gestion/auditorias/2026-10-18-auditoria-360-total/hallazgos/05-ia-datos-analitica.md` y `99a`): IA-01, IA-02, IA-03, IA-04, LEG-01, SEG-04.

1. **Nivel gratuito de Gemini (IA-01).** La clave de producción era del nivel sin facturación, donde Google puede usar el contenido para mejorar sus productos y lo pueden leer revisores humanos. Contradice `/privacidad` y `/dpa`.
2. **Términos de Gemini API (IA-03).** Prohíben el uso en práctica clínica, aunque se pague.
3. **Se enviaba PII sin necesidad (IA-02).** Ya está corregido (ver abajo).

Exposición real hasta la pausa: prácticamente nula (0 usos de IA registrados y 0 clínicas activas al 18-oct).

## Qué proveedor puede hacer qué (verificado el 20-oct-2026)

Patty tiene dos usos con riesgos distintos, y cada uno se rutea por separado:

| Uso       | Qué hace                                                                                    | Dónde se llama                                                            | Variable              |
| --------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------- |
| `clinico` | Redactar, resumir y pulir notas SOAP; extraer alergias, medicamentos, diagnósticos y piezas | `generateNoteText`, `extractNoteEntities` (`clinical-notes.functions.ts`) | `AI_PROVIDER_CLINICO` |
| `agenda`  | Leer si un WhatsApp pide agendar, mover o cancelar, y qué fecha (tarea administrativa)      | `interpretarConIA` (`intencion-de-agenda-ia.ts`)                          | `AI_PROVIDER_AGENDA`  |

| Proveedor                | `clinico`        | `agenda` | Fundamento                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic (Claude API)   | ✅ (recomendado) | ✅       | La Usage Policy de Anthropic trata lo médico como caso de uso de alto riesgo, permitido con (1) revisión humana calificada antes de que llegue al paciente y (2) aviso de que se usó IA. Esmalia ya cumple las dos: la nota la revisa y firma el profesional, y lo no validado sale como "Sugerido por IA".                                                                   |
| Vertex AI (Google Cloud) | ⛔ bloqueado     | ✅       | Service Specific Terms de Google Cloud §20(e) "Healthcare Restrictions": los servicios de IA generativa no se pueden usar "for clinical purposes"; aclara que la investigación no clínica, la agenda y las tareas administrativas no están restringidas. §18: no entrena con datos del cliente. Gemini 2.5 Flash está en `southamerica-east1` con procesamiento en la región. |
| OpenAI                   | ⚠️ permitido     | ✅       | Se mantiene como alternativa técnica. Antes de usarlo para lo clínico, revisar sus términos para datos de salud y firmar el acuerdo que corresponda.                                                                                                                                                                                                                          |
| Gemini API (AI Studio)   | ⛔ eliminado     | ⛔       | Sus términos excluyen la práctica clínica y el nivel gratuito entrena con los datos. El gateway ya no lo soporta: configurarlo da `ConfigIaError`.                                                                                                                                                                                                                            |

**Corrección:** la versión anterior de este documento recomendaba Vertex AI para todo. Es incorrecto: §20(e) prohíbe usar Vertex para redactar documentación clínica o extraer entidades clínicas. El gateway lo bloquea en código: `AI_PROVIDER_CLINICO=vertex` (o `gemini`) lanza `ConfigIaError` y no sale ningún request.

### Recomendación

- **Uso clínico → Anthropic (Claude API)**, modelo `claude-haiku-5-5` por defecto (`ANTHROPIC_MODEL` para cambiarlo). El gateway usa la Messages API nativa (`POST https://api.anthropic.com/v1/messages`, cabeceras `x-api-key` y `anthropic-version: 2023-06-01`), no la capa compatible con OpenAI: Anthropic la documenta como pensada para probar y comparar modelos, no para producción, e ignora `response_format`.
  - Alternativa si se prefiere tener todo en AWS con el BAA de AWS: **Claude en Amazon Bedrock**. Ojo: en `sa-east-1` (São Paulo) Bedrock ofrece Claude solo con enrutamiento global entre regiones (Global cross-region inference), así que el procesamiento puede salir de Brasil. Hoy no está implementado en el gateway.
- **Agenda → Vertex AI en `southamerica-east1`** (misma región que Supabase, procesamiento en la región) **o el mismo proveedor Anthropic** para tener un solo contrato y un solo subencargado. Para arrancar, lo más simple es Anthropic en los dos usos (es el valor por defecto).

## Configuración (variables de entorno del servidor)

| Variable                         | Para qué                                                                                                            | Por defecto               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `AI_ENABLED`                     | Interruptor general. Solo `true` prende a Patty.                                                                    | apagada                   |
| `AI_PROVIDER_CLINICO`            | `anthropic` u `openai`. `vertex` y `gemini` se rechazan.                                                            | `anthropic`               |
| `AI_PROVIDER_AGENDA`             | `anthropic`, `vertex` u `openai`. `gemini` se rechaza.                                                              | `anthropic`               |
| `ANTHROPIC_API_KEY`              | Clave de la Claude API (consola de Anthropic, workspace de Esmalia).                                                | —                         |
| `ANTHROPIC_MODEL`                | Modelo de Claude.                                                                                                   | `claude-haiku-5-5`        |
| `GOOGLE_VERTEX_CREDENTIALS`      | JSON de la cuenta de servicio de Google Cloud, en **base64** (`base64 -i cuenta.json`). Rol mínimo: Vertex AI User. | —                         |
| `GOOGLE_VERTEX_PROJECT`          | Proyecto de Google Cloud. Si falta, se usa `project_id` de las credenciales.                                        | `project_id`              |
| `GOOGLE_VERTEX_LOCATION`         | Región de Vertex.                                                                                                   | `southamerica-east1`      |
| `VERTEX_MODEL`                   | Modelo en Vertex (con el prefijo `google/`).                                                                        | `google/gemini-2.5-flash` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI.                                                                                                             | `gpt-4o-mini`             |
| `AI_TIMEOUT_MS`                  | Timeout de cada llamada al modelo (IA-07).                                                                          | `20000`                   |

Variables que ya no se leen: `AI_PROVIDER`, `AI_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`. Si estuvieran cargadas en Vercel, se pueden borrar.

Detalles del gateway:

- Vertex se autentica con el flujo JWT bearer de OAuth 2.0 (firma RS256 con `jose`, `https://oauth2.googleapis.com/token`, scope `cloud-platform`) y cachea el token hasta un minuto antes de que venza. Endpoint: `https://{region}-aiplatform.googleapis.com/v1/projects/{proyecto}/locations/{region}/endpoints/openapi/chat/completions`.
- Si falta la clave del proveedor elegido, el gateway no cae en silencio a otro proveedor: `resolverProveedorIa` devuelve `null` y `gatewayChat` explica qué falta.
- Timeout (IA-07): `AbortController` en cada llamada (y en el pedido del token de Vertex). Al vencer lanza `TimeoutIaError`; en WhatsApp eso se traga y el webhook sigue sin IA.
- Una respuesta de Claude con `stop_reason: "refusal"` se trata como error, no como texto vacío.
- **Cupo diario por clínica (IA-06): pendiente.** No es trivial hacerlo bien: el conteo tiene que vivir en la base (no en memoria, por las instancias de Vercel) y el uso de agenda no tiene sesión de usuario. Propuesta: tabla `ai_usage_daily (clinic_id, dia, uso, llamadas)` con RLS, RPC `SECURITY DEFINER` `consumir_cupo_ia(clinic_id, uso)` que incrementa y devuelve si queda cupo, llamada desde `generateNoteText`/`extractNoteEntities` y desde el webhook antes de `gatewayChat`, con `AI_DAILY_CAP_PER_CLINIC`. Hay un `TODO(IA-06)` en `gatewayChat`. La demo pública tiene que tener un cupo propio bajo.

## Lo que ya quedó listo para cuando vuelva

- **Minimización (IA-02)** en `src/lib/ai/minimizacion.ts`:
  - El contexto del paciente (`construirContextoPaciente`) no lleva nombre ni edad exacta: tramo de 10 años, etiquetas, última visita y los últimos 4 eventos.
  - `gatewayChat` pasa todo texto de usuario por `redactarPii`: quita nombre, documento, teléfono y email del paciente por valor exacto (los busca el servidor en `patients`) y, además, cualquier email, RUT, CURP o número de 8+ dígitos escrito a mano. Las fechas se conservan.
  - Límite conocido: el filtro genérico no reconoce nombres de terceros escritos en los apuntes ("vino con su hija Ana").
- **PDF clínico (IA-04):** las entidades que extrajo la IA y nadie validó salen con el rótulo "Sugerido por IA, sin validar" (`src/lib/clinical/note-pdf.ts`).
- **Prompts en un solo lugar:** `src/lib/ai/prompts.ts`, que usan la app y los evals. El mensaje de agenda ahora incluye el día de la semana ("Hoy es martes 2026-10-20"), para que "el viernes" no obligue al modelo a calcular el calendario.

## Evals (IA-05)

Viven en `evals/` (fuera de `src/`: no entran al bundle) y usan el mismo gateway y los mismos prompts que la app. Casos 100% inventados, en español de LatAm y contexto dental; nunca agregar datos reales.

| Set                  | Archivo                      | Casos | Qué mide                                                                                                             | Umbral para aprobar                                 |
| -------------------- | ---------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Apuntes → SOAP       | `evals/casos/soap.json`      | 30    | Hechos que no están en los apuntes y no pueden aparecer; hechos que sí deben conservarse; las 4 secciones            | 0 hechos alucinados (cada aviso se revisa a mano)   |
| Nota → entidades     | `evals/casos/entidades.json` | 30    | Precisión y recall por tipo: alergias, medicamentos, condiciones (diagnósticos), piezas FDI                          | 0 alergias inventadas; precisión y recall ≥ 0,85    |
| WhatsApp → intención | `evals/casos/agenda.json`    | 50    | Exactitud de intención y de fecha con "ahora" fijo (martes 20-oct-2026 10:00, `America/Santiago`); fechas inventadas | intención ≥ 0,90; fecha ≥ 0,90; 0 fechas inventadas |

Cómo correrlos (en local, nunca con la clave de producción de Vercel; cada corrida gasta tokens):

```bash
# clínico (60 llamadas): proveedor de AI_PROVIDER_CLINICO, anthropic por defecto
ANTHROPIC_API_KEY=... node evals/run.mjs --uso clinico

# agenda (50 llamadas) con Vertex
AI_PROVIDER_AGENDA=vertex GOOGLE_VERTEX_CREDENTIALS=... node evals/run.mjs --uso agenda

# opciones: --limite 5 (prueba corta), --modelo claude-sonnet-5-5
```

- El script no corre sin la clave del proveedor en el entorno, no lee `.env`, y no corre en CI (salvo `EVALS_EN_CI=1`). `AI_ENABLED=true` se fija solo dentro de su proceso.
- Imprime cada posible alucinación con su fragmento, los falsos positivos y negativos por caso, y el resumen; sale con código 1 si no pasa los umbrales. El detalle queda en `evals/resultados/` (gitignoreado).
- Los patrones de "hecho prohibido" pueden calzar con una negación ("no se indica amoxicilina"): cada aviso lo confirma una persona antes de contarlo como alucinación.
- Las métricas son puras y las prueba `tests/evals-metricas.test.ts` (que también verifica que ningún hecho prohibido calce con sus propios apuntes y que los casos no traigan PII con forma real).
- Falta, fuera del script: **20 SOAP revisados por un odontólogo** sobre salidas reales del modelo elegido.

## Checklist de activación

Todos, no alguno, y en este orden:

1. **Contrato del proveedor aceptado.** Anthropic: Commercial Terms + Data Processing Addendum (DPA) del workspace de Esmalia. Si se usa Vertex para agenda: Cloud Data Processing Addendum de Google Cloud aceptado en la cuenta de la empresa. Sin entrenamiento con los datos: confirmado por contrato.
2. **Textos legales actualizados:** subencargados en `/privacidad` y `/dpa` (Anthropic, PBC y, si aplica, Google Cloud con región `southamerica-east1`), con qué datos van a cada uno (texto clínico minimizado; mensajes de WhatsApp para agenda).
3. **OK del abogado** sobre "redactar documentación clínica a partir de apuntes del profesional, con revisión y firma del profesional" y sobre la transferencia internacional (revisión en `03 - Legal y Cumplimiento/`).
4. **Evals pasados** con el modelo y proveedor que se van a usar (umbrales de la tabla de arriba) + 20 SOAP revisados por un odontólogo. Volver a correrlos cada vez que cambie un prompt o el modelo.
5. **Cupo diario por clínica (IA-06)** implementado, con cupo bajo para la demo.
6. **Variables cargadas** en Vercel (Preview antes que Production): `AI_PROVIDER_CLINICO`, `AI_PROVIDER_AGENDA`, la clave del proveedor y, al final, `AI_ENABLED=true`.
7. **Textos públicos**: recién después de prender, volver a pasar a presente las páginas que dicen "en habilitación" (`src/content/paginas/funciones-patty-ia.ts` y las demás), `llms-base.md`, `seo.ts` y la sección Patty de `src/routes/index.tsx`; actualizar `MENSAJE_IA_PAUSADA` en `src/lib/ai/estado.ts` solo si cambia el texto. Mientras Patty siga pausada, esos textos no se tocan.

## Cómo prender el interruptor

Solo con el checklist cumplido y con OK de Walter:

1. Probar primero en local o en un preview: `AI_ENABLED=true` en `.env` junto con la clave del proveedor.
2. En Vercel, agregar `AI_ENABLED` con valor `true` al entorno que corresponda (Preview antes que Production) y redeployar: la variable se lee en runtime, pero un deploy nuevo asegura que todas las instancias la tomen.
3. Verificar en la ficha de un paciente de prueba que aparezcan los botones de Patty y que la auditoría de la nota registre el uso.

Para apagarla otra vez: borrar `AI_ENABLED` (o ponerla en `false`) y redeployar. No hace falta tocar las claves.
