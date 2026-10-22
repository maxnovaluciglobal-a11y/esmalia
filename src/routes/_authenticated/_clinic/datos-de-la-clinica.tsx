import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACCESS_QUERY_KEY } from "@/lib/access/access";
import { requirePermission } from "@/lib/access/route-guards";
import {
  etiquetaZonaHoraria,
  zonasHorariasDisponibles,
  type DatosClinica,
} from "@/lib/clinic-operations/datos-clinica";
import {
  getDatosClinica,
  updateDatosClinica,
} from "@/lib/clinic-operations/datos-clinica.functions";
import { listBranchesDetailed } from "@/lib/clinic-operations/branches.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { COUNTRIES } from "@/lib/onboarding-types";

/**
 * Datos de la clínica ACTUAL (UX-03, Ola 0). Reemplaza al enlace
 * "Configuración inicial" de Ajustes, que abría el asistente que CREA una
 * clínica nueva. Crear otra clínica queda solo en el selector de clínica.
 */
export const Route = createFileRoute("/_authenticated/_clinic/datos-de-la-clinica")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [{ title: "Datos de la clínica | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: DatosDeLaClinicaPage,
});

function DatosDeLaClinicaPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic!.id;
  const fetchDatos = useServerFn(getDatosClinica);
  const datos = useQuery({
    queryKey: ["datos-clinica", clinicId],
    queryFn: () => fetchDatos({ data: { clinicId } }),
  });

  return (
    <AppShell title="Datos de la clínica" access={access}>
      <div className="mx-auto max-w-3xl space-y-10">
        <p className="text-sm text-muted-foreground">
          Estos son los datos de{" "}
          <span className="font-medium text-foreground">{access.clinic!.name}</span>, la clínica en
          la que estás trabajando. Los cambios se ven en toda la app y en los documentos que emites
          desde hoy.
        </p>
        {datos.isError ? (
          <ErrorDeCarga
            onReintentar={() => datos.refetch()}
            reintentando={datos.isFetching}
            mensaje="No pudimos cargar los datos de la clínica."
          />
        ) : !datos.data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
          </p>
        ) : (
          <FormularioDatos datos={datos.data} esDemo={access.clinic!.isDemo} />
        )}
        <DireccionYContacto clinicId={clinicId} />
      </div>
    </AppShell>
  );
}

function FormularioDatos({ datos, esDemo }: { datos: DatosClinica; esDemo: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const guardar = useServerFn(updateDatosClinica);

  const [name, setName] = useState(datos.name);
  const [legalName, setLegalName] = useState(datos.legalName ?? "");
  const [taxId, setTaxId] = useState(datos.taxId ?? "");
  const [timezone, setTimezone] = useState(datos.timezone);
  useEffect(() => {
    setName(datos.name);
    setLegalName(datos.legalName ?? "");
    setTaxId(datos.taxId ?? "");
    setTimezone(datos.timezone);
  }, [datos]);

  const zonas = useMemo(() => zonasHorariasDisponibles(datos.timezone), [datos.timezone]);
  const pais = COUNTRIES.find((c) => c.code === datos.country);
  const cambio =
    name.trim() !== datos.name ||
    legalName.trim() !== (datos.legalName ?? "") ||
    taxId.trim() !== (datos.taxId ?? "") ||
    timezone !== datos.timezone;

  const mut = useMutation({
    mutationFn: () => guardar({ data: { clinicId: datos.id, name, legalName, taxId, timezone } }),
    onSuccess: async () => {
      toast.success("Datos de la clínica guardados.");
      await queryClient.invalidateQueries({ queryKey: ["datos-clinica", datos.id] });
      // El nombre y la zona horaria viven también en `access` (selector de
      // clínica, fechas de toda la app): se refresca y se recarga la ruta.
      await queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY });
      await router.invalidate();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (cambio) mut.mutate();
      }}
    >
      <section aria-labelledby="datos-identidad" className="space-y-4">
        <h2 id="datos-identidad" className="kicker">
          Identificación
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="clinica-nombre">Nombre de la clínica</Label>
            <Input
              id="clinica-nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              minLength={2}
              autoComplete="organization"
            />
            <p className="text-xs text-muted-foreground">
              Es el que ven tu equipo, tus pacientes y el portal.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clinica-razon">Razón social (opcional)</Label>
            <Input
              id="clinica-razon"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              maxLength={160}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clinica-fiscal">Identificación fiscal (opcional)</Label>
            <Input
              id="clinica-fiscal"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              maxLength={40}
              placeholder="RUT, RFC, NIT, RUC o CUIT"
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="datos-region" className="space-y-4">
        <h2 id="datos-region" className="kicker">
          Región
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="clinica-zona">Zona horaria</Label>
            <select
              id="clinica-zona"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
            >
              {zonas.map((z) => (
                <option key={z} value={z}>
                  {etiquetaZonaHoraria(z)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Define qué es "hoy" para la agenda, la caja y los avisos. Cada sucursal puede tener su
              propio horario en Sucursales.
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">País</p>
            <p className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">
              {pais?.label ?? datos.country}
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Moneda</p>
            <p className="cifra flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">
              {datos.currency}
            </p>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            País y moneda no se pueden cambiar desde aquí: todos los montos que ya registraste están
            en {datos.currency}. Si necesitas cambiarlos, escríbenos desde Ayuda.
          </p>
        </div>
      </section>

      {esDemo && (
        <p className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Esta es la clínica demo: puedes mirar el formulario, pero los cambios no se guardan.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <BloqueoEscritura>
          <Button type="submit" disabled={!cambio || mut.isPending || esDemo}>
            {mut.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Guardar cambios
          </Button>
        </BloqueoEscritura>
        {cambio && !mut.isPending && (
          <span className="text-xs text-muted-foreground" role="status">
            Tienes cambios sin guardar.
          </span>
        )}
      </div>
    </form>
  );
}

/** Dirección y teléfono viven en cada sucursal: se muestran y se editan allá. */
function DireccionYContacto({ clinicId }: { clinicId: string }) {
  const fetchSucursales = useServerFn(listBranchesDetailed);
  const { data: sucursales, isError } = useQuery({
    queryKey: ["branches-detailed", clinicId],
    queryFn: () => fetchSucursales({ data: { clinicId } }),
  });
  const activas = (sucursales ?? []).filter((s) => s.isActive);

  return (
    <section aria-labelledby="datos-contacto" className="space-y-3">
      <h2 id="datos-contacto" className="kicker">
        Dirección y contacto
      </h2>
      <p className="text-sm text-muted-foreground">
        La dirección y el teléfono son de cada sucursal, porque una clínica puede tener varias
        sedes.
      </p>
      {isError ? (
        <p className="text-sm text-muted-foreground">No pudimos cargar las sucursales.</p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-border">
          {activas.map((s) => (
            <li key={s.id} className="py-3 text-sm">
              <p className="font-medium">{s.name}</p>
              <p className="text-muted-foreground">
                {[s.address, s.city].filter(Boolean).join(", ") || "Sin dirección"}
                {" · "}
                {s.phone ?? "Sin teléfono"}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/sucursales"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      >
        Editar dirección y teléfono en Sucursales <ChevronRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
