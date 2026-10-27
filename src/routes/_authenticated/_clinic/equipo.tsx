import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
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
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  hasPermission,
  permissionsForRole,
  type ClinicMember,
  type ClinicRole,
} from "@/lib/access/access";
import {
  inviteMember,
  listClinicMembers,
  removeMember,
  updateMemberRole,
} from "@/lib/access/access.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

const INVITABLE_ROLES = CLINIC_ROLES.filter((r) => r !== "owner");

function InvitarMiembroDialog({ clinicId }: { clinicId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<ClinicRole>("assistant");

  const queryClient = useQueryClient();
  const inviteFn = useServerFn(inviteMember);

  const invitar = useMutation({
    mutationFn: () =>
      inviteFn({ data: { clinicId, email: email.trim(), fullName: fullName.trim(), role } }),
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
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" /> Invitar integrante
        </Button>
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
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
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
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              placeholder="persona@ejemplo.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="im-rol">Rol</Label>
            <select
              id="im-rol"
              value={role}
              onChange={(e) => setRole(e.target.value as ClinicRole)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
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
          "Gestiona los integrantes de tu clínica y qué puede ver cada rol dentro de Esmalia.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EquipoPage,
});

function EquipoPage() {
  const { access } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useServerFn(listClinicMembers);
  const changeRole = useServerFn(updateMemberRole);
  const kickMember = useServerFn(removeMember);

  const clinicId = access.clinic!.id;
  const puedeGestionar = hasPermission(access, "team:manage");

  const membersQuery = useQuery({
    queryKey: ["clinic-members", clinicId],
    queryFn: () => fetchMembers({ data: { clinicId } }),
  });

  const roleMutation = useMutation({
    mutationFn: (vars: { memberId: string; role: ClinicRole }) => changeRole({ data: vars }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["clinic-members", clinicId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => kickMember({ data: { memberId } }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["clinic-members", clinicId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const members: ClinicMember[] = membersQuery.data ?? [];

  return (
    <AppShell title="Equipo" access={access}>
      <div className="space-y-8">
        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">
                Integrantes de {access.clinic!.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {puedeGestionar
                  ? "Cambia el rol de cada persona para ajustar qué secciones puede abrir."
                  : "Solo propietario y administradores pueden modificar roles."}
              </p>
            </div>
            {puedeGestionar && <InvitarMiembroDialog clinicId={clinicId} />}
          </div>

          <div className="card-clinical divide-y divide-hairline">
            {membersQuery.isLoading && (
              <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Cargando equipo…
              </p>
            )}
            {membersQuery.isError && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No pudimos cargar el equipo.
              </p>
            )}
            {members.map((m) => {
              const esYo = m.userId === access.userId;
              const bloqueado = !puedeGestionar || esYo || m.role === "owner";
              return (
                <div
                  key={m.id}
                  className="grid gap-3 px-5 py-4 sm:grid-cols-[2fr_1.2fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.fullName ?? m.email ?? "Integrante"}
                      {esYo && <span className="ml-2 text-[11px] text-muted-foreground">(tú)</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.email ?? "—"}</p>
                  </div>

                  <label className="text-xs text-muted-foreground">
                    <span className="sr-only">Rol de {m.fullName ?? m.email ?? "integrante"}</span>
                    <select
                      value={m.role}
                      disabled={bloqueado || roleMutation.isPending}
                      onChange={(e) =>
                        roleMutation.mutate({ memberId: m.id, role: e.target.value as ClinicRole })
                      }
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
                    >
                      {CLINIC_ROLES.map((r) => (
                        <option key={r} value={r} disabled={r === "owner"}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(m.id)}
                    disabled={bloqueado || removeMutation.isPending}
                    aria-label={`Quitar a ${m.fullName ?? m.email ?? "integrante"} del equipo`}
                    className="grid size-9 place-items-center justify-self-start rounded-lg border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 sm:justify-self-end"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold">Qué puede hacer cada rol</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {CLINIC_ROLES.map((r) => (
              <article key={r} className="card-clinical p-5">
                <p className="font-display text-sm font-semibold">{ROLE_LABELS[r]}</p>
                <p className="mt-1 text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {permissionsForRole(r).map((p) => (
                    <li
                      key={p}
                      className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground"
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
    </AppShell>
  );
}
