import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

import { ROLE_LABELS, type ClinicAccess } from "@/lib/access/access";
import { getMyAccess } from "@/lib/access/access.functions";
import { guardarRolSimulado, leerRolSimulado, puedeSimular } from "@/lib/access/role-simulation";

export const Route = createFileRoute("/_authenticated/sin-acceso")({
  loader: () => getMyAccess({}),
  head: () => ({
    meta: [
      { title: "Acceso restringido | Esmalia" },
      {
        name: "description",
        content: "Tu rol no tiene permisos para ver esta sección de Esmalia.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: () => <SinAccesoLayout mensaje="No pudimos verificar tus permisos." />,
  component: SinAcceso,
});

function SalirSimulacion({ realRole }: { realRole: ClinicAccess["role"] }) {
  const router = useRouter();
  if (!puedeSimular(realRole) || !leerRolSimulado()) return null;
  return (
    <button
      type="button"
      onClick={() => {
        guardarRolSimulado(null);
        void router.invalidate();
      }}
      className="mb-4 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
    >
      Salir de la simulación de rol
    </button>
  );
}

function SinAccesoLayout({ mensaje, children }: { mensaje: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-6 text-foreground">
      <div className="card-clinical max-w-md p-8 text-center">
        <ShieldAlert className="mx-auto mb-4 size-8 text-warning" />
        <h1 className="mb-2 font-display text-xl font-semibold">Acceso restringido</h1>
        <p className="mb-6 text-sm text-muted-foreground">{mensaje}</p>
        {children}
        <Link
          to="/dashboard"
          className="inline-block rounded-lg border border-brand bg-transparent px-4 py-2 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12"
        >
          Volver al panel
        </Link>
      </div>
    </div>
  );
}

function SinAcceso() {
  const access = Route.useLoaderData() as ClinicAccess;
  const rol = access.role ? ROLE_LABELS[access.role] : "sin rol asignado";

  return (
    <SinAccesoLayout
      mensaje={`Tu perfil (${rol}) no tiene permiso para esta sección. Pide a un administrador de la clínica que ajuste tu rol.`}
    >
      <SalirSimulacion realRole={access.role} />
    </SinAccesoLayout>
  );
}
