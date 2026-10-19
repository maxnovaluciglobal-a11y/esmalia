> **Archivado el 2026-10-19: histórico, no vigente.** Lo reemplaza la auditoría 360 total del 18-oct-2026 (fuera del repo: `04 - Esmalia/00 - Gestion/auditorias/2026-10-18-auditoria-360-total/`); lo que quedó por hacer está en [`docs/ROADMAP.md`](../ROADMAP.md). Se conserva como registro de cómo se pensó y decidió en su momento; no lo uses como fuente de estado ni de planes. Las rutas `docs/…` que aparecen abajo apuntan a la ubicación anterior (hoy `docs/archivo/`). Motivo: hallazgo GOB-03 de la auditoría 360 del 18-oct-2026.

# Prompt maestro: Auditoría de código y arquitectura de Esmalia (nivel ingeniería senior)

> Uso: brief para una auditoría técnica multi-agente, en paralelo, sobre el código real de Esmalia. A diferencia de `AUDITORIA_360_PROMPT_2026-08-21.md` (producto vs. competencia) y de la auditoría externa del 01-sep-2026 (seguridad de infraestructura, dinero/fiscal, growth, operación humana — ver `esmalia_auditoria_externa_20260901` en memoria), **esta es una auditoría de código e ingeniería**: arquitectura, rendimiento, calidad, deuda técnica y mejores prácticas del stack. No repetir lo que esas dos ya cubrieron. No implementar nada sin que Walter lo pida explícitamente después de leer el reporte.

## Rol

Sos un panel de ingenieros de software senior/principal haciendo due diligence técnica de un codebase real antes de que escale a más clientes pagos. Exigencia alta: lo que en un review normal pasaría como "está bien" acá se cuestiona si de verdad es la mejor decisión disponible, no solo si funciona. Cero tolerancia a hallazgos genéricos de linter — todo tiene que estar atado a este código, con archivo:línea, y explicar el escenario concreto donde falla o degrada.

## Contexto del proyecto

**Qué es Esmalia**: SaaS de gestión para clínicas dentales LatAm. Stack: TanStack Start (SSR) + React 19 + Vite 8 + TypeScript + Tailwind 4 + shadcn/ui (48 componentes vendored) + Supabase (Postgres + RLS + Vault + Realtime + Storage) + Stripe + Meta Cloud API (WhatsApp). Repo: `05 - Esmalia/` (ver `CLAUDE.md` del repo para las 11 reglas obligatorias del proyecto — RLS en toda tabla, `bigint` cents, `hoyISO(timezone)`, correlativos vía RPC atómica, nunca UPDATE de eventos versionados, etc. — cualquier hallazgo que contradiga esas reglas es automáticamente P0/P1, no una sugerencia de estilo).

**Por qué esta auditoría, y por qué ahora**: el codebase creció muy rápido (de 0 a producto con piloto real en ~3 semanas) a través de **muchísimas sesiones de agente distintas, varias corriendo en paralelo o directamente concurrentes** (hay incidentes documentados de un `git stash` que pisó cambios de otros agentes en la misma working tree, y de secretos de Supabase rotándose solos por tocar otra cosa en el dashboard). Ese modo de construcción es exactamente el que genera un tipo de deuda técnica que un review normal no ve: **inconsistencia entre módulos que resuelven el mismo problema de formas distintas**, porque cada sesión reinventó el patrón sin ver cómo lo había resuelto la sesión anterior. Buscar eso específicamente, no solo bugs aislados.

**Qué NO auditar en esta ronda** (ya cubierto, no repetir):

- Seguridad de infraestructura (backups, Vault/cifrado de PII, secrets de CI/Vercel) — ver auditoría externa 01-sep.
- Dinero/fiscal (Stripe, SII, gate de billing) — ver auditoría externa 01-sep.
- Naming, dominio, trademark, growth — ver auditoría externa 01-sep + `esmalia_naming_finalistas`.
- Gap de producto vs. competencia — ver `AUDITORIA_360_PROMPT_2026-08-21.md` y su reporte.
- RLS multi-clínica ya probado (`tests/multi-clinic-isolation.test.ts`, 6 tests pasando contra Supabase real) — no reprobar el aislamiento básico, sí auditar RLS de tablas **nuevas** desde la última pasada de seguridad (26-ago) que no hayan tenido un ojo dedicado.

## Metodología — no negociable

1. **Todo contra el código real de HOY**, no contra memoria ni contra lo que un commit dice que hace. Citar archivo:línea siempre. Si un hallazgo depende de correr algo (build, test, grep de un patrón en todo el repo), correrlo de verdad y pegar el resultado real, no asumir.
2. **Cuantificar cuando se pueda**: no "esto podría ser lento", sino "esta query trae N filas sin índice, con 500 pacientes son M ms" (medido o estimado con el plan de la query si hay acceso). No "hay código duplicado", sino "estos 4 archivos repiten esta misma lógica de 15 líneas, ver X/Y/Z/W".
3. **Priorizar por blast radius real dado el estado del negocio** (piloto, ~1 clínica real con datos reales, 0 clínicas pagando): un bug en el flujo de pacientes/historia clínica pesa más que uno en `/comisiones` que nadie usó todavía. Nota esto explícitamente en cada hallazgo.
4. **No genéricos de linter/AI-slop**: "usar `const` en vez de `let`", "agregar más comentarios", "considerar TypeScript strict mode" (ya está activado) no cuentan como hallazgo salvo que el caso puntual importe de verdad.
5. Nada de fixes en esta pasada — es diagnóstico. Reportar, no commitear.

## Dimensiones (una por especialista)

1. **Arquitectura y consistencia de patrones de datos** — RLS/`SECURITY DEFINER`/triggers a través de las ~40 tablas reales (no solo las de la última auditoría), consistencia del patrón "server function → `context.supabase` con RLS del user" en los ~35 archivos `*.functions.ts`, uso de `service_role` fuera de contexto server-only, columnas `enc`/versionadas que no siguen el patrón ya establecido (snapshot inmutable, `superseded_at`), y explícitamente: **¿dónde se resolvió el mismo problema de 2+ formas distintas por sesiones distintas?**

2. **Rendimiento y eficiencia** — bundle real por ruta (correr `npm run build:vercel` y mirar `.vercel/output/static/assets/`, no asumir), queries N+1 o sin `.in()`+`Map` en los server functions, falta de índices para patrones de acceso reales (leer las migraciones y cruzarlas contra las queries que las usan), trabajo pesado en el cliente que debería ser RPC/vista, over-fetching (`select("*")` donde alcanzaría con columnas puntuales), re-renders innecesarios en componentes de tablas grandes (pacientes, agenda).

3. **Seguridad de código** (no infraestructura — eso ya se auditó) — cobertura real de validación Zod en cada `inputValidator` vs. lo que realmente llega a SQL/RPC, superficie de XSS (`dangerouslySetInnerHTML`, contenido no sanitizado en templates de WhatsApp/email renderizados con datos de usuario), matriz `access.ts` vs. guards reales en cada server function (¿hay algún endpoint que la UI oculta pero el server no protege, mismo patrón que ya causó el PHI leak de la Fase 6?), manejo de errores que filtra información interna (nombres de tabla/columna/stack) al cliente.

4. **Calidad, duplicación y deuda técnica** — funciones/archivos que crecieron demasiado (candidatos a partir, CLAUDE.md ya marca `clinical-notes.functions.ts` y `finance.functions.ts` como candidatos), usos de `any`/`as unknown as`/type assertions que esconden un bug real, TODOs y código muerto, inconsistencia de idioma/voseo-tuteo en mensajes de error de cara al usuario, `types.ts` parcheado a mano — ¿qué tan desincronizado está hoy del schema real? (correr `npm run types:gen` contra una copia y diffear, sin sobrescribir el real).

5. **Cobertura de tests en rutas críticas** — mapear qué % de `*.functions.ts` que tocan dinero (`billing`, `finance`, `commissions`), PHI (`clinical-notes`, `clinical-documents`, `patients`) o permisos (`access`) tiene al menos un test real corriendo contra Supabase, no contra mocks. Identificar el gap de mayor riesgo (código crítico + cero tests), no listar cobertura en general.

6. **Mejores prácticas del stack específico** (TanStack Start/Router/Query 2025-2026, React 19, Supabase) — patrones obsoletos o no-idiomáticos para estas versiones puntuales (no consejos genéricos de React), manejo de `Suspense`/error boundaries, uso correcto de `createServerFn` vs. lógica que debería vivir en RPC de Postgres, oportunidades reales de usar Realtime de Supabase donde hoy se hace polling.

## Reglas no negociables

- Archivo:línea siempre. Comando/query real cuando el hallazgo lo permita verificar así.
- Explicitar impacto dado el momento del negocio (piloto real, 1 clínica con datos reales, 0 revenue) — no tratar todo como si fuera escala.
- Distinguir "esto va a romper con más volumen/clínicas reales" de "esto ya está roto hoy".
- Español rioplatense, directo, sin relleno. Sin genéricos de linter.
- No tocar código — solo lectura, greps, builds locales sin commitear, tests que no escriban en Supabase real sin confirmarlo antes.
- No salir de `05 - Esmalia/`.

## Entregable

Reporte único con: (1) resumen ejecutivo de 5-8 líneas con el veredicto general sobre si la arquitectura aguanta escalar a 10-20 clínicas reales tal como está; (2) hallazgos por dimensión, severidad P0/P1/P2, cada uno con archivo:línea + evidencia + impacto concreto + esfuerzo estimado; (3) síntesis de los 5 riesgos técnicos más grandes del codebase hoy, ordenados por impacto real (no por dimensión); (4) un "top 3 de inconsistencia entre sesiones" — los 3 casos más claros de que el mismo problema se resolvió de 2+ formas distintas en distintas partes del código.
