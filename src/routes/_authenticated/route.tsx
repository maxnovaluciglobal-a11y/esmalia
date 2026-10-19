import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { necesitaDesafioMfa } from "@/lib/auth/mfa";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // `getSession()` lee la sesión de localStorage sin tocar la red.
    // `getUser()` sí pega contra Supabase para revalidar el token, y por eso
    // durante un corte de internet echaba al usuario al login aunque tuviera
    // una sesión perfectamente válida guardada.
    //
    // Esto es un guard de interfaz, no la frontera de seguridad: quién puede
    // leer qué lo siguen decidiendo las políticas RLS contra el JWT, del lado
    // del servidor. Un token adulterado acá no abre ningún dato.
    // Import diferido: `routeTree.gen.ts` importa TODOS los módulos de ruta
    // de forma eager, así que un import estático acá metía el cliente de
    // Supabase (~200 KB) en el chunk de entrada — lo descargaba también quien
    // sólo abre la landing. `beforeLoad` ya es async, así que diferirlo no
    // cambia el orden de nada.
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });

    // SEG-01: si la cuenta tiene verificación en dos pasos y esta sesión
    // todavía no la pasó (`aal1`), se pide el código antes de mostrar nada.
    // Cubre los tres caminos de entrada (contraseña, Google y sesión
    // restaurada) porque todos terminan acá. Sin argumentos,
    // `getAuthenticatorAssuranceLevel` lee la sesión local y no toca la red,
    // así que no rompe el modo sin conexión.
    const { data: niveles } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (necesitaDesafioMfa(niveles)) throw redirect({ to: "/auth/verificar" });

    return { user: data.session.user };
  },
  component: () => <Outlet />,
});
