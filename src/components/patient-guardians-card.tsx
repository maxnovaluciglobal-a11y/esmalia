import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Pencil, UserPlus, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { guardiansQueryKey, useGuardians } from "@/hooks/use-guardians";
import { archiveGuardian, saveGuardian } from "@/lib/patients/guardians.functions";
import {
  PARENTESCOS,
  etiquetaParentesco,
  parentescoLegible,
  tutorSchema,
  type Parentesco,
  type Tutor,
} from "@/lib/patients/tutor";
import { TituloSeccion } from "@/components/titulo-seccion";

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

type Borrador = {
  fullName: string;
  documentId: string;
  relationship: Parentesco;
  relationshipDetail: string;
  phone: string;
  email: string;
  isPrimary: boolean;
};

const VACIO: Borrador = {
  fullName: "",
  documentId: "",
  relationship: "madre",
  relationshipDetail: "",
  phone: "",
  email: "",
  isPrimary: true,
};

/**
 * Tutor o representante legal (CLI-11). Si el paciente es menor, es
 * obligatorio: firma los consentimientos y recibe las comunicaciones.
 */
export function PatientGuardiansCard({
  clinicId,
  patientId,
  esMenor,
  puedeEditar,
}: {
  clinicId: string;
  patientId: string;
  /** null = sin fecha de nacimiento, no se sabe. */
  esMenor: boolean | null;
  puedeEditar: boolean;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const guardiansQuery = useGuardians(clinicId, patientId);
  const doSave = useServerFn(saveGuardian);
  const doArchive = useServerFn(archiveGuardian);

  const [open, setOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador>(VACIO);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [confirmarQuitar, setConfirmarQuitar] = useState<Tutor | null>(null);

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: guardiansQueryKey(clinicId, patientId) });

  const saveMutation = useMutation({
    mutationFn: (tutor: Borrador) =>
      doSave({
        data: {
          clinicId,
          patientId,
          guardianId: editandoId ?? undefined,
          tutor: {
            ...tutor,
            relationshipDetail: tutor.relationshipDetail || undefined,
            phone: tutor.phone || undefined,
          },
        },
      }),
    onSuccess: () => {
      toast.success(editandoId ? "Tutor actualizado." : "Tutor agregado.");
      void invalidar();
      setOpen(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el tutor."),
  });

  const archiveMutation = useMutation({
    mutationFn: (guardianId: string) => doArchive({ data: { clinicId, guardianId } }),
    onSuccess: () => {
      toast.success("Tutor quitado. Sus firmas anteriores se conservan.");
      void invalidar();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo quitar el tutor."),
    onSettled: () => setConfirmarQuitar(null),
  });

  if (guardiansQuery.data && !guardiansQuery.data.disponible) return null;
  const tutores = guardiansQuery.data?.items ?? [];

  function abrirNuevo() {
    setEditandoId(null);
    setBorrador({ ...VACIO, isPrimary: tutores.length === 0 });
    setErrorForm(null);
    setOpen(true);
  }

  function abrirEdicion(t: Tutor) {
    setEditandoId(t.id);
    setBorrador({
      fullName: t.fullName,
      documentId: t.documentId,
      relationship: t.relationship,
      relationshipDetail: t.relationshipDetail ?? "",
      phone: t.phone ?? "",
      email: t.email ?? "",
      isPrimary: t.isPrimary,
    });
    setErrorForm(null);
    setOpen(true);
  }

  function guardar() {
    const parsed = tutorSchema.safeParse({
      ...borrador,
      relationshipDetail: borrador.relationshipDetail || undefined,
      phone: borrador.phone || undefined,
    });
    if (!parsed.success) {
      setErrorForm(parsed.error.issues[0]?.message ?? "Revisa los datos del tutor.");
      return;
    }
    setErrorForm(null);
    saveMutation.mutate(borrador);
  }

  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) =>
    setBorrador((b) => ({ ...b, [k]: v }));

  return (
    <section className="space-y-3 rounded-lg border border-border p-5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <TituloSeccion
            icono={<UsersRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          >
            Tutor o representante
          </TituloSeccion>
          <p className="text-xs text-muted-foreground">
            {esMenor === true
              ? "Menor de edad: su tutor firma los consentimientos y recibe los mensajes."
              : "Solo hace falta si el paciente es menor o tiene un representante legal."}
          </p>
        </div>
        {puedeEditar && (
          <Button size="sm" variant="outline" onClick={abrirNuevo}>
            <UserPlus className="size-3.5" aria-hidden /> Agregar
          </Button>
        )}
      </div>

      {guardiansQuery.isLoading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Cargando…
        </p>
      ) : tutores.length === 0 ? (
        esMenor === true ? (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Falta registrar el tutor. Sin él no se puede firmar un consentimiento.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Sin tutor registrado.</p>
        )
      ) : (
        <ul className="space-y-2">
          {tutores.map((t) => (
            <li key={t.id} className="rounded-lg border border-hairline p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {t.fullName}
                    {t.isPrimary && (
                      <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Principal
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {parentescoLegible(t)} · Doc. {t.documentId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[t.phone, t.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {puedeEditar && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => abrirEdicion(t)}
                      aria-label={`Editar tutor ${t.fullName}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmarQuitar(t)}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Quitar
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editandoId ? "Editar tutor" : "Agregar tutor o representante"}
            </DialogTitle>
            <DialogDescription>
              Quien responde legalmente por el paciente. Su nombre, documento y parentesco quedan
              guardados en cada consentimiento que firme.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-nombre`}>Nombre completo</Label>
              <input
                id={`${fid}-nombre`}
                value={borrador.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                className={inputClass()}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-doc`}>Documento de identidad</Label>
                <input
                  id={`${fid}-doc`}
                  value={borrador.documentId}
                  onChange={(e) => set("documentId", e.target.value)}
                  className={inputClass()}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-parentesco`}>Parentesco</Label>
                <select
                  id={`${fid}-parentesco`}
                  value={borrador.relationship}
                  onChange={(e) => set("relationship", e.target.value as Parentesco)}
                  className={inputClass()}
                >
                  {PARENTESCOS.map((p) => (
                    <option key={p} value={p}>
                      {etiquetaParentesco[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {(borrador.relationship === "familiar" || borrador.relationship === "otro") && (
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-detalle`}>¿Cuál?</Label>
                <input
                  id={`${fid}-detalle`}
                  value={borrador.relationshipDetail}
                  onChange={(e) => set("relationshipDetail", e.target.value)}
                  placeholder="Ej. Abuela, tía, curador designado"
                  className={inputClass()}
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-tel`}>Teléfono</Label>
                <input
                  id={`${fid}-tel`}
                  type="tel"
                  value={borrador.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  className={inputClass()}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-email`}>Correo</Label>
                <input
                  id={`${fid}-email`}
                  type="email"
                  value={borrador.email}
                  onChange={(e) => set("email", e.target.value)}
                  className={inputClass()}
                />
              </div>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={borrador.isPrimary}
                onChange={(e) => set("isPrimary", e.target.checked)}
                className="size-4 shrink-0 pointer-coarse:size-5"
              />
              Tutor principal: recibe los mensajes y es el firmante sugerido.
            </label>
            {errorForm && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {errorForm}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={guardar} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmarQuitar !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmarQuitar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitar tutor</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmarQuitar?.fullName} deja de figurar como tutor. Los consentimientos que ya
              firmó se conservan con sus datos. ¿Confirmas?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmarQuitar) archiveMutation.mutate(confirmarQuitar.id);
              }}
            >
              {archiveMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
