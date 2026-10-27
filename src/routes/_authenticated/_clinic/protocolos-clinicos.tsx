import { useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { BOTON_PASTILLA, ChipFiltro, EncabezadoEditorial } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { CLASE_CAMPO } from "@/components/cita-formulario";
import { ErrorDeCarga } from "@/components/estado-error";
import { Label } from "@/components/ui/label";
import { requirePermission } from "@/lib/access/route-guards";
import {
  MAX_PASOS_PROTOCOLO,
  pasosDesdeTexto,
  protocoloSchema,
  type ProtocoloClinico,
} from "@/lib/clinical/protocolos";
import {
  guardarProtocoloClinico,
  listProtocolosClinicos,
  setProtocoloActivo,
} from "@/lib/clinical/protocolos.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * FIC-15 · Protocolos clínicos de la clínica (Ola 9): pasos e indicaciones
 * por procedimiento. Se aplican desde el editor de notas y su texto queda en
 * la nota. Los administran owner, admin y dentist (`clinical:write`), igual
 * que la RLS de `clinical_protocols`. No se borran: se desactivan.
 */
export const Route = createFileRoute("/_authenticated/_clinic/protocolos-clinicos")({
  beforeLoad: requirePermission("clinical:write"),
  head: () => ({
    meta: [
      { title: "Protocolos clínicos | Esmalia" },
      {
        name: "description",
        content: "Pasos e indicaciones por procedimiento que se aplican a la nota clínica.",
      },
    ],
  }),
  component: ProtocolosPage,
});

const PANEL = "rounded-panel border border-border bg-card";

function ProtocolosPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const listar = useServerFn(listProtocolosClinicos);
  const consulta = useQuery({
    queryKey: ["protocolos-clinicos", clinicId, "todos"],
    queryFn: () => listar({ data: { clinicId: clinicId as string, soloActivos: false } }),
    enabled: Boolean(clinicId),
  });
  const [filtro, setFiltro] = useState<"activos" | "inactivos">("activos");
  const [editando, setEditando] = useState<ProtocoloClinico | "nuevo" | null>(null);

  const todos = consulta.data ?? [];
  const visibles = todos.filter((p) => (filtro === "activos" ? p.active : !p.active));
  const activos = todos.filter((p) => p.active).length;

  return (
    <AppShell title="Protocolos clínicos" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-7">
        <EncabezadoEditorial
          contexto={["Ajustes", "Clínica", consulta.data ? `${activos} activos` : null]}
          titulo="Protocolos"
          enfasis="clínicos"
          acciones={
            <button type="button" onClick={() => setEditando("nuevo")} className={BOTON_PASTILLA}>
              <Plus className="size-4" aria-hidden /> Nuevo protocolo
            </button>
          }
        >
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            Pasos e indicaciones para cada procedimiento. Desde la nota clínica se aplican con un
            toque: el texto queda dentro de la nota, en su versión y en su firma.
          </p>
        </EncabezadoEditorial>

        {editando && clinicId && (
          <EditorDeProtocolo
            key={editando === "nuevo" ? "nuevo" : editando.id}
            clinicId={clinicId}
            protocolo={editando === "nuevo" ? null : editando}
            onCerrar={() => setEditando(null)}
          />
        )}

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar protocolos">
          <ChipFiltro activo={filtro === "activos"} onClick={() => setFiltro("activos")}>
            Activos
          </ChipFiltro>
          <ChipFiltro activo={filtro === "inactivos"} onClick={() => setFiltro("inactivos")}>
            Desactivados
          </ChipFiltro>
        </div>

        {consulta.isPending && (
          <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
          </p>
        )}
        {consulta.isError && (
          <ErrorDeCarga
            onReintentar={() => consulta.refetch()}
            reintentando={consulta.isFetching}
            mensaje={mensajeDeError(consulta.error)}
          />
        )}
        {consulta.data && visibles.length === 0 && (
          <div className={cn(PANEL, "p-8 text-center")}>
            <ClipboardCheck className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-base text-muted-foreground">
              {filtro === "activos"
                ? "Todavía no hay protocolos. Crea el primero: por ejemplo, las indicaciones después de una exodoncia."
                : "No hay protocolos desactivados."}
            </p>
          </div>
        )}
        {clinicId && visibles.length > 0 && (
          <ul className="grid gap-[18px] lg:grid-cols-2">
            {visibles.map((p) => (
              <TarjetaProtocolo
                key={p.id}
                clinicId={clinicId}
                protocolo={p}
                onEditar={() => setEditando(p)}
              />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function TarjetaProtocolo({
  clinicId,
  protocolo,
  onEditar,
}: {
  clinicId: string;
  protocolo: ProtocoloClinico;
  onEditar: () => void;
}) {
  const queryClient = useQueryClient();
  const activar = useServerFn(setProtocoloActivo);
  const mutacion = useMutation({
    mutationFn: (active: boolean) =>
      activar({ data: { clinicId, protocolId: protocolo.id, active } }),
    onSuccess: (_r, active) => {
      void queryClient.invalidateQueries({ queryKey: ["protocolos-clinicos", clinicId] });
      toast.success(active ? "Protocolo activado." : "Protocolo desactivado.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <li className={cn(PANEL, "flex flex-col p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-2xl font-medium leading-tight">{protocolo.name}</h3>
          {protocolo.procedureLabel && (
            <p className="mt-1 text-sm text-muted-foreground">{protocolo.procedureLabel}</p>
          )}
        </div>
        <span className="inline-flex h-[26px] items-center rounded-full border border-control px-2.5 text-[12.5px] font-semibold">
          <span className="cifra">{protocolo.steps.length}</span>&nbsp;
          {protocolo.steps.length === 1 ? "paso" : "pasos"}
        </span>
      </div>
      <ol className="mt-3 ml-5 list-decimal space-y-1 text-[15px]">
        {protocolo.steps.map((paso, i) => (
          <li key={i}>{paso}</li>
        ))}
      </ol>
      {protocolo.indications && (
        <p className="mt-3 whitespace-pre-wrap rounded-[14px] bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
          {protocolo.indications}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onEditar}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control px-3.5 text-sm font-semibold hover:border-foreground pointer-coarse:h-11"
        >
          <Pencil className="size-4" aria-hidden /> Editar
        </button>
        <button
          type="button"
          onClick={() => mutacion.mutate(!protocolo.active)}
          disabled={mutacion.isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control px-3.5 text-sm font-semibold hover:border-foreground disabled:opacity-60 pointer-coarse:h-11"
        >
          {mutacion.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {protocolo.active ? "Desactivar" : "Activar"}
        </button>
      </div>
    </li>
  );
}

function EditorDeProtocolo({
  clinicId,
  protocolo,
  onCerrar,
}: {
  clinicId: string;
  protocolo: ProtocoloClinico | null;
  onCerrar: () => void;
}) {
  const fid = useId();
  const [nombre, setNombre] = useState(protocolo?.name ?? "");
  const [procedimiento, setProcedimiento] = useState(protocolo?.procedureLabel ?? "");
  const [pasos, setPasos] = useState((protocolo?.steps ?? []).join("\n"));
  const [indicaciones, setIndicaciones] = useState(protocolo?.indications ?? "");
  const queryClient = useQueryClient();
  const guardar = useServerFn(guardarProtocoloClinico);

  const listaPasos = pasosDesdeTexto(pasos);
  const validacion = protocoloSchema.safeParse({
    name: nombre,
    procedureLabel: procedimiento,
    steps: listaPasos,
    indications: indicaciones,
  });

  const mutacion = useMutation({
    mutationFn: () =>
      guardar({
        data: {
          clinicId,
          ...(protocolo ? { protocolId: protocolo.id } : {}),
          name: nombre,
          procedureLabel: procedimiento,
          steps: listaPasos,
          indications: indicaciones,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["protocolos-clinicos", clinicId] });
      toast.success(protocolo ? "Protocolo guardado." : "Protocolo creado.");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <section
      aria-labelledby={`${fid}-titulo`}
      className="space-y-4 rounded-panel border border-foreground/20 bg-card p-5"
    >
      <h3 id={`${fid}-titulo`} className="font-display text-2xl font-medium">
        {protocolo ? `Editar «${protocolo.name}»` : "Nuevo protocolo"}
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-nombre`}>Nombre</Label>
          <input
            id={`${fid}-nombre`}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={120}
            placeholder="Ej. Indicaciones post exodoncia"
            className={cn(CLASE_CAMPO, "text-base")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-procedimiento`}>Procedimiento (opcional)</Label>
          <input
            id={`${fid}-procedimiento`}
            value={procedimiento}
            onChange={(e) => setProcedimiento(e.target.value)}
            maxLength={120}
            placeholder="Ej. Exodoncia simple"
            className={cn(CLASE_CAMPO, "text-base")}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${fid}-pasos`}>Pasos (uno por línea)</Label>
        <textarea
          id={`${fid}-pasos`}
          value={pasos}
          onChange={(e) => setPasos(e.target.value)}
          rows={6}
          placeholder={
            "Anestesia local infiltrativa\nSindesmotomía y luxación\nExtracción y revisión del alvéolo\nHemostasia con gasa"
          }
          className={cn(CLASE_CAMPO, "text-base")}
        />
        <p className="text-[13px] text-muted-foreground">
          <span className="cifra">{listaPasos.length}</span> de{" "}
          <span className="cifra">{MAX_PASOS_PROTOCOLO}</span> pasos. Las viñetas o números del
          comienzo de cada línea se quitan solos.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${fid}-indicaciones`}>Indicaciones al paciente (opcional)</Label>
        <textarea
          id={`${fid}-indicaciones`}
          value={indicaciones}
          onChange={(e) => setIndicaciones(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Ej. No enjuagar durante 24 horas, dieta blanda y fría, no fumar."
          className={cn(CLASE_CAMPO, "text-base")}
        />
      </div>
      {!validacion.success && (nombre || pasos) && (
        <p className="text-sm text-destructive">{validacion.error.issues[0]?.message}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-10 items-center rounded-full border border-control px-4 text-sm font-semibold hover:border-foreground pointer-coarse:h-11"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => mutacion.mutate()}
          disabled={!validacion.success || mutacion.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-foreground bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50 pointer-coarse:h-11"
        >
          {mutacion.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {protocolo ? "Guardar cambios" : "Crear protocolo"}
        </button>
      </div>
    </section>
  );
}
