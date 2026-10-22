import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { PermissionsMatrix } from "@/components/permissions-matrix";
import { requirePermission } from "@/lib/access/route-guards";

export const Route = createFileRoute("/_authenticated/_clinic/permisos")({
  beforeLoad: requirePermission("team:manage"),
  head: () => ({
    meta: [
      { title: "Permisos | Esmalia" },
      {
        name: "description",
        content:
          "Consulta qué acciones puede realizar cada rol de la clínica según el estado de la nota clínica.",
      },
      { property: "og:title", content: "Permisos | Esmalia" },
      {
        property: "og:description",
        content: "Permisos por rol y por estado de la nota clínica en Esmalia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PermisosPage,
});

function PermisosPage() {
  const { access } = Route.useRouteContext();
  return (
    <AppShell title="Permisos" access={access}>
      <PermissionsMatrix />
    </AppShell>
  );
}
