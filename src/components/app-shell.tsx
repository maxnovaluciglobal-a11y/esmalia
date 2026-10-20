import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LifeBuoy, LogOut, Menu, Moon, Settings, Sun } from "lucide-react";

import { EsmaliaLogo } from "@/components/esmalia-logo";
import { ClinicSwitcher } from "@/components/clinic-switcher";
import { GlobalSearch } from "@/components/global-search";
import { NotificationsBell } from "@/components/notifications-bell";
import { PastillaConexion } from "@/components/pastilla-conexion";
import { SoloLecturaProvider } from "@/components/solo-lectura";
import { StatusStrip } from "@/components/status-strip";
import { getSupabase } from "@/integrations/supabase/lazy";
import { resetOfflineCache } from "@/lib/offline/offline-cache";
import { useSincronizacionAutomatica } from "@/hooks/use-offline-mutation";
import { leerCola, pendientes } from "@/lib/offline/offline-queue";
import { hasPermission, ROLE_LABELS, type ClinicAccess } from "@/lib/access/access";
import { listPendingOutreach, listPendingReminders } from "@/lib/messaging/messaging.functions";
import { countConversacionesSinResponder } from "@/lib/messaging/conversations.functions";
import { AyudaMenu } from "@/components/ayuda-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  type Destino,
  destinoDeRuta,
  destinosVisibles,
  esRutaDeAjustes,
  pestanaActiva,
} from "@/lib/access/navegacion";
import { useFlag } from "@/lib/flags";
import { propsItemNav } from "@/lib/shell-v2";
import { cn } from "@/lib/utils";

/**
 * Barra inferior del celular (<768px, rediseño fase 5): los cinco destinos
 * del mostrador — Hoy, Agenda, Pacientes, Mensajes, Caja — con objetivos de
 * 44px+. Reportes, Ajustes y Ayuda van en "Más", para que la barra no pase
 * de seis toques posibles.
 */
const DESTINOS_BARRA = ["hoy", "agenda", "pacientes", "mensajes", "caja"] as const;

function BarraInferior({
  destinos,
  destinoActualId,
  enAjustes,
  badgePorDestino,
  onSignOut,
  signingOut,
  clinicName,
}: {
  destinos: Destino[];
  destinoActualId: string | null;
  enAjustes: boolean;
  badgePorDestino: Record<string, number>;
  onSignOut: () => void;
  signingOut: boolean;
  clinicName?: string | null;
}) {
  const [masAbierto, setMasAbierto] = useState(false);
  const enBarra = destinos.filter((d) => (DESTINOS_BARRA as readonly string[]).includes(d.id));
  const resto = destinos.filter((d) => !(DESTINOS_BARRA as readonly string[]).includes(d.id));
  const masActivo = enAjustes || resto.some((d) => d.id === destinoActualId);

  const item =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors";

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background/95 backdrop-blur-sm md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {enBarra.map(({ id, label, icon: Icon, pestanas }) => {
        const activo = destinoActualId === id;
        const badge = badgePorDestino[id] ?? 0;
        return (
          <Link
            key={id}
            to={pestanas[0].to}
            aria-current={activo ? "page" : undefined}
            className={cn(item, activo ? "text-brand-800" : "text-muted-foreground")}
          >
            <span className="relative">
              <Icon className={cn("size-5", activo && "text-brand-700")} aria-hidden />
              {badge > 0 && (
                <>
                  <span
                    aria-hidden
                    className="absolute -top-1.5 -right-3 min-w-4 rounded-sm bg-brand-700 px-0.5 text-center text-[11px] leading-4 tabular-nums text-white"
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                  <span className="sr-only">{` (${badge} pendientes)`}</span>
                </>
              )}
            </span>
            {label}
          </Link>
        );
      })}
      <Sheet open={masAbierto} onOpenChange={setMasAbierto}>
        <SheetTrigger className={cn(item, masActivo ? "text-brand-800" : "text-muted-foreground")}>
          <Menu className={cn("size-5", masActivo && "text-brand-700")} aria-hidden />
          Más
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="rounded-t-lg pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <SheetTitle className="font-display text-xl">Más</SheetTitle>
          <ul className="mt-4 divide-y divide-hairline border-y border-border">
            {[
              ...resto.map((d) => ({ to: d.pestanas[0].to, label: d.label })),
              { to: "/ajustes", label: "Ajustes" },
            ].map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  onClick={() => setMasAbierto(false)}
                  className="flex min-h-12 items-center text-base"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <AyudaMenu
                clinicName={clinicName}
                className="flex min-h-12 w-full items-center text-left text-base"
              >
                Ayuda
              </AyudaMenu>
            </li>
            <li className="flex min-h-12 items-center justify-between">
              <span className="text-base">Tema</span>
              <ThemeToggle />
            </li>
            <li>
              <button
                type="button"
                onClick={onSignOut}
                disabled={signingOut}
                className="flex min-h-12 w-full items-center gap-2 text-base text-destructive disabled:opacity-60"
              >
                <LogOut className="size-4" aria-hidden /> Cerrar sesión
              </button>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

const THEME_STORAGE_KEY = "esmalia:theme";

function ThemeToggle() {
  // Arranca en "claro" para que el primer render coincida con el del server
  // (TanStack Start SSR no tiene window/localStorage) y no rompa la
  // hidratación. La preferencia real (guardada, o si no la del SO) se aplica
  // recién en el efecto de montaje, que solo corre en el cliente.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const guardado = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (guardado === "dark" || guardado === "light") {
      setDark(guardado === "dark");
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setDark(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  function alternar() {
    setDark((d) => {
      const next = !d;
      window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      return next;
    });
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function initials(name: string | null, email: string | null) {
  const base = (name ?? email ?? "?").trim();
  const parts = base.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

export function AppShell({
  title,
  access,
  children,
}: {
  title: string;
  access: ClinicAccess;
  children: React.ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  // Shell A+ (PR 4): sidebar en tinta, ⌘K visible y densidad tranquila.
  // Apagado = el shell de siempre, sin un solo cambio.
  const shellV2 = useFlag("shell-v2", access.email);

  // Una sola vez para toda la app: si cada pantalla lo montara, varias
  // sincronizaciones competirían por la misma cola.
  useSincronizacionAutomatica(access.userId);

  // Seis destinos + Ajustes (rediseño, fase 3). Las rutas de siempre
  // aparecen como pestañas dentro de su destino; ver `navegacion.ts`.
  const destinos = destinosVisibles(access.role);
  const destinoActual = destinoDeRuta(pathname, destinos);
  const enAjustes = !destinoActual && esRutaDeAjustes(pathname);

  // Badge de "Recordatorios": sin recepción, un dentista solo puede olvidarse
  // de entrar a despachar la cola a mano. Solo se calcula si el rol puede
  // ver esa sección — mismo queryKey que /recordatorios para compartir cache.
  // Auditoría de código 01-sep-2026: esto relanza ~10 queries a la vez (la
  // cuenta real vive en listPendingReminders/listPendingOutreach) en TODA
  // pestaña abierta con este permiso — decisión de Walter (01-sep): 5 min de
  // atraso es imperceptible para una cola de "encargarse cuando puedas", a
  // cambio de ~5x menos carga. Se deja el poll (no se reemplaza por Realtime
  // puro) porque varios de los candidatos vencen por TIEMPO, no por una
  // escritura nueva en la DB (ej. cooldown de hygiene_recall a los 90 días).
  const clinicId = access.clinic?.id;
  const puedeVerRecordatorios = hasPermission(access.role, "agenda:manage") && Boolean(clinicId);
  const fetchReminders = useServerFn(listPendingReminders);
  const { data: recordatoriosPendientes = [] } = useQuery({
    queryKey: ["pending-reminders", clinicId],
    enabled: puedeVerRecordatorios,
    queryFn: () => fetchReminders({ data: { clinicId: clinicId! } }),
    refetchInterval: 5 * 60_000,
  });
  const fetchOutreach = useServerFn(listPendingOutreach);
  const { data: outreachPendiente = [] } = useQuery({
    queryKey: ["pending-outreach", clinicId],
    enabled: puedeVerRecordatorios,
    queryFn: () => fetchOutreach({ data: { clinicId: clinicId! } }),
    refetchInterval: 5 * 60_000,
  });
  const recordatoriosBadge = recordatoriosPendientes.length + outreachPendiente.length;

  // Badge de "Conversaciones": cuántos hilos terminan con un mensaje del
  // paciente. Query propia y liviana (no comparte cache con la pantalla) —
  // solo pide patient_id y direction, sin el cuerpo del mensaje, porque esto
  // se recalcula en toda pestaña abierta. 2 min y no 5 como recordatorios:
  // que alguien escriba y nadie conteste es más urgente que una cola de
  // avisos que vencen por tiempo.
  const fetchSinResponder = useServerFn(countConversacionesSinResponder);
  const { data: conversacionesBadge = 0 } = useQuery({
    queryKey: ["conversations-pendientes", clinicId],
    enabled: puedeVerRecordatorios,
    queryFn: () => fetchSinResponder({ data: { clinicId: clinicId! } }),
    refetchInterval: 2 * 60_000,
  });

  // Una sola tabla ruta→número, consumida por los dos navs (escritorio y
  // móvil). Antes el badge era un `to === "/recordatorios" && ...` repetido
  // en ambos: agregar un segundo contador significaba cuatro condicionales
  // que se desincronizan solos.
  const badgePorRuta: Record<string, number> = {
    "/recordatorios": recordatoriosBadge,
    "/conversaciones": conversacionesBadge,
  };
  const badgePorDestino: Record<string, number> = {
    mensajes: recordatoriosBadge + conversacionesBadge,
  };

  async function handleSignOut() {
    // La cola NO se borra al salir (son cobros ya hechos), pero quien se va
    // tiene que enterarse de que quedó algo sin subir.
    const sinSincronizar = pendientes(await leerCola()).filter(
      (i) => i.userId === access.userId,
    ).length;
    if (sinSincronizar > 0) {
      const seguir = window.confirm(
        `Quedan ${sinSincronizar} operación(es) guardadas en este equipo sin sincronizar. ` +
          `No se pierden: se van a subir cuando vuelvas a entrar con internet. ¿Cerrar sesión igual?`,
      );
      if (!seguir) return;
    }
    setSigningOut(true);
    await queryClient.cancelQueries();
    queryClient.clear();
    // No alcanza con limpiar memoria: en una PC compartida los datos de
    // pacientes quedarían en IndexedDB para el próximo que entre.
    await resetOfflineCache();
    // scope "local" a propósito: la clínica demo comparte una sola cuenta
    // (demo@esmalia.com) entre todos los visitantes anónimos. El scope por
    // defecto de Supabase ("global") revoca el refresh token en el server
    // para TODA sesión de ese user, así que cualquier visitante que cierre
    // sesión echaba de la demo a cualquier otro visitante concurrente.
    const supabase = await getSupabase();
    await supabase.auth.signOut({ scope: "local" });
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div
      data-app-shell
      data-shell-v2={shellV2 ? "" : undefined}
      className="flex min-h-dvh w-full bg-background text-foreground"
    >
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh w-60 shrink-0 flex-col lg:flex",
          // `dark` en el aside: los tokens de adentro (logo, selector de
          // clínica, foco) se leen sobre tinta aunque la página esté en claro.
          shellV2
            ? "dark border-r border-night-line bg-night text-on-night"
            : "border-r border-border bg-sidebar",
        )}
      >
        <div className="space-y-4 px-5 pt-6 pb-4">
          <Link to="/dashboard" className="flex items-center py-1">
            <EsmaliaLogo size={28} />
          </Link>
          <ClinicSwitcher access={access} />
          <GlobalSearch access={access} atajo shellV2={shellV2} />
        </div>

        <nav aria-label="Principal" className="flex-1 overflow-y-auto px-3">
          <ul className="space-y-0.5">
            {destinos.map(({ id, label, icon: Icon, pestanas }) => {
              const activo = destinoActual?.id === id;
              const badge = badgePorDestino[id] ?? 0;
              return (
                <li key={id}>
                  <Link to={pestanas[0].to} {...propsItemNav(activo, shellV2)}>
                    <Icon
                      className={cn(
                        "size-4",
                        shellV2
                          ? activo
                            ? "text-brand-on-night"
                            : "text-on-night-2"
                          : activo
                            ? "text-brand-700"
                            : "text-muted-foreground",
                      )}
                    />
                    <span>{label}</span>
                    {badge > 0 && (
                      <>
                        <span
                          aria-hidden
                          className="ml-auto min-w-5 rounded-sm bg-brand-700 px-1 text-center text-[11px] leading-5 tabular-nums text-white"
                        >
                          {badge > 9 ? "9+" : badge}
                        </span>
                        <span className="sr-only">{` (${badge} pendientes)`}</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {shellV2 && (
          <div className="px-5 pt-3">
            <PastillaConexion
              userId={access.userId}
              className="border-night-line bg-night-2 text-on-night-2"
            />
          </div>
        )}

        <div
          className={cn(
            "space-y-0.5 border-t px-3 py-3",
            shellV2 ? "mt-3 border-night-line" : "border-border",
          )}
        >
          <Link to="/ajustes" {...propsItemNav(enAjustes, shellV2)}>
            <Settings
              className={cn(
                "size-4",
                shellV2
                  ? enAjustes
                    ? "text-brand-on-night"
                    : "text-on-night-2"
                  : enAjustes
                    ? "text-brand-700"
                    : "text-muted-foreground",
              )}
            />
            Ajustes
          </Link>
          <AyudaMenu
            clinicName={access.clinic?.name}
            className={
              shellV2
                ? propsItemNav(false, true).className
                : "flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left text-[15px] text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-foreground"
            }
          >
            <LifeBuoy
              className={cn("size-4", shellV2 ? "text-on-night-2" : "text-muted-foreground")}
            />
            Ayuda
          </AyudaMenu>
        </div>
      </aside>

      <main id="main-content" className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-10 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-5 backdrop-blur-sm sm:px-8"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <h1 className="truncate font-display text-xl font-semibold">{title}</h1>
          <div className="flex items-center gap-3">
            {shellV2 && (
              <div className="hidden sm:block lg:hidden">
                <PastillaConexion userId={access.userId} />
              </div>
            )}
            <div className={cn("sm:w-56 lg:hidden", shellV2 && "md:w-64")}>
              <GlobalSearch access={access} shellV2={shellV2} enBarraSuperior />
            </div>
            <NotificationsBell userId={access.userId} />
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">
                {access.fullName ?? access.email ?? "Mi cuenta"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {access.role ? ROLE_LABELS[access.role] : "Sin rol"}
                {access.simulatedRole ? " · simulado" : ""}
              </p>
            </div>
            {access.avatarUrl ? (
              <img
                src={access.avatarUrl}
                alt={access.fullName ?? "Avatar"}
                width={40}
                height={40}
                loading="lazy"
                className="size-10 rounded-full object-cover outline outline-offset-[-1px] outline-border"
              />
            ) : (
              <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
                {initials(access.fullName, access.email)}
              </span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-label="Cerrar sesión"
              className="hidden size-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60 md:grid"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        {shellV2 && (
          <div className="px-5 pt-3 empty:hidden sm:hidden">
            <PastillaConexion userId={access.userId} soloSiHayAlgo />
          </div>
        )}

        <StatusStrip access={access} shellV2={shellV2} />

        <nav
          aria-label="Principal"
          className="hidden gap-1 overflow-x-auto border-b border-border px-4 py-2 md:flex lg:hidden"
        >
          {[
            ...destinos.map((d) => ({
              key: d.id,
              to: d.pestanas[0].to,
              label: d.label,
              activo: destinoActual?.id === d.id,
              badge: badgePorDestino[d.id] ?? 0,
            })),
            { key: "ajustes", to: "/ajustes", label: "Ajustes", activo: enAjustes, badge: 0 },
          ].map((d) => (
            <Link
              key={d.key}
              to={d.to}
              aria-current={d.activo ? "page" : undefined}
              className={cn(
                "flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm",
                d.activo
                  ? "border-brand/50 text-brand-800"
                  : "border-transparent text-muted-foreground",
              )}
            >
              {d.label}
              {d.badge > 0 && (
                <>
                  <span
                    aria-hidden
                    className="min-w-5 rounded-sm bg-brand-700 px-1 text-center text-[11px] leading-5 tabular-nums text-white"
                  >
                    {d.badge > 9 ? "9+" : d.badge}
                  </span>
                  <span className="sr-only">{` (${d.badge} pendientes)`}</span>
                </>
              )}
            </Link>
          ))}
          {/* Entre md y lg no hay sidebar ni barra inferior: Ayuda va acá. */}
          <AyudaMenu
            clinicName={access.clinic?.name}
            className="flex min-h-9 items-center whitespace-nowrap rounded-md border border-transparent px-3 text-sm text-muted-foreground"
          >
            Ayuda
          </AyudaMenu>
        </nav>

        {destinoActual && destinoActual.pestanas.length > 1 && (
          <nav
            aria-label={`Secciones de ${destinoActual.label}`}
            className="flex gap-6 overflow-x-auto border-b border-border px-5 sm:px-8"
          >
            {destinoActual.pestanas.map((p) => {
              const activa = pestanaActiva(pathname, p);
              const badge = badgePorRuta[p.to] ?? 0;
              return (
                <Link
                  key={p.to}
                  to={p.to}
                  aria-current={activa ? "page" : undefined}
                  className={cn(
                    "-mb-px flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 text-sm transition-colors",
                    activa
                      ? "border-brand text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                  {badge > 0 && (
                    <>
                      <span
                        aria-hidden
                        className="min-w-5 rounded-sm bg-brand-700 px-1 text-center text-[11px] leading-5 tabular-nums text-white"
                      >
                        {badge > 9 ? "9+" : badge}
                      </span>
                      <span className="sr-only">{` (${badge} pendientes)`}</span>
                    </>
                  )}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="flex-1 p-5 pb-28 sm:p-8 md:pb-8">
          <SoloLecturaProvider access={access}>{children}</SoloLecturaProvider>
        </div>

        <BarraInferior
          clinicName={access.clinic?.name}
          destinos={destinos}
          destinoActualId={destinoActual?.id ?? null}
          enAjustes={enAjustes}
          badgePorDestino={badgePorDestino}
          onSignOut={handleSignOut}
          signingOut={signingOut}
        />
      </main>
    </div>
  );
}
