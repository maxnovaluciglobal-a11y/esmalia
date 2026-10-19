# Esmalia

Sistema operativo cloud-first para clínicas dentales en Latinoamérica. Nacido como
prototipo en [Lovable](https://lovable.dev), en desarrollo activo desde este repo.

> El nombre de proyecto en Lovable es "Aurora Dental OS"; la marca del producto,
> en todo el código y la documentación, es **Esmalia**.

## Estado actual (2026-08-13, histórico; el vigente está en el Documento Maestro v2)

Fases completas end-to-end verificadas contra la base de datos real:

- **Fase 0** — higiene local + rebranding a Esmalia
- **Fase 1** — Pacientes + Agenda reales (`patients`, `appointments`, `waitlist_entries`)
- **Fase 2** — Odontograma versionado FDI con trigger de cierre inmutable
- **Fase 3A** — Presupuestos → Planes de tratamiento (trigger de conversión)
- **Fase 3B** — Pagos manuales + saldo real calculado
- **Fase 4A** — WhatsApp por links `wa.me` + catálogo de templates + historial

Módulos que ya venían del prototipo Lovable (backend real desde el arranque):
notas clínicas con versionado/revisión/auditoría, notificaciones realtime,
equipo y permisos con RLS testeada, exportación de compliance, subsistema
completo de email/DNS.

Qué hace y qué no hace el producto hoy, estado comercial, stack, seguridad y
cumplimiento: [`docs/Esmalia_Documento_Maestro_v2.md`](docs/Esmalia_Documento_Maestro_v2.md).
Qué viene en los próximos 90 días: [`docs/ROADMAP.md`](docs/ROADMAP.md) (única
fuente). Objetivos de disponibilidad: [`docs/SLO.md`](docs/SLO.md). Los planes y
auditorías anteriores están en [`docs/archivo/`](docs/archivo/) como histórico.

## Desarrollo local

```sh
npm i
npm run dev
```

Necesitas un `.env` con las variables de `.env.example` (Supabase + al menos una
clave de IA: `GEMINI_API_KEY` u `OPENAI_API_KEY`).

## Stack

- TanStack Start (SSR) + React 19 + Vite 8 + TypeScript
- Tailwind 4 + shadcn/ui
- Supabase (Postgres, Auth, Storage, Realtime)
- Deploy: Vercel o self-hosting con Docker (ver `DEPLOY-VERCEL.md` / `DEPLOY-SELFHOSTING.md`)

## Build con Lovable

Este proyecto sigue conectado a [Lovable](https://lovable.dev). Ver `AGENTS.md`
antes de hacer force-push o reescribir historia en `main`: rompe el sync.
