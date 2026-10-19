# Verificación en dos pasos (MFA TOTP)

Hallazgo SEG-01 de la auditoría 360 (18-oct-2026). Implementado con la API TOTP de Supabase Auth (`supabase.auth.mfa.*`), sin librerías propias de TOTP.

## Qué hace hoy

| Quién                                                    | Política                  | Dónde se aplica                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staff de plataforma (`ESMALIA_STAFF_EMAILS`, `/admin/*`) | **Obligatoria**           | Servidor: `requireEsmaliaStaffEmail` (`src/lib/admin/staff-gate.ts`) exige el claim `aal = "aal2"` del JWT verificado por `getClaims` en `requireSupabaseAuth`. Sin `aal2`, las server functions de `/admin` tiran `MENSAJE_STAFF_REQUIERE_MFA`. |
| Owner de clínica                                         | Recomendada (no bloquea)  | Franja en `StatusStrip` (se puede posponer 7 días) y tarjeta en `/preferencias`.                                                                                                                                                                 |
| Resto de roles                                           | Opcional                  | Tarjeta en `/preferencias`.                                                                                                                                                                                                                      |
| Cualquiera con un factor verificado                      | Desafío al iniciar sesión | Cliente: `_authenticated/route.tsx` manda a `/auth/verificar` si `currentLevel = aal1` y `nextLevel = aal2`. Cubre contraseña, Google y sesión restaurada.                                                                                       |
| Cuenta de la demo (`demo@esmalia.com`)                   | Bloqueada                 | La tarjeta no deja inscribir un factor: la cuenta es compartida y un factor dejaría afuera a todos los visitantes.                                                                                                                               |

La lógica de decisión es pura y está en `src/lib/auth/mfa.ts`, con tests en `tests/mfa-gate.test.ts`.

### Límite conocido

Para quien no es staff, el desafío al iniciar sesión es una frontera **de interfaz**: el JWT `aal1` (solo contraseña) sigue siendo aceptado por PostgREST y por las server functions de clínica, porque ninguna policy RLS mira `aal`. Alguien con la contraseña robada de un usuario con MFA podría llamar la API directo. Cerrarlo es la sección siguiente.

## Cómo volverla obligatoria (owners, o todos los que la activaron)

1. **RLS (la frontera real).** Una policy `RESTRICTIVE` por tabla sensible, con el patrón oficial de Supabase. Para "obligatoria solo para quien la activó":

   ```sql
   create policy mfa_si_la_activo on public.patients
     as restrictive to authenticated
     using (
       array[(select auth.jwt()->>'aal')] <@ (
         select case when count(id) > 0 then array['aal2'] else array['aal1','aal2'] end
         from auth.mfa_factors
         where (select auth.uid()) = user_id and status = 'verified'
       )
     );
   ```

   Repetir en `patients`, `clinical_notes*`, `patient_medical_history`, `payments`, `odontogram_marks`, `patient_documents` y el resto de tablas con PHI. Para exigirla a **todo owner**, la condición es `(select auth.jwt()->>'aal') = 'aal2' or not public.has_clinic_role(clinic_id, array['owner']::public.app_role[])` (owner sin `aal2` no lee). Va como migración versionada, con test cross-tenant y con OK de Walter para aplicarla.

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
