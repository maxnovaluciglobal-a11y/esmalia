# Desacople de Lovable (2026-08-31)

Esmalia salió de Lovable por completo. Este doc explica qué se sacó, por qué era
seguro y qué habría que revisar si algo se rompe.

## Por qué se pudo sacar

El proyecto de Lovable (`aurora-clinic-ai`, workspace "Walter's Lovable") tiene
su **última actualización el 2026-08-11** — el mismo día del commit
`8d6205d Import Aurora Dental OS from Lovable`. Desde entonces:

- Los **140 commits** del repo son de la cuenta de Walter. Lovable nunca
  commiteó acá; fue un import de una sola vez.
- `7ca6301` (14-ago) ya había migrado de Lovable Cloud a Supabase propio.
- `c6f1861` + `9ebf9c8` (25-ago) ya habían sacado el auth de Lovable.

Es decir: el desacople venía hecho por partes y sólo quedaban los restos.

## Qué se sacó

| Pieza                                         | Qué era                                                                                                                           | Reemplazo                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@lovable.dev/vite-tanstack-config`           | preset de Vite que armaba toda la config                                                                                          | `vite.config.ts` propio (ver abajo)                                                                                                  |
| `src/lib/lovable-error-reporting.ts`          | reenviaba errores del boundary a `window.__lovableEvents`, hooks que **sólo existen dentro del editor** — en producción era no-op | `src/lib/error-reporting.ts` con `console.error` (queda en logs de Vercel). El reporte real ya lo hace **Sentry**, que sigue intacto |
| proveedor `lovable` en `ai-gateway.server.ts` | AI Gateway `ai.gateway.lovable.dev` con `LOVABLE_API_KEY`                                                                         | Cadena reducida a `GEMINI_API_KEY` → `OPENAI_API_KEY`                                                                                |
| `.lovable/project.json`                       | metadata del editor                                                                                                               | —                                                                                                                                    |

## Sobre el `vite.config.ts`

El preset activaba sus plugins propios (HMR gate, dev-server bridge, assets
proxy, diagnósticos de build) **sólo dentro del sandbox de Lovable**, detrás de
un `isSandbox`. Fuera de ahí — local y Vercel — no hacían nada, así que la config
nueva sólo replica lo que sí corría:

devtools de TanStack (dev), tailwindcss, tsConfigPaths, tanstackStart con
`importProtection` y el server entry en `src/server.ts`, nitro (sólo en build),
viteReact, el `define` de las `VITE_*`, `css.transformer: lightningcss`, el alias
`@`, el `dedupe` de React/TanStack, `optimizeDeps` y `server.host/port`.

Dos paquetes que venían como dependencia transitiva del preset pasaron a ser
devDependencies directas, fijadas a la misma versión que ya estaba instalada:
`@tanstack/devtools-vite@0.8.3` y `lightningcss@1.33.0`.

## Ojo: la IA está apagada en producción

Al revisar esto se encontró que **producción no tiene ninguna key de IA**. Las 13
env vars de prod son Stripe, Supabase, Numverify y `NITRO_PRESET` — no hay
`LOVABLE_API_KEY`, ni `GEMINI_API_KEY`, ni `OPENAI_API_KEY`.

O sea que `generateNoteText` y `extractNoteEntities` (notas clínicas) ya venían
fallando antes de este cambio. Sacar Lovable **no rompió nada que funcionara**:
para encender la IA hay que cargar `GEMINI_API_KEY` o `OPENAI_API_KEY` en Vercel.

## Ojo 2: Sentry está en el código pero apagado

`src/lib/sentry.ts` hace `if (!dsn) return;` antes de `Sentry.init()`, y en
producción **no existe ni `VITE_SENTRY_DSN` ni `SENTRY_DSN`**. Verificado en vivo:
`window.__SENTRY__` es `undefined` en el dominio `.vercel.app` original.

O sea que hoy Esmalia **no tiene ningún reporte de errores activo en producción**.
Esto no lo causó el desacople — el reporting de Lovable tampoco funcionaba fuera
del editor, así que el estado es el mismo de antes. Pero conviene saberlo: para
tener reporte real hay que cargar `VITE_SENTRY_DSN` en Vercel.

## Qué queda

- `.env.lovable-backup.1786756349` sigue en el disco local, **gitignored**. No se
  borró: puede tener valores de env que no estén en otro lado. Revisar y borrar.
- El repo se puede renombrar sin romper nada de Lovable, si se decide alinear el
  nombre con la marca Esmalia.
