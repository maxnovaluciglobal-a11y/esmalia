# Captación: lead magnets + trial de 14 días — Plan de implementación

> **Para quien ejecute esto:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> checkbox (`- [ ]`) para seguimiento.

**Goal:** Que Esmalia pueda captar el contacto de un dueño de clínica dental que todavía no es
cliente, dándole una herramienta gratuita útil, y que el trial de 14 días que la landing ya promete
exista de verdad.

**Architecture:** Tres piezas independientes. (1) Cimientos: una tabla `marketing_leads` que no
cuelga de ninguna clínica —la primera del schema— escrita por una server function pública con el
patrón que Esmalia ya usa en el portal y el webhook de WhatsApp. (2) Una calculadora pública cuyo
cálculo vive en un módulo puro con tests y transcribe fórmulas reales del producto. (3) El trial de
14 días, que se enciende creando la fila en `subscriptions` que hoy nadie crea.

**Tech Stack:** TanStack Start (SSR) + React 19 + Vite 8 + TypeScript + Tailwind 4 + shadcn/ui +
Supabase (Postgres con RLS) + Zod + Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-captacion-lead-magnets-design.md` — leerlo antes de
empezar. Este plan argumenta desde ese documento.

---

## Global Constraints

Estas reglas aplican a **todas** las tareas. Salen de `CLAUDE.md` del repo y del spec.

- **Antes de empezar: `git pull` y verificar el estado de `main`.** Durante el diseño apareció un
  commit desde otra sesión concurrente. No asumir el estado descrito acá.
- **Migraciones: dos pasos.** (a) archivo versionado en `supabase/migrations/` con formato
  `YYYYMMDDHHMMSS_nombre_descriptivo.sql`; (b) aplicarla con
  `psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -f <archivo>`
  usando `PGPASSWORD` del `.env`. Sin el paso (b) el schema queda desfasado.
- **`src/integrations/supabase/types.ts` se parchea A MANO** al agregar tabla o enum: bloque
  `Row`/`Insert`/`Update`/`Relationships`. Verificar después con `npm run types:check`.
- **Toda tabla nueva va a `scripts/backup-tables.mjs`** (lista alfabética). El test
  `tests/backup-tables-sync.test.ts` **falla el CI nombrando la que falte**.
- **RLS habilitada en toda tabla nueva.** Los helpers `is_clinic_member` / `has_clinic_role` /
  `can_manage_clinic` asumen `clinic_id` y **no aplican** a `marketing_leads`.
- **Dinero: `bigint` cents.** `currency` es **obligatoria** en `formatMoney`/`toCents`/`fromCents`.
  CLP, COP y PYG tienen factor 1; MXN, PEN y ARS tienen 100. Nunca dividir por 100 asumiendo.
- **`??` y nunca `||`** para caer a un default cuando `0` es un valor legítimo.
- **Nada de caracteres invisibles en el fuente.** `scripts/check-invisibles.mjs` corre en
  lint-staged y rechaza el commit.
- **Todo gate de UI necesita su par en el servidor.** El JWT vive en `localStorage`.
- **Nunca `git push --force` a `main`.**
- **Nunca relajar la CSP.** `script-src 'self'` + nonce; `connect-src 'self'` + Supabase + Sentry.
  Nada de terceros: no PostHog, no Calendly, no GTM. Ya tumbó producción el 2026-08-15.
- **El CI corre contra la base de producción.** Un test que dependa de una columna nueva deja el CI
  rojo hasta aplicar la migración. Los tests de este plan son de lógica pura y no tocan Postgres.
- **Analítica: sólo buckets, nunca cifras** de la clínica. Sin cookies, sin `identify()`, sin PII.
- 🔴 **Benchmarks: sólo tres indicadores llevan semáforo** — ausentismo (10-30%, default 15%,
  literatura revisada por pares), overhead total (≈58%) y margen del dueño (≈24%), estos dos
  últimos **etiquetados como referencia de EE.UU.**, con fuente ADA Health Policy Institute,
  _2026 Survey of Dental Practice_. **Nunca mostrar rangos por categoría** (personal, insumos,
  laboratorio, arriendo): las cifras que circulan se atribuyen al ADA y **esa atribución es falsa**
  — el ADA no publica ese desglose. **Para LatAm no existe ningún dato publicable**: no inventar
  ninguno. Detalle en §5.2.4 del spec.
- ⚖️ **Ley 21.719 de Chile entra en vigencia el 1-dic-2026** y la carga de la prueba del
  consentimiento es nuestra. Guardar timestamp + texto literal aceptado. Baja tan fácil como el
  alta. Teléfono **opcional** (minimización). Checkbox separado para WhatsApp. Declarar el
  perfilamiento. Detalle en §5.1.6 del spec.
- **Nunca gatear**: `clinical:*`, `agenda:*`, `patients:*`, `/consentimientos`, `/compliance`,
  `/tratamientos`, `/aranceles`, exportación de datos, `/suscripcion`.
- **Comandos:** `npm test` (vitest run) · `npm run typecheck` · `npm run lint` ·
  `npm run types:check` · `preview_start({name: "esmalia"})` para el dev server (puerto 8080).
- **Commits en español**, formato `tipo(alcance): descripción`, terminando con
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Estructura de archivos

**Fase 0 — Cimientos**

- Crear `supabase/migrations/<ts>_captacion_marketing_leads.sql` — tablas `marketing_leads` y `marketing_events`
- Crear `src/lib/marketing/leads.ts` — normalización, buckets, validación pura (sin React, sin Supabase)
- Crear `tests/marketing-leads.test.ts`
- Crear `src/lib/marketing/leads.functions.ts` — `submitMarketingLead`, `listMarketingLeads`
- Crear `src/routes/api.ev.ts` — endpoint de eventos
- Modificar `scripts/backup-tables.mjs`, `src/integrations/supabase/types.ts`, `.env.example`

**Fase 1 — Calculadora**

- Crear `src/lib/marketing/calculadora.ts` — fórmulas puras
- Crear `tests/calculadora-rentabilidad.test.ts`
- Crear `src/routes/calculadora-rentabilidad-dental.tsx` — UI
- Crear `src/components/marketing/lead-form.tsx` — formulario reusable (calculadora + checklist)
- Modificar `src/routes/sitemap[.]xml.ts`, `src/components/site-chrome.tsx`, `src/routes/software-dental-latam.tsx`

**Fase 2 — Trial**

- Modificar `src/lib/billing.ts` — fix de `isSubscriptionActive` + `trialInformesBloqueados`
- Crear `tests/trial-gating.test.ts`
- Crear `supabase/migrations/<ts>_trial_nace_con_la_clinica.sql`
- Crear `src/components/trial-desbloqueo.tsx`
- Modificar las rutas de informes y `src/lib/finance/finance-reports.functions.ts`

**Fase 3 — Checklist**

- Crear `src/routes/recursos.fugas-clinica-dental.tsx`
- Crear `src/routes/api.recurso.$slug.ts` — entrega gateada del PDF
- Crear `scripts/build-pdf-recursos.mjs`

---

# FASE 0 — Cimientos de captación

## Task 1: Tablas `marketing_leads` y `marketing_events`

**Files:**

- Create: `supabase/migrations/<TIMESTAMP>_captacion_marketing_leads.sql`
- Modify: `scripts/backup-tables.mjs`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**

- Produces: tablas `public.marketing_leads` y `public.marketing_events`, ambas con RLS habilitada
  y **cero policies** (sólo `service_role` accede). Tipos `Database["public"]["Tables"]["marketing_leads"]`.

- [ ] **Step 1: Crear el archivo de migración**

Usar timestamp posterior a `20260907200000`. Contenido:

```sql
-- Captación de leads de marketing (calculadora, checklist, benchmark).
--
-- PRIMERA tabla del schema que NO cuelga de una clínica: un dueño de clínica
-- que usa la calculadora todavía no es cliente y no tiene clinic_id. Por eso
-- los helpers is_clinic_member/has_clinic_role NO aplican acá.
--
-- Estrategia de acceso: RLS habilitada y CERO policies. Nadie con un JWT de
-- usuario puede leer ni escribir; sólo service_role (que bypassea RLS) desde
-- las server functions. Es el mismo criterio por el que appointment_requests
-- no tiene GRANT INSERT para authenticated.

create table public.marketing_leads (
  id uuid primary key default gen_random_uuid(),

  -- Contacto: al menos uno de los dos (ver constraint abajo).
  email text,
  phone text,
  phone_valid boolean,
  name text,
  clinic_name text,
  country_code text,

  source text not null,
  utm jsonb,

  -- Calificación. SOLO buckets ("margen_bucket":"bajo"), nunca cifras de la
  -- clínica: el servidor no tiene por qué saber cuánto factura alguien que
  -- todavía no es cliente.
  meta jsonb,

  -- Consentimiento: se guarda el texto literal aceptado, no sólo un booleano.
  -- Si el copy del formulario cambia, seguimos sabiendo qué aceptó cada lead.
  consent_at timestamptz not null default now(),
  consent_text text not null,
  consent_whatsapp boolean not null default false,
  unsubscribe_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  unsubscribed_at timestamptz,

  delivered_at timestamptz,
  delivery_error text,

  -- Minimización: la IP sólo sirve para rate limit, así que guardamos el hash
  -- y no el dato personal.
  ip_hash text,
  user_agent text,
  submissions_count integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketing_leads_contacto_presente
    check (email is not null or phone is not null),
  constraint marketing_leads_source_valido
    check (source in ('calculadora', 'checklist', 'benchmark')),
  constraint marketing_leads_pais_valido
    check (country_code is null or country_code in ('CL', 'MX', 'CO', 'PE', 'AR'))
);

-- Únicos parciales: el mismo dentista que vuelve hace upsert, no fila nueva.
create unique index marketing_leads_email_key
  on public.marketing_leads (lower(email)) where email is not null;
create unique index marketing_leads_phone_key
  on public.marketing_leads (phone) where phone is not null;
create index marketing_leads_created_idx
  on public.marketing_leads (created_at desc);
-- El rate limit consulta por (ip_hash, created_at): sin este índice escanea.
create index marketing_leads_ip_hash_idx
  on public.marketing_leads (ip_hash, created_at desc);

create trigger marketing_leads_set_updated_at
  before update on public.marketing_leads
  for each row execute function public.set_updated_at();

alter table public.marketing_leads enable row level security;

-- Embudo mínimo propio: la CSP prohíbe PostHog/GA y sin medición no sabemos
-- si esto convierte. Sin cookies, sin identify, sin PII.
create table public.marketing_events (
  id bigserial primary key,
  name text not null,
  props jsonb,
  session_hash text,
  created_at timestamptz not null default now(),

  constraint marketing_events_name_valido
    check (name in ('calculadora_vista', 'calculadora_usada', 'lead_enviado', 'cta_click'))
);

create index marketing_events_name_created_idx
  on public.marketing_events (name, created_at desc);

alter table public.marketing_events enable row level security;
```

- [ ] **Step 2: Verificar que `set_updated_at` existe con ese nombre**

Run: `grep -rn "function public.set_updated_at\|create or replace function.*set_updated_at" supabase/migrations/ | head -3`
Expected: al menos un resultado. Si el nombre real difiere, ajustar el trigger del Step 1.

- [ ] **Step 3: Aplicar la migración a Supabase**

```bash
cd "/Users/walterlamadriz/Documents/05 - Esmalia"
set -a; source .env; set +a
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -f supabase/migrations/<TIMESTAMP>_captacion_marketing_leads.sql
```

Expected: `CREATE TABLE` ×2, `CREATE INDEX` ×5, `ALTER TABLE` ×2, sin errores.
(Si la variable del `.env` tiene otro nombre, buscarla con `grep -i password .env`.)

- [ ] **Step 4: Verificar contra la base real que RLS quedó sin policies**

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -c "select tablename, rowsecurity from pg_tables where tablename in ('marketing_leads','marketing_events'); select tablename, policyname from pg_policies where tablename in ('marketing_leads','marketing_events');"
```

Expected: `rowsecurity = t` en las dos tablas, y **cero filas** de policies. Verificar la base, no
el archivo — el archivo versionado no prueba que se aplicó.

- [ ] **Step 5: Agregar ambas tablas a `scripts/backup-tables.mjs`**

Insertarlas en la lista alfabética (`marketing_events` antes que `marketing_leads`, ambas después
de `lab_orders` y antes de `message_templates`, según el orden real del archivo).

- [ ] **Step 6: Verificar que el test de sincronía de backups pasa**

Run: `npm test -- backup-tables-sync`
Expected: PASS. Si falla, nombra exactamente la tabla que falta.

- [ ] **Step 7: Parchear `src/integrations/supabase/types.ts` a mano**

Agregar los bloques `Row` / `Insert` / `Update` / `Relationships: []` de ambas tablas, en orden
alfabético dentro de `Tables`. Tipos: `jsonb` → `Json`, `timestamptz` → `string`,
`bigserial` → `number`, nullable → `| null`.

- [ ] **Step 8: Verificar tipos y drift**

Run: `npm run typecheck && npm run types:check`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/ scripts/backup-tables.mjs src/integrations/supabase/types.ts
git commit -m "$(cat <<'EOF'
feat(captacion): tablas de leads de marketing y embudo propio

Primera tabla del schema que no cuelga de una clínica: quien usa la
calculadora todavía no es cliente. RLS habilitada y cero policies —
sólo service_role accede, mismo criterio que appointment_requests.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Módulo puro de leads (normalización, buckets, hash)

**Files:**

- Create: `src/lib/marketing/leads.ts`
- Test: `tests/marketing-leads.test.ts`

**Interfaces:**

- Consumes: `normalizeToWaMe` de `@/lib/messaging/messaging`, `COUNTRIES` de `@/lib/onboarding-types`.
- Produces:
  - `CODIGO_PAIS_TELEFONO: Record<"CL"|"MX"|"CO"|"PE"|"AR", string>`
  - `normalizarTelefonoPorPais(phone: string, country: PaisCaptacion): string | null`
  - `hashIp(ip: string, salt: string): Promise<string>`
  - `TEXTO_CONSENTIMIENTO: string`
  - `type PaisCaptacion = "CL" | "MX" | "CO" | "PE" | "AR"`
  - `type MetaLead = { margen_bucket, ausencias_bucket, conversion_bucket, retencion_declarada, pais }`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/marketing-leads.test.ts
import { describe, expect, it } from "vitest";
import { CODIGO_PAIS_TELEFONO, hashIp, normalizarTelefonoPorPais } from "@/lib/marketing/leads";

describe("normalizarTelefonoPorPais", () => {
  it("usa el código del país elegido, no el de Chile por defecto", () => {
    // normalizeToWaMe tiene defaultCountryCode = "56" hardcodeado. Un dentista
    // mexicano que escribe su número local no puede terminar con prefijo chileno.
    expect(normalizarTelefonoPorPais("5512345678", "MX")).toBe("525512345678");
    expect(normalizarTelefonoPorPais("912345678", "CL")).toBe("56912345678");
  });

  it("respeta un número que ya viene con código de país", () => {
    expect(normalizarTelefonoPorPais("+56912345678", "MX")).toBe("56912345678");
  });

  it("devuelve null si el número no es utilizable", () => {
    expect(normalizarTelefonoPorPais("", "CL")).toBeNull();
    expect(normalizarTelefonoPorPais("abc", "CL")).toBeNull();
    expect(normalizarTelefonoPorPais("123", "CL")).toBeNull();
  });

  it("cubre los cinco países soportados", () => {
    expect(Object.keys(CODIGO_PAIS_TELEFONO).sort()).toEqual(["AR", "CL", "CO", "MX", "PE"]);
  });
});

describe("hashIp", () => {
  it("es determinista con la misma sal", async () => {
    const a = await hashIp("203.0.113.7", "sal");
    const b = await hashIp("203.0.113.7", "sal");
    expect(a).toBe(b);
  });

  it("no deja la IP legible en el resultado", async () => {
    const h = await hashIp("203.0.113.7", "sal");
    expect(h).not.toContain("203.0.113.7");
    expect(h).toHaveLength(64);
  });

  it("distingue IPs distintas", async () => {
    expect(await hashIp("203.0.113.7", "sal")).not.toBe(await hashIp("203.0.113.8", "sal"));
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- marketing-leads`
Expected: FAIL — "Cannot find module '@/lib/marketing/leads'".

- [ ] **Step 3: Escribir la implementación mínima**

```ts
// src/lib/marketing/leads.ts
//
// Lógica pura de captación. Sin React, sin Supabase: se puede testear sin
// levantar nada y se importa tanto desde la UI pública como desde la server fn.

import { normalizeToWaMe } from "@/lib/messaging/messaging";

export type PaisCaptacion = "CL" | "MX" | "CO" | "PE" | "AR";

/** Prefijo telefónico por país. normalizeToWaMe tiene "56" fijo como default;
 *  acá lo elegimos según el país que el visitante seleccionó. */
export const CODIGO_PAIS_TELEFONO: Record<PaisCaptacion, string> = {
  CL: "56",
  MX: "52",
  CO: "57",
  PE: "51",
  AR: "54",
};

export function normalizarTelefonoPorPais(phone: string, country: PaisCaptacion): string | null {
  const limpio = (phone ?? "").trim();
  if (!limpio) return null;
  return normalizeToWaMe(limpio, CODIGO_PAIS_TELEFONO[country]);
}

/** SHA-256 hex de la IP con sal. Guardamos el hash y no la IP: para el rate
 *  limit alcanza, y así no persistimos un dato personal identificable. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const datos = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const TEXTO_CONSENTIMIENTO =
  "Autorizo a Esmalia a usar estos datos para enviarme el material solicitado y " +
  "comunicarse conmigo. Puedo pedir la baja en cualquier momento.";

export type MetaLead = {
  margen_bucket: "perdida" | "bajo" | "medio" | "alto" | "na";
  ausencias_bucket: "bajo" | "medio" | "alto" | "na";
  conversion_bucket: "baja" | "media" | "alta" | "na";
  retencion_declarada: boolean;
  pais: PaisCaptacion;
};
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test -- marketing-leads`
Expected: PASS (9 tests).
Si `normalizeToWaMe` rechaza un número válido de otro país, leer `messaging.ts:163` y ajustar el
test a lo que la función realmente garantiza — **no** debilitar la función.

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketing/leads.ts tests/marketing-leads.test.ts
git commit -m "$(cat <<'EOF'
feat(captacion): normalización de teléfono por país y hash de IP

normalizeToWaMe tiene "56" fijo como default: un dentista mexicano
habría quedado con prefijo chileno. La IP se guarda hasheada porque
sólo hace falta para el rate limit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Server function pública `submitMarketingLead`

**Files:**

- Create: `src/lib/marketing/leads.functions.ts`
- Modify: `.env.example`

**Interfaces:**

- Consumes: `normalizarTelefonoPorPais`, `hashIp`, `PaisCaptacion` de `@/lib/marketing/leads`;
  `validatePhoneNumber` de `@/lib/patients/phoneValidation`.
- Produces: `submitMarketingLead` (server fn POST) que devuelve `{ ok: true }` siempre que no haya
  error de validación; `listMarketingLeads` (server fn GET, autenticada).

- [ ] **Step 1: Escribir la server function**

```ts
// src/lib/marketing/leads.functions.ts
//
// Captura pública de leads. SIN requireSupabaseAuth a propósito: quien usa la
// calculadora no tiene sesión. Sigue el patrón que ya usan el portal del
// paciente y el webhook de WhatsApp — escritura con supabaseAdmin y filtros
// explícitos, sobre una tabla sin GRANT para authenticated.

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { hashIp, normalizarTelefonoPorPais } from "@/lib/marketing/leads";
import { requireSupabaseAuth } from "@/lib/auth-middleware";

const MAX_POR_IP_POR_HORA = 5;

const EsquemaLead = z
  .object({
    email: z.string().trim().email().max(254).optional().or(z.literal("")),
    phone: z.string().trim().max(30).optional().or(z.literal("")),
    name: z.string().trim().max(120).optional(),
    clinicName: z.string().trim().max(120).optional(),
    countryCode: z.enum(["CL", "MX", "CO", "PE", "AR"]),
    source: z.enum(["calculadora", "checklist", "benchmark"]),
    consent: z.literal(true),
    consentText: z.string().trim().min(10).max(500),
    consentWhatsapp: z.boolean().default(false),
    meta: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
    utm: z.record(z.string(), z.string().max(100)).optional(),
    // Honeypot: un humano nunca ve este campo, así que tiene que venir vacío.
    company: z.string().max(0).optional(),
  })
  .refine((d) => !!(d.email && d.email.length) || !!(d.phone && d.phone.length), {
    message: "Dejanos un email o un WhatsApp para poder enviarte el material.",
  });

export const submitMarketingLead = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => EsquemaLead.parse(input))
  .handler(async ({ data }) => {
    // Honeypot lleno: fingimos éxito. Devolver un error le confirma al bot
    // que detectamos la trampa y le enseña a evitarla.
    if (data.company) return { ok: true as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ipCruda =
      (getRequestHeader("x-forwarded-for") ?? "").split(",")[0]?.trim() || "desconocida";
    const sal = process.env.PORTAL_TOKEN_SECRET ?? "sal-de-desarrollo";
    const ipHash = await hashIp(ipCruda, sal);

    // Rate limit EN LA BASE, no en memoria: la capa en memoria de
    // rate-limit.server.ts es por instancia serverless y no sirve como
    // control real. Mismo patrón que el portal (3 solicitudes/24h).
    const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("marketing_leads")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", desde);
    if ((count ?? 0) >= MAX_POR_IP_POR_HORA) {
      throw new Error("Recibimos varios envíos desde tu conexión. Probá de nuevo en un rato.");
    }

    const email = data.email?.trim().toLowerCase() || null;
    const phone = data.phone ? normalizarTelefonoPorPais(data.phone, data.countryCode) : null;
    if (!email && !phone) {
      throw new Error("El número no parece válido. Revisalo o dejanos tu email.");
    }

    // Numverify best-effort: nunca bloquea el alta. Mismo criterio que en
    // el alta de pacientes — un falso negativo perdiendo un lead real sería
    // peor que no validar.
    let phoneValid: boolean | null = null;
    if (phone) {
      try {
        const { validatePhoneNumber } = await import("@/lib/patients/phoneValidation");
        phoneValid = await validatePhoneNumber(phone);
      } catch {
        phoneValid = null;
      }
    }

    const fila = {
      email,
      phone,
      phone_valid: phoneValid,
      name: data.name?.trim() || null,
      clinic_name: data.clinicName?.trim() || null,
      country_code: data.countryCode,
      source: data.source,
      utm: data.utm ?? null,
      meta: data.meta ?? null,
      consent_text: data.consentText,
      consent_whatsapp: data.consentWhatsapp,
      ip_hash: ipHash,
      user_agent: (getRequestHeader("user-agent") ?? "").slice(0, 255) || null,
    };

    // Upsert por contacto: el mismo dentista que vuelve a usar la calculadora
    // actualiza su fila, no genera una nueva. DypOS no tiene dedupe y produce
    // duplicados en cada recarga.
    const columnaConflicto = email ? "email" : "phone";
    const { error } = await supabaseAdmin
      .from("marketing_leads")
      .upsert(fila, { onConflict: columnaConflicto, ignoreDuplicates: false });

    if (error) throw new Error("No pudimos registrar tus datos. Probá de nuevo.");

    return { ok: true as const };
  });

/** Lectura de leads para el equipo de Esmalia. No existe un rol "staff de la
 *  empresa" en el schema (todos los roles son de clínica), así que el gate es
 *  una allowlist de emails por env var. */
export const listMarketingLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const permitidos = (process.env.ESMALIA_STAFF_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: usuario } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = usuario?.user?.email?.toLowerCase();

    if (!email || !permitidos.includes(email)) {
      throw new Error("No tienes permisos.");
    }

    const { data, error } = await supabaseAdmin
      .from("marketing_leads")
      .select(
        "id, email, phone, name, clinic_name, country_code, source, meta, submissions_count, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("No pudimos cargar los leads.");
    return data ?? [];
  });
```

- [ ] **Step 2: Verificar que los imports existen con esos nombres exactos**

Run: `grep -n "export const requireSupabaseAuth" src/lib/auth-middleware.ts && grep -n "getRequestHeader" src/routes/api.whatsapp-webhook.ts src/lib/**/*.ts | head -3`
Expected: `requireSupabaseAuth` existe. Si `getRequestHeader` no es el helper que usa el repo,
copiar la forma real de leer headers del webhook de WhatsApp y ajustar.
Verificar también el nombre del campo de usuario en el contexto del middleware
(`grep -n "userId" src/lib/auth-middleware.ts`).

- [ ] **Step 3: Agregar `ESMALIA_STAFF_EMAILS` a `.env.example`**

```
# Emails del equipo de Esmalia habilitados a leer los leads de marketing.
# Separados por coma. Sin esta variable, nadie puede leerlos desde la app.
ESMALIA_STAFF_EMAILS=
```

- [ ] **Step 4: Verificar tipos y lint**

Run: `npm run typecheck && npm run lint`
Expected: sin errores.

- [ ] **Step 5: Probar el endpoint contra el dev server**

Levantar con `preview_start({name: "esmalia"})`. Después, cada caso con curl contra
`http://localhost:8080/_serverFn/...` (la ruta exacta se ve en la pestaña Red del navegador al
disparar la función una vez desde la UI; anotarla antes de correr esto):

1. Honeypot lleno (`company: "x"`) → `{ok:true}` y **cero filas nuevas** en la tabla.
2. Sin `consent` → error de validación.
3. Sin email ni phone → error con el mensaje del `refine`.
4. Envío válido → una fila con `consent_at`, `consent_text`, `ip_hash` (64 hex), `meta`.
5. Mismo email otra vez → **sigue habiendo una sola fila** (upsert).
6. Sexto envío en una hora desde la misma IP → error de rate limit.

Verificar cada caso consultando la tabla:

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -c "select id, email, phone, source, submissions_count, ip_hash, created_at from public.marketing_leads order by created_at desc limit 10;"
```

- [ ] **Step 6: Borrar las filas de prueba**

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -c "delete from public.marketing_leads where email like '%@example.com' or email like '%+test%';"
```

Usar direcciones `@example.com` en las pruebas del Step 5 para que este borrado las alcance.

- [ ] **Step 7: Commit**

```bash
git add src/lib/marketing/leads.functions.ts .env.example
git commit -m "$(cat <<'EOF'
feat(captacion): endpoint público de leads con honeypot y rate limit en base

Séptima server function sin auth del repo. Sigue el patrón del portal:
escritura con supabaseAdmin sobre una tabla sin GRANT para authenticated.
El rate limit va en la base y no en memoria porque la capa en memoria es
por instancia serverless. El honeypot finge éxito en vez de devolver error.

No hace lookup DNS del email a propósito: a verificarDnsEmail le pusieron
auth justamente porque un endpoint anónimo que consulta recursos externos
se presta a DoS.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Endpoint de eventos `/api/ev`

**Files:**

- Create: `src/routes/api.ev.ts`
- Create: `src/lib/marketing/eventos.ts`

**Interfaces:**

- Produces: `POST /api/ev` que acepta `{name, props?, sessionHash?}`;
  `registrarEvento(name, props?)` client-side en `src/lib/marketing/eventos.ts`.

- [ ] **Step 1: Crear el endpoint**

```ts
// src/routes/api.ev.ts
//
// Embudo mínimo propio. Existe porque la CSP prohíbe PostHog/GA/GTM
// (script-src 'self'), y sin ninguna medición no hay forma de saber si la
// calculadora convierte. Same-origin, cubierto por el rate limiter de /api/.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const NOMBRES = ["calculadora_vista", "calculadora_usada", "lead_enviado", "cta_click"] as const;

const Esquema = z.object({
  name: z.enum(NOMBRES),
  // Sólo buckets y strings cortos. Nunca cifras de la clínica.
  props: z.record(z.string().max(40), z.union([z.string().max(60), z.boolean()])).optional(),
  sessionHash: z.string().max(64).optional(),
});

export const Route = createFileRoute("/api/ev")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let cuerpo: unknown;
        try {
          cuerpo = await request.json();
        } catch {
          return new Response(null, { status: 204 });
        }
        const parsed = Esquema.safeParse(cuerpo);
        // La telemetría nunca rompe nada ni informa al cliente: 204 siempre.
        if (!parsed.success) return new Response(null, { status: 204 });

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("marketing_events").insert({
            name: parsed.data.name,
            props: parsed.data.props ?? null,
            session_hash: parsed.data.sessionHash ?? null,
          });
        } catch {
          // Silencio deliberado.
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
```

- [ ] **Step 2: Verificar la forma de declarar handlers de servidor en este repo**

Run: `sed -n '1,40p' src/routes/api.health.ts`
Expected: ver la forma exacta (`createFileRoute` + `server.handlers` o `createAPIFileRoute`).
**Copiar la forma que use `api.health.ts`** y ajustar el Step 1 si difiere.

- [ ] **Step 3: Crear el helper de cliente**

```ts
// src/lib/marketing/eventos.ts
type NombreEvento = "calculadora_vista" | "calculadora_usada" | "lead_enviado" | "cta_click";

/** Envía un evento sin bloquear ni romper nunca la página. Sin cookies:
 *  el sessionHash vive sólo en memoria mientras dura la pestaña. */
let sessionHash: string | null = null;

function hashDeSesion(): string {
  if (!sessionHash) {
    sessionHash = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  }
  return sessionHash;
}

export function registrarEvento(
  name: NombreEvento,
  props?: Record<string, string | boolean>,
): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/ev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, props, sessionHash: hashDeSesion() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nunca romper la página por telemetría.
  }
}
```

- [ ] **Step 4: Verificar tipos**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 5: Probar el endpoint**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/api/ev \
  -H "Content-Type: application/json" \
  -d '{"name":"calculadora_vista","props":{"pais":"CL"}}'
```

Expected: `204`. Luego verificar la fila:

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -c "select name, props, created_at from public.marketing_events order by created_at desc limit 5;"
```

Probar también un nombre inválido (`{"name":"otro"}`) → debe devolver `204` sin insertar fila.

- [ ] **Step 6: Borrar los eventos de prueba y commitear**

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -c "delete from public.marketing_events where created_at > now() - interval '1 hour';"
git add src/routes/api.ev.ts src/lib/marketing/eventos.ts
git commit -m "$(cat <<'EOF'
feat(captacion): embudo mínimo propio, sin cookies ni terceros

La CSP prohíbe PostHog, GA y GTM, y sin medición no hay forma de saber
si la calculadora convierte. Cuatro eventos, sólo buckets, 204 siempre:
la telemetría nunca rompe la página ni le informa nada al cliente.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4b: Aviso de privacidad al día con la Ley 21.719

**Files:**

- Modify: `src/routes/privacidad.tsx`

**Por qué es bloqueante:** la ley entra en vigencia el **1-dic-2026** y exige un aviso de privacidad
permanentemente accesible con 12 ítems (art. 14 ter). Publicar un formulario de captación con un
aviso incompleto es empezar mal a tres meses de la vigencia. Además, **guardar buckets para
calificar leads es elaboración de perfiles** y hay que declararlo (art. 8° bis y 14 ter letra l).

- [ ] **Step 1: Auditar el aviso actual contra los 12 ítems**

Leer `src/routes/privacidad.tsx` y marcar cuáles de estos falta:

1. Política de tratamiento **con fecha y versión**
2. Identificación del responsable y su representante legal
3. Medio de contacto para solicitudes de titulares
4. Categorías de datos tratados
5. Destinatarios de los datos
6. Finalidades de cada tratamiento
7. **Base de legitimidad** de cada una (y si es interés legítimo, cuál)
8. Medidas de seguridad
9. Derechos del titular: acceso, rectificación, supresión, oposición, portabilidad
10. Derecho a recurrir a la Agencia de Protección de Datos
11. Transferencias internacionales y si el país de destino tiene nivel adecuado
    _(relevante: Supabase está en `sa-east-1`, São Paulo → Brasil)_
12. **Período de conservación** de los datos

- [ ] **Step 2: Escribir lo que falte, incluyendo lo específico de captación**

Además de los 12 ítems, agregar:

- Que los datos del formulario de la calculadora se usan para enviar el material solicitado y para
  contacto comercial, **con la base de legitimidad de cada finalidad por separado**.
- **Declaración del perfilamiento**: que se guarda una clasificación agregada del resultado (rangos,
  no cifras) para priorizar el contacto. Es lo que exige el art. 8° bis.
- El período de conservación concreto de los leads.
- Cómo se pide la baja, y que es gratuita e inmediata.

- [ ] **Step 3: Verificar en el navegador**

`/privacidad` renderiza sin errores, con fecha y versión visibles, y el enlace desde el formulario
de la Task 6 llega ahí.

- [ ] **Step 4: Commit**

```bash
git add src/routes/privacidad.tsx
git commit -m "$(cat <<'EOF'
docs(privacidad): aviso al día con la Ley 21.719, que rige desde el 1-dic-2026

Doce ítems del art. 14 ter, con fecha y versión. Declara el perfilamiento:
guardar rangos del resultado para priorizar el contacto es elaboración de
perfiles y el art. 8 bis obliga a informarlo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

# FASE 1 — La calculadora

## Task 5: Módulo puro de cálculo

**Files:**

- Create: `src/lib/marketing/calculadora.ts`
- Test: `tests/calculadora-rentabilidad.test.ts`

**Interfaces:**

- Consumes: `netAfterRetention` de `@/lib/finance/finance`.
- Produces:
  - `type EntradaPL` — todos los campos en **cents** (`bigint`-compatible `number`)
  - `type ResultadoPL`
  - `calcularPL(entrada: EntradaPL): ResultadoPL`
  - `type EntradaFugas`, `type ResultadoFugas`, `calcularFugas(e: EntradaFugas): ResultadoFugas`
  - `bucketDeMargen(pct: number | null): "perdida"|"bajo"|"medio"|"alto"|"na"`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/calculadora-rentabilidad.test.ts
import { describe, expect, it } from "vitest";
import { bucketDeMargen, calcularFugas, calcularPL } from "@/lib/marketing/calculadora";

// CLP es moneda de cero decimales: 1 "cent" = 1 peso. Es el caso donde un
// bug de factor 100 es INVISIBLE, por eso hay también un caso en MXN.
const baseCLP = {
  ingresosCents: 12_000_000,
  honorariosCents: 4_800_000,
  sueldosCents: 1_800_000,
  insumosCents: 1_200_000,
  laboratorioCents: 900_000,
  fijosCents: 1_500_000,
  variablesCents: 400_000,
  retencionPct: 0,
};

describe("calcularPL", () => {
  it("calcula utilidad y margen sin retención", () => {
    const r = calcularPL(baseCLP);
    // 12.000.000 − (4.800.000+1.800.000+1.200.000+900.000+1.500.000+400.000) = 1.400.000
    expect(r.utilidadCents).toBe(1_400_000);
    expect(r.margenPct).toBeCloseTo(11.67, 1);
  });

  it("descuenta la retención del medio de pago del ingreso, no de los costos", () => {
    // El paciente paga el total; la clínica recibe menos. Misma regla que
    // netAfterRetention en el producto: 2,95% de 12.000.000 = 354.000.
    const r = calcularPL({ ...baseCLP, retencionPct: 2.95 });
    expect(r.ingresoNetoCents).toBe(11_646_000);
    expect(r.retencionCents).toBe(354_000);
    expect(r.utilidadCents).toBe(1_046_000);
  });

  it("devuelve margen null cuando no hay ingresos, no cero", () => {
    // Regla de la casa: placeholder nullable, nunca un cero fabricado.
    const r = calcularPL({ ...baseCLP, ingresosCents: 0 });
    expect(r.margenPct).toBeNull();
    expect(r.puntoEquilibrioCents).toBeNull();
  });

  it("reporta utilidad negativa sin invertir el signo", () => {
    const r = calcularPL({ ...baseCLP, ingresosCents: 6_000_000 });
    expect(r.utilidadCents).toBeLessThan(0);
    expect(r.margenPct).toBeLessThan(0);
  });

  it("calcula el punto de equilibrio con fijos + sueldos como costo fijo", () => {
    const r = calcularPL(baseCLP);
    // Variables = insumos + laboratorio + honorarios + otros variables.
    // Fijos = arriendo/fijos + sueldos del equipo de apoyo.
    expect(r.puntoEquilibrioCents).toBeGreaterThan(0);
    expect(r.puntoEquilibrioCents).toBeLessThan(baseCLP.ingresosCents);
  });

  it("funciona igual en una moneda de dos decimales", () => {
    // MXN: 1 peso = 100 cents. Los mismos ratios deben salir idénticos.
    const enMXN = Object.fromEntries(
      Object.entries(baseCLP).map(([k, v]) =>
        k === "retencionPct" ? [k, v] : [k, (v as number) * 100],
      ),
    ) as typeof baseCLP;
    const r = calcularPL(enMXN);
    expect(r.margenPct).toBeCloseTo(11.67, 1);
    expect(r.utilidadCents).toBe(140_000_000);
  });
});

describe("calcularFugas", () => {
  it("cuantifica el dinero perdido por ausencias", () => {
    const r = calcularFugas({
      citasPorMes: 200,
      ausenciasPct: 15,
      ticketPromedioCents: 45_000,
      presupuestosPorMes: 40,
      aceptacionPct: 35,
      aceptacionReferenciaPct: 60,
      retencionCents: 0,
    });
    // 200 × 15% × 45.000 = 1.350.000
    expect(r.perdidaAusenciasCents).toBe(1_350_000);
  });

  it("cuantifica la oportunidad de presupuestos no cerrados", () => {
    const r = calcularFugas({
      citasPorMes: 200,
      ausenciasPct: 0,
      ticketPromedioCents: 45_000,
      presupuestosPorMes: 40,
      aceptacionPct: 35,
      aceptacionReferenciaPct: 60,
      retencionCents: 0,
    });
    // 40 × (60% − 35%) × 45.000 = 450.000
    expect(r.oportunidadPresupuestosCents).toBe(450_000);
  });

  it("no inventa oportunidad si ya se supera la referencia", () => {
    const r = calcularFugas({
      citasPorMes: 100,
      ausenciasPct: 0,
      ticketPromedioCents: 45_000,
      presupuestosPorMes: 40,
      aceptacionPct: 80,
      aceptacionReferenciaPct: 60,
      retencionCents: 0,
    });
    expect(r.oportunidadPresupuestosCents).toBe(0);
  });

  it("devuelve null en vez de cero cuando falta el ticket promedio", () => {
    const r = calcularFugas({
      citasPorMes: 200,
      ausenciasPct: 15,
      ticketPromedioCents: 0,
      presupuestosPorMes: 40,
      aceptacionPct: 35,
      aceptacionReferenciaPct: 60,
      retencionCents: 0,
    });
    expect(r.perdidaAusenciasCents).toBeNull();
  });
});

describe("bucketDeMargen", () => {
  it("clasifica sin exponer la cifra", () => {
    expect(bucketDeMargen(null)).toBe("na");
    expect(bucketDeMargen(-3)).toBe("perdida");
    expect(bucketDeMargen(4)).toBe("bajo");
    expect(bucketDeMargen(12)).toBe("medio");
    expect(bucketDeMargen(25)).toBe("alto");
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- calculadora-rentabilidad`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escribir la implementación**

```ts
// src/lib/marketing/calculadora.ts
//
// Cálculo de la calculadora pública. Módulo puro: sin React, sin Supabase,
// sin fetch. Todo en cents, igual que el resto del producto — la conversión
// a unidad visible la hace formatMoney con la moneda del país elegido.
//
// Las fórmulas son las del producto, no inventadas:
//   - la retención del medio de pago usa netAfterRetention (finance.ts:77)
//   - el resultado del período replica getFinanceSummary: neto − gastos
// Si acá dijéramos algo distinto de lo que Esmalia muestra adentro, el lead
// magnet estaría prometiendo una pantalla que no existe.

import { netAfterRetention } from "@/lib/finance/finance";

export type EntradaPL = {
  ingresosCents: number;
  honorariosCents: number;
  sueldosCents: number;
  insumosCents: number;
  laboratorioCents: number;
  fijosCents: number;
  variablesCents: number;
  /** % que retiene el medio de pago (ej. 2.95). 0 = sin retención. */
  retencionPct: number;
};

export type ResultadoPL = {
  ingresoNetoCents: number;
  retencionCents: number;
  costosTotalesCents: number;
  utilidadCents: number;
  /** null cuando no hay ingresos: sin dato, no cero. */
  margenPct: number | null;
  puntoEquilibrioCents: number | null;
  distribucion: {
    honorarios: number | null;
    sueldos: number | null;
    insumos: number | null;
    laboratorio: number | null;
    fijos: number | null;
    variables: number | null;
  };
};

function porcentajeSobre(parte: number, total: number): number | null {
  if (total <= 0) return null;
  return (parte / total) * 100;
}

export function calcularPL(e: EntradaPL): ResultadoPL {
  const ingresoNetoCents = netAfterRetention(e.ingresosCents, e.retencionPct);
  const retencionCents = e.ingresosCents - ingresoNetoCents;

  const costosTotalesCents =
    e.honorariosCents +
    e.sueldosCents +
    e.insumosCents +
    e.laboratorioCents +
    e.fijosCents +
    e.variablesCents;

  const utilidadCents = ingresoNetoCents - costosTotalesCents;
  const margenPct = porcentajeSobre(utilidadCents, e.ingresosCents);

  // Punto de equilibrio: los honorarios del profesional son variables (se
  // pagan por producción); los sueldos del equipo de apoyo son fijos (se
  // pagan atienda o no). Es la diferencia estructural con un restaurante.
  const variablesCents = e.honorariosCents + e.insumosCents + e.laboratorioCents + e.variablesCents;
  const fijosCents = e.fijosCents + e.sueldosCents;
  const ratioContribucion =
    e.ingresosCents > 0 ? (ingresoNetoCents - variablesCents) / e.ingresosCents : 0;
  const puntoEquilibrioCents =
    ratioContribucion > 0 ? Math.round(fijosCents / ratioContribucion) : null;

  return {
    ingresoNetoCents,
    retencionCents,
    costosTotalesCents,
    utilidadCents,
    margenPct,
    puntoEquilibrioCents,
    distribucion: {
      honorarios: porcentajeSobre(e.honorariosCents, e.ingresosCents),
      sueldos: porcentajeSobre(e.sueldosCents, e.ingresosCents),
      insumos: porcentajeSobre(e.insumosCents, e.ingresosCents),
      laboratorio: porcentajeSobre(e.laboratorioCents, e.ingresosCents),
      fijos: porcentajeSobre(e.fijosCents, e.ingresosCents),
      variables: porcentajeSobre(e.variablesCents, e.ingresosCents),
    },
  };
}

export type EntradaFugas = {
  citasPorMes: number;
  ausenciasPct: number;
  ticketPromedioCents: number;
  presupuestosPorMes: number;
  aceptacionPct: number;
  /** Referencia contra la que se compara la aceptación. NO tiene benchmark
   *  citable: el 61% que circula es de 2016 y no se pudo verificar contra el
   *  informe original. Por eso es un parámetro que fija el usuario en la UI
   *  (default 60 sólo como punto de partida editable), y el resultado se
   *  presenta como "si llegaras a X%", nunca como "estás por debajo de la
   *  industria". */
  aceptacionReferenciaPct: number;
  retencionCents: number;
};

export type ResultadoFugas = {
  perdidaAusenciasCents: number | null;
  oportunidadPresupuestosCents: number | null;
  retencionCents: number;
  totalRecuperableCents: number | null;
};

export function calcularFugas(e: EntradaFugas): ResultadoFugas {
  const sinTicket = e.ticketPromedioCents <= 0;

  const perdidaAusenciasCents = sinTicket
    ? null
    : Math.round(e.citasPorMes * (e.ausenciasPct / 100) * e.ticketPromedioCents);

  const brecha = Math.max(0, e.aceptacionReferenciaPct - e.aceptacionPct);
  const oportunidadPresupuestosCents = sinTicket
    ? null
    : Math.round(e.presupuestosPorMes * (brecha / 100) * e.ticketPromedioCents);

  const totalRecuperableCents =
    perdidaAusenciasCents === null || oportunidadPresupuestosCents === null
      ? null
      : perdidaAusenciasCents + oportunidadPresupuestosCents + e.retencionCents;

  return {
    perdidaAusenciasCents,
    oportunidadPresupuestosCents,
    retencionCents: e.retencionCents,
    totalRecuperableCents,
  };
}

export function bucketDeMargen(pct: number | null): "perdida" | "bajo" | "medio" | "alto" | "na" {
  if (pct === null) return "na";
  if (pct < 0) return "perdida";
  if (pct < 8) return "bajo";
  if (pct < 18) return "medio";
  return "alto";
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test -- calculadora-rentabilidad`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketing/calculadora.ts tests/calculadora-rentabilidad.test.ts
git commit -m "$(cat <<'EOF'
feat(calculadora): cálculo puro de P&L y fugas, con tests

Transcribe las fórmulas del producto en vez de inventar aritmética:
netAfterRetention para la retención del medio de pago, y neto − gastos
para el resultado, igual que getFinanceSummary.

Los honorarios del profesional van como costo variable y los sueldos del
equipo de apoyo como fijo: es la diferencia estructural de una clínica.

Hay un caso de prueba en MXN además del de CLP a propósito — en CLP el
factor es 1 y un bug de 100x sería invisible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Formulario de captura reusable

**Files:**

- Create: `src/components/marketing/lead-form.tsx`

**Interfaces:**

- Consumes: `submitMarketingLead` de `@/lib/marketing/leads.functions`; `TEXTO_CONSENTIMIENTO` y
  `PaisCaptacion` de `@/lib/marketing/leads`; `registrarEvento` de `@/lib/marketing/eventos`.
- Produces: `<LeadForm source pais meta onOk />` — usado por la calculadora (Task 7) y por el
  checklist (Task 13).

- [ ] **Step 1: Crear el componente**

El esqueleto con las partes que no se pueden improvisar (honeypot, consentimiento, UTM). El estilo
visual queda a criterio de quien implemente, respetando la paleta Nácar:

```tsx
// src/components/marketing/lead-form.tsx
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { submitMarketingLead } from "@/lib/marketing/leads.functions";
import { TEXTO_CONSENTIMIENTO, type MetaLead, type PaisCaptacion } from "@/lib/marketing/leads";
import { registrarEvento } from "@/lib/marketing/eventos";

const CLAVES_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

function leerUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const clave of CLAVES_UTM) {
    const valor = params.get(clave);
    if (valor) utm[clave] = valor.slice(0, 100);
  }
  if (document.referrer) utm.referrer = document.referrer.slice(0, 100);
  return utm;
}

export function LeadForm({
  source,
  pais,
  meta,
  tituloExito,
}: {
  source: "calculadora" | "checklist" | "benchmark";
  pais: PaisCaptacion;
  meta?: MetaLead;
  tituloExito: string;
}) {
  const enviar = useServerFn(submitMarketingLead);
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);

    if (f.get("consent") !== "on") {
      setError("Necesitamos tu autorización para poder enviarte el material.");
      return;
    }

    setEstado("enviando");
    try {
      await enviar({
        data: {
          email: String(f.get("email") ?? "").trim() || undefined,
          phone: String(f.get("phone") ?? "").trim() || undefined,
          name: String(f.get("name") ?? "").trim() || undefined,
          clinicName: String(f.get("clinicName") ?? "").trim() || undefined,
          countryCode: pais,
          source,
          consent: true,
          consentText: TEXTO_CONSENTIMIENTO,
          consentWhatsapp: f.get("consentWhatsapp") === "on",
          meta,
          utm: leerUtm(),
          company: String(f.get("company") ?? ""), // honeypot
        },
      });
      registrarEvento("lead_enviado", { source, pais });
      setEstado("ok");
    } catch (err) {
      setEstado("idle");
      setError(err instanceof Error ? err.message : "No pudimos guardar tus datos.");
    }
  }

  if (estado === "ok") {
    // NUNCA decir "te lo mandamos": hoy no hay RESEND_API_KEY y prometer un
    // envío que no ocurre es exactamente el modo de falla que tiene DypOS.
    return (
      <div className="rounded-xl border border-mint bg-mint-soft p-5">
        <p className="font-medium">{tituloExito}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Guardamos tus datos. Nos vamos a poner en contacto para acompañarte con esto.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Honeypot: fuera de pantalla, no display:none (algunos bots lo detectan).
          Sin tabIndex ni autocomplete para que ningún humano lo alcance. */}
      <div className="absolute left-[-9999px]" aria-hidden="true">
        <label htmlFor="company">No completar</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          Tu nombre
        </label>
        <input
          id="name"
          name="name"
          type="text"
          maxLength={120}
          className="mt-1 w-full rounded-md border px-3 py-2"
        />
      </div>

      <div>
        <label htmlFor="clinicName" className="block text-sm font-medium">
          Nombre de la clínica
        </label>
        <input
          id="clinicName"
          name="clinicName"
          type="text"
          maxLength={120}
          className="mt-1 w-full rounded-md border px-3 py-2"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          maxLength={254}
          className="mt-1 w-full rounded-md border px-3 py-2"
        />
      </div>

      <div>
        {/* Opcional por minimización (art. 14 quáter de la Ley 21.719): sólo
            pedimos como obligatorio lo estrictamente necesario. */}
        <label htmlFor="phone" className="block text-sm font-medium">
          WhatsApp <span className="text-muted-foreground">(opcional)</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          maxLength={30}
          className="mt-1 w-full rounded-md border px-3 py-2"
        />
      </div>

      {/* No premarcado y obligatorio. */}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-1" />
        <span>
          {TEXTO_CONSENTIMIENTO}{" "}
          <a href="/privacidad" className="underline">
            Cómo tratamos tus datos
          </a>
          .
        </span>
      </label>

      {/* Separado: el número dado "para recibir el material" no habilita
          prospección comercial — es otra finalidad. */}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consentWhatsapp" className="mt-1" />
        <span>Quiero recibir novedades comerciales por WhatsApp.</span>
      </label>

      {error && (
        <p id="lead-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={estado === "enviando"}
        aria-describedby={error ? "lead-error" : undefined}
        className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-ink-foreground disabled:opacity-60"
      >
        {estado === "enviando" ? "Guardando…" : "Quiero recibirlo"}
      </button>
    </form>
  );
}
```

Requisitos que el código de arriba materializa y que **no** se pueden cambiar (spec §5.1.5 y §5.1.6):

- Campo honeypot `company` **oculto para humanos** (posicionado fuera de pantalla, no
  `display:none`, con `tabIndex={-1}` y `autoComplete="off"`).
- Checkbox de consentimiento **no premarcado**, obligatorio, con `TEXTO_CONSENTIMIENTO` visible.
- Checkbox **separado** y opcional para WhatsApp: aceptar un informe por mail no es aceptar que te
  escriban por WhatsApp.
- Enlace a `/privacidad`.
- Al menos uno de email o WhatsApp; el mensaje de error lo dice con claridad.
- **Nunca decir "te lo mandamos"**: el estado de éxito muestra el recurso en pantalla y describe el
  envío como algo adicional. Hoy Esmalia no puede enviar emails (falta `RESEND_API_KEY`).
- UTM leídos de `window.location.search` (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`,
  `utm_content`) + `document.referrer`, recortados a 100 caracteres.
- `registrarEvento("lead_enviado", { source, pais })` sólo tras respuesta OK.
- Labels reales asociados a cada input (no `sr-only` sin `htmlFor`), y `aria-describedby` para el
  texto de error.

- [ ] **Step 2: Verificar tipos y lint**

Run: `npm run typecheck && npm run lint`
Expected: sin errores.

- [ ] **Step 3: Verificar accesibilidad y honeypot en el navegador**

Con `preview_start({name: "esmalia"})`, en la página que lo monte (Task 7):

- Navegar el formulario **sólo con teclado**: el foco nunca debe caer en `company`.
- Enviar sin marcar el consentimiento → el envío se bloquea con mensaje visible.
- Inspeccionar el DOM y confirmar que `company` está en el formulario pero fuera de vista.

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/lead-form.tsx
git commit -m "$(cat <<'EOF'
feat(captacion): formulario de leads con consentimiento explícito

Checkbox no premarcado, texto del consentimiento guardado literal, y
consentimiento separado para WhatsApp. El estado de éxito nunca dice
"te lo mandamos": hoy no hay RESEND_API_KEY y prometer un envío que no
ocurre es el modo de falla silenciosa que tiene DypOS.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Página de la calculadora

**Files:**

- Create: `src/routes/calculadora-rentabilidad-dental.tsx`

**Interfaces:**

- Consumes: `calcularPL`, `calcularFugas`, `bucketDeMargen` de `@/lib/marketing/calculadora`;
  `formatMoney`, `toCents`, `pasoDeMoneda` de `@/lib/finance/finance`; `COUNTRIES` de
  `@/lib/onboarding-types`; `<LeadForm>`; `SiteHeader`/`SiteFooter` de `@/components/site-chrome`.

- [ ] **Step 1: Construir la página**

Estructura y reglas:

- **Selector de país arriba** (los 5 de `COUNTRIES`), que fija la moneda. Todo el formato pasa por
  `formatMoney(cents, currency)` — **nunca** un `$` hardcodeado ni `/100`.
- Inputs con `MoneyInput` (habla cents, `step` correcto por moneda) o `type="text"` +
  `inputMode="numeric"` con separadores de miles y `tabular-nums`.
- **Resultado en vivo, sin pedir nada**: panel `lg:sticky` con `aria-live="polite"` y
  `aria-atomic="true"`.
- Dos bloques: P&L primero, fugas después.
- **Semáforo SOLO en tres indicadores**, con su fuente visible al lado (§5.2.4 del spec):
  - **Ausentismo** — 10-30%, default 15%. Literatura revisada por pares. Es el único con respaldo
    académico y el único aplicable sin etiqueta de país.
  - **Overhead total** (≈58%) y **margen** (≈24%) — **etiquetados "referencia EE.UU."**, con la
    nota de que no son transferibles a LatAm (mix de seguros, costo laboral y de laboratorio son
    estructuralmente distintos). Fuente: ADA Health Policy Institute, _2026 Survey of Dental
    Practice_ (ejercicio 2025).
  - Todo lo demás —% de personal, insumos, laboratorio, arriendo, aceptación de presupuestos,
    cobranza— se muestra **sin semáforo y sin juicio de valor**. 🔴 **No inventar rangos y no
    atribuir cifras por categoría al ADA: el ADA no publica ese desglose.**
  - **Decir en voz alta que no existe benchmark público para LatAm.** Es honesto y es la razón por
    la que pedimos el dato.
  - Cuatro estados donde el semáforo aplique: `sano` · `bajo` (azul, informativo — un ratio
    anormalmente bueno es señal de mala medición, no de éxito) · `atención` · `alto`, cada uno con
    **ícono propio además del color**.
- Diagnóstico narrativo de un párrafo, **peor foco primero**, nombrando la acción concreta y no el
  ratio.
- Debajo del resultado: `<LeadForm source="calculadora">` con el `meta` de buckets.
- Nota metodológica en `<details>` al pie: los rangos son referencia de industria, con fuente y
  año, nunca "promedio de N clínicas".
- Paleta **Nácar** de la landing (`--ink`, `--mint-strong`, `--bone`, `--mint-soft`), tipografías
  `font-precise` para titulares. No usar la paleta de la app autenticada.
- `registrarEvento("calculadora_vista")` al montar y `"calculadora_usada"` (con buckets) la primera
  vez que hay datos suficientes.

- [ ] **Step 2: Verificar tipos, lint y tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: todo verde.

- [ ] **Step 3: Verificar en el navegador con datos reales**

Con `preview_start({name: "esmalia"})` en `/calculadora-rentabilidad-dental`:

1. Cargar el caso CLP del test (12.000.000 de ingresos, etc.) → utilidad 1.400.000, margen ~11,7%.
2. Cambiar el país a **México** → los mismos números deben mostrarse con formato MXN correcto
   (con decimales), no 100× mayores ni menores.
3. Poner retención 2,95% → el ingreso neto baja a 11.646.000 en CLP.
4. Verificar consola sin errores y que **no hay ninguna petición bloqueada por CSP**.
5. Probar modo claro y oscuro.

- [ ] **Step 4: Commit**

```bash
git add src/routes/calculadora-rentabilidad-dental.tsx
git commit -m "$(cat <<'EOF'
feat(calculadora): página pública de rentabilidad para clínicas dentales

Resultado primero: se ve completo sin dar el mail, que sólo se pide para
llevarse el informe. Respeta la promesa de la landing ("sin dar tu mail"),
que es sobre la demo y sigue siendo verdad.

Cinco países con su moneda real vía formatMoney. Sin semáforo en los
indicadores que todavía no tienen fuente citable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: SEO, sitemap y enlaces

**Files:**

- Modify: `src/routes/calculadora-rentabilidad-dental.tsx` (bloque `head()`)
- Modify: `src/routes/sitemap[.]xml.ts:25-37`
- Modify: `src/components/site-chrome.tsx:39-45` y `47-85`
- Modify: `src/routes/software-dental-latam.tsx`

- [ ] **Step 1: Agregar `head()` con SEO completo**

Incluir: `title`, `meta description`, `canonicalHead("/calculadora-rentabilidad-dental")` de
`@/lib/seo`, y JSON-LD `WebApplication` + `BreadcrumbList` + **`FAQPage`** con 4 preguntas que
**repitan literalmente las fórmulas** (es la mitad del valor frente a buscadores generativos).
Usar `faqJsonLdScript()` de `seo.ts:63`.

⚠️ Gotcha documentado en `seo.ts:18-24`: el shape de `head().scripts` **no** anida bajo `attrs`;
anidarlo produce `<script attrs="[object Object]">`.

- [ ] **Step 2: Agregar la ruta al sitemap**

En el array `entries` de `sitemap[.]xml.ts`, con `priority: 0.8`.

- [ ] **Step 3: Agregar al footer**

En `site-chrome.tsx`: primero extender la **unión de tipos cerrada** de `FooterLink` (líneas 39-45)
con la ruta nueva — TypeScript falla sin eso —, y después agregarla a la columna "Recursos" de
`footerColumns`.

- [ ] **Step 4: Enlazar desde la página GEO**

En `software-dental-latam.tsx`, agregar un enlace a la calculadora en la sección de recursos.

- [ ] **Step 5: Verificar en local que el HTML servido tiene todo**

```bash
curl -s http://localhost:8080/calculadora-rentabilidad-dental | grep -o 'rel="canonical"[^>]*'
curl -s http://localhost:8080/calculadora-rentabilidad-dental | grep -c 'application/ld+json'
curl -s http://localhost:8080/sitemap.xml | grep calculadora
```

Expected: canonical presente, al menos 2 bloques JSON-LD, y la URL en el sitemap.

- [ ] **Step 6: Verificar la CSP en local**

```bash
curl -sD - -o /dev/null http://localhost:8080/calculadora-rentabilidad-dental | grep -i "content-security-policy"
```

Expected: la CSP con nonce, **sin cambios** respecto de las otras rutas. Si algo obligó a tocarla,
detenerse: el spec lo prohíbe.

- [ ] **Step 7: Commit**

```bash
git add src/routes/calculadora-rentabilidad-dental.tsx "src/routes/sitemap[.]xml.ts" src/components/site-chrome.tsx src/routes/software-dental-latam.tsx
git commit -m "$(cat <<'EOF'
feat(seo): la calculadora entra al sitemap, al footer y a la página GEO

FAQPage en JSON-LD que repite las fórmulas: es lo que hace que un
buscador generativo pueda citar la herramienta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

# FASE 2 — Trial de 14 días

> Esta fase **no depende de las fases 0 ni 1**. Se puede ejecutar primero.

## Task 9: Corregir `isSubscriptionActive` y agregar el gate de informes

**Files:**

- Modify: `src/lib/billing.ts:40-53`
- Test: `tests/trial-gating.test.ts`

**Interfaces:**

- Produces: `isSubscriptionActive` corregida; `trialInformesBloqueados(sub): boolean`;
  `TRIAL_DAYS: 14`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/trial-gating.test.ts
import { describe, expect, it } from "vitest";
import {
  isSubscriptionActive,
  trialDaysLeft,
  trialInformesBloqueados,
  TRIAL_DAYS,
  type Subscription,
} from "@/lib/billing";

const base: Subscription = {
  clinicId: "c1",
  status: "trialing",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

const enDias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe("isSubscriptionActive", () => {
  it("un trial vigente está activo", () => {
    expect(isSubscriptionActive({ ...base, trialEnd: enDias(5) })).toBe(true);
  });

  it("un trial VENCIDO ya no está activo aunque no haya currentPeriodEnd", () => {
    // Bug original: la función sólo miraba currentPeriodEnd, así que un trial
    // con trial_end pasado y current_period_end null nunca vencía.
    expect(isSubscriptionActive({ ...base, trialEnd: enDias(-1) })).toBe(false);
  });

  it("sin suscripción no está activa", () => {
    expect(isSubscriptionActive(null)).toBe(false);
  });

  it("una suscripción activa con período vigente sigue activa", () => {
    expect(isSubscriptionActive({ ...base, status: "active", currentPeriodEnd: enDias(20) })).toBe(
      true,
    );
  });

  it("una cancelada no está activa", () => {
    expect(isSubscriptionActive({ ...base, status: "canceled" })).toBe(false);
  });
});

describe("trialInformesBloqueados", () => {
  it("no bloquea a las clínicas sin fila de suscripción", () => {
    // Las clínicas piloto existentes tienen sub === null y no se tocan.
    expect(trialInformesBloqueados(null)).toBe(false);
  });

  it("no bloquea durante el trial", () => {
    expect(trialInformesBloqueados({ ...base, trialEnd: enDias(3) })).toBe(false);
  });

  it("bloquea cuando el trial venció y no hay tarjeta", () => {
    expect(trialInformesBloqueados({ ...base, trialEnd: enDias(-1) })).toBe(true);
  });

  it("no bloquea si ya puso tarjeta, aunque el trial haya vencido", () => {
    expect(
      trialInformesBloqueados({
        ...base,
        trialEnd: enDias(-1),
        stripeSubscriptionId: "sub_123",
      }),
    ).toBe(false);
  });

  it("no bloquea a una suscripción activa", () => {
    expect(trialInformesBloqueados({ ...base, status: "active" })).toBe(false);
  });
});

describe("trialDaysLeft", () => {
  it("cuenta los días que faltan", () => {
    expect(trialDaysLeft({ ...base, trialEnd: enDias(7) })).toBe(7);
  });

  it("nunca devuelve negativo", () => {
    expect(trialDaysLeft({ ...base, trialEnd: enDias(-5) })).toBe(0);
  });
});

describe("TRIAL_DAYS", () => {
  it("es la única fuente de verdad de la duración", () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- trial-gating`
Expected: FAIL — `trialInformesBloqueados` y `TRIAL_DAYS` no existen, y el test del trial vencido
falla contra la implementación actual.

- [ ] **Step 3: Corregir e implementar en `src/lib/billing.ts`**

```ts
/** Duración del trial. Única fuente de verdad: la migración que crea la fila
 *  y este valor tienen que decir lo mismo. DypOS lo tiene hardcodeado en dos
 *  INSERT distintos. */
export const TRIAL_DAYS = 14;

/** Considerada operativa: el usuario tiene acceso completo al panel. */
export function isSubscriptionActive(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (sub.status !== "trialing" && sub.status !== "active") return false;
  // Un trial con trial_end pasado está vencido aunque currentPeriodEnd sea
  // null: sin esta línea, la fila que crea el trigger nunca expiraría.
  if (sub.status === "trialing" && sub.trialEnd && new Date(sub.trialEnd) <= new Date()) {
    return false;
  }
  if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) <= new Date()) return false;
  return true;
}

/** ¿Se bloquean los INFORMES (finanzas, comisiones, panel, inventario)?
 *  La operación diaria —agenda, pacientes, ficha clínica— nunca se bloquea.
 *  Devuelve false para sub === null: las clínicas piloto anteriores al trigger
 *  siguen con acceso libre y no se tocan. */
export function trialInformesBloqueados(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (sub.status !== "trialing") return false;
  if (sub.stripeSubscriptionId) return false;
  return !!sub.trialEnd && new Date(sub.trialEnd) <= new Date();
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test -- trial-gating`
Expected: PASS.

- [ ] **Step 5: Correr TODA la suite — este cambio toca el gate del router**

Run: `npm test && npm run typecheck`
Expected: verde. Si algún test asumía que un trial vencido seguía activo, revisarlo: probablemente
documentaba el bug.

- [ ] **Step 6: Commit**

```bash
git add src/lib/billing.ts tests/trial-gating.test.ts
git commit -m "$(cat <<'EOF'
fix(billing): un trial vencido deja de estar activo

isSubscriptionActive sólo miraba currentPeriodEnd, así que un trial con
trial_end pasado y current_period_end null nunca expiraba. Sin este fix,
la fila que crea el trigger del trial no serviría para nada.

Agrega trialInformesBloqueados: separa "operar" de "entender". La agenda,
los pacientes y la ficha clínica nunca se bloquean.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: El trial nace con la clínica

**Files:**

- Create: `supabase/migrations/<TIMESTAMP>_trial_nace_con_la_clinica.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- El trial de 14 días que la landing promete desde siempre no existía: nada
-- creaba la fila en `subscriptions` salvo el webhook de Stripe, así que toda
-- clínica quedaba con sub === null y acceso ilimitado gratis para siempre.
--
-- Todo el andamiaje (isSubscriptionActive, trialDaysLeft, TrialBanner, el
-- gate del router) ya existía y estaba muerto por falta de esta fila.
--
-- Es un trigger y no un default por la misma razón que moneda_desde_la_clinica:
-- un trigger que escribe siempre hace imposible que un camino de alta se
-- olvide de crear el trial.

create or replace function public.crear_trial_de_la_clinica()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (clinic_id, status, trial_end)
  values (new.id, 'trialing', now() + interval '14 days')
  on conflict (clinic_id) do nothing;
  return new;
end;
$$;

revoke all on function public.crear_trial_de_la_clinica() from public, anon;

create trigger clinics_crear_trial
  after insert on public.clinics
  for each row execute function public.crear_trial_de_la_clinica();

-- Las clínicas EXISTENTES no se tocan a propósito: hoy operan con sub === null
-- y convertirlas a trial es una decisión comercial, no técnica.
```

⚠️ Los 14 días de acá tienen que coincidir con `TRIAL_DAYS` de `src/lib/billing.ts` (Task 9).

- [ ] **Step 2: Aplicar la migración**

```bash
set -a; source .env; set +a
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -f supabase/migrations/<TIMESTAMP>_trial_nace_con_la_clinica.sql
```

Expected: `CREATE FUNCTION`, `REVOKE`, `CREATE TRIGGER`.

- [ ] **Step 3: Verificar el comportamiento contra la base real, sin dejar filas**

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" <<'SQL'
BEGIN;
  INSERT INTO public.clinics (name, country, currency, timezone)
  VALUES ('Prueba trigger trial', 'CL', 'CLP', 'America/Santiago')
  RETURNING id \gset
  SELECT clinic_id, status, trial_end > now() + interval '13 days' AS vence_en_14
  FROM public.subscriptions WHERE clinic_id = :'id';
ROLLBACK;
SQL
```

Expected: una fila con `status = trialing` y `vence_en_14 = t`. El `ROLLBACK` garantiza que no
queda nada. (Si `clinics` exige más columnas NOT NULL, agregarlas al INSERT — verificar con
`\d public.clinics`.)

- [ ] **Step 4: Verificar que el trigger existe en la base**

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "postgresql://postgres.hvfkygoguxvpmwslrccb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -c "select tgname from pg_trigger where tgrelid = 'public.clinics'::regclass and not tgisinternal;"
```

Expected: `clinics_crear_trial` en la lista.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/
git commit -m "$(cat <<'EOF'
feat(billing): el trial de 14 días nace con la clínica

La landing lo promete desde siempre y no existía: nada creaba la fila en
subscriptions salvo el webhook de Stripe, así que toda clínica quedaba con
acceso ilimitado gratis. El andamiaje ya estaba entero y muerto por falta
de esta fila.

Trigger y no default, por la misma razón que moneda_desde_la_clinica.
Las clínicas existentes no se tocan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Pantalla de desbloqueo y gate de informes

**Files:**

- Create: `src/components/trial-desbloqueo.tsx`
- Modify: `src/routes/_authenticated/_clinic/finanzas.tsx`, `comisiones.tsx`, `gastos.tsx`,
  `medios-de-pago.tsx`, `inventario.tsx`, `laboratorios.tsx`, `convenios.tsx`
- Modify: `src/lib/finance/finance-reports.functions.ts` (helper `requireFinanceView`)

- [ ] **Step 1: Crear la pantalla de desbloqueo**

Requisitos:

- **Grilla de dos columnas**: "Abierto siempre" (agenda, pacientes, ficha clínica, tratamientos,
  aranceles, exportar datos) vs "Se activa al suscribirte" (finanzas, comisiones, panel de
  desempeño, inventario, laboratorios, convenios). Nunca esconder qué hay del otro lado.
- Título que nombra la pantalla que se intentó abrir.
- CTA a `/suscripcion`.
- Salida sin fricción: "Seguir usando Esmalia" → `/agenda`.
- **No ofrecer ninguna vía que no funcione de punta a punta.** En particular, no agregar "agendar
  una llamada" salvo que exista el mecanismo que efectivamente desbloquea — DypOS tiene hoy ese
  botón como CTA principal y no desbloquea nada (`onboarding_call_at` se lee en 3 lugares y no se
  escribe en ninguno).

- [ ] **Step 2: Aplicar el gate en cada ruta de informes**

En cada una de las 7 rutas: leer la suscripción con el `useQuery` que ya usa `TrialBanner`, y si
`trialInformesBloqueados(sub)` es `true`, renderizar `<TrialDesbloqueo pantalla="..." />` en lugar
del contenido. **No** redirigir: el trial vencido no expulsa de la app.

- [ ] **Step 3: Agregar el par en el servidor**

Regla 15 de la casa: el JWT vive en `localStorage`, así que un gate de UI sin par en el servidor no
protege nada. Extender `requireFinanceView` para que además consulte la suscripción de la clínica y
lance el error genérico `"No tienes permisos."` si `trialInformesBloqueados` es `true`.

- [ ] **Step 4: Verificar tipos, lint y la suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: verde.

- [ ] **Step 5: Verificar el comportamiento real, extremo a extremo**

Con una clínica de prueba propia (no la demo, no la clínica piloto):

1. Crearla → verificar que nace con `trial_end` a 14 días.
2. Entrar a `/finanzas` → **se ve normal**.
3. Mover `trial_end` al pasado:
   `update public.subscriptions set trial_end = now() - interval '1 day' where clinic_id = '<id>';`
4. Recargar `/finanzas` → **pantalla de desbloqueo**.
5. Ir a `/agenda` y `/pacientes` → **funcionan con normalidad**. Abrir una ficha y la historia
   clínica → **funcionan**. Esto es lo más importante de verificar.
6. Llamar la server function de finanzas directamente (desde la consola del navegador) →
   **debe fallar** con "No tienes permisos". Sin esto, el gate es sólo cosmético.
7. Borrar la clínica de prueba.

- [ ] **Step 6: Commit**

```bash
git add src/components/trial-desbloqueo.tsx src/routes/_authenticated/_clinic/ src/lib/finance/finance-reports.functions.ts
git commit -m "$(cat <<'EOF'
feat(billing): al vencer el trial se activan los informes, no se cierra la app

Operar sigue abierto: agenda, pacientes y ficha clínica nunca se bloquean
—la historia clínica es obligación de custodia del profesional, no un
upsell—. Lo que se activa al suscribirse es el insight: finanzas,
comisiones, panel de desempeño, inventario, laboratorios y convenios.

La pantalla muestra las dos columnas: esconder qué hay del otro lado
convierte peor y se siente trampa.

Gate también en el servidor: el JWT vive en localStorage.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

# FASE 3 — El checklist

## Task 12: Página del checklist

**Files:**

- Create: `src/routes/recursos.fugas-clinica-dental.tsx`
- Modify: `src/routes/sitemap[.]xml.ts`, `src/components/site-chrome.tsx`

- [ ] **Step 1: Escribir el contenido y la página**

15 fugas, cada una: número → título → 1-2 frases con un dato concreto → casilla → una línea
_"Detectala: ¿pregunta?"_. Cada fuga es un problema del dueño que Esmalia resuelve, **escrito sin
nombrar la feature**.

Candidatas (todas ancladas en módulos que existen): sillón vacío por ausencias · presupuestos
aceptados que nadie agendó · presupuestos enviados sin seguimiento · retención de medios de pago
que nadie mira · convenios liquidados de memoria · laboratorio sin trazabilidad de costo ni fecha ·
insumos que se consumen sin descontarse · stock sin conteo físico · comisiones calculadas a mano ·
historia clínica en papel · recordatorios que dependen de que alguien se acuerde · pacientes que no
vuelven y nadie los llama.

Usar el shell `LegalPage` de `src/components/legal-page.tsx`. **La página se lee completa y gratis**
— el contacto se pide sólo para llevarse el PDF (Task 13).

- [ ] **Step 2: Agregar al sitemap y al footer**

Igual que en la Task 8: primero extender la unión de tipos de `FooterLink`, después
`footerColumns`, después el array `entries` del sitemap con `priority: 0.7`.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run lint`
Y en el navegador: la página se lee entera sin formulario; el `<LeadForm source="checklist">` está
al pie.

- [ ] **Step 4: Commit**

```bash
git add src/routes/recursos.fugas-clinica-dental.tsx "src/routes/sitemap[.]xml.ts" src/components/site-chrome.tsx
git commit -m "$(cat <<'EOF'
feat(recursos): checklist de 15 fugas de dinero, como página versionada

Va como HTML en el repo y no como PDF suelto: el de DypOS es un binario
huérfano sin fuente ni script generador, y para cambiar una coma hay que
rehacerlo. Así es lead magnet y contenido indexable a la vez.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Entrega gateada del PDF

**Files:**

- Create: `scripts/build-pdf-recursos.mjs`
- Create: `src/routes/api.recurso.$slug.ts`

- [ ] **Step 1: Script generador del PDF**

Con el Chromium de Playwright ya instalado globalmente: abre la ruta pública del checklist en el
dev server, aplica un CSS de impresión y guarda el PDF **fuera de `public/`** (por ejemplo en
`assets-privados/`, agregado a `.gitignore` si pesa, o versionado si es chico). El PDF se genera
desde la misma página que se lee online: una sola fuente de verdad.

- [ ] **Step 2: Endpoint de entrega**

`GET /api/recurso/$slug?token=…`: valida un token de descarga de un solo uso ligado al lead, y
responde el archivo con `Content-Type: application/pdf` (patrón de `sitemap[.]xml.ts:58-63`).

**No poner el PDF en `public/`**: es CDN abierto, sin rate limit, y no se puede condicionar a haber
dejado el contacto.

- [ ] **Step 3: Verificar**

- Sin token → 403.
- Con token válido → PDF de 200 con `Content-Type` correcto.
- Con el mismo token dos veces → el segundo falla.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-pdf-recursos.mjs src/routes/api.recurso.\$slug.ts
git commit -m "$(cat <<'EOF'
feat(recursos): PDF generado desde la propia página, servido con token

No va en public/: eso es CDN abierto y no se puede condicionar a haber
dejado el contacto.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

# FASE 4 — Email (BLOQUEADA)

## Task 14: Entrega por email

> 🔴 **Bloqueada por Walter.** Verificado con `vercel env ls production` el 2026-09-07: no existe
> `RESEND_API_KEY` ni `EMAIL_FROM`. Y sin dominio propio (producción es el dominio `.vercel.app` original)
> los correos van a spam de forma sistemática.
>
> **Cadena a destrabar:** comprar dominio → verificarlo en Resend → cargar `RESEND_API_KEY` y
> `EMAIL_FROM` en Vercel → ejecutar esta tarea.

Cuando se destrabe:

- [ ] **Step 1:** Enganchar `sendEmail` de `src/lib/messaging/email.server.ts:33` al alta de lead,
      **no bloqueante**: si el envío falla, el lead ya quedó guardado y la respuesta sigue siendo OK.
- [ ] **Step 2:** Registrar el resultado en `marketing_leads.delivered_at` / `delivery_error`.
      Registrar éxitos **y** fallos: sin los éxitos no se puede dimensionar el plan de envío.
- [ ] **Step 3:** Cambiar el copy de éxito del formulario para mencionar el envío — **sólo
      entonces**. Hasta acá nunca debe decir "te lo mandamos".
- [ ] **Step 4:** Implementar la ruta pública `/baja/$token` que setea `unsubscribed_at`.
- [ ] **Step 5:** Verificar de punta a punta con una dirección real y confirmar que llega a la
      bandeja de entrada, no a spam.

---

## Verificación final (después de todas las fases)

- [ ] `npm test` — toda la suite verde
- [ ] `npm run typecheck && npm run lint && npm run types:check` — limpio
- [ ] `npm run build` — build de producción sin errores
- [ ] Preview deploy real de Vercel: la calculadora responde 200, la CSP no cambió, el sitemap
      incluye las rutas nuevas
- [ ] Ninguna fila de prueba quedó en `marketing_leads`, `marketing_events`, `clinics` ni
      `subscriptions`
- [ ] Actualizar `CLAUDE.md` del repo con: la tabla `marketing_leads` (primera sin `clinic_id`), el
      trigger del trial, y el criterio de qué se gatea y qué no
- [ ] Guardar una memoria del trabajo con lo aprendido
