import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Loader2 } from "lucide-react";
import { getSupabase } from "@/integrations/supabase/lazy";
import {
  listMyNotifications,
  markNotificationsRead,
} from "@/lib/messaging/notifications.functions";
import {
  destinoDeNotificacion,
  NOTIFICATION_KIND_LABELS,
  tiempoRelativo,
} from "@/lib/messaging/notifications";
import { esLecturaDePatty } from "@/lib/messaging/aviso-de-agenda";
import { PattyCara } from "@/components/patty-cara";

/** Campana de notificaciones internas con actualización en tiempo real. */
export function NotificationsBell({ userId }: { userId?: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const queryKey = ["notifications", userId ?? "anon"];

  const { data: notificaciones = [], isLoading } = useQuery({
    queryKey,
    enabled: Boolean(userId),
    queryFn: () => listMyNotifications(),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!userId) return;
    let soltar: (() => void) | undefined;
    let cancelado = false;

    void getSupabase().then((supabase) => {
      if (cancelado) return;
      const channel = supabase
        .channel(`notifications-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${userId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey });
            // El centro de notificaciones (NAV-11) también se entera.
            void queryClient.invalidateQueries({ queryKey: ["notification-center"] });
          },
        )
        .subscribe();
      soltar = () => void supabase.removeChannel(channel);
      // Si el componente se desmontó mientras resolvía el import, soltamos ya
      // — si no, el canal queda suscrito para siempre.
      if (cancelado) soltar();
    });

    return () => {
      cancelado = true;
      soltar?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const marcar = useMutation({
    mutationFn: (notificationId: string | null) =>
      markNotificationsRead({ data: { notificationId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["notification-center"] });
    },
  });

  if (!userId) return null;
  const sinLeer = notificaciones.filter((n) => !n.readAt).length;

  return (
    <div className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-label={sinLeer > 0 ? `Notificaciones, ${sinLeer} sin leer` : "Notificaciones"}
        className="relative inline-flex size-9 items-center justify-center rounded-lg border border-hairline hover:bg-secondary/60"
      >
        <Bell aria-hidden className="size-4" />
        {sinLeer > 0 && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 min-w-4 rounded-full bg-brand px-1 text-[11px] font-semibold leading-4 text-brand-foreground"
          >
            {sinLeer > 9 ? "9+" : sinLeer}
          </span>
        )}
      </button>

      {abierto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-hairline bg-background p-2 shadow-lg">
            <div className="flex items-center justify-between px-2 py-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Notificaciones
              </p>
              {sinLeer > 0 && (
                <button
                  onClick={() => marcar.mutate(null)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {marcar.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Check className="size-3" />
                  )}
                  Marcar todas
                </button>
              )}
            </div>

            <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {isLoading && <p className="px-2 py-3 text-xs text-muted-foreground">Cargando…</p>}
              {!isLoading && notificaciones.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No tienes notificaciones por ahora.
                </p>
              )}
              {notificaciones.map((n) => {
                const texto = (
                  <>
                    <p className="text-xs font-medium">{n.title}</p>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                    )}
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {NOTIFICATION_KIND_LABELS[n.kind] ?? "Aviso"} · {tiempoRelativo(n.createdAt)}
                    </p>
                  </>
                );
                // Solicitud de agenda que leyó Patty: su cara al lado. Solo en
                // ese tipo de aviso, para que un mensaje del paciente que
                // empiece igual no se haga pasar por ella. El cuerpo ya la
                // nombra ("Patty leyó: …"), así que la cara es decorativa.
                const leyoPatty = n.kind === "appointment_request" && esLecturaDePatty(n.body);
                const contenido = leyoPatty ? (
                  <span className="flex items-start gap-2.5">
                    <PattyCara px={28} decorativa className="mt-0.5" />
                    <span className="min-w-0 flex-1">{texto}</span>
                  </span>
                ) : (
                  texto
                );
                const clases = `block rounded-lg border p-2.5 text-left ${
                  n.readAt ? "border-hairline" : "border-brand/30 bg-brand/5"
                }`;
                const destino = destinoDeNotificacion(n);
                return n.patientRef ? (
                  <Link
                    key={n.id}
                    to="/pacientes/$pacienteId"
                    params={{ pacienteId: n.patientRef }}
                    onClick={() => {
                      setAbierto(false);
                      if (!n.readAt) marcar.mutate(n.id);
                    }}
                    className={clases}
                  >
                    {contenido}
                  </Link>
                ) : (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (!n.readAt) marcar.mutate(n.id);
                      // REC-10 y otros avisos con ruta interna (nunca externa).
                      if (destino?.tipo === "ruta") {
                        setAbierto(false);
                        void navigate({ href: destino.href });
                      }
                    }}
                    className={`w-full ${clases}`}
                  >
                    {contenido}
                  </button>
                );
              })}
            </div>
            {/* NAV-11: la bandeja completa, con filtros y "no leída". */}
            <Link
              to="/notificaciones"
              search={{ estado: "todas", tipo: "" }}
              onClick={() => setAbierto(false)}
              className="mt-1 flex min-h-10 items-center justify-center rounded-lg border-t border-hairline text-xs font-semibold text-brand-700 hover:bg-secondary/60"
            >
              Ver todas las notificaciones →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
