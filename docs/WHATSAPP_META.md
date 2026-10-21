# WhatsApp con Meta: Tech Provider y Embedded Signup v4

Cómo queda Esmalia habilitada para que cada clínica conecte su propio número
de WhatsApp. Esmalia es **Tech Provider independiente** (Cloud API directo,
sin un BSP en el medio). Cada clínica paga a Meta sus conversaciones con su
propio medio de pago.

## Estado al 21-oct-2026
| Pieza | Estado |
|---|---|
| App de Meta **Esmalia** | ✅ ID `1659883992514425`, propiedad del portafolio, caso de uso WhatsApp agregado, ícono y URLs legales cargadas |
| Webhook | ✅ `https://esmalia.com/api/whatsapp-webhook` verificado; campos `messages`, `message_template_status_update`, `account_update` (token rotado el 20-oct) |
| Embedded Signup v4 | ✅ configuración "Esmalia Embedded Signup v4", ID `2083986443004167` (= `VITE_WHATSAPP_CONFIG_ID`), producto WhatsApp Cloud API, token de usuario del sistema a 60 días |
| Facebook Login for Business | ✅ Client OAuth, Web OAuth, HTTPS, navegador integrado, modo estricto y SDK de JavaScript; URI y dominio `https://esmalia.com/` |
| Usuario del sistema | ✅ `esmalia-whatsapp` (`61595613541883`), acceso total a la app |
| Variables en Vercel | ✅ `WHATSAPP_APP_ID`, `VITE_WHATSAPP_APP_ID`, `VITE_WHATSAPP_CONFIG_ID`, `WHATSAPP_APP_SECRET` (sensitive), redeploy hecho |
| Tech Provider | ⏳ falta (lo registra Walter: Casos de uso → Conviértete en proveedor de tecnología) |
| Verificación del negocio | ⏳ falta: Meta pide un teléfono de EE. UU. con un documento de la LLC (factura del proveedor del número) |
| App Review | ⏳ después de lo anterior |

Mientras la app no esté publicada, solo conectan su WhatsApp las personas con rol en la app: para el piloto, sumar a cada clínica como **tester** (Roles de la app).

## Estructura en Meta

Un solo **portafolio comercial**: `Maxnova & Luci LLC` (ID `2490091194819587`),
razón social `MAXNOVA & LUCI GLOBAL LLC`. Debajo, un **grupo de activos** por
proyecto (Configuración → Grupos de activos comerciales):

| Grupo | Activos |
|---|---|
| DypOS | Página de Facebook DypOS, su app de Meta si la tiene |
| MOY IQ | Página de Facebook MOY IQ |
| Esmalia | App de Meta "Esmalia" (WhatsApp), dominio `esmalia.com`, usuario del sistema `esmalia-whatsapp` |

La verificación del negocio es del portafolio: se hace una vez y sirve a los tres.

## Quién hace qué

| Paso | Quién |
|---|---|
| Perfil personal real como administrador del portafolio | Walter |
| Web del portafolio `https://esmalia.com` | Walter |
| Dominio `esmalia.com` en Seguridad de la marca (TXT en Cloudflare) | Walter lo agrega, Claude carga el TXT |
| Cuenta de desarrollador y app Business "Esmalia" | Walter (con su perfil real) |
| Verificación del negocio (artículos de la LLC o carta del EIN, correo `@esmalia.com`) | Walter |
| Configuración de la app (dominios, OAuth, webhook, configuración de Embedded Signup v4) | Claude, con acceso de desarrollador a la app |
| Variables en Vercel que no son secretas | Claude |
| `WHATSAPP_APP_SECRET` en Vercel | Walter: `vercel env add WHATSAPP_APP_SECRET production --sensitive` |
| Videos y envío de App Review | Walter graba, Claude escribe el guion y los textos |

## Configuración de la app (App Dashboard)

1. **Configuración básica:** nombre Esmalia, ícono, categoría Negocios,
   privacidad `https://esmalia.com/privacidad`, términos
   `https://esmalia.com/terminos`, eliminación de datos
   `https://esmalia.com/privacidad`, contacto `soporte@esmalia.com`.
2. **Casos de uso → WhatsApp → Personalizar → Tech Provider onboarding:**
   aceptar los términos, "Independent Tech Provider".
3. **Facebook Login for Business → Configuración → Client OAuth:** activar
   Client OAuth login, Web OAuth login, Enforce HTTPS, Embedded Browser OAuth
   login, Strict Mode y Login with the JavaScript SDK. Dominios permitidos y
   URI de redirección: `https://esmalia.com/`.
4. **Facebook Login for Business → Configurations:** crear desde la plantilla
   "WhatsApp Embedded Signup Configuration With 60 Expiration Token", producto
   **Cloud API**. El ID de esa configuración es `VITE_WHATSAPP_CONFIG_ID`.
   Seleccionar productos en la configuración es lo que activa la v4 (la v2 y
   la v3 dejan de funcionar el 15-oct-2026).
5. **WhatsApp → Configuración → Webhook:** URL
   `https://esmalia.com/api/whatsapp-webhook`, token de verificación =
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (ya cargado en Vercel). Suscribir los
   campos `messages`, `message_template_status_update` y `account_update`.

## Variables en Vercel (producción)

| Variable | Secreta | Estado |
|---|---|---|
| `WHATSAPP_APP_ID` / `VITE_WHATSAPP_APP_ID` | No | ✅ Cargadas (20-oct) |
| `VITE_WHATSAPP_CONFIG_ID` | No | ✅ Cargada (20-oct) |
| `WHATSAPP_APP_SECRET` | Sí | ✅ Cargada (20-oct, por portapapeles, validada contra Meta) |
| `WHATSAPP_CREDENTIALS_KEY` | Sí | Cargada |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Baja | Cargada |
| `WHATSAPP_API_VERSION` / `VITE_WHATSAPP_API_VERSION` | No | `v25.0`, cargadas |
| `WHATSAPP_SYSTEM_USER_TOKEN` | Sí | Opcional, respaldo |

Con `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_CREDENTIALS_KEY` y
`VITE_WHATSAPP_CONFIG_ID` cargadas (más un redeploy, por las `VITE_`), `/whatsapp`
muestra el botón de conectar. Sin ellas, todo sigue por wa.me.

## Qué hace Esmalia cuando una clínica conecta

1. Canjea el código de Meta por el token de negocio de la clínica (vive 30 s).
2. Suscribe la app al WABA de la clínica (webhooks).
3. Registra el número para Cloud API con un PIN aleatorio.
4. Guarda token y PIN cifrados en `whatsapp_credentials` (solo service role).
5. Crea las 12 plantillas de `src/lib/messaging/meta-plantillas.ts` en la
   cuenta de la clínica. Cuando Meta las aprueba, el webhook las marca
   `approved` y recién ahí los envíos salen por la API.
6. La clínica tiene que agregar un medio de pago en WhatsApp Manager
   (https://business.facebook.com/wa/manage/home/). Sin eso Meta no entrega.

## Límites

- Antes de la verificación del negocio y la App Review: hasta 10 clínicas
  nuevas cada 7 días. Después: 200.
- Mientras la app está en modo desarrollo, solo pueden conectarse personas
  con rol en la app (administrador, desarrollador o tester). Sirve para un
  piloto antes de la revisión.

## App Review

Pedir **acceso avanzado** a `whatsapp_business_messaging` y
`whatsapp_business_management`, con dos videos: un mensaje enviado desde
Esmalia que llega a WhatsApp, y la creación de una plantilla (puede ser en
WhatsApp Manager).
