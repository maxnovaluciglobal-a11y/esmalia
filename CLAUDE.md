# CLAUDE.md — Esmalia

Guía para Claude Code en este repositorio. Complementa `~/Documents/CLAUDE.md` (workspace) y `../../CLAUDE.md` (negocio); este archivo manda en lo técnico del producto. Detalle histórico: memoria del proyecto en `~/.claude/memoria/esmalia/` y `git log`.

## Qué es Esmalia

SaaS de gestión para clínicas dentales de LatAm (CL/MX/CO/PE/AR). Repo, carpeta, Vercel, Supabase y nombres internos (`ESMALIA_STAFF_EMAILS`, claves `esmalia:*` de `localStorage`, `demo@esmalia.com`, clave de Vault `esmalia_document_id_key`) usan el mismo nombre. Los identificadores anteriores se aceptan en un solo lugar, `src/lib/compat/nombres-anteriores.ts`, que se borra desde el 2026-11-12.

- Sistema visual: tokens en `src/styles.css` (papel/tinta/ocre, modo oscuro), Cormorant (títulos) + Instrument Sans (texto y UI) + Geist Mono solo en datos con la utilidad `cifra`. La landing (`/`, componentes en `src/components/marketing/v2/`) usa además Bricolage Grotesque en titulares grandes y cifras, solo ahí (lo vigila `tests/tipografia.test.ts`). Logo: `docs/MARCA.md`. Brief de marca: `../../04 - Marca y Diseno/2026-10-09-prompt-identidad-esmalia-saas.md`.
- Desacoplado de Lovable el 31-ago-2026 (`docs/DESACOPLE_LOVABLE.md`): Lovable no es editor ni fuente de nada.

## Ubicaciones y accesos

| Qué                 | Dónde                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local               | `~/Documents/01 - Maxnova Luci Global/04 - Esmalia/05 - Producto/esmalia/` (⚠️ ruta con espacios: citar siempre). Worktrees de agentes en `.claude/worktrees/`                                                                                                                                                                                                               |
| GitHub              | `maxnovaluciglobal-a11y/esmalia`, rama `main`. **Repo público**                                                                                                                                                                                                                                                                                                              |
| Vercel              | proyecto `esmalia`, team `maxnovaluci-global`, **plan Pro** desde el 19-oct-2026 (US$20/mes, 1 asiento; Fluid Compute, crons horarios). Prod `https://esmalia.com` (DNS en Cloudflare). El dominio `.vercel.app` original redirige las páginas públicas con 308 y sigue sirviendo `/auth`, `/portal*`, `/api/*` y la app. Node 24.x. **Push a `main` = deploy a producción** |
| Supabase            | `hvfkygoguxvpmwslrccb` (`esmalia-prod`, `sa-east-1`, org MaxnovaLuci, plan Pro). Sin PITR: snapshot diario                                                                                                                                                                                                                                                                   |
| Supabase huérfano   | proyecto de Lovable Cloud `9f5bde21-…`: legado, solo para un rollback histórico                                                                                                                                                                                                                                                                                              |
| Docs clave          | `docs/Esmalia_Documento_Maestro_v2.md` · `docs/ROADMAP.md` (única fuente) · `docs/SLO.md` · `docs/RUNBOOK_MIGRACIONES.md` · `docs/TESTS.md` · `docs/BACKUPS.md` · `docs/DISASTER_RECOVERY.md` · `docs/MFA.md` · `docs/IA.md` · `docs/WHATSAPP_META.md` · `docs/MEDICION.md`                                                                                                  |
| Backups             | `.github/workflows/backup.yml`, diario, cifrado con `age` y subido a B2. Clave privada fuera del repo (`docs/BACKUPS.md`)                                                                                                                                                                                                                                                    |
| Estado del servicio | `https://esmalia.com/estado`: lee `/api/health` desde el navegador + incidentes versionados en `src/content/incidentes.ts`                                                                                                                                                                                                                                                   |

## Correr en local

- App: `preview_start({name: "esmalia"})` (puerto 8080) o `npm run dev`. Credenciales de prueba: memoria local, nunca en el repo.
- Chequeos: `npm run typecheck` y `npm run lint` (0 errores).
- Tests: la suite corre contra un **Supabase efímero en Docker**, nunca contra producción (`docs/TESTS.md`): `bash scripts/test-db/start.sh` → `set -a; source .env.test; set +a` → `npm test` → `bash scripts/test-db/stop.sh`. Los tests puros corren sin base: `npx vitest run tests/<archivo>.test.ts`. `tests/setup/guard-produccion.ts` aborta si alguna variable apunta a prod. **Nunca exportar `PGPASSWORD`/`SUPABASE_SERVICE_ROLE_KEY` de prod en la terminal donde corren tests.**
- CI (`.github/workflows/ci.yml`): typecheck, lint y la suite completa contra la base efímera, sin ningún secret.
- `pre-commit` (husky) corre `lint-staged`: `check-invisibles`, `eslint --fix` y `prettier`.

## Stack

TanStack Start (SSR) + React 19 + Vite 8 + TypeScript + Tailwind 4 + shadcn/ui (`src/components/ui/`) + Supabase (auth/DB/storage/realtime) + Sentry v10 (activo con `VITE_SENTRY_DSN`). Sin luxon (usar `Intl.DateTimeFormat`), sin libphonenumber, sin Twilio.

## Estado (19-oct-2026)

Producción con cobro en USD por Stripe (`/precios`: Solo US$29, Clínica US$69). Lo último que cambió cómo se trabaja (PRs #64-#79, auditoría 360 del 18-oct-2026):

- **Patty (IA) pausada** (#70): interruptor de servidor `AI_ENABLED` (apagado salvo `"true"`). Con él apagado no sale ningún dato a un modelo; los textos públicos la dan "en habilitación". Cómo reactivarla: `docs/IA.md`.
- **MFA TOTP** (#65): obligatorio (`aal2`) para el staff de `/admin`, recomendado al owner, opcional al resto; la demo no puede inscribir factores. RLS que exige `aal2` a quien tiene MFA: PR #72, pendiente. `docs/MFA.md`.
- **Pacientes se archivan, no se borran** (#79): sin política ni permiso de DELETE en `patients`; `archived_at`/`archived_by` por trigger (owner/admin). Las FKs clínicas → `patients` son `RESTRICT`. Las notas firmadas no vuelven a borrador: se corrigen con **adenda**; la firma registra nombre, matrícula y hash; nota + versión se guardan juntas con `guardar_nota_clinica`. La fusión de fichas no mueve documentos firmados: se leen desde la ficha destino.
- **Exportación completa de la clínica** (#67): owner/admin desde `/ajustes` (ZIP de CSVs armado en el cliente). Cada exportación queda en `clinic_data_exports` vía RPC `SECURITY DEFINER`.
- **CI con base efímera** (#71), lecturas de ficha registradas y `document_id` cifrado (#74), medición del embudo sin cookies (#68), WhatsApp con baja en servidor (#66, #75).

## Reglas obligatorias

1. **RLS en toda tabla nueva**, con los helpers `is_clinic_member`, `has_clinic_role`, `can_manage_clinic`. Toda función `SECURITY DEFINER` revoca `EXECUTE` a `PUBLIC, anon` (lo vigila `tests/permisos-funciones-definer.test.ts`).
2. **`clinical_notes*` solo owner/admin/dentist/assistant.** `payments` excluye assistant. No revertir sin auditoría.
3. **Nunca `git push --force` a `main` ni pushear a `main` directo**: se trabaja en una rama (o worktree) y PR; Walter mergea.
4. **`src/integrations/supabase/types.ts` se parchea a mano** al agregar tabla/enum (bloques `Row/Insert/Update/Relationships` + `Enums`), en orden alfabético para no chocar con otros PRs. `npm run types:gen` existe pero requiere `supabase login`.
5. **Migraciones:** archivo versionado en `supabase/migrations/` (versión asignada, nunca editar una aplicada) + tabla nueva en `scripts/backup-tables.mjs` (lo vigila `tests/backup-tables-sync.test.ts`). **Aplicarla en prod requiere OK de Walter** y se hace **justo antes de mergear**, siguiendo `docs/RUNBOOK_MIGRACIONES.md`: `npx supabase db query --linked -f "<ruta ABSOLUTA>"` desde el checkout principal (Management API, sin contraseña) o `psql` por el pooler con `--single-transaction`.
6. **Dinero:** `bigint` cents. `formatMoney(cents, currency)` respeta ISO zero-decimal; `currency` es obligatorio; inputs con `MoneyInput`. Nunca dividir por 100 asumiendo.
7. **Fechas:** `hoyISO(timezone)` con `access.clinic?.timezone`, nunca sin argumento; `wallTimeInTzToUtc` para `<input datetime-local>`. En servidor, "hoy" de la clínica con `hoyEnLaClinica(clinics.timezone)`, nunca el reloj UTC.
8. **Correlativos** vía RPC atómica `next_clinic_counter(clinic_id, kind, year)`. Nunca `count(*)+1`.
9. **Nunca UPDATE de eventos versionados** (`odontogram_marks`, `clinical_note_versions`): INSERT + trigger que cierra la anterior.
10. **Snapshots inmutables** de catálogo (`name_snapshot` + FK `ON DELETE SET NULL`).
11. **Nullable en vez de fabricar cero** (`saldo`, `no_show_risk`, `ai_summary`): la UI muestra "Sin datos".
12. **`??`, no `||`**, cuando 0 es válido (bug real con `patient_cents` = 0).
13. **Nada de caracteres invisibles** en el fuente (`scripts/check-invisibles.mjs` en lint-staged); rangos de diacríticos escapados (`̀-ͯ`).
14. **La moneda nunca viaja desde el cliente**: el trigger `moneda_desde_la_clinica` la fija desde `clinics.currency`.
15. **Todo gate de permiso de la UI tiene su par en el servidor** (el JWT vive en `localStorage`). Dinero: `requireFinanceView`.
16. **La auditoría la escribe la base**: no insertar en `clinical_note_audit` desde la app (falla por RLS); los eventos no observables van por `registrar_evento_de_nota()`.
17. **Textos de UI en tuteo neutro** (sin voseo) y **colores solo con tokens** (nada de `amber-600` y similares): `tests/tuteo-neutro.test.ts` y `tests/sistema-color.test.ts`.

## Patrón de server function

```ts
// src/lib/*.functions.ts
export const doThing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]) // JWT + context.supabase con RLS del usuario
  .validator((input: unknown) => Schema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
  });
```

- Error genérico "No tienes permisos" cuando viene de una policy: no filtrar el motivo.
- Evitar embedded `select('t(col)')`: 2 queries + `Map`.
- Todo `.update()` filtra también por `clinicId` (defensa en profundidad).

## UI

- Rediseño A+ (plan del 19-oct-2026) encendido entero y sin flags desde el PR 13 (20-oct): shell en tinta con ⌘K y pastilla de conexión (`src/lib/shell.ts`), agenda con arrastre y semana por carriles, sugerencia odontograma → presupuesto y arqueo por denominación. No hay flags de UI; una variante nueva se prueba en rama, no detrás de un interruptor.
- Ficha `/pacientes/:id` es el hub (KPIs → notas → odontograma → finanzas → mensajes → timeline).
- Guards con `beforeLoad: requirePermission("perm")`; matriz en `src/lib/access.ts`. Simulación de rol disponible.
- Diálogos: Radix Dialog + `useMutation` + `invalidateQueries` + `toast`.
- Portal de pacientes `/portal/*` en vivo: sin login, link JWT firmado, 3 solicitudes/paciente/24 h.
- Páginas públicas nuevas: `PublicPageShell` (o `LegalPage` para prosa), y sumarlas al footer (`site-chrome.tsx`) y a `sitemap[.]xml.ts`.

## WhatsApp y mensajería (invariantes)

Detalle de Meta en `docs/WHATSAPP_META.md`; historia de cada fase en la memoria (`esmalia_f2…f5_*`).

- **Envío:** `sendWhatsAppFromTemplate` intenta la Cloud API de Meta (clínica `connected` + plantilla `approved`) y si no, cae a **wa.me manual**, que siempre funciona. Nunca bloquea el envío. Credenciales por clínica cifradas en `whatsapp_credentials` (sin políticas: solo service role).
- **Nada sale solo desde un cron.** Recordatorios y outreach (recall, reseña, saldo, cumpleaños, seguimiento, referidos) se calculan y el staff los despacha a mano en `/recordatorios`.
- **Baja:** `wa_opt_out_at` corta todo envío en el servidor. Palabras de baja en `baja-whatsapp.ts` ("CANCELAR" no es baja desde el 19-oct).
- **El webhook no confirma citas** (`confirmada` = lo aceptó el profesional). Si se quiere confirmación del paciente, va en un eje aparte. Orden del webhook: baja → confirmación → agenda → genérico (`tests/agenda-precedencia-webhook.test.ts`).
- **Resumen diario** (`/api/daily-digest`) y **correos de ciclo de vida** (`/api/lifecycle-emails`): disparo horario por Vercel Cron (minutos 37 y 47) y, de respaldo, GitHub Actions (minutos 7 y 17), los dos con `CRON_SECRET`; son idempotentes, así que el doble disparo no duplica nada. El resumen diario actúa entre 8:00 y 11:59 hora de la clínica y los correos de ciclo de vida entre 8:00 y 20:59 (la ventana ancha viene de cuando el único disparo era GitHub, que no es fiable; ver `docs/CORREOS.md`). Ninguno le escribe a pacientes.
- El interruptor de avisos en la app se respeta en la base (trigger `notifications_respetar_preferencia`).

## Contenido editorial (SEO/GEO)

- Páginas en `src/content/paginas/*.ts` (tipo en `src/content/tipos.ts`): crear el archivo alcanza para rutas, índices, sitemap y `/llms.txt`. Texto fijo de `/llms.txt` en `src/content/llms-base.md`.
- Toda afirmación respaldada por el código; competidores con fuente y fecha; guías normativas con `borrador: true` hasta tener revisor. Lo vigilan `tests/contenido-editorial.test.ts` y `tests/marca-unica.test.ts`.
- Estado real a respetar: WhatsApp en modo manual (la conexión por Meta está en habilitación), Patty en habilitación, no emite factura electrónica.
- Después de publicar: `node scripts/indexnow.mjs`.

## Herramientas

- **Leer prod sin contraseña:** `npx supabase db query --linked "<sql>"` y `npx supabase db advisors --linked`, desde el checkout principal. Escribir en prod: solo migraciones con OK (regla 5).
- **Crons:** `vercel.json` tiene `/api/demo-reset` (diario) y los horarios `/api/daily-digest` (minuto 37) y `/api/lifecycle-emails` (minuto 47). `.github/workflows/` (`daily-digest.yml`, `lifecycle-emails.yml`) los repite de respaldo en los minutos 7 y 17; el backup va en `backup.yml`.
- **Allowlists:** `ESMALIA_STAFF_EMAILS` = quién entra a `/admin`; `LEADS_NOTIFY_EMAILS` = a quién llega el aviso de lead.
- Cambios de `vercel.json` (headers, redirects) **no se ven en local**: verificar en un preview deploy. La CSP con nonce vive en `src/router.tsx` y sí se prueba en local (`curl -sD - http://localhost:8080/auth`).

## Gotchas

- Repo público: nunca contraseñas, claves ni datos de pacientes. `.env` gitignoreado; solo la publishable key es pública.
- `assets-privados/` está versionado: no es privado.
- Sentry no-op sin `VITE_SENTRY_DSN`.
- Sub-sistema de email/DNS ya construido (`/dominio-email`, `/pruebas-email`, `/sandbox-email`); cada clínica arranca con `email_sandbox_config` en `sandbox`.
- `npm` es el único gestor (sin `bun.lock`).

## Auditorías

- Seguridad (18-oct-2026): 64/64 tablas con RLS, ninguna policy `using (true)`, aislamiento multi-clínica probado en vivo, tablas de backend _fail-closed_. Método: memoria `auditoria-seguridad-metodo`.
- Auditoría 360 (18-oct-2026) y su plan de remediación: `../../00 - Gestion/auditorias/2026-10-18-auditoria-360-total/` (fuera del repo).
