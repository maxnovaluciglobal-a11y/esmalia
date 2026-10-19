# Verificación en dos pasos (MFA TOTP)

Hallazgo SEG-01 de la auditoría 360 (18-oct-2026). Implementado con la API TOTP de Supabase Auth (`supabase.auth.mfa.*`), sin librerías propias de TOTP.

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

Migración `20261019200000_rls_exige_aal2.sql` (**sin aplicar, requiere OK de Walter**). Hasta ella, el desafío al iniciar sesión era solo una frontera **de interfaz**: el JWT `aal1` (solo contraseña) seguía siendo aceptado por PostgREST, y con la contraseña robada de un usuario con MFA se podía leer la historia clínica llamando `/rest/v1` directo.

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
- **Tablas:** la lista vive en `src/lib/auth/mfa-rls.ts` (`TABLAS_CON_AAL2`, 31 tablas: pacientes, historia clínica y sus versiones/revisiones/entidades/bitácora, anamnesis y su bitácora, odontograma, periodontograma, documentos, consentimientos, ortodoncia, planes de tratamiento, laboratorio, agenda, pedidos de hora, lista de espera, mensajes, avisos, leads de WhatsApp, accesos al portal, presupuestos, pagos, gastos, caja y comisiones). Más el bucket `clinical-documents` de Storage. Las demás están en `TABLAS_SIN_AAL2` con su motivo (estructura de la clínica que la app lee antes y durante `/auth/verificar`, catálogos, backend solo `service_role`).
- **Guarda en CI:** `tests/mfa-rls-tablas.test.ts` falla si una migración crea una tabla que no está en ninguna de las dos listas, y si la migración no contiene exactamente el SQL que genera `sqlPoliticaAal2` para cada tabla protegida. **Tabla nueva con datos de salud, de pacientes o de dinero:** agregarla a `TABLAS_CON_AAL2` y crear la política en su propia migración con el SQL de `sqlPoliticaAal2(tabla)`.
- **Server functions:** las que usan `context.supabase` (cliente del usuario, `requireSupabaseAuth`) reenvían el JWT tal cual a PostgREST, así que heredan el comportamiento de la tabla de arriba sin cambios de código. Las que usan `supabaseAdmin` (portal del paciente, portal del laboratorio, invitaciones, WhatsApp) no se ven afectadas.

#### Lo que esta política NO cubre

- **Funciones `SECURITY DEFINER` llamables por RPC** saltean RLS por diseño: `list_patients_with_last_and_next_appointment` (listado de pacientes) y `get_patient_document_id` (RUT/DNI descifrado) devuelven datos de pacientes a un `aal1` con MFA; `set_patient_document_id`, `merge_patients` y `registrar_exportacion_de_clinica` escriben. Cerrarlo es agregar al inicio de cada una `if not public.sesion_cumple_mfa() then raise exception 'Se requiere verificación en dos pasos.' using errcode = '42501'; end if;`. Quedó **fuera de este cambio a propósito**: la Tanda 2 tiene migraciones anteriores (soft delete, cifrado de la ficha) que probablemente redefinen esas funciones, y un `create or replace` con el cuerpo de hoy les pisaría el cambio. Va en una migración propia después de que esas se mergeen.
- **Server functions con `supabaseAdmin` detrás de `requireSupabaseAuth`** que lean datos clínicos para el usuario: hoy ninguna lo hace (las que usan `supabaseAdmin` son portales con token propio, invitaciones y WhatsApp), pero una nueva tendría que chequear `context.claims.aal` igual que `requireEsmaliaStaffEmail`.
- **Otro dispositivo con sesión vieja:** si alguien activa MFA en su computadora, la sesión `aal1` que ya tenía abierta en el teléfono deja de ver datos clínicos (pantallas vacías) hasta la próxima navegación, cuando `_authenticated/route.tsx` lo manda a `/auth/verificar`. Es el comportamiento correcto; puede generar una consulta a soporte.

#### Plan de prueba después de aplicar

1. Usuario **sin** MFA: entrar, abrir agenda, ficha, odontograma, presupuestos y pagos, registrar un pago. Todo igual.
2. Usuario **con** MFA, sesión `aal1` por API (contraseña sola, sin `mfa.verify`): `GET /rest/v1/patients?select=id` con su `access_token` → `[]`; `POST /rest/v1/patients` → 403/42501. Mismo resultado en `payments`, `clinical_notes`, `odontogram_marks`.
3. El mismo usuario después de `mfa.challengeAndVerify` (`aal2`): todo visible y editable.
4. Demo: entrar por `/demo` y recorrer la ficha. Todo igual.
5. Consulta de control: `select tablename from pg_policies where policyname = 'mfa_exige_aal2' order by 1;` → 31 filas.

#### Reversa

Al pie de la migración, comentada: un `drop policy if exists mfa_exige_aal2 on public.<tabla>;` por tabla, el de `storage.objects` y `drop function if exists public.sesion_cumple_mfa();`, en una transacción.

### Inscripción y cuenta demo (revisión del PR #65)

- **Solo desde `/preferencias`, con inicio de sesión reciente** (`sesionReciente`: menos de 10 minutos según el `amr` del JWT; el `iat` no sirve porque se renueva con cada refresh). La pantalla de acceso restringido de `/admin` ya **no** ofrece activar el factor: con una contraseña robada de staff alcanzaba para inscribir un TOTP propio y subir a `aal2`.
- Esto es una guarda de interfaz: quien tiene la contraseña puede iniciar sesión de nuevo y llamar `mfa.enroll` desde la consola. Lo que protege de verdad al staff es **que cada integrante ya tenga su factor inscrito**. Mientras no lo tenga, la contraseña sola alcanza para inscribirlo. Por eso, después del deploy, todo el staff activa su factor de inmediato y se verifica con `select user_id, status from auth.mfa_factors`.
- **Demo:** el cliente nunca le pide el código a `demo@esmalia.com` (`_authenticated/route.tsx` y `/auth/verificar`). `/api/demo-reset` borra sus factores en cada reset (admin API), y la migración `20261019140000_demo_sin_mfa.sql` (**sin aplicar, requiere OK de Walter**) agrega un trigger que rechaza inscribirle factores y borra los existentes.

## Cómo volverla obligatoria (owners, o todos los que la activaron)

1. **RLS.** Para quien ya tiene un factor, la exigencia de `aal2` ya está en la base (sección anterior). Para exigirla a **todo owner** aunque no haya inscrito un factor, la condición de `public.sesion_cumple_mfa()` pasaría a ser `(select auth.jwt()->>'aal') = 'aal2' or not public.has_clinic_role(clinic_id, array['owner']::public.app_role[])` en una política aparte por tabla (owner sin `aal2` no lee). Migración versionada, con test cross-tenant y con OK de Walter.

2. **Interfaz.** En `src/lib/auth/mfa.ts`, `politicaMfaDeRol("owner")` → `"obligatoria"`, y en `_authenticated/_clinic/route.tsx`, si la política es obligatoria y no hay factor, redirigir a una pantalla de inscripción (reusar `VerificacionDosPasosCard`) en vez de mostrar la franja.

3. **Comunicarlo antes**: aviso a las clínicas con fecha de corte, para que nadie quede afuera un lunes a las 9.

## Recuperación (perdió el teléfono)

La pantalla de desafío manda a `soporte@esmalia.com`. Procedimiento, solo con identidad verificada (respuesta desde el correo de la cuenta y, para owners, confirmación por un segundo canal conocido):

```ts
// Con service_role, desde un script local. Nunca exponer esto en la app.
await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId, id: factorId });
```

Después, pedirle que la vuelva a activar en `/preferencias`. Registrar quién, cuándo y por qué en el runbook de incidentes.

## Configuración del proyecto Supabase

Según la documentación de Supabase, la API TOTP viene **habilitada por defecto** en todos los proyectos. Confirmar en Dashboard → Authentication → Multi-Factor (proyecto `hvfkygoguxvpmwslrccb`) que TOTP tenga _Enroll_ y _Verify_ habilitados. Este cambio no toca esa configuración.
