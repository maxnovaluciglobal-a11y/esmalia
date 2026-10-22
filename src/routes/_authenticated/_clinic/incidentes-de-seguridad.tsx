import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { RegistroBrechas } from "@/components/derechos/registro-brechas";
import { requirePermission } from "@/lib/access/route-guards";

export const Route = createFileRoute("/_authenticated/_clinic/incidentes-de-seguridad")({
  beforeLoad: requirePermission("team:manage"),
  head: () => ({
    meta: [
      { title: "Incidentes de seguridad | Esmalia" },
      {
        name: "description",
        content:
          "Registro de incidentes de seguridad y brechas de datos personales de la clínica (Ley 21.719), exportable en PDF y CSV.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: IncidentesDeSeguridadPage,
});

function IncidentesDeSeguridadPage() {
  const { access } = Route.useRouteContext();
  return (
    <AppShell title="Incidentes de seguridad" access={access}>
      {access.clinic ? (
        <RegistroBrechas clinicId={access.clinic.id} isDemo={access.clinic.isDemo} />
      ) : (
        <p className="text-muted-foreground">
          Necesitas una clínica activa para ver el registro de incidentes.
        </p>
      )}
    </AppShell>
  );
}
