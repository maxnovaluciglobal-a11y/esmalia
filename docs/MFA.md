# Verificación en dos pasos (app autenticadora o código por correo)

Hallazgo SEG-01 de la auditoría 360 (18-oct-2026). Dos métodos, que cada usuario activa por separado en `/preferencias` (Seguridad de tu cuenta):

- **App autenticadora** (TOTP): la API TOTP de Supabase Auth (`supabase.auth.mfa.*`), sin librerías propias de TOTP.
- **Código por correo** (26-oct-2026, pedido de Walter): propio de Esmalia, porque Supabase no tiene factor de correo. Ver la sección "Código por correo" más abajo.

## Qué hace hoy

| Quién                                                    | Política                                           | Dónde se aplica                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff de plataforma (`ESMALIA_STAFF_EMAILS`, `/admin/*`) | **Obligatoria**                                    | Servidor: `requireEsmaliaStaffEmail` (`src/lib/admin/staff-gate.ts`) exige el claim `aal = "aal2"` del JWT verificado por `getClaims` en `requireSupabaseAuth`. Sin `aal2`, las server functions de `/admin` tiran `MENSAJE_STAFF_REQUIERE_MFA`.                                                   |
| Owner de clínica                                         | Recomendada (no bloquea)                           | Franja en `StatusStrip` (se puede posponer 7 días) y tarjeta en `/preferencias`.                                                                                                                                                                                                                   |
| Resto de roles                                           | Opcional                                           | Tarjeta en `/preferencias`.                                                                                                                                                                                                                                                                        |
| Cualquiera con un factor verificado                      | Desafío al iniciar sesión y `aal2` exigido por RLS | Cliente: `_authenticated/route.tsx` manda a `/auth/verificar` si `currentLevel = aal1` y `nextLevel = aal2` (contraseña, Google y sesión restaurada). Base: política `RESTRICTIVE` `mfa_exige_aal2` en las tablas con datos de salud, de pacientes o de dinero (ver abajo; migración sin aplicar). |
| Cuenta de la demo (`demo@esmalia.com`)                   | Bloqueada                                          | La tarjeta no deja inscribir un factor: la cuenta es compartida y un factor dejaría afuera a todos los visitantes.                                                                                                                                                                                 |

La lógica de decisión es pura y está en `src/lib/auth/mfa.ts`, con tests en `tests/mfa-gate.test.ts`.

### La frontera real: RLS exige `aal2` a quien activó MFA

Migración `20261019230000_rls_exige_aal2.sql` (**aplicada en producción**, PR #72). Hasta ella, el desafío al iniciar sesión era solo una frontera **de interfaz**: el JWT `aal1` (solo contraseña) seguía siendo aceptado por PostgREST, y con la contraseña robada de un usuario con MFA se podía leer la historia clínica llamando `/rest/v1` directo.

Patrón oficial de Supabase: una política `RESTRICTIVE` llamada `mfa_exige_aal2` en cada tabla sensible, `for all to authenticated`, con `using`/`with check` = `(select public.sesion_cumple_mfa())`. Las restrictivas se combinan con AND con las permisivas de siempre (`is_clinic_member`, `has_clinic_role`): no abren nada, solo cierran.

| Sesión                                            | Resultado                                                      |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Usuario sin factor verificado (`aal1`)            | Todo igual que antes                                           |
| Usuario con factor verificado, sesión `aal2`      | Todo igual que antes                                           |
| Usuario con factor verificado, sesión `aal1`      | 0 filas al leer; error de RLS al escribir                      |
| Factor inscrito pero sin verificar                | Cuenta como "sin MFA": todo igual                              |
| Cuenta demo (`demo@esmalia.com`)                  | Siempre pasa (ya no puede tener factores; esto es el cinturón) |
| `service_role` (webhooks, crons, portales, admin) | No la ve (`BYPASSRLS`)                                         |
| `anon`                                            | No aplica                                                      |

- **Función:** `public.sesion_cumple_mfa()` — `language sql stable security definer set search_path = ''`, EXECUTE solo para `authenticated` y `service_role`. Devuelve `aal = 'aal2'` **o** no existe factor `verified` en `auth.mfa_factors` para `auth.uid()` **o** es la cuenta demo.
- **Rendimiento:** envuelta en `(select ...)` Postgres la evalúa una vez por consulta (InitPlan), no por fila; por dentro son dos búsquedas por índice. Verificado con `explain` en una base local.
- **Tablas:** la lista vive en `src/lib/auth/mfa-rls.ts` (`TABLAS_CON_AAL2`, 81 tablas (verificado el 28-oct-2026 importando la lista; 62 más en `TABLAS_SIN_AAL2`, 143 en total). La lista de acá es la de la primera tanda, el código manda: pacientes, recetas, signos vitales, tutores y su bitácora, registro de lecturas de la ficha, historia clínica y sus versiones/revisiones/entidades/bitácora, anamnesis y su bitácora, odontograma, periodontograma, documentos, consentimientos, ortodoncia, planes de tratamiento, laboratorio, agenda, pedidos de hora, lista de espera, mensajes, avisos, leads de WhatsApp, accesos al portal, presupuestos, pagos, gastos, caja y comisiones). Más el bucket `clinical-documents` de Storage. Las demás están en `TABLAS_SIN_AAL2` con su motivo (estructura de la clínica que la app lee antes y durante `/auth/verificar`, catálogos, backend solo `service_role`).
- **Guarda en CI:** `tests/mfa-rls-tablas.test.ts` falla si una migración crea una tabla que no está en ninguna de las dos listas, y si la migración no contiene exactamente el SQL que genera `sqlPoliticaAal2` para cada tabla protegida. **Tabla nueva con datos de salud, de pacientes o de dinero:** agregarla a `TABLAS_CON_AAL2` y crear la política en su propia migración con el SQL de `sqlPoliticaAal2(tabla)`.
- **Server functions:** las que usan `context.supabase` (cliente del usuario, `requireSupabaseAuth`) reenvían el JWT tal cual a PostgREST, así que heredan el comportamiento de la tabla de arriba sin cambios de código. Las que usan `supabaseAdmin` (portal del paciente, portal del laboratorio, invitaciones, WhatsApp) no se ven afectadas.

#### Lo que esta política NO cubre

- **Funciones `SECURITY DEFINER` llamables por RPC** saltean RLS por diseño. Las que leen o escriben datos de pacientes (`RPC_CON_GUARDIA_AAL2` en `src/lib/auth/mfa-rls.ts`: `get_patient_document_id`, `list_patients_with_last_and_next_appointment`, `merge_patients`, `registrar_evento_de_nota`, `registrar_exportacion_de_clinica`, `registrar_lectura_ficha`, `set_patient_document_id`) reciben en la misma migración un guard al inicio del cuerpo: `IF NOT public.sesion_cumple_mfa() THEN RAISE EXCEPTION ... USING ERRCODE = '42501'`. Cada `create or replace` copia la última definición vigente y solo agrega el guard; el test lo verifica y también falla si aparece una función `SECURITY DEFINER` nueva que toque tablas de pacientes sin clasificar. **Si otra migración redefine una de estas funciones después, tiene que conservar el guard.** `guardar_nota_clinica` (#79) no lo necesita: es `SECURITY INVOKER`, así que la política RLS de `clinical_notes` y `clinical_note_versions` ya la cubre. `mis_datos_de_firma` y `registrar_mis_datos_de_firma` solo tocan los datos de firma del propio profesional.
- **Server functions con `supabaseAdmin` detrás de `requireSupabaseAuth`** que lean datos clínicos para el usuario: hoy ninguna lo hace (las que usan `supabaseAdmin` son portales con token propio, invitaciones y WhatsApp), pero una nueva tendría que chequear `context.claims.aal` igual que `requireEsmaliaStaffEmail`.
- **Otro dispositivo con sesión vieja:** si alguien activa MFA en su computadora, la sesión `aal1` que ya tenía abierta en el teléfono deja de ver datos clínicos (pantallas vacías) hasta la próxima navegación, cuando `_authenticated/route.tsx` lo manda a `/auth/verificar`. Es el comportamiento correcto; puede generar una consulta a soporte.

#### Plan de prueba después de aplicar

1. Usuario **sin** MFA: entrar, abrir agenda, ficha, odontograma, presupuestos y pagos, registrar un pago. Todo igual.
2. Usuario **con** MFA, sesión `aal1` por API (contraseña sola, sin `mfa.verify`): `GET /rest/v1/patients?select=id` con su `access_token` → `[]`; `POST /rest/v1/patients` → 403/42501. Mismo resultado en `payments`, `clinical_notes`, `odontogram_marks`.
3. El mismo usuario después de `mfa.challengeAndVerify` (`aal2`): todo visible y editable.
4. Demo: entrar por `/demo` y recorrer la ficha. Todo igual.
5. Consulta de control: `select tablename from pg_policies where policyname = 'mfa_exige_aal2' order by 1;` → 36 filas.

#### Reversa

Al pie de la migración, comentada. Orden: primero volver a correr la definición anterior de cada RPC con guard (la última en `supabase/migrations/` antes de esta, que es igual sin el guard), después un `drop policy if exists mfa_exige_aal2 on public.<tabla>;` por tabla y el de `storage.objects`, y recién al final `drop function if exists public.sesion_cumple_mfa();` (si se borra antes, las RPC con guard fallan). Todo en una transacción.

### Inscripción y cuenta demo (revisión del PR #65)

- **Solo desde `/preferencias`, con inicio de sesión reciente** (`sesionReciente`: menos de 10 minutos según el `amr` del JWT; el `iat` no sirve porque se renueva con cada refresh). La pantalla de acceso restringido de `/admin` ya **no** ofrece activar el factor: con una contraseña robada de staff alcanzaba para inscribir un TOTP propio y subir a `aal2`.
- Esto es una guarda de interfaz: quien tiene la contraseña puede iniciar sesión de nuevo y llamar `mfa.enroll` desde la consola. Lo que protege de verdad al staff es **que cada integrante ya tenga su factor inscrito**. Mientras no lo tenga, la contraseña sola alcanza para inscribirlo. Por eso, después del deploy, todo el staff activa su factor de inmediato y se verifica con `select user_id, status from auth.mfa_factors`.
- **Demo:** el cliente nunca le pide el código a `demo@esmalia.com` (`_authenticated/route.tsx` y `/auth/verificar`). `/api/demo-reset` borra sus factores en cada reset (admin API), y la migración `20261019140000_demo_sin_mfa.sql` (aplicada en producción) agrega un trigger que rechaza inscribirle factores y borra los existentes.

## Código por correo (26-oct-2026)

Pedido de Walter del 26-oct-2026: esperaba un correo con el código y Esmalia solo usaba Google Authenticator. Migración `20261026900000_mfa_por_correo.sql` (PR #160; **aplicada en producción**, comprobado el 28-oct-2026 con `to_regclass('public.mfa_email_settings')`).

### Por qué no es un factor de Supabase

Supabase Auth solo tiene factores **TOTP** y **teléfono** (documentación oficial, consultada el 26-oct-2026); el correo existe como método de inicio de sesión (`otp`), no como segundo factor, y nada que no sea un factor sube la sesión a `aal2`. Por eso:

- El servidor genera el código (6 dígitos uniformes, `generarCodigo`), guarda solo `sha256("mfa-correo:" + user_id + ":" + session_id + ":" + código)` y lo manda por Resend. Vence en 10 minutos, admite 5 intentos y sirve una vez; un código nuevo anula el anterior. Límites: 1 por minuto por sesión y 5 por hora por usuario (en la base), más un límite por IP en memoria.
- Al validarlo, la base registra la verificación **ligada al `session_id` del JWT** en `mfa_email_verifications`. Vale mientras esa sesión exista en `auth.sessions` (cerrar sesión la borra) y el usuario tenga el correo activo.
- `public.sesion_cumple_mfa()` pasa a ser: `aal2` **o** (sin TOTP verificado **y** sin correo activo) **o** demo **o** verificación por correo vigente para esta sesión. Parte de la definición de producción (consultada en solo lectura el 26-oct-2026, igual a `20261019230000`): para quien no activó el correo no cambia nada. Las políticas `mfa_exige_aal2` (una por tabla de `TABLAS_CON_AAL2`, 81 al 28-oct-2026) y el guard de las RPC la usan, así que quedan cubiertas sin tocarlas.

| Sesión                                                          | Resultado           |
| --------------------------------------------------------------- | ------------------- |
| Correo activo, sesión `aal1` sin código                         | Bloqueada (0 filas) |
| Correo activo, código verificado en **esta** sesión             | Permitida           |
| Correo activo, otra sesión del mismo usuario (otro dispositivo) | Bloqueada           |
| Código verificado, después cierra sesión o desactiva el correo  | Ya no cuenta        |
| TOTP + correo: `aal2` **o** código por correo                   | Permitida           |
| Código vencido, usado o con 5 intentos fallidos                 | Rechazado           |

Lo fija `tests/mfa-correo-db.test.ts` contra la base efímera.

### Tablas y funciones

- `mfa_email_settings` (activo, método preferido, autorización para sumar la app), `mfa_email_codes` (solo el hash), `mfa_email_verifications` (sesiones verificadas), `mfa_email_events` (bitácora: enviado, fallido, incorrecto, agotado, verificado, activado, desactivado, método preferido, app autorizada; nunca el código). Las cuatro con RLS **sin políticas**: solo `service_role`. Clasificadas en `TABLAS_SIN_AAL2` y en el backup.
- `mfa_correo_emitir_codigo` y `mfa_correo_verificar_codigo`: solo `service_role` (las llama el servidor). `mi_estado_mfa()` y `sesion_mfa_por_correo_vigente()`: `authenticated`, solo leen lo del propio usuario y su sesión.
- Trigger `exigir_correo_para_inscribir_factor` en `auth.mfa_factors`: con el correo activo, GoTrue dejaría inscribir un TOTP a una sesión `aal1` (no hay otro factor de Supabase), y con la contraseña sola se podía subir a `aal2` sin pasar por el correo. El trigger lo rechaza salvo que una sesión ya verificada lo autorice (`autorizarInscripcionApp`, 10 minutos).

### Servidor (`src/lib/auth/mfa-correo.functions.ts`)

- `session_id`, `aal` y `amr` salen del JWT verificado (`context.claims`), nunca del cliente. Ninguna función recibe una dirección: el código va al correo de la cuenta (leído con `service_role`), así que no se puede preguntar por otra ni saber si un correo existe.
- **Activar** el correo exige inicio de sesión reciente (10 min) y, si la cuenta ya tiene la app, una sesión `aal2`: con la contraseña sola no se suma un método que esquive la app. La activación misma prueba que el correo es suyo (código) y deja verificada la sesión.
- **Desactivar** o **cambiar el método preferido** exige una sesión que ya cumple (`mi_estado_mfa().sesion_cumple`).
- Las POST no usan el middleware de escritura: son la seguridad de la cuenta y tienen que funcionar con la suscripción impaga (`ESCRITURA_EXENTA`).

### Cuándo no se ofrece el correo

`motivoCorreoNoDisponible` (`src/lib/auth/mfa-correo.ts`): cuenta demo, envío sin configurar (`RESEND_API_KEY`/`EMAIL_FROM`), cuenta sin correo, correo sin confirmar o de un dominio reservado (`example.com`, `.test`…). La tarjeta muestra el botón deshabilitado con el motivo (`AccionDeshabilitada`).

**Sin modo de prueba:** el código va siempre al correo de la cuenta por Resend directo, sin `email_sandbox_config` de la clínica ni `LIFECYCLE_EMAIL_REDIRECT_TO`. Esos redirigen correos a otra dirección, y un código de acceso redirigido se lo entrega a otra persona. Es un correo de autenticación, como los de Supabase (confirmar cuenta, recuperar contraseña), que tampoco pasan por ahí.

### Interfaz

- `/preferencias` → tarjeta "Verificación en dos pasos": arriba, en una línea, qué se le pide al entrar; después la app y el correo con su estado (Activa / No activa) y sus botones; con los dos activos, "Al entrar, pedirme primero".
- `/auth/verificar`: ofrece el preferido y "Usar el otro método". Con el correo, el código sale solo al abrir la pantalla, con "Reenviar el código" y cuenta regresiva. Con la app, la ayuda: "El código de la app no llega por correo: abre tu app autenticadora y escribe el número que muestra".
- `_authenticated/route.tsx`: si la sesión no es `aal2`, pregunta a la base `mi_estado_mfa().sesion_cumple` (la misma función que la RLS) y guarda el `true` en memoria por `session_id`. Sin conexión cae a la regla de la app (sin red), como antes.

### Staff de `/admin`: el correo no alcanza

`requireEsmaliaStaffEmail` sigue exigiendo el claim `aal = "aal2"` del JWT, que solo da la app autenticadora. Decisión: `/admin` ve todas las clínicas, y el correo del staff es justamente lo que se recupera con la contraseña en un robo de cuenta típico; el TOTP vive en otro dispositivo. Un integrante del staff puede tener el correo activo para la app de clínica, pero para `/admin` necesita la app.

### Plan de prueba después de aplicar

1. Usuario sin segundo paso: entra y navega igual que antes.
2. Activar el correo en `/preferencias` (sesión de menos de 10 min): llega el código, se escribe, queda "Activa" y la sesión sigue adentro.
3. Cerrar sesión y entrar: pide el código por correo; `/rest/v1/patients` con el `access_token` antes de verificar → `[]`; después → filas.
4. Sumar la app con el correo activo; elegir "pedirme primero" cada uno; en `/auth/verificar` probar "Usar el otro método".
5. Control: `select event, count(*) from public.mfa_email_events group by 1;`

### Reversa

Al pie de la migración, comentada: primero se restaura `sesion_cumple_mfa()` a la definición anterior (que no usa las tablas nuevas), después se borran el trigger, las funciones y las tablas. Quien solo tenía el correo queda con la contraseña sola.

## Cómo volverla obligatoria (owners, o todos los que la activaron)

1. **RLS.** Para quien ya tiene un factor, la exigencia de `aal2` ya está en la base (sección anterior). Para exigirla a **todo owner** aunque no haya inscrito un factor, la condición de `public.sesion_cumple_mfa()` pasaría a ser `(select auth.jwt()->>'aal') = 'aal2' or not public.has_clinic_role(clinic_id, array['owner']::public.app_role[])` en una política aparte por tabla (owner sin `aal2` no lee). Migración versionada, con test cross-tenant y con OK de Walter.

2. **Interfaz.** En `src/lib/auth/mfa.ts`, `politicaMfaDeRol("owner")` → `"obligatoria"`, y en `_authenticated/_clinic/route.tsx`, si la política es obligatoria y no hay factor, redirigir a una pantalla de inscripción (reusar `VerificacionDosPasosCard`) en vez de mostrar la franja.

3. **Comunicarlo antes**: aviso a las clínicas con fecha de corte, para que nadie quede afuera un lunes a las 9.

## Recuperación (perdió el teléfono o el acceso al correo)

La pantalla de desafío manda a `soporte@esmalia.com`. Procedimiento, solo con identidad verificada (respuesta desde el correo de la cuenta y, para owners, confirmación por un segundo canal conocido):

```ts
// Con service_role, desde un script local. Nunca exponer esto en la app.
await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId, id: factorId });
```

Si perdió el acceso al correo: `update public.mfa_email_settings set enabled = false where user_id = '<id>';` (con `service_role`, misma verificación de identidad).

Después, pedirle que la vuelva a activar en `/preferencias`. Registrar quién, cuándo y por qué en el runbook de incidentes.

## Configuración del proyecto Supabase

Según la documentación de Supabase, la API TOTP viene **habilitada por defecto** en todos los proyectos. Confirmar en Dashboard → Authentication → Multi-Factor (proyecto `hvfkygoguxvpmwslrccb`) que TOTP tenga _Enroll_ y _Verify_ habilitados. Este cambio no toca esa configuración.
