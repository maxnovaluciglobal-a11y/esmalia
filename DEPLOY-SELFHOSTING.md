# Esmalia — Guía de self-hosting (VPS propia)

Esmalia es una app **TanStack Start + Vite**. En producción se construye con **Nitro**,
que genera un servidor Node autónomo en `.output/server/index.mjs`.

---

## 1. Requisitos de la VPS

- 2 vCPU / 2 GB RAM mínimo (4 GB recomendado para builds en el propio servidor)
- Docker + Docker Compose, **o** Node.js 24 (el mismo que usa Vercel) con npm
- Un dominio apuntando a la IP y un reverse proxy con TLS (Caddy, Nginx o Traefik)

---

## 2. Variables de entorno

Copia `.env.example` a `.env` y complétalo.

| Variable                            | Momento   | Notas                                                             |
| ----------------------------------- | --------- | ----------------------------------------------------------------- |
| `VITE_SUPABASE_URL`                 | **build** | Se incrusta en el bundle del navegador                            |
| `VITE_SUPABASE_PUBLISHABLE_KEY`     | **build** | Clave pública, puede viajar al cliente                            |
| `VITE_SUPABASE_PROJECT_ID`          | **build** | Referencia del proyecto                                           |
| `SUPABASE_SERVICE_ROLE_KEY`         | runtime   | **Solo servidor.** Nunca al navegador                             |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | runtime   | Reemplazan a `LOVABLE_API_KEY`, que solo existe dentro de Lovable |
| `EMAIL_*`, `RESEND_API_KEY`         | runtime   | Notificaciones del flujo de revisión                              |
| `PORT`, `HOST`                      | runtime   | Por defecto `3000` y `0.0.0.0`                                    |

> Las variables `VITE_*` se resuelven **en build-time**: si las cambias hay que reconstruir la imagen.

---

## 3. Despliegue con Docker (recomendado)

```bash
git clone <tu-repo> esmalia && cd esmalia
cp .env.example .env && nano .env

docker compose up -d --build
docker compose logs -f esmalia
```

La app queda en `http://TU_IP:3000`.

Actualizaciones:

```bash
git pull
docker compose up -d --build
```

---

## 4. Despliegue sin Docker

```bash
npm ci
export NITRO_PRESET=node-server
npm run build

# arranque
NODE_ENV=production PORT=3000 HOST=0.0.0.0 node .output/server/index.mjs
```

Servicio systemd (`/etc/systemd/system/esmalia.service`):

```ini
[Unit]
Description=Esmalia
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/esmalia
EnvironmentFile=/opt/esmalia/.env
ExecStart=/usr/bin/node /opt/esmalia/.output/server/index.mjs
Restart=always
User=esmalia

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now esmalia
```

---

## 5. Reverse proxy con TLS (Caddy)

```caddyfile
clinica.ejemplo.com {
    reverse_proxy 127.0.0.1:3000
}
```

---

## 6. Base de datos

El backend gestionado por Lovable no se migra automáticamente. Para una instancia propia:

1. Levanta tu propio Supabase (self-hosted) o crea un proyecto en supabase.com.
2. Aplica las migraciones del repo (`supabase/migrations/`) en orden con el CLI de Supabase o `psql`.
3. Vuelca los datos existentes con `pg_dump --data-only` y restáuralos.
4. Reconfigura Auth: proveedores (Google), URLs de redirección y plantillas de correo.
5. Actualiza `VITE_SUPABASE_*` y `SUPABASE_SERVICE_ROLE_KEY`, y **reconstruye**.

> Las políticas RLS, funciones y triggers del flujo clínico viajan en las migraciones: no las repliques a mano.

---

## 7. Checklist antes de producción

- [ ] TLS activo y `PUBLIC_APP_URL` con https
- [ ] `SUPABASE_SERVICE_ROLE_KEY` fuera del control de versiones
- [ ] `EMAIL_SANDBOX=true` hasta validar entregabilidad
- [ ] Backups automáticos de Postgres (`pg_dump` diario)
- [ ] Clave de IA propia configurada y con límite de gasto
- [ ] Healthcheck (`/`) monitorizado
