import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { BandejaSolicitudes } from "@/components/derechos/bandeja-solicitudes";
import { requirePermission } from "@/lib/access/route-guards";

export const Route = createFileRoute("/_authenticated/_clinic/derechos-de-pacientes")({
  beforeLoad: requirePermission("team:manage"),
  head: () => ({
    meta: [
      { title: "Derechos de los pacientes | Esmalia" },
      {
        name: "description",
        content:
          "Solicitudes de los pacientes sobre sus datos personales (Ley 21.719): acceso, rectificación, supresión, oposición, portabilidad y bloqueo, con su plazo legal.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DerechosDePacientesPage,
});

function DerechosDePacientesPage() {
  const { access } = Route.useRouteContext();
  return (
    <AppShell title="Derechos de los pacientes" access={access}>
      {access.clinic ? (
        <BandejaSolicitudes clinicId={access.clinic.id} isDemo={access.clinic.isDemo} />
      ) : (
        <p className="text-muted-foreground">
          Necesitas una clínica activa para ver las solicitudes de los pacientes.
        </p>
      )}
    </AppShell>
  );
}
