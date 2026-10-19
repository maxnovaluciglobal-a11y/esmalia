import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { ComplianceExport } from "@/components/compliance-export";
import { LecturasDeFichas } from "@/components/lecturas-de-fichas";
import { requirePermission } from "@/lib/access/route-guards";

export const Route = createFileRoute("/_authenticated/_clinic/compliance")({
  beforeLoad: requirePermission("team:manage"),
  head: () => ({
    meta: [
      { title: "Compliance y auditoría | Esmalia" },
      {
        name: "description",
        content:
          "Exporta en CSV o PDF el historial de revisión y auditoría clínica, y revisa quién abrió cada ficha de paciente.",
      },
      { property: "og:title", content: "Compliance y auditoría | Esmalia" },
      {
        property: "og:description",
        content: "Historial de auditoría y revisión clínica exportable para compliance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CompliancePage,
});

function CompliancePage() {
  const { access } = Route.useRouteContext();
  return (
    <AppShell title="Compliance y auditoría" access={access}>
      {access.clinic ? (
        <div className="space-y-6">
          <ComplianceExport clinicId={access.clinic.id} clinicName={access.clinic.name} />
          <LecturasDeFichas clinicId={access.clinic.id} />
        </div>
      ) : (
        <p className="text-muted-foreground">
          Necesitas una clínica activa para consultar el historial de compliance.
        </p>
      )}
    </AppShell>
  );
}
