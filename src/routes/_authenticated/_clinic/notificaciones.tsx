import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import {
  CentroDeNotificaciones,
  type FiltroEstado,
} from "@/components/notificaciones/centro-de-notificaciones";
import { requirePermission } from "@/lib/access/route-guards";
import { esGrupoDeNotificacion } from "@/lib/messaging/notifications";

interface NotificacionesSearch {
  estado: FiltroEstado;
  /** Grupo de tipos ("" = todos). */
  tipo: string;
}

/** Ola 11 · NAV-11: centro de notificaciones (la bandeja de la campana). */
export const Route = createFileRoute("/_authenticated/_clinic/notificaciones")({
  validateSearch: (search: Record<string, unknown>): NotificacionesSearch => ({
    estado: search.estado === "sin-leer" ? "sin-leer" : "todas",
    tipo: esGrupoDeNotificacion(search.tipo) ? search.tipo : "",
  }),
  // Todos los roles tienen su bandeja; solo se leen las propias (RLS).
  beforeLoad: requirePermission("dashboard:view"),
  head: () => ({
    meta: [{ title: "Notificaciones | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: NotificacionesPage,
});

function NotificacionesPage() {
  const { access } = Route.useRouteContext();
  const { estado, tipo } = Route.useSearch();
  return (
    <AppShell title="Notificaciones" access={access}>
      {access.clinic && (
        <CentroDeNotificaciones
          clinicId={access.clinic.id}
          clinicName={access.clinic.name}
          userId={access.userId}
          estado={estado}
          grupo={esGrupoDeNotificacion(tipo) ? tipo : null}
        />
      )}
    </AppShell>
  );
}
