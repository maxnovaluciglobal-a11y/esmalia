import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Merge } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
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
import { requirePermission } from "@/lib/access/route-guards";
import {
  listDuplicateCandidates,
  mergePatients,
} from "@/lib/clinic-operations/clinic-operations.functions";
import { cn } from "@/lib/utils";
import { EncabezadoEditorial, PANEL_LISTA } from "@/components/a-plus/lista";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/_clinic/fusionar-fichas")({
  beforeLoad: requirePermission("patients:manage"),
  head: () => ({
    meta: [
      { title: "Fichas duplicadas | Esmalia" },
      {
        name: "description",
        content:
          "Detecta pacientes cargados dos veces y fusiona sus fichas sin perder citas, pagos ni historia clínica.",
      },
    ],
  }),
  component: FusionarFichasPage,
});

function FusionarFichasPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const queryClient = useQueryClient();
  const [seleccion, setSeleccion] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState<{
    targetId: string;
    targetNombre: string;
    fuentes: { id: string; nombre: string }[];
  } | null>(null);

  const fetchCandidates = useServerFn(listDuplicateCandidates);
  const mergeFn = useServerFn(mergePatients);

  const {
    data: grupos = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["duplicate-candidates", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchCandidates({ data: { clinicId: clinicId! } }),
  });

  const fusionar = useMutation({
    mutationFn: async (v: { targetId: string; fuentes: { id: string }[] }) => {
      // Una llamada por ficha absorbida. Secuencial y no en paralelo: cada
      // fusión reasigna filas de las mismas tablas, y lanzarlas juntas haría
      // que dos transacciones compitan por las mismas filas sin necesidad.
      for (const f of v.fuentes) {
        await mergeFn({ data: { clinicId: clinicId!, sourceId: f.id, targetId: v.targetId } });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duplicate-candidates", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
      toast.success("Fichas fusionadas");
      setConfirmar(null);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <AppShell title="Fichas duplicadas" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-6 text-base">
        <EncabezadoEditorial
          contexto={[access.clinic?.name, "Pacientes"]}
          titulo={
            isLoading || isError
              ? "Fichas"
              : grupos.length === 0
                ? "Sin fichas"
                : `${grupos.length} ${grupos.length === 1 ? "grupo" : "grupos"} de fichas`
          }
          enfasis="duplicadas"
        >
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Toda clínica que migra de otro sistema llega con el mismo paciente cargado más de una
            vez. Elige cuál ficha sobrevive y el resto se fusiona en ella: citas, pagos,
            presupuestos, odontograma, periodontograma, empresa con convenio, membresía con sus
            cuotas e inscripciones a citas grupales se reasignan; las notas, documentos y
            consentimientos (que no se reescriben) y la anamnesis de la ficha vieja se muestran en
            la que queda. Si las dos fichas tienen una membresía vigente o empresas distintas, te
            pedimos resolverlo antes de fusionar.
          </p>
        </EncabezadoEditorial>

        {isLoading && <p className="text-sm text-muted-foreground">Buscando duplicados…</p>}

        {isError && (
          <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos buscar fichas duplicadas." />
        )}

        {!isLoading && !isError && grupos.length === 0 && (
          <div className={cn(PANEL_LISTA, "p-8 text-center")}>
            <p className="mb-1 font-display text-2xl font-medium">No encontramos duplicados</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Ninguna ficha comparte documento ni nombre exacto con otra.
            </p>
          </div>
        )}

        {grupos.map((g) => {
          const elegido = seleccion[g.clave] ?? g.pacientes[0]?.id;
          const fuentes = g.pacientes.filter((p) => p.id !== elegido);
          return (
            <section key={`${g.motivo}-${g.clave}`} className={cn(PANEL_LISTA, "overflow-hidden")}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-secondary/40 px-4 py-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.motivo === "documento"
                    ? `Mismo documento · ${g.clave}`
                    : `Mismo nombre · ${g.pacientes[0]?.nombre}`}
                </p>
                <span className="text-xs text-muted-foreground">{g.pacientes.length} fichas</span>
              </div>

              <div className="divide-y divide-hairline">
                {g.pacientes.map((p) => (
                  <label
                    key={p.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-secondary/40",
                      p.id === elegido && "bg-success-soft/40",
                    )}
                  >
                    <input
                      type="radio"
                      name={`grupo-${g.clave}`}
                      checked={p.id === elegido}
                      onChange={() => setSeleccion((s) => ({ ...s, [g.clave]: p.id }))}
                      className="size-4"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {p.nombre}
                      {p.documento && (
                        <span className="ml-2 tabular-nums text-xs text-muted-foreground">
                          {p.documento}
                        </span>
                      )}
                    </span>
                    {p.id === elegido ? (
                      <span className="shrink-0 rounded bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">
                        Sobrevive
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-muted-foreground">Se fusiona</span>
                    )}
                    <Link
                      to="/pacientes/$pacienteId"
                      params={{ pacienteId: p.id }}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 text-xs font-medium text-brand-700 hover:underline"
                    >
                      Ver ficha
                    </Link>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-hairline px-4 py-2">
                <Button
                  size="sm"
                  disabled={fuentes.length === 0 || fusionar.isPending}
                  onClick={() =>
                    setConfirmar({
                      targetId: elegido,
                      targetNombre:
                        g.pacientes.find((p) => p.id === elegido)?.nombre ?? "la ficha elegida",
                      fuentes,
                    })
                  }
                >
                  <Merge className="size-4" /> Fusionar {fuentes.length}{" "}
                  {fuentes.length === 1 ? "ficha" : "fichas"}
                </Button>
              </div>
            </section>
          );
        })}

        <AlertDialog open={confirmar !== null} onOpenChange={(o) => !o && setConfirmar(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning" />
                ¿Fusionar en «{confirmar?.targetNombre}»?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    Todo lo de {confirmar?.fuentes.map((f) => `«${f.nombre}»`).join(", ")} pasa a la
                    ficha elegida: citas, pagos, presupuestos, planes, odontograma, periodontograma,
                    mensajes y órdenes de laboratorio. Las notas clínicas, los documentos y los
                    consentimientos no se reescriben (un registro firmado no se toca), pero se ven
                    en la ficha elegida junto a los suyos.
                  </p>
                  <p>
                    La anamnesis <strong>no</strong> se combina sola — juntar dos historias médicas
                    automáticamente inventaría un cuadro clínico que nadie revisó. Sus alergias y
                    antecedentes aparecen como alerta en la ficha elegida para que un profesional
                    los revise y los sume.
                  </p>
                  <p>Esto no se puede deshacer desde la aplicación.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={fusionar.isPending}
                onClick={() =>
                  confirmar &&
                  fusionar.mutate({ targetId: confirmar.targetId, fuentes: confirmar.fuentes })
                }
              >
                {fusionar.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Fusionar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
