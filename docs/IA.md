# Patty (IA de Esmalia): estado y cómo reactivarla

## Estado: PAUSADA desde el 19-oct-2026

Patty no llama a ningún modelo de IA. El interruptor de servidor `AI_ENABLED` está apagado por defecto: si la variable no existe, está vacía o tiene cualquier valor que no sea `true`, Patty queda apagada aunque `GEMINI_API_KEY` u `OPENAI_API_KEY` estén cargadas.

Qué pasa con el interruptor apagado:

| Dónde                                  | Comportamiento                                                                                                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai-gateway.server.ts`         | `gatewayChat` lanza `IaPausadaError` (`code: "AI_DISABLED"`) antes de armar el request: no hay `fetch`. `resolverProveedorIa()` devuelve `null`.                                                                                          |
| Notas clínicas (`notas-clinicas.tsx`)  | En lugar de los botones de Patty se ve "Patty está en habilitación…". Escribir, guardar, firmar, revisar y exportar funcionan igual. `generateNoteText` y `extractNoteEntities` cortan antes de consultar al paciente o llamar al modelo. |
| WhatsApp (`intencion-de-agenda-ia.ts`) | `interpretarConIA` devuelve `null` sin llamar al modelo. El webhook sigue con las reglas deterministas y, si no alcanzan, con el aviso genérico al equipo.                                                                                |
| Páginas públicas, `/llms.txt`, schema  | Patty figura "en habilitación", en futuro. Las páginas no se borraron.                                                                                                                                                                    |

Lo prueba `tests/patty-pausada.test.ts` (puro: espía de `fetch`, sin red ni base).

## Por qué está pausada

Hallazgos de la auditoría 360 del 18-oct-2026 (`00 - Gestion/auditorias/2026-10-18-auditoria-360-total/hallazgos/05-ia-datos-analitica.md` y `99a`): IA-01, IA-02, IA-03, IA-04, LEG-01, SEG-04.

1. **Nivel gratuito de Gemini (IA-01).** La clave de producción es del nivel sin facturación. En ese nivel Google puede usar el contenido para mejorar sus productos y lo pueden leer revisores humanos. Eso contradice `/privacidad` y `/dpa`, que prometen que los datos no se usan para entrenar IA.
2. **Términos de Gemini API (IA-03).** Prohíben el uso "in clinical practice", aunque se pague. Patty redacta documentación clínica dentro de la ficha. Un abogado tiene que confirmar si eso queda dentro o fuera.
3. **Se enviaba PII sin necesidad (IA-02).** El prompt llevaba nombre completo y edad exacta del paciente. Ya está corregido (ver abajo), pero mientras 1 y 2 sigan abiertos, Patty no vuelve.

Exposición real hasta la pausa: prácticamente nula (0 usos de IA registrados y 0 clínicas activas al 18-oct). La pausa evita que el primer piloto la active.

## Lo que ya quedó listo para cuando vuelva

- **Minimización (IA-02)** en `src/lib/ai/minimizacion.ts`:
  - El contexto del paciente (`construirContextoPaciente`) no lleva nombre ni edad exacta: tramo de 10 años (`40-49 años`, `menor de 18 años`, `80 años o más`), etiquetas, última visita y los últimos 4 eventos.
  - `gatewayChat` pasa todo texto de usuario por `redactarPii`: quita nombre, documento, teléfono y email del paciente por valor exacto (los busca el servidor en `patients`, no los manda el cliente) y, además, cualquier email, RUT, CURP o número de 8+ dígitos escrito a mano. Las fechas se conservan.
  - Límite conocido: el filtro genérico no reconoce nombres de terceros escritos en los apuntes ("vino con su hija Ana"). La capa de valor exacto solo conoce al paciente de la ficha.
- **PDF clínico (IA-04):** las entidades que extrajo la IA y nadie validó salen con el rótulo "Sugerido por IA, sin validar", con una leyenda al inicio de la sección (`src/lib/clinical/note-pdf.ts`).

## Requisitos para reactivarla

Todos, no alguno:

1. **Proveedor con contrato para datos de salud.** Recomendado: Vertex AI (Google Cloud) con el Cloud Data Processing Addendum aceptado, o equivalente de otro proveedor. No vale la API de Gemini de AI Studio (ni gratis ni paga) mientras sus términos excluyan la práctica clínica.
2. **Región definida**, idealmente `southamerica-east1` (São Paulo, la misma que Supabase), y constancia en el subencargado de `/privacidad` y `/dpa`.
3. **Sin entrenamiento con los datos**: confirmado por contrato, no por suposición.
4. **OK del abogado** sobre el uso "redactar documentación clínica a partir de apuntes del profesional" (revisión legal en `03 - Legal y Cumplimiento/`).
5. **Evals mínimos (IA-05)** con casos sintéticos, nunca datos reales, corridos contra el modelo elegido:
   - Apuntes → SOAP: 30 casos con hechos que no deben aparecer. Meta: 0 hechos inventados en el set.
   - Nota → entidades: 30 casos con respuesta esperada. Medir precisión y recall por tipo; ninguna alergia inventada.
   - WhatsApp → intención y fecha: 50 mensajes anonimizados. Medir exactitud de intención y de fecha.
   - 20 SOAP revisados por un odontólogo.
6. **Cupo y costo por clínica (IA-06)** y timeout en la llamada al modelo (IA-07), para que la demo pública no consuma la cuota de clínicas reales.
7. **Textos**: volver a pasar a presente las páginas públicas (`src/content/paginas/funciones-patty-ia.ts` y las que dicen "en habilitación"), `llms-base.md`, `seo.ts` y la sección Patty de `src/routes/index.tsx`; actualizar `MENSAJE_IA_PAUSADA` en `src/lib/ai/estado.ts` solo si cambia el texto.

El gateway es agnóstico: cambiar a Vertex AI es cambiar URL y autenticación en `resolverProveedorIa` (`ai-gateway.server.ts`).

## Cómo prender el interruptor

Solo con los requisitos cumplidos y con OK de Walter:

1. Probar primero en local o en un preview: `AI_ENABLED=true` en `.env` junto con la clave del proveedor.
2. En Vercel, agregar `AI_ENABLED` con valor `true` al entorno que corresponda (Preview antes que Production) y redeployar: la variable se lee en runtime, pero un deploy nuevo asegura que todas las instancias la tomen.
3. Verificar en la ficha de un paciente de prueba que aparezcan los botones de Patty y que la auditoría de la nota registre el uso.

Para apagarla otra vez: borrar `AI_ENABLED` (o ponerla en `false`) y redeployar. No hace falta tocar las claves.
