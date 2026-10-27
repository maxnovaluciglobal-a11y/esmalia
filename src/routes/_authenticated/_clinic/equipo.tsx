import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, SlidersHorizontal, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import {
  AvatarIniciales,
  BOTON_PASTILLA,
  EncabezadoEditorial,
  PANEL_LISTA,
} from "@/components/a-plus/lista";
import { AjustesDePermisosDialog } from "@/components/equipo/ajustes-de-permisos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PERMISSION_LABELS } from "@/lib/access/permisos-etiquetas";
import { requirePermission } from "@/lib/access/route-guards";
import {
  CLINIC_ROLES,
  PROFESIONES,
  PROFESION_LABELS,
  PROFESION_SUGERIDA,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  etiquetaProfesion,
  hasPermission,
  permissionsForRole,
  type ClinicMember,
  type ClinicRole,
  type Profesion,
} from "@/lib/access/access";
import {
  definirProfesion,
  inviteMember,
  listClinicMembers,
  removeMember,
  updateMemberRole,
} from "@/lib/access/access.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

const INVITABLE_ROLES = CLINIC_ROLES.filter((r) => r !== "owner");

const CAMPO =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 pointer-coarse:text-base";

const CHIP = "inline-flex h-6 items-center rounded-full border px-2 text-[12px] font-semibold";

function InvitarMiembroDialog({ clinicId }: { clinicId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<ClinicRole>("assistant");
  const [profession, setProfession] = useState<Profesion | "">(PROFESION_SUGERIDA.assistant ?? "");

  const queryClient = useQueryClient();
  const inviteFn = useServerFn(inviteMember);

  const invitar = useMutation({
    mutationFn: () =>
      inviteFn({
        data: {
          clinicId,
          email: email.trim(),
          fullName: fullName.trim(),
          role,
          profession: profession || null,
        },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["clinic-members", clinicId] });
      toast.success(
        res.invited
          ? "Invitación enviada. Va a recibir un email para crear su contraseña."
          : "Persona agregada al equipo.",
      );
      setOpen(false);
      setEmail("");
      setFullName("");
      setRole("assistant");
      setProfession(PROFESION_SUGERIDA.assistant ?? "");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={BOTON_PASTILLA}>
          <UserPlus className="size-4" aria-hidden /> Invitar integrante
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitar integrante</DialogTitle>
          <DialogDescription>
            Le mandamos un email para que cree su contraseña y entre directo a esta clínica.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="im-nombre">Nombre completo</Label>
            <input
              id="im-nombre"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={CAMPO}
              placeholder="Nombre y apellido"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="im-email">Email</Label>
            <input
              id="im-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={CAMPO}
              placeholder="persona@ejemplo.com"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="im-rol">Rol</Label>
              <select
                id="im-rol"
                value={role}
                onChange={(e) => {
                  const r = e.target.value as ClinicRole;
                  setRole(r);
                  setProfession(PROFESION_SUGERIDA[r] ?? "");
                }}
                className={CAMPO}
              >
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="im-profesion">Profesión</Label>
              <select
                id="im-profesion"
                value={profession}
                onChange={(e) => setProfession(e.target.value as Profesion | "")}
                className={CAMPO}
              >
                <option value="">Sin indicar</option>
                {PROFESIONES.map((p) => (
                  <option key={p} value={p}>
                    {PROFESION_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
        </div>
        <DialogFooter>
          <Button
            onClick={() => invitar.mutate()}
            disabled={invitar.isPending || !email.trim() || !fullName.trim()}
          >
            {invitar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Enviar invitación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const Route = createFileRoute("/_authenticated/_clinic/equipo")({
  beforeLoad: requirePermission("team:view"),
  head: () => ({
    meta: [
      { title: "Equipo | Esmalia" },
      {
        name: "description",
        content:
          "Gestiona los integrantes de tu clínica, su profesión y qué puede ver cada uno dentro de Esmalia.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EquipoPage,
});

function nombreDe(m: ClinicMember) {
  return m.fullName ?? m.email ?? "Integrante";
}

function EquipoPage() {
  const { access } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [ajustando, setAjustando] = useState<ClinicMember | null>(null);

  const fetchMembers = useServerFn(listClinicMembers);
  const changeRole = useServerFn(updateMemberRole);
  const kickMember = useServerFn(removeMember);
  const changeProfession = useServerFn(definirProfesion);

  const clinicId = access.clinic!.id;
  // Con simulación de rol se ve como ese rol (sin gestionar); el servidor
  // igual exige owner/admin con el rol real.
  const puedeGestionar = hasPermission(access, "team:manage");

  const membersQuery = useQuery({
    queryKey: ["clinic-members", clinicId],
    queryFn: () => fetchMembers({ data: { clinicId } }),
  });

  const invalidar = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["clinic-members", clinicId] });
  };

  const roleMutation = useMutation({
    mutationFn: (vars: { memberId: string; role: ClinicRole }) => changeRole({ data: vars }),
    onSuccess: invalidar,
    onError: (e: Error) => setError(mensajeDeError(e)),
  });

  const professionMutation = useMutation({
    mutationFn: (vars: { memberId: string; profession: Profesion | null }) =>
      changeProfession({ data: vars }),
    onSuccess: () => {
      invalidar();
      toast.success("Profesión guardada.");
    },
    onError: (e: Error) => setError(mensajeDeError(e)),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => kickMember({ data: { memberId } }),
    onSuccess: invalidar,
    onError: (e: Error) => setError(mensajeDeError(e)),
  });

  const members: ClinicMember[] = membersQuery.data ?? [];
  const conAjustes = members.filter((m) => m.ajustes.length > 0).length;
  const miembroAjustando = ajustando ? (members.find((m) => m.id === ajustando.id) ?? null) : null;

  return (
    <AppShell title="Equipo" access={access}>
      <div className="space-y-8">
        <EncabezadoEditorial
          contexto={[
            access.clinic!.name,
            membersQuery.data
              ? `${members.length} ${members.length === 1 ? "integrante" : "integrantes"}`
              : null,
          ]}
          titulo="Equipo y"
          enfasis="permisos"
          acciones={puedeGestionar ? <InvitarMiembroDialog clinicId={clinicId} /> : undefined}
        >
          <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
            {puedeGestionar
              ? "Cada persona trae los permisos de su rol. Si alguien necesita algo distinto, ajústalo en «Permisos»."
              : "Solo propietario y administración pueden modificar roles y permisos."}
          </p>
        </EncabezadoEditorial>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <section
          aria-label="Resumen de permisos"
          className="dark tinta-de-pagina grid gap-5 overflow-hidden rounded-[14px] border border-night-line bg-night p-[clamp(20px,2.6vw,32px)] text-on-night sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center"
        >
          <div>
            <p className="text-[13px] font-semibold text-on-night-2">Ajustes por persona</p>
            <p className="cifra font-display text-[clamp(2.5rem,5vw,3.5rem)] leading-none">
              {membersQuery.data ? conAjustes : "—"}
            </p>
          </div>
          <p className="text-[14.5px] leading-relaxed text-on-night-2">
            {conAjustes === 1
              ? "Una persona tiene permisos distintos a los de su rol."
              : `${conAjustes} personas tienen permisos distintos a los de su rol.`}{" "}
            Un ajuste nunca abre la historia clínica a recepción, contabilidad, coordinación ni
            laboratorio, ni los pagos a asistentes: lo impide la base de datos.
          </p>
        </section>

        <section aria-labelledby="equipo-lista" className="space-y-3">
          <h2 id="equipo-lista" className="font-display text-2xl font-medium">
            Integrantes
          </h2>
          <div className={`${PANEL_LISTA} divide-y divide-hairline`}>
            {membersQuery.isLoading && (
              <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Cargando equipo…
              </p>
            )}
            {membersQuery.isError && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No pudimos cargar el equipo. Revisa tu conexión y vuelve a intentarlo.
              </p>
            )}
            {members.map((m) => {
              const esYo = m.userId === access.userId;
              const bloqueado = !puedeGestionar || esYo || m.role === "owner";
              const motivoBloqueo = esYo
                ? "No puedes cambiar tu propio rol ni tus permisos."
                : m.role === "owner"
                  ? "El propietario no se modifica aquí."
                  : !puedeGestionar
                    ? "Solo propietario y administración."
                    : null;
              const puedeProfesion = puedeGestionar || esYo;
              const profesion = etiquetaProfesion(m.profession);
              return (
                <div
                  key={m.id}
                  className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <AvatarIniciales nombre={nombreDe(m)} />
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold">
                        {nombreDe(m)}
                        {esYo && (
                          <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                            (tú)
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {m.email ?? "Sin correo"}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className={`${CHIP} border-foreground bg-foreground text-background`}>
                          {ROLE_LABELS[m.role]}
                        </span>
                        {profesion && (
                          <span className={`${CHIP} border-control text-foreground/80`}>
                            {profesion}
                          </span>
                        )}
                        {m.ajustes.length > 0 && (
                          <span className={`${CHIP} border-brand-700 text-brand-700`}>
                            {m.ajustes.length === 1
                              ? "1 ajuste de permisos"
                              : `${m.ajustes.length} ajustes de permisos`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                      Rol
                    </span>
                    <select
                      value={m.role}
                      disabled={bloqueado || roleMutation.isPending}
                      title={motivoBloqueo ?? undefined}
                      onChange={(e) =>
                        roleMutation.mutate({ memberId: m.id, role: e.target.value as ClinicRole })
                      }
                      className={CAMPO}
                      aria-label={`Rol de ${nombreDe(m)}`}
                    >
                      {CLINIC_ROLES.map((r) => (
                        <option key={r} value={r} disabled={r === "owner"}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                      Profesión
                    </span>
                    <select
                      value={m.profession ?? ""}
                      disabled={!puedeProfesion || professionMutation.isPending}
                      onChange={(e) =>
                        professionMutation.mutate({
                          memberId: m.id,
                          profession: (e.target.value || null) as Profesion | null,
                        })
                      }
                      className={CAMPO}
                      aria-label={`Profesión de ${nombreDe(m)}`}
                    >
                      <option value="">Sin indicar</option>
                      {PROFESIONES.map((p) => (
                        <option key={p} value={p}>
                          {PROFESION_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex items-center gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => setAjustando(m)}
                      className={BOTON_PASTILLA}
                      aria-label={`Permisos de ${nombreDe(m)}`}
                    >
                      <SlidersHorizontal className="size-4" aria-hidden /> Permisos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`¿Quitar a ${nombreDe(m)} del equipo?`)) {
                          removeMutation.mutate(m.id);
                        }
                      }}
                      disabled={bloqueado || removeMutation.isPending}
                      title={motivoBloqueo ?? undefined}
                      aria-label={`Quitar a ${nombreDe(m)} del equipo`}
                      className="grid size-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 pointer-coarse:size-11"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  {motivoBloqueo && puedeGestionar && (
                    <p className="text-[12.5px] text-muted-foreground lg:col-span-4">
                      {motivoBloqueo}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="equipo-roles" className="space-y-4">
          <h2 id="equipo-roles" className="font-display text-2xl font-medium">
            Qué puede hacer cada rol
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {CLINIC_ROLES.map((r) => (
              <article key={r} className={`${PANEL_LISTA} p-5`}>
                <p className="font-display text-lg font-semibold">{ROLE_LABELS[r]}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {permissionsForRole(r).map((p) => (
                    <li
                      key={p}
                      className="rounded-full bg-secondary px-2 py-0.5 text-[12px] text-foreground/75"
                    >
                      {PERMISSION_LABELS[p]}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </div>

      <AjustesDePermisosDialog
        miembro={miembroAjustando}
        puedeEditar={
          !!miembroAjustando &&
          puedeGestionar &&
          miembroAjustando.userId !== access.userId &&
          miembroAjustando.role !== "owner"
        }
        motivoNoEditable={
          !miembroAjustando
            ? null
            : miembroAjustando.userId === access.userId
              ? "No puedes ajustar tus propios permisos."
              : miembroAjustando.role === "owner"
                ? "El propietario tiene acceso completo: no se ajusta por persona."
                : !puedeGestionar
                  ? "Solo propietario y administración pueden ajustar permisos."
                  : null
        }
        onClose={() => setAjustando(null)}
        onGuardado={invalidar}
      />
    </AppShell>
  );
}
