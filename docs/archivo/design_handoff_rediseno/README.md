# Handoff: Esmalia — rediseño de landing y app

## Cómo usar esto con Claude Code (lo más sencillo)

1. Descomprime esta carpeta **dentro del repo de Esmalia**, en `docs/design_handoff_rediseno/`.
2. Abre Claude Code en la raíz del repo y pega, una fase por vez:
   > Lee `docs/design_handoff_rediseno/README.md` y abre el HTML de referencia. Implementa **solo la Fase 1** en una rama `redesign/fase-1`. Respeta los patrones del repo (TanStack Router, Tailwind v4, componentes en `src/components/ui`). Al terminar corre typecheck, lint y tests, y muéstrame el diff antes de hacer commit.
3. Revisa el preview de Vercel de esa rama, haz merge y pasa a la fase siguiente.

No pidas todo de una vez: cada fase es un PR que se puede desplegar por sí solo.

## Sobre los archivos de diseño

`esmalia-rediseno.dc.html` es una **referencia de diseño en HTML**, no código de producción. Ábrelo en el navegador: es un lienzo con 6 paneles (1a–1f). La tarea es **recrear estas pantallas en el código existente** (React 19 + TanStack Start + Tailwind v4 + Supabase), reutilizando sus componentes y rutas.

## Fidelidad

**Alta fidelidad** en la estructura, la jerarquía, el copy y los tokens. Las cifras (−40%, precios en CLP, nombres de pacientes) son ilustrativas: los datos reales vienen de Supabase. Los logos y el testimonio son placeholders y requieren permiso de las clínicas piloto.

## Fases (orden obligatorio)

### Fase 0 — Desbloqueos de negocio (semana 1, sin código de UI)

- Cerrar el naming y el dominio; migrar a la vez OAuth de Google, el webhook de Stripe, `PUBLIC_APP_URL` y `EMAIL_FROM`.
- Cuenta de Stripe propia (hoy Checkout muestra “DypOS”).
- Hacer push de los commits pendientes de `main` antes de abrir ramas.
- **Listo cuando:** el checkout y los emails salen con la marca y el dominio de Esmalia.

### Fase 1 — Sistema visual único (semanas 1–2)

- En `src/styles.css`, reemplazar los tokens actuales (teal de la app; clay/ink/mint/bone de la landing) por los tokens de abajo, en un único bloque `:root` mapeado al `@theme` de Tailwind.
- Fuentes en `src/routes/__root.tsx`: Cormorant Garamond (títulos) y Lora (cuerpo). Quitar Outfit, Schibsted y Newsreader.
- `src/components/ui/button.tsx`: el botón primario es **outline** (borde de acento de 1px, fondo transparente) y nunca va relleno; el secundario lleva borde hairline; el ghost es solo texto. `badge.tsx` usa tintes de las rampas y siempre lleva texto. `card.tsx` lleva borde y no tiene relleno.
- Eliminar `hero-aurora`, `hero-grain`, las tarjetas rotadas y las sombras pesadas.
- **Listo cuando:** `grep -rE "clay-|ink-|mint-|bone" src/` no devuelve resultados.

### Fase 2 — Landing nueva (semanas 2–3) — panel 1b

Archivos: `src/routes/index.tsx`, `src/components/site-chrome.tsx`, `src/lib/pricing-display.ts`.
Secciones, en orden:

1. **Nav:** Esmalia · Producto · Precios · Calculadora · Recursos · Ingresar · [Ver la demo].
2. **Hero** en 2 columnas (1fr / 1.05fr, gap de 56px):
   - Kicker: “Gestión dental · Chile, Perú, México, Colombia”.
   - Título H1 de 68px, peso 400, line-height .98: “Cada silla vacía / _es plata que no vuelve._”
   - Subtítulo: “Esmalia confirma tus citas por WhatsApp, lleva la ficha y el odontograma, y te dice cada noche cuánto entró y cuánto te deben. Sin instalar nada.”
   - CTA primario “Entrar a la demo, sin registro” → `/demo`; CTA ghost “o crea tu clínica gratis →” → `/signup`.
   - Microcopy: 14 días gratis · Sin tarjeta · Exportas tus datos cuando quieras.
   - A la derecha va la **pantalla “Hoy” construida en HTML** (no una imagen): 3 KPIs, 4 filas de agenda con etiqueta de estado y una línea de WhatsApp.
3. **Franja de clínicas piloto:** filete hairline arriba y abajo.
4. **Calculadora de fugas embebida:** reutilizar la lógica de `/calculadora-rentabilidad-dental`. Pide citas/mes, % de ausencias y ticket medio. Resultado: pérdida mensual = citas × % × ticket. Agregar el enlace al PDF de fugas. Sin pedir email.
5. **Tres resultados:** −40% ausencias / 24 h cobros / 1 ficha. Cada uno con un enlace a su pantalla dentro de la demo.
6. **Testimonio:** `public/landing/dentist.jpg` con tratamiento de _plate_ (mat de 1px) y la cita en Cormorant itálica de 30px.
7. **Precios:** selector de moneda (CLP/PEN/MXN/USD) usando `pricing-display.ts`; planes Solo, Clínica (recomendado, con borde de acento) y Red (“A medida”).
8. **Cierre:** “Ordena tu clínica esta semana.” + [Entrar a la demo] + [Hablar por WhatsApp] usando un `wa.me` real (`buildWaMeUrl`), no un `mailto`.

- **Voz:** tuteo neutro en todo el sitio; eliminar el voseo (“importás”, “pagás”) y la frase “No son features. Son resultados.”
- **Listo cuando:** Lighthouse ≥ 95 y el evento `demo_click` se registra.

### Fase 3 — Navegación de 6 destinos (semanas 3–5) — tabla en el panel 1a

Archivo: `src/components/app-shell.tsx` (`navGroups`).

| Destino   | Absorbe                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hoy       | dashboard, efectividad (resumen)                                                                                                                  |
| Agenda    | agenda, mi-agenda (filtro “Solo yo”), lista de espera                                                                                             |
| Pacientes | pacientes, fichas duplicadas, tratamientos, ortodoncia, laboratorios                                                                              |
| Mensajes  | conversaciones, recordatorios, whatsapp (en pestañas)                                                                                             |
| Caja      | cajas, gastos, cobro                                                                                                                              |
| Reportes  | finanzas, morosidad, comisiones, efectividad, inventario                                                                                          |
| Ajustes   | equipo, permisos, compliance, aranceles, convenios, estados, sucursales, profesionales, consentimientos, preferencias, suscripción, dominio-email |

- Rutas nuevas: `ajustes.tsx` (índice), `mensajes.tsx`, `reportes.tsx`.
- Agregar **redirects** desde las rutas viejas para no romper los enlaces de emails y del digest diario.
- Búsqueda ⌘K (`global-search.tsx`) en la parte superior del sidebar.
- **Listo cuando:** ningún rol ve más de 7 entradas y los tests de permisos siguen en verde.

### Fase 4 — “Hoy” por rol + franja de estado (semanas 5–6) — panel 1c

- `dashboard.tsx`: encabezado con la fecha (kicker), saludo en H1 de 44px y las acciones [Nuevo paciente] [Agendar cita].
- Fila de 4 KPIs entre filetes, según el rol:
  - **Recepción:** citas hoy, confirmadas, en sala, por cobrar hoy.
  - **Dueño:** cobrado hoy, por cobrar, ausencias del mes, ocupación.
- Debajo, dos columnas (1.5fr / 1fr):
  - Izquierda: tabla de la agenda de hoy (Hora · Paciente · Profesional · Estado · Saldo).
  - Derecha: **cola accionable** (número + título + detalle + botón), que cambia según el rol, y el checklist “Activa tu clínica · n de 5” mientras dura el trial.
- `components/status-strip.tsx` (nuevo) reemplaza los banners de trial, demo, offline, sincronización pendiente y simulación de rol. Muestra una sola franja con prioridad: demo > offline > sync > trial > simulación.

### Fase 5 — Ficha del paciente y móvil (semanas 6–8) — paneles 1d y 1e

- `pacientes.$pacienteId.tsx`:
  - **Cabecera fija:** avatar con iniciales, nombre en H1 de 40px, línea de datos y las acciones [WhatsApp] [Cobrar] [Agendar].
  - Fila de 4 datos: próxima cita · saldo · plan activo · alerta médica.
  - **Pestañas:** Resumen, Odontograma, Notas clínicas, Presupuestos y pagos, Documentos, Mensajes.
- En el resumen, a dos columnas: odontograma + presupuesto a la izquierda y línea de tiempo (`paciente-timeline.tsx`) a la derecha.
- **Etiquetas de estado siempre con texto**; nunca solo color (hallazgo de la auditoría del 04-sep).
- **Móvil (<768px):** barra inferior con Hoy · Agenda · Pacientes · Mensajes · Caja; cola de confirmación con tarjetas y botones de 44px de alto.
- **Listo cuando:** recepción confirma una cita en ≤ 2 toques.

## Tokens de diseño

| Token                  | Valor                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| bg                     | `#f3f2f2`                                                             |
| surface                | `#eae9e9`                                                             |
| text                   | `#201f1d`                                                             |
| accent                 | `#b68235` (trazo, iconos y texto grande)                              |
| accent-700             | `#7d5411` (texto de acento a tamaño de cuerpo)                        |
| accent-100 / 200 / 300 | `#fff3e4` / `#ffe3bf` / `#facb8d` (tintes)                            |
| accent-600             | `#a06f24` (hover/pressed)                                             |
| neutral-200 / 300      | `#eae7e7` / `#d7d3d3`                                                 |
| divider                | `color-mix(in srgb, #201f1d 16%, transparent)`                        |
| font-heading           | Cormorant Garamond (máx. 600; display a 400)                          |
| font-body              | Lora                                                                  |
| spacing                | 4.6 · 9.2 · 13.8 · 18.4 · 23 · 27.6 · 32.2 · 36.8 px (`--space-1..8`) |
| radius                 | sm 2px · md 4px · lg 7px                                              |
| shadow-sm              | `0 1px 2px rgb(45 43 43 / .14)`                                       |
| shadow-md              | `0 3px 10px rgb(45 43 43 / .16)`                                      |
| shadow-lg              | `0 12px 32px rgb(45 43 43 / .22)`                                     |

**Reglas:**

- Color como borde o filete, nunca como relleno grande.
- Kickers de 11px en mayúsculas, con tracking de .12em, en accent-700.
- Cifras con `font-feature-settings: "tnum"`.
- Foco: `outline: 2px solid accent; outline-offset: 2px`.
- Iconos: Lucide (ya está en el repo).

El archivo completo de tokens y clases está en `_ds/.../styles.css` (incluido).

## Assets

- `assets/dentist.jpg` y `assets/patient.jpg`: ya existen en `public/landing/`.
- Logos de clínicas piloto y testimonio: **pendientes** (pedirlos a las clínicas).

## Archivos

- `esmalia-rediseno.dc.html`: lienzo de referencia. En el panel de Tweaks puedes alternar el rol (Recepción/Dueño) y las anotaciones.
- `support.js`, `_ds/`, `assets/`: necesarios para abrir el HTML.
