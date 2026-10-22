# Firma a distancia con código

**Versión:** 1 · 22-oct-2026 · Ola 5 (DOC-05). Código en `src/lib/firma-distancia/`, página pública en `src/routes/firmar.$token.tsx`, migraciones `20261026100000` y `20261026100100`.

El paciente firma en su celular un documento que la clínica le pide: un consentimiento, cualquier documento emitido cuya plantilla diga "El paciente firma este documento", o la aceptación de un presupuesto. Es **firma electrónica simple** (Ley 19.799, art. 2 letra f): no es avanzada ni usa certificado acreditado.

## Flujo

```
staff: "Pedir firma a distancia"  (documento emitido o presupuesto)
  → patient_signature_requests (la base copia el documento, calcula su huella,
    decide quién firma y exige RUT y correo; vence en 72 h)
  → link /firmar/<token> por WhatsApp (wa.me asistido), correo o copiado
paciente (sin login):
  1. RUT          → compara con la ficha (índice ciego); 5 intentos, bloqueo 15 min
                    bien: sesión de 30 min y recién ahí ve el documento
  2. código       → 6 dígitos por correo; vence en 10 min; uno por minuto, 5 por link;
                    5 intentos y bloqueo
  3. firma        → nombre + "Leí y acepto" + dibujo (opcional)
                    evidencia + huella; presupuesto aceptado; copia en PDF
```

- **Token:** 256 bits aleatorios en base64url. La base guarda solo `sha256(token)`. De un solo uso: firmada, cancelada o reemplazada, la solicitud ya no acepta nada. Reenviar crea una solicitud nueva y la anterior queda `reemplazada`.
- **Sin datos clínicos fuera de la página:** el correo y el WhatsApp dicen que la clínica pide una firma, no qué documento. Antes del RUT la página muestra solo el nombre de la clínica. El historial del paciente (`messages`) guarda que se mandó un link, sin el link ni el título.
- **Quién firma:** el paciente adulto; si es menor (en el huso de la clínica), su tutor principal vigente, con el RUT del tutor. Sin tutor, sin RUT o sin correo, la base no deja pedir la firma y el diálogo dice qué falta.
- **Estados:** `enviada`, `abierta` (la abrió o pasó el RUT), `firmada`, `cancelada`, `reemplazada`; `vencida` se calcula (abierta con `expires_at` pasado). Ficha (pestaña Documentos), documento emitido y presupuesto muestran el estado, reenviar, cancelar y la evidencia.

## Decisión: el código siempre por correo

El brief pedía el código por el canal que no se usó para el link, o el mismo si hay uno solo. Esmalia manda WhatsApp en modo **asistido** (wa.me: lo envía una persona de la clínica). Un código por wa.me lo vería quien lo manda, que además tiene el link: podría firmar por el paciente. Por eso:

- El código sale **siempre por correo**, desde el servidor, y nadie de la clínica lo ve. La base guarda solo `sha256(token_hash:código)`, y el staff no puede leer esa columna (SELECT por columna) para no poder probar el millón de combinaciones fuera de línea.
- Link por WhatsApp o copiado → código por correo: dos canales.
- Link por correo → código por el mismo correo (un solo canal disponible), como permitía el brief.
- Cuando la conexión con la Cloud API de Meta esté habilitada, el código puede ir por una plantilla de autenticación de WhatsApp (pendiente).
- El correo del código es **transaccional**: lo pide el propio paciente en ese momento, no lleva enlace de baja y sale aunque se haya dado de baja de los correos de la clínica. Sí respeta el modo de prueba (`email_sandbox_config`): en sandbox se bloquea o se desvía, y el diálogo del staff lo avisa antes de pedir la firma. El correo con el **link** sí respeta la baja (no se ofrece ese canal) y lleva enlace de baja.

## Evidencia guardada

En la solicitud firmada, inmutable (trigger `patient_signature_requests_proteger`, corre también para el rol de servicio):

| Dato                         | Columna                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Copia exacta de lo firmado   | `sheet`, `content_blocks`, `content_html`                                    |
| Huella del documento         | `document_sha256` (en un documento emitido = su `content_sha256`)            |
| Quién firmó y en qué calidad | `signer_name`, `signer_role` (paciente/tutor), `signer_expected_name`        |
| RUT verificado               | `signer_rut_masked` (últimos 4) y `signer_rut_sha256` (atado a la solicitud) |
| Fecha y hora                 | `signed_at` (UTC, milisegundos) y `signed_at_local` (huso de la clínica)     |
| IP y dispositivo             | `signed_ip`, `signed_user_agent`                                             |
| Canal del código y del link  | `code_channel`, `code_recipient_masked`, `link_channel`                      |
| Declaración aceptada         | `accepted_text` (la arma el servidor, no el navegador)                       |
| Firma dibujada               | `signature_storage_path`, `signature_sha256` (bucket `clinical-documents`)   |
| Huella de toda la evidencia  | `evidence_sha256` (la calcula la base; `huellaDeEvidencia` es el par)        |
| Copia firmada en PDF         | `signed_copy_path`, `signed_copy_sha256` (una vez, hasta 15 min después)     |

Más la bitácora `patient_signature_events` (creada, abierta, RUT correcto/incorrecto, bloqueo, código enviado/incorrecto, firmada, copia guardada, cancelada, reemplazada) con IP y navegador. La copia firmada (`pdf.ts` + `hojaDeCopiaFirmada`) lleva el documento, la firma del paciente y una constancia con todos estos datos; el paciente la descarga al firmar y la clínica la ve en la evidencia. La pantalla de evidencia recalcula la huella en el navegador ("Evidencia íntegra").

Base legal: Ley 19.799 (firma electrónica simple y su valor probatorio), Ley 20.584 (derechos del paciente, consentimiento informado), Decreto 41 de 2012 del Minsal (la ficha se conserva: nada de esto se edita ni se borra; `patients` usa `RESTRICT`). El texto de los consentimientos sigue siendo un modelo que la clínica revisa con su asesor.

## Presupuesto

Firmar = aceptarlo **completo**, por la transición de siempre: la función de la base hace `UPDATE quotes SET status = 'accepted'` y los triggers de siempre validan la transición (`quote_a_validar_transicion`), crean el plan (`quote_accept_creates_plan`) y escriben el historial (`quote_events`). Pedir la firma de un borrador lo pasa a `sent`. Si después la clínica cambia líneas o totales, la huella del presupuesto (`huella_de_presupuesto`) cambia y la firma se rechaza: hay que pedir un link nuevo. La aceptación parcial a distancia no está (se hace en la clínica).

## Antiabuso

- Límite por IP en memoria (30/min, `exigirLimiteDeFirma`) y en la base (60 eventos de una IP en 10 min).
- 5 intentos de RUT y 5 de código por solicitud, con bloqueo de 15 min; 5 códigos por solicitud.
- La página pública no llama a la base: llama server functions que usan funciones `SECURITY DEFINER` ejecutables **solo** por `service_role`, cada una acotada por el sha256 del token.
- El token va en el path: Sentry lo tapa (`sentry-redact.ts`), `robots.txt` excluye `/firmar` y la página es `noindex` con `no-referrer`.

## Límites conocidos

- WhatsApp asistido: el staff abre wa.me y envía el mensaje; si no lo envía, el estado queda en "Enviada" igual.
- Un consentimiento firmado a distancia es un documento emitido de tipo consentimiento, no una fila de `patient_consents` (la tarjeta Consentimientos sigue siendo la firma en la clínica). Los dos aparecen en la pestaña Documentos.
- La IP la pone Vercel (`x-forwarded-for`); en local queda "Sin dato".
- Quien edita la ficha podría cambiar el correo del paciente antes de pedir la firma: la evidencia guarda a qué correo (enmascarado) fue el código, y la bitácora quién pidió la firma.
- El lienzo de firma dibuja en el color del texto; antes de enviarla se repinta en tinta oscura para que se vea en el PDF.
