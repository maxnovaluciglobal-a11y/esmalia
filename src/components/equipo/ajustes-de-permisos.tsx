import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PERMISSIONS,
  ROLE_LABELS,
  motivoSinAjuste,
  permisosEfectivos,
  permissionsForRole,
  type ClinicMember,
  type EfectoAjuste,
  type Permission,
} from "@/lib/access/access";
import { guardarAjustePermiso } from "@/lib/access/access.functions";
import { PERMISSION_LABELS } from "@/lib/access/permisos-etiquetas";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/** Estado de un permiso para una persona, en palabras. */
type Estado = "rol" | "dado" | "quitado" | "sin" | "sin_por_dependencia";

const TEXTO_ESTADO: Record<Estado, string> = {
  rol: "Por su rol",
  dado: "Dado a esta persona",
  quitado: "Quitado a esta persona",
  sin: "Sin acceso",
  sin_por_dependencia: "Sin acceso: no ve la historia clínica",
};

const ESTILO_ESTADO: Record<Estado, string> = {
  rol: "border-control text-foreground/80",
  dado: "border-foreground bg-foreground text-background",
  quitado: "border-brand-700 text-brand-700",
  sin: "border-hairline text-muted-foreground",
  sin_por_dependencia: "border-hairline text-muted-foreground",
};

/**
 * EQU-01 · Permisos de una persona: los de su rol, lo que se le dio y lo que
 * se le quitó. Cada control que no se puede usar queda deshabilitado con su
 * motivo a la vista (regla de calidad 6). El servidor y la base validan lo
 * mismo (`guardarAjustePermiso`, trigger `validar_ajuste_de_permiso`).
 */
export function AjustesDePermisosDialog({
  miembro,
  puedeEditar,
  motivoNoEditable,
  onClose,
  onGuardado,
}: {
  miembro: ClinicMember | null;
  puedeEditar: boolean;
  motivoNoEditable: string | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const guardarFn = useServerFn(guardarAjustePermiso);
  const guardar = useMutation({
    mutationFn: (vars: { permission: Permission; effect: EfectoAjuste | null }) =>
      guardarFn({ data: { memberId: miembro!.id, ...vars } }),
    onSuccess: (_r, vars) => {
      onGuardado();
      toast.success(
        vars.effect === null
          ? "Volvió a lo que trae su rol."
          : vars.effect === "grant"
            ? "Permiso dado."
            : "Permiso quitado.",
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const nombre = miembro ? (miembro.fullName ?? miembro.email ?? "Integrante") : "";

  return (
    <Dialog open={!!miembro} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {miembro && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl font-medium">
                Permisos de <em className="text-brand-600">{nombre}</em>
              </DialogTitle>
              <DialogDescription>
                Rol: {ROLE_LABELS[miembro.role]}. Lo que no se puede ajustar muestra por qué.
              </DialogDescription>
            </DialogHeader>
            {motivoNoEditable && (
              <p className="rounded-lg border border-hairline bg-secondary px-3 py-2 text-[13px] text-foreground/80">
                {motivoNoEditable}
              </p>
            )}
            <ListaDePermisos
              miembro={miembro}
              puedeEditar={puedeEditar}
              ocupado={guardar.isPending ? (guardar.variables?.permission ?? null) : null}
              onCambiar={(permission, effect) => guardar.mutate({ permission, effect })}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListaDePermisos({
  miembro,
  puedeEditar,
  ocupado,
  onCambiar,
}: {
  miembro: ClinicMember;
  puedeEditar: boolean;
  ocupado: Permission | null;
  onCambiar: (p: Permission, effect: EfectoAjuste | null) => void;
}) {
  const delRol = new Set(permissionsForRole(miembro.role));
  const efectivos = new Set(permisosEfectivos(miembro.role, miembro.ajustes));
  const ajustePor = new Map(miembro.ajustes.map((a) => [a.permission, a.effect]));

  return (
    <ul className="divide-y divide-hairline rounded-[14px] border border-hairline">
      {PERMISSIONS.map((p) => {
        const ajuste = ajustePor.get(p) ?? null;
        const estado: Estado =
          ajuste === "grant" && efectivos.has(p)
            ? "dado"
            : ajuste === "revoke"
              ? "quitado"
              : efectivos.has(p)
                ? "rol"
                : p === "clinical:write" && delRol.has(p)
                  ? "sin_por_dependencia"
                  : "sin";
        const motivoCatalogo = motivoSinAjuste(miembro.role, p);
        const necesitaVer =
          p === "clinical:write" && !delRol.has(p) && !efectivos.has("clinical:view");
        const motivo =
          ajuste !== null
            ? null
            : (motivoCatalogo ?? (necesitaVer ? "Primero dale «Ver historia clínica»." : null));
        const deshabilitado = !puedeEditar || ocupado !== null || (ajuste === null && !!motivo);
        const accion: { texto: string; effect: EfectoAjuste | null } =
          ajuste !== null
            ? { texto: "Volver al rol", effect: null }
            : delRol.has(p)
              ? { texto: "Quitar", effect: "revoke" }
              : { texto: "Dar", effect: "grant" };
        const idMotivo = `motivo-${p.replace(/[^a-z]/g, "-")}`;
        return (
          <li
            key={p}
            className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-[15px] font-medium">{PERMISSION_LABELS[p]}</p>
              <span
                className={cn(
                  "mt-1 inline-flex h-6 items-center rounded-full border px-2 text-[12px] font-semibold",
                  ESTILO_ESTADO[estado],
                )}
              >
                {TEXTO_ESTADO[estado]}
              </span>
              {motivo && (
                <p id={idMotivo} className="mt-1 text-[12.5px] text-muted-foreground">
                  {motivo}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={deshabilitado}
              aria-describedby={motivo ? idMotivo : undefined}
              onClick={() => onCambiar(p, accion.effect)}
              className="inline-flex h-9 items-center justify-center gap-1.5 justify-self-start rounded-full border border-border bg-card px-4 text-[13.5px] font-semibold transition-colors hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45 sm:justify-self-end pointer-coarse:h-11"
            >
              {ocupado === p && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {accion.texto}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
