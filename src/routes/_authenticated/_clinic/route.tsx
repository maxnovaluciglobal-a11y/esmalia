import { useEffect, useMemo } from "react";
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { getMyAccess } from "@/lib/access/access.functions";
import { ACCESS_QUERY_KEY, type ClinicAccess } from "@/lib/access/access";
import { leerRolSimulado, puedeSimular } from "@/lib/access/role-simulation";
import { ensureOfflineCacheHydrated } from "@/lib/offline/offline-cache";
import { AppShell } from "@/components/app-shell";
import { reportBoundaryError } from "@/lib/error-reporting";
import { captureException } from "@/lib/sentry";
// Geist Mono (utilidad `cifra`): solo la usa la app, así que se precarga acá
// y no en la raíz, para no sumarle un archivo a la landing.
import geistMono from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";

export const Route = createFileRoute("/_authenticated/_clinic")({
  head: () => ({
    links: [
      {
        rel: "preload",
        href: geistMono,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  beforeLoad: async ({ context }): Promise<{ access: ClinicAccess }> => {
    const { queryClient, user } = context;

    // Restaura del disco lo que se guardó en visitas anteriores. Antes esto
    // se esperaba ANTES de arrancar `getMyAccess`, en serie — sumaba una
    // vuelta completa al round-trip de red que ya de por sí cruza de Vercel
    // (EE.UU.) a Supabase (São Paulo). No hace falta esperarlo para *iniciar*
    // el pedido de red: arranca en paralelo, y solo se espera explícitamente
    // más abajo, en el catch, para el caso offline (auditoría de
    // performance, 31-ago — medido en producción: ~6-13s de hueco antes de
    // esto).
    const hydratePromise = ensureOfflineCacheHydrated(queryClient, user.id);

    // Va por el cache de React Query en vez de llamar directo: durante un
    // corte, este `await` era lo que tumbaba toda la app de clínica de una,
    // porque cada navegación lo vuelve a ejecutar.
    let access: ClinicAccess;
    try {
      access = await queryClient.ensureQueryData({
        queryKey: ACCESS_QUERY_KEY,
        queryFn: () => getMyAccess({}),
        staleTime: 5 * 60 * 1000,
      });
    } catch (err) {
      // Si ya sabíamos quién es, seguimos con eso: perder internet no debería
      // sacar a la clínica de la aplicación. La primera carga sí necesita red.
      // Hay que esperar la restauración acá (no antes): si todavía está en
      // vuelo, `getQueryData` daría un falso "no hay nada" y mandaría al
      // login a alguien con una sesión offline perfectamente válida.
      await hydratePromise;
      const conocido = queryClient.getQueryData<ClinicAccess>(ACCESS_QUERY_KEY);
      if (!conocido) throw err;
      access = conocido;
    }

    if (!access.clinic || !access.role) {
      throw redirect({ to: "/onboarding" });
    }

    // Sin gate de suscripción a nivel de app (auditoría 360, BIL-01): un
    // cobro fallido, una disputa o una cancelación ya NO expulsan al owner a
    // `/suscripcion`. La clínica es la custodia legal de la historia clínica
    // y tiene que poder verla y exportarla siempre. Lo que se restringe
    // (informes) lo decide `informesBloqueados` en cada ruta de informes y
    // en su par del servidor; el aviso con días de gracia lo muestra
    // `TrialBanner` vía `StatusStrip`. Ver `accesoPorSuscripcion` en billing.ts.

    // Simulación de rol: solo cambia lo que ve la interfaz. La autorización real
    // sigue viviendo en las políticas RLS con el rol verdadero del usuario.
    const simulado = puedeSimular(access.role) ? leerRolSimulado() : null;

    return {
      access: {
        ...access,
        realRole: access.role,
        simulatedRole: simulado,
        role: simulado ?? access.role,
      },
    };
  },
  component: () => <Outlet />,
  errorComponent: ClinicSectionError,
});

// Auditoría de código 01-sep-2026: ninguna ruta hija de /_clinic define su
// propio `errorComponent`, y esta ruta y `_authenticated` solo renderizan
// `<Outlet/>` — sin este boundary, un error en CUALQUIER pantalla (agenda,
// finanzas, etc.) escapaba hasta el de __root.tsx, que no tiene forma de
// armar el AppShell (nav lateral) porque esta rama del árbol nunca la monta
// arriba del Outlet. El usuario perdía la navegación entera por un error de
// una sola sección. Puesto acá (no en cada ruta hija) cubre todas de una.
function ClinicSectionError({ error: errorDesconocido, reset }: ErrorComponentProps) {
  // Desde @tanstack/react-router 1.170.4x el error llega como `unknown`.
  const error = useMemo(
    () =>
      errorDesconocido instanceof Error ? errorDesconocido : new Error(String(errorDesconocido)),
    [errorDesconocido],
  );
  const router = useRouter();
  const { access } = Route.useRouteContext();

  useEffect(() => {
    reportBoundaryError(error, { boundary: "clinic_section_error_component" });
    captureException(error, { tags: { boundary: "clinic_section_error_component" } });
  }, [error]);

  const mensaje = (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        No pudimos cargar esta sección. Puede ser un corte de conexión momentáneo.
      </p>
      <button
        type="button"
        onClick={() => {
          router.invalidate();
          reset();
        }}
        className="inline-flex items-center justify-center rounded-md border border-brand bg-transparent px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand/12"
      >
        Reintentar
      </button>
    </div>
  );

  // El beforeLoad de esta misma ruta puede fallar antes de resolver `access`
  // (sin cache offline y sin red) — ahí no hay con qué armar el AppShell.
  if (!access) {
    return <div className="p-6">{mensaje}</div>;
  }
  return (
    <AppShell title="No se pudo cargar" access={access}>
      {mensaje}
    </AppShell>
  );
}
