import { Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellOff, Check, CheckCheck, Loader2, Mail, MailOpen } from "lucide-react";
import { toast } from "sonner";

import {
  BOTON_PASTILLA,
  ChipFiltro,
  EncabezadoEditorial,
  PANEL_LISTA,
} from "@/components/a-plus/lista";
import { PattyCara } from "@/components/patty-cara";
import { getMyNotificationPreferences } from "@/lib/messaging/notification-preferences.functions";
import {
  destinoDeNotificacion,
  GRUPOS_DE_NOTIFICACION,
  NOTIFICATION_KIND_LABELS,
  tiempoRelativo,
  type AppNotification,
  type GrupoDeNotificacion,
} from "@/lib/messaging/notifications";
import {
  listNotificationCenter,
  markNotificationsRead,
  markNotificationUnread,
} from "@/lib/messaging/notifications.functions";
import { esLecturaDePatty } from "@/lib/messaging/aviso-de-agenda";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Centro de notificaciones (Ola 11 · NAV-11): la bandeja completa de la
 * campana. Leídas y sin leer, marcar todo, volver a "no leída" y filtros por
 * tipo, en la clínica activa. Respeta la preferencia de avisos: si la persona
 * los apagó, la base no los guarda (`notifications_respetar_preferencia`) y
 * acá se le dice, con el camino para volver a encenderlos.
 */

export type FiltroEstado = "todas" | "sin-leer";

export function CentroDeNotificaciones({
  clinicId,
  clinicName,
  userId,
  estado,
  grupo,
}: {
  clinicId: string;
  clinicName: string | null;
  userId: string;
  estado: FiltroEstado;
  grupo: GrupoDeNotificacion | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchBandeja = useServerFn(listNotificationCenter);
  const fetchPreferencias = useServerFn(getMyNotificationPreferences);
  const marcarLeidas = useServerFn(markNotificationsRead);
  const marcarNoLeida = useServerFn(markNotificationUnread);

  const queryKey = ["notification-center", clinicId, estado, grupo] as const;
  const bandeja = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchBandeja({ data: { clinicId, estado, grupo, antesDe: pageParam } }),
    getNextPageParam: (ultima) => ultima.siguiente,
    refetchInterval: 60_000,
  });
  const { data: preferencias } = useQuery({
    queryKey: ["notification-preferences", userId],
    queryFn: () => fetchPreferencias(),
    staleTime: 5 * 60_000,
  });

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ["notification-center", clinicId] });
    // La campana comparte los datos: que el contador baje también ahí.
    void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
  };

  const leer = useMutation({
    mutationFn: (notificationId: string | null) =>
      marcarLeidas({ data: { notificationId, clinicId: notificationId ? null : clinicId } }),
    onSuccess: refrescar,
    onError: (e) => toast.error(mensajeDeError(e, "No pudimos actualizar tus notificaciones.")),
  });
  const desleer = useMutation({
    mutationFn: (notificationId: string) => marcarNoLeida({ data: { notificationId } }),
    onSuccess: refrescar,
    onError: (e) => toast.error(mensajeDeError(e, "No pudimos actualizar tus notificaciones.")),
  });

  const items = bandeja.data?.pages.flatMap((p) => p.items) ?? [];
  const sinLeer = bandeja.data?.pages[0]?.sinLeer ?? 0;

  const irA = (patch: { estado?: FiltroEstado; tipo?: GrupoDeNotificacion | null }) =>
    void navigate({
      to: "/notificaciones",
      search: {
        estado: patch.estado ?? estado,
        tipo: patch.tipo === undefined ? (grupo ?? "") : (patch.tipo ?? ""),
      },
      replace: true,
    });

  const abrir = (n: AppNotification) => {
    if (!n.readAt) leer.mutate(n.id);
    const destino = destinoDeNotificacion(n);
    if (!destino) return;
    if (destino.tipo === "paciente") {
      void navigate({ to: "/pacientes/$pacienteId", params: { pacienteId: destino.pacienteId } });
    } else {
      void navigate({ href: destino.href });
    }
  };

  return (
    <div className="mx-auto max-w-[60rem] space-y-[18px]">
      <EncabezadoEditorial
        contexto={[
          clinicName,
          bandeja.isLoading ? null : sinLeer === 0 ? "Todo leído" : `${sinLeer} sin leer`,
        ]}
        titulo="Tus"
        enfasis="notificaciones"
        acciones={
          <>
            {sinLeer > 0 && (
              <button
                type="button"
                onClick={() => leer.mutate(null)}
                disabled={leer.isPending}
                className={BOTON_PASTILLA}
              >
                {leer.isPending ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <CheckCheck aria-hidden className="size-4" />
                )}
                Marcar todo como leído
              </button>
            )}
            <Link to="/preferencias" className={BOTON_PASTILLA}>
              Preferencias
            </Link>
          </>
        }
      />

      {preferencias && !preferencias.inappEnabled && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-[14px] border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          <BellOff aria-hidden className="size-4 shrink-0" />
          <p className="min-w-0 flex-1">
            Tienes apagados los avisos dentro de Esmalia: no llegan avisos nuevos a esta bandeja.
          </p>
          <Link to="/preferencias" className="font-semibold underline underline-offset-4">
            Encenderlos
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros">
        <ChipFiltro activo={estado === "todas"} onClick={() => irA({ estado: "todas" })}>
          Todas
        </ChipFiltro>
        <ChipFiltro activo={estado === "sin-leer"} onClick={() => irA({ estado: "sin-leer" })}>
          Sin leer
        </ChipFiltro>
        <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
        <ChipFiltro activo={grupo === null} onClick={() => irA({ tipo: null })}>
          Todos los tipos
        </ChipFiltro>
        {GRUPOS_DE_NOTIFICACION.map((g) => (
          <ChipFiltro key={g.id} activo={grupo === g.id} onClick={() => irA({ tipo: g.id })}>
            {g.label}
          </ChipFiltro>
        ))}
      </div>

      <section aria-label="Notificaciones" className={cn(PANEL_LISTA, "overflow-hidden")}>
        {bandeja.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 text-sm text-destructive"
          >
            No pudimos cargar tus notificaciones.
            <button type="button" onClick={() => void bandeja.refetch()} className={BOTON_PASTILLA}>
              Reintentar
            </button>
          </div>
        ) : bandeja.isLoading ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">
            {estado === "sin-leer"
              ? "No tienes notificaciones sin leer."
              : grupo
                ? "No hay notificaciones de este tipo."
                : "No tienes notificaciones por ahora. Los avisos del equipo y de los pacientes aparecen acá."}
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {items.map((n) => {
              const destino = destinoDeNotificacion(n);
              const leyoPatty = n.kind === "appointment_request" && esLecturaDePatty(n.body);
              return (
                <li
                  key={n.id}
                  data-notificacion={n.readAt ? "leida" : "sin-leer"}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 sm:px-5",
                    !n.readAt && "bg-brand/5",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-2 size-2 shrink-0 rounded-full",
                      n.readAt ? "bg-transparent" : "bg-brand",
                    )}
                  />
                  {leyoPatty && <PattyCara px={28} decorativa className="mt-0.5" />}
                  <button
                    type="button"
                    onClick={() => abrir(n)}
                    disabled={!destino && Boolean(n.readAt)}
                    className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default"
                  >
                    <span className="sr-only">{n.readAt ? "Leída: " : "Sin leer: "}</span>
                    <span
                      className={cn(
                        "block text-[15px] leading-snug",
                        n.readAt ? "font-medium" : "font-semibold",
                      )}
                    >
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block line-clamp-2 text-sm text-muted-foreground">
                        {n.body}
                      </span>
                    )}
                    <span className="mt-1 block text-[12.5px] text-muted-foreground">
                      {NOTIFICATION_KIND_LABELS[n.kind] ?? "Aviso"} · {tiempoRelativo(n.createdAt)}
                      {destino && <span className="font-semibold text-brand-700"> · Abrir →</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => (n.readAt ? desleer.mutate(n.id) : leer.mutate(n.id))}
                    aria-label={n.readAt ? "Marcar como no leída" : "Marcar como leída"}
                    title={n.readAt ? "Marcar como no leída" : "Marcar como leída"}
                    className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:size-9"
                  >
                    {n.readAt ? (
                      <Mail aria-hidden className="size-4" />
                    ) : (
                      <MailOpen aria-hidden className="size-4" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {bandeja.hasNextPage && (
          <div className="border-t border-hairline px-5 py-3">
            <button
              type="button"
              onClick={() => void bandeja.fetchNextPage()}
              disabled={bandeja.isFetchingNextPage}
              className={BOTON_PASTILLA}
            >
              {bandeja.isFetchingNextPage ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Check aria-hidden className="size-4" />
              )}
              Ver anteriores
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
