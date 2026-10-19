> **Archivado el 2026-10-19: histórico, no vigente.** Lo reemplaza la auditoría 360 total del 18-oct-2026 (fuera del repo: `04 - Esmalia/00 - Gestion/auditorias/2026-10-18-auditoria-360-total/`); lo que quedó por hacer está en [`docs/ROADMAP.md`](../ROADMAP.md). Se conserva como registro de cómo se pensó y decidió en su momento; no lo uses como fuente de estado ni de planes. Las rutas `docs/…` que aparecen abajo apuntan a la ubicación anterior (hoy `docs/archivo/`). Motivo: hallazgo GOB-03 de la auditoría 360 del 18-oct-2026.

# Prompt: Auditoría 360° de Esmalia (pre-implementación)

> Uso: este documento es el brief para correr una auditoría multi-agente en rondas (investigación → contraauditoría → defensa → síntesis). Está pensado para ejecutarse con el tool `Workflow` de Claude Code (subagentes en paralelo, fases con barrera donde corresponde). No implementar nada hasta tener el reporte final aprobado por Walter.

## Contexto para el equipo

**Qué es Esmalia**: SaaS de gestión odontológica para clínicas LatAm (target CL/MX/CO/PE). Stack: TanStack Start (SSR) + React 19 + Vite 8 + TS + Tailwind 4 + shadcn/ui + Supabase propio (`hvfkygoguxvpmwslrccb`, sa-east-1) + AI Gateway (Lovable → Gemini → OpenAI fallback). Repo: `github.com/walterlamadriz-ai/esmalia` (público). Prod: el dominio `.vercel.app` original. Piloto real: clínica "Patricia" (Chile).

**Estado al 2026-08-21**: Fases 0 a 6 (pacientes, agenda, odontograma, presupuestos/planes, pagos, WhatsApp) completas. Desde la última auditoría (15-ago) se sumó: offline-first completo (4 tandas, lectura+escritura con resolución de conflictos), WhatsApp Fase 1-4 completas (outreach aprobado por staff, lista de espera, captación de leads, comunidad/referidos), backups a B2 cifrados con age (falta que Walter cree el bucket), billing skeleton Stripe (tabla + webhook, sin gate duro todavía), isotipo/logo definitivo ("Cúspide"), naming reabierto (Esmalia vs Alik, sin decidir).

**Auditoría previa (15-ago)**: 4 agentes (seguridad, arquitectura, producto, landing) sobre el código de esa fecha. Todos los críticos de esa ronda ya están resueltos y commiteados. **Esta auditoría NO es continuación de esa — es una auditoría nueva sobre todo lo construido hasta hoy**, con un objetivo adicional que la anterior no tuvo: decidir explícitamente qué agregar y qué sacar, no solo qué arreglar.

**Competidores ya mapeados una vez** (LatAm): Dentalix, Dentiqa, DtDental, Dentalink, DentalCore, Doctocliq. Para esta ronda, el equipo debe ampliar la investigación a jugadores globales serios (Dentrix, Curve Dental, Denticon, tab32, Open Dental, Weave) y a herramientas AI-native emergentes en gestión clínica, no quedarse solo con la lista anterior.

**Momento de negocio**: pre-lanzamiento, solo founder (Walter), objetivo inmediato es 3-5 clínicas piloto reales, no escala. Las recomendaciones tienen que pesar esto — features que solo importan con 50+ clínicas son ruido ahora.

## Objetivo de la auditoría

1. Evaluar todo lo construido hasta hoy en todas las dimensiones relevantes (no solo bugs — valor de producto).
2. Para cada dimensión, investigar en paralelo cómo resuelven el mismo problema 3-5 competidores reales (LatAm + global) y traer lo mejor encontrado — con fuente verificable, no de memoria.
3. Responder explícitamente dos preguntas por cada área: **¿qué función de valor falta que deberíamos agregar?** y **¿qué función ya construida no está aportando valor real y deberíamos sacar o simplificar?**
4. Multi-ronda con debate real: cada hallazgo lo cuestiona un especialista distinto al que lo escribió, el autor defiende o cede, y solo lo que sobrevive entra al reporte final.
5. Un único reporte consolidado, con conclusiones priorizadas y accionables. **No se implementa nada en esta fase** — es diagnóstico y decisión.

## Equipo (dimensiones + mandato)

1. **Seguridad & compliance de datos de salud** — RLS, PHI, portal de paciente (JWT firmado), webhook de WhatsApp, manejo de secrets, y específicamente regulación de historia clínica por país (Chile Ley 21.719, Colombia Resolución 2275, México LFPDPPP). Comparar cómo las competidoras comunican/resuelven compliance.
2. **Arquitectura & deuda técnica** — schema Supabase, patrones RLS/triggers, escalabilidad multi-tenant, calidad real de CI/tests, robustez del offline-first bajo conflicto real.
3. **Producto: gap analysis vs. competencia** — comparación feature-by-feature contra 6-8 competidores reales, marcando gaps P0/P1/P2 y distinguiendo diferenciación real (tracción esperable) de "nice to have" sin evidencia de que importe.
4. **UX de uso clínico real** — flujo de un día real de dentista/recepcionista (no solo demo), accesibilidad básica, usabilidad offline en consultorio con mala señal.
5. **Growth, pricing y monetización** — validar los US$49/mes flat contra lo que cobra la competencia LatAm real, setup fee, trial, elasticidad de precio para clínicas chicas.
6. **Operación / go-to-market con un solo founder** — qué falta para operar 5-10 clínicas reales sin que Walter colapse: soporte, onboarding, SLA, estado real de backups/DR.

Cada dimensión la lleva el especialista más calificado disponible para esa área (seguridad de aplicaciones + privacidad de datos; arquitectura de software + bases de datos; producto + estrategia de negocio; investigación UX + accesibilidad; análisis de pricing + growth; operaciones + éxito de cliente).

## Mecánica de ejecución (rondas)

**Ronda 1 — Investigación independiente.** Cada especialista audita su área contra el código real (rutas, tablas, RLS, funciones — citando archivo:línea) e investiga en paralelo 3-5 competidores reales (sitios públicos, pricing pages, docs, reviews — citando fuente). Nunca opinar sin evidencia. Salida: lista de hallazgos, cada uno con qué / por qué / evidencia / impacto (alto-medio-bajo) / esfuerzo estimado / veredicto tentativo (agregar / sacar / mantener / diferir).

**Ronda 2 — Contraauditoría cruzada.** Cada hallazgo lo revisa un especialista distinto al autor, con mandato explícito de intentar refutarlo: ¿la evidencia es real? ¿el gap importa para el piloto de 3-5 clínicas o es prematuro? ¿la comparación con el competidor es justa (tamaño/mercado distinto)?

**Ronda 3 — Defensa.** El autor original responde a la refutación con más evidencia, o ajusta/retira la recomendación.

**Ronda 4 — Síntesis final.** Un rol único de síntesis consolida solo lo que sobrevivió el debate en el reporte final, ordenado por impacto, con veredicto claro y próximo paso concreto por ítem.

## Reglas no negociables

- Nada de opiniones sin evidencia: código real (archivo:línea) o fuente pública verificable del competidor (URL).
- Nada de recomendaciones genéricas de SaaS ("agregar analytics", "mejorar el onboarding") — todo atado a este código y a este momento del negocio.
- Distinguir explícitamente "bloqueante para pilotos pagados ya" vs. "importa cuando haya escala real" — la auditoría del 15-ago mezcló ambos una vez, no repetir el error.
- Toda recomendación de "sacar/simplificar" debe decir explícitamente qué se pierde al sacarlo, no solo qué se gana.
- Reporte final en español rioplatense, directo, sin relleno.
- No tocar `10 - Personal/` ni nada fuera de `05 - Esmalia/`.
- No commitear ni deployar nada — es solo diagnóstico.

## Entregable

Reporte único en markdown con:

1. Resumen ejecutivo (5-8 líneas, veredicto general).
2. Tabla de recomendaciones finales: Ítem | Agregar/Sacar/Mantener/Diferir | Impacto | Esfuerzo | Evidencia | Qué se pierde/gana.
3. Detalle por dimensión: hallazgos que sobrevivieron el debate + los descartados en Ronda 2/3 y por qué (transparencia del proceso).
4. Comparación competitiva resumida (tabla feature × Esmalia × competidores relevantes).
5. Próximos pasos sugeridos — explícitamente fuera de esta auditoría, la implementación queda para después con aprobación de Walter.
