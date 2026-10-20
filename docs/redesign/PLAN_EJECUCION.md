# Rediseño Esmalia — plan de ejecución

Fuente: `docs/archivo/design_handoff_rediseno/` (README + lienzo `esmalia-rediseno.dc.html`, paneles 1a–1f).
Progreso vivo y punto de retome: [`PROGRESO.md`](./PROGRESO.md).

## Cómo se ejecuta

- Una rama por fase, apilada sobre la anterior: `redesign/fase-1` → `redesign/fase-2` → … Cada una es un PR desplegable por sí solo.
- **Nada se mergea a `main` ni se pushea sin OK de Walter** (push a `main` = deploy a producción).
- Gate de cada fase antes del commit: `npm run typecheck` verde, `eslint` sin errores nuevos en los archivos tocados, `vitest` igual que la línea base (401 ok; los 15 archivos que fallan son de integración y piden credenciales de Supabase), `npm run build` ok y verificación visual en el dev server (`localhost:8080`) en escritorio y 375px.
- Si la sesión se corta: leer `PROGRESO.md`, hacer `git checkout` de la última rama marcada y seguir con el primer ítem sin tildar.

## Línea base (06-oct-2026, `main` = `59895be`, al día con origin)

- typecheck ✅ · lint: 262 problemas previos (prettier en `src/components/ui/*` y en el worktree) · tests: 401 ✅, 15 archivos de integración ❌ por falta de env.

## Fase 0 — Desbloqueos de negocio (NO es código; depende de Walter)

Naming definitivo, dominio, cuenta de Stripe propia y migración de OAuth/webhook/`PUBLIC_APP_URL`/`EMAIL_FROM`. No bloquea las fases de UI. Los commits pendientes de `main` ya están subidos.

## Fase 1 — Sistema visual único

1. `src/styles.css`: un solo `:root` con los tokens del handoff (bg `#f3f2f2`, surface `#eae9e9`, text `#201f1d`, accent `#b68235` + rampas, divider, spacing, radius 2/4/7, sombras suaves). Los tokens semánticos de shadcn (`--primary`, `--border`, `--muted`…) se re-mapean a la paleta nueva → los 48 componentes y las ~35 pantallas cambian sin tocarlas una por una. Se mantiene `.dark` derivado de la rampa neutral (la app tiene toggle de tema).
2. Borrar `--clay/--ink/--mint/--bone`, `hero-aurora`, `hero-grain`, animaciones decorativas y `font-precise`.
3. `__root.tsx`: Cormorant Garamond + Lora; fuera Outfit, Schibsted y Newsreader.
4. `button.tsx` (primario outline con borde de acento, secundario hairline, ghost solo texto, foco 2px accent), `badge.tsx` (tintes + texto), `card.tsx` (borde, sin relleno ni sombra).
5. Reemplazar los ~250 usos de `clay-/ink/mint-/bone` en 70 archivos por tokens semánticos.

- **Listo cuando:** `grep -rE "(bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|divide|shadow)-(clay|ink|mint|bone)|--(clay|ink|mint|bone)" src/` = 0 (el grep literal del handoff da falsos positivos con `shrink-0`).

## Fase 2 — Landing nueva (panel 1b)

`src/routes/index.tsx`, `site-chrome.tsx`, `pricing-display.ts`: nav, hero 2 columnas con la pantalla "Hoy" en HTML, franja de pilotos, calculadora de fugas embebida (reutiliza la lógica de `/calculadora-rentabilidad-dental`, sin email, link al PDF), tres resultados con link a la demo, testimonio con _plate_, precios con selector CLP/PEN/MXN/USD y plan Red, cierre con `wa.me` real. Tuteo neutro en todo el sitio público; fuera "No son features. Son resultados.".

- **Listo cuando:** evento `demo_click` llega a `/api/ev` y Lighthouse ≥ 95 (medido en build local).

## Fase 3 — Navegación de 6 destinos (panel 1a)

`app-shell.tsx`: Hoy · Agenda · Pacientes · Mensajes · Caja · Reportes + Ajustes. Rutas nuevas `ajustes.tsx`, `mensajes.tsx`, `reportes.tsx` (hubs). Las rutas viejas **siguen existiendo** (enlaces de emails y digest no se rompen); los hubs las agrupan. ⌘K arriba del sidebar.

- **Listo cuando:** ningún rol ve más de 7 entradas y los tests de permisos siguen verdes.

## Fase 4 — "Hoy" por rol + franja de estado (panel 1c)

`dashboard.tsx` con kicker de fecha, saludo H1, 4 KPIs por rol (recepción / dueño), agenda de hoy en tabla y cola accionable + checklist de activación. `status-strip.tsx` reemplaza los 5 banners con prioridad demo > offline > sync > trial > simulación.

## Fase 5 — Ficha del paciente y móvil (paneles 1d y 1e)

Cabecera fija (avatar, nombre, datos, WhatsApp/Cobrar/Agendar, 4 datos), pestañas (Resumen, Odontograma, Notas clínicas, Presupuestos y pagos, Documentos, Mensajes). Estados siempre con texto. Barra inferior móvil (<768px) y cola de confirmación con objetivos de 44px.

- **Listo cuando:** recepción confirma una cita en ≤ 2 toques desde el celular.

## Riesgos y cómo se cubren

- **Datos de salud / permisos:** las fases no tocan RLS ni server functions; los hubs nuevos reutilizan `requirePermission` y `hasPermission` existentes.
- **Enlaces viejos:** no se borra ninguna ruta, así que no hacen falta redirects que puedan fallar.
- **Contraste:** accent `#b68235` sobre `#f3f2f2` no llega a AA en texto chico → texto de acento a tamaño de cuerpo usa `accent-700` (`#7d5411`), como pide el handoff.
