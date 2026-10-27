# Reserva en línea embebida (widget para la web de la clínica)

La página pública de reserva (`/reservar/<clínica>` y `/reservar/<clínica>/<profesional>`) se puede incrustar en el sitio de una clínica con un `iframe`. Es la única parte de Esmalia que acepta marcos de otros sitios; el resto de la app (agenda, fichas, portal, `/mi-cita`, `/api`) sigue prohibiendo ser embebida.

## Snippet para la clínica

Se copia desde **Reserva en línea → Compartir → Widget para tu web** (`snippetWidget` en `src/lib/reserva/qr.ts`). Es este:

```html
<iframe
  src="https://esmalia.com/reservar/<clinica>?embed=1"
  title="Reserva tu hora en <Clínica>"
  width="100%"
  height="760"
  style="border:0;max-width:640px"
  loading="lazy"
></iframe>
<p>
  <a href="https://esmalia.com/reservar/<clinica>" target="_blank" rel="noopener"
    >Reserva tu hora en <Clínica></a
  >
</p>
```

- `?embed=1` quita el encabezado y el pie del sitio de Esmalia (`validarBusquedaReserva`).
- El `<p><a>` de respaldo sirve a quien ve un sitio que no deja insertar páginas.
- Para un profesional concreto, usar la URL `/reservar/<clínica>/<profesional>?embed=1`.
- El título se escapa (`&`, `<`, `>`, `"`), así que un nombre de clínica con símbolos no rompe el HTML.

## Cómo está permitido (dos capas que tienen que coincidir)

1. **`vercel.json`**: el header `X-Frame-Options: SAMEORIGIN` se manda a toda ruta **salvo** `/reservar/*` (regla `"/((?!reservar/).*)"`). Los demás headers de seguridad (HSTS, nosniff, Referrer-Policy, Permissions-Policy) siguen aplicando también a la reserva.
2. **CSP en `src/router.tsx`** (`frameAncestorsPara`): `/reservar/<clínica>` y `/reservar/<clínica>/<profesional>` responden `frame-ancestors 'self' https:`; todo lo demás, `frame-ancestors 'self'`. Si hubiera un `X-Frame-Options` estático, el navegador lo respetaría y bloquearía el marco; por eso se quitó solo ahí.

Solo se admiten sitios `https:` como marco. Un sitio `http://` no puede embeber la reserva.

## Cómo se verifica

Los cambios de `vercel.json` no se ven en local. Tras cada cambio de headers:

```bash
# La reserva no debe traer X-Frame-Options y sí frame-ancestors con https:
curl -sD - -o /dev/null "https://<preview>/reservar/<clinica>" | grep -i -E "x-frame|content-security"
# Cualquier otra ruta debe seguir con SAMEORIGIN:
curl -sD - -o /dev/null "https://<preview>/auth" | grep -i -E "x-frame|content-security"
```

Y en un navegador real: una página local servida en otro origen (`python3 -m http.server 9100`) con un `<iframe>` hacia el preview debe mostrar el formulario; el mismo iframe hacia `/auth` debe quedar bloqueado. `tests/vercel-marco-widget.test.ts` vigila el archivo y `tests/reserva-en-linea.test.ts` la CSP.

## Cuando el preview está protegido

Los preview deploys de Vercel pueden pedir autenticación de Vercel (Deployment Protection): ahí el iframe cargaría la pantalla de acceso de Vercel y no la reserva. La verificación definitiva del widget es en producción (`esmalia.com` no tiene esa protección).
