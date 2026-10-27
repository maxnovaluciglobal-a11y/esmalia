import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, MessageCircle, Plus } from "lucide-react";
import { toast } from "sonner";

import { BOTON_PASTILLA, ChipFiltro, EncabezadoEditorial } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { EditorDeMensaje } from "@/components/seguimiento/editor-de-mensaje";
import { BOTON_FILA, Chip, PanelLista, Vacio } from "@/components/seguimiento/piezas";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requirePermission } from "@/lib/access/route-guards";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  guardarPlantillaDeMensaje,
  listPlantillasDeMensaje,
  type PlantillaDeMensaje,
} from "@/lib/seguimiento/campanas.functions";
import {
  analizarMensaje,
  ETIQUETA_CANAL,
  PLANTILLAS_SUGERIDAS,
  type CanalDePlantilla,
} from "@/lib/seguimiento/plantillas";

/**
 * CRM-03 · Plantillas de mensajes de la clínica (Ola 8), por correo o
 * WhatsApp, con variables en español. Las usan las campañas (CRM-04). Las
 * escriben owner y admin (RLS `can_manage_clinic`); se desactivan, no se
 * borran.
 */
export const Route = createFileRoute("/_authenticated/_clinic/plantillas-de-mensajes")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Plantillas de mensajes | Esmalia" },
      {
        name: "description",
        content: "Textos de la clínica para correos y mensajes, con datos del paciente.",
      },
    ],
  }),
  component: PlantillasPage,
});

interface Borrador {
  id: string | null;
  nombre: string;
  canal: CanalDePlantilla;
  asunto: string;
  cuerpo: string;
  activa: boolean;
}

const VACIO: Borrador = {
  id: null,
  nombre: "",
  canal: "whatsapp",
  asunto: "",
  cuerpo: "",
  activa: true,
};

function PlantillasPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id ?? "";
  const clinica = access.clinic?.name ?? "";
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<"todas" | CanalDePlantilla>("todas");
  const [borrador, setBorrador] = useState<Borrador | null>(null);

  const listar = useServerFn(listPlantillasDeMensaje);
  const consulta = useQuery({
    queryKey: ["plantillas-de-mensaje", clinicId],
    queryFn: () => listar({ data: { clinicId } }),
    enabled: Boolean(clinicId),
  });
  const plantillas = consulta.data ?? [];
  const visibles = plantillas.filter((p) => filtro === "todas" || p.channel === filtro);

  const editar = (p: PlantillaDeMensaje) =>
    setBorrador({
      id: p.id,
      nombre: p.name,
      canal: p.channel,
      asunto: p.subject ?? "",
      cuerpo: p.body,
      activa: p.active,
    });

  return (
    <AppShell title="Plantillas de mensajes" access={access}>
      <div className="mx-auto max-w-[64rem] space-y-[18px]">
        <EncabezadoEditorial
          contexto={["Ajustes", "Mensajería"]}
          titulo="Plantillas de"
          enfasis="mensajes"
          acciones={
            <BloqueoEscritura>
              <button type="button" className={BOTON_PASTILLA} onClick={() => setBorrador(VACIO)}>
                <Plus className="size-4" aria-hidden /> Nueva plantilla
              </button>
            </BloqueoEscritura>
          }
        >
          <p className="mt-3 max-w-[64ch] text-[15px] text-muted-foreground">
            Textos de la clínica para campañas por correo o WhatsApp. Escribe{" "}
            <span className="cifra text-foreground">{"{{paciente.primer_nombre}}"}</span> y cada
            paciente recibe su nombre.
          </p>
        </EncabezadoEditorial>

        <div role="group" aria-label="Canal" className="flex flex-wrap gap-1.5">
          <ChipFiltro activo={filtro === "todas"} onClick={() => setFiltro("todas")}>
            Todas <span className="cifra text-[11px] opacity-75">{plantillas.length}</span>
          </ChipFiltro>
          {(["whatsapp", "correo"] as const).map((c) => (
            <ChipFiltro key={c} activo={filtro === c} onClick={() => setFiltro(c)}>
              {ETIQUETA_CANAL[c]}{" "}
              <span className="cifra text-[11px] opacity-75">
                {plantillas.filter((p) => p.channel === c).length}
              </span>
            </ChipFiltro>
          ))}
        </div>

        {consulta.isPending ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
          </p>
        ) : consulta.isError ? (
          <ErrorDeCarga
            onReintentar={() => consulta.refetch()}
            mensaje={mensajeDeError(consulta.error)}
          />
        ) : (
          <PanelLista titulo="Plantillas" conteo={visibles.length}>
            {visibles.length === 0 ? (
              <Vacio>Todavía no hay plantillas. Parte de una sugerida o crea una nueva.</Vacio>
            ) : (
              <ul className="divide-y divide-hairline">
                {visibles.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border border-hairline bg-secondary">
                        {p.channel === "correo" ? (
                          <Mail className="size-4" aria-hidden />
                        ) : (
                          <MessageCircle className="size-4" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                          {p.name}
                          <Chip tono="tenue">{ETIQUETA_CANAL[p.channel]}</Chip>
                          {!p.active && <Chip tono="tenue">Desactivada</Chip>}
                        </p>
                        {p.subject && <p className="text-sm font-medium">{p.subject}</p>}
                        <p className="line-clamp-2 text-sm text-muted-foreground">{p.body}</p>
                      </div>
                    </div>
                    <BloqueoEscritura>
                      <button type="button" className={BOTON_FILA} onClick={() => editar(p)}>
                        Editar
                      </button>
                    </BloqueoEscritura>
                  </li>
                ))}
              </ul>
            )}
          </PanelLista>
        )}

        <PanelLista
          titulo="Sugeridas"
          descripcion="Puntos de partida: úsalas tal cual o ajústalas al tono de tu clínica."
        >
          <ul className="grid gap-px bg-hairline sm:grid-cols-3">
            {PLANTILLAS_SUGERIDAS.map((s) => (
              <li key={s.nombre} className="flex flex-col gap-2 bg-card px-4 py-3">
                <p className="text-[15px] font-semibold">{s.nombre}</p>
                <p className="line-clamp-4 flex-1 text-sm text-muted-foreground">{s.cuerpo}</p>
                <BloqueoEscritura>
                  <button
                    type="button"
                    className={BOTON_FILA}
                    onClick={() =>
                      setBorrador({
                        id: null,
                        nombre: s.nombre,
                        canal: s.canal,
                        asunto: s.asunto ?? "",
                        cuerpo: s.cuerpo,
                        activa: true,
                      })
                    }
                  >
                    Usar esta
                  </button>
                </BloqueoEscritura>
              </li>
            ))}
          </ul>
        </PanelLista>
      </div>

      {borrador && clinicId && (
        <EditorDePlantilla
          clinicId={clinicId}
          clinica={clinica}
          inicial={borrador}
          onCerrar={() => setBorrador(null)}
          onGuardada={() => {
            queryClient.invalidateQueries({ queryKey: ["plantillas-de-mensaje", clinicId] });
            setBorrador(null);
          }}
        />
      )}
    </AppShell>
  );
}

function EditorDePlantilla({
  clinicId,
  clinica,
  inicial,
  onCerrar,
  onGuardada,
}: {
  clinicId: string;
  clinica: string;
  inicial: Borrador;
  onCerrar: () => void;
  onGuardada: () => void;
}) {
  const [b, setB] = useState<Borrador>(inicial);
  const guardar = useServerFn(guardarPlantillaDeMensaje);
  const mutacion = useMutation({
    mutationFn: () =>
      guardar({
        data: {
          clinicId,
          id: b.id,
          nombre: b.nombre,
          canal: b.canal,
          asunto: b.canal === "correo" ? b.asunto : null,
          cuerpo: b.cuerpo,
          activa: b.activa,
        },
      }),
    onSuccess: () => {
      toast.success("Plantilla guardada.");
      onGuardada();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const problemas = analizarMensaje(b.cuerpo, b.canal === "correo" ? b.asunto : null).problemas;
  const valida =
    b.nombre.trim().length >= 2 &&
    problemas.length === 0 &&
    (b.canal !== "correo" || b.asunto.trim().length >= 2);

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{b.id ? "Editar plantilla" : "Nueva plantilla"}</DialogTitle>
          <DialogDescription>
            Texto plano: en el correo se respetan los saltos de línea; en WhatsApp sale tal cual.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valida) mutacion.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="plantilla-nombre">Nombre</Label>
            <Input
              id="plantilla-nombre"
              value={b.nombre}
              maxLength={80}
              onChange={(e) => setB({ ...b, nombre: e.target.value })}
            />
          </div>
          <div role="radiogroup" aria-label="Canal" className="flex flex-wrap gap-1.5">
            {(["whatsapp", "correo"] as const).map((c) => (
              <ChipFiltro key={c} activo={b.canal === c} onClick={() => setB({ ...b, canal: c })}>
                {ETIQUETA_CANAL[c]}
              </ChipFiltro>
            ))}
          </div>
          <EditorDeMensaje
            canal={b.canal}
            asunto={b.asunto}
            cuerpo={b.cuerpo}
            onAsunto={(v) => setB({ ...b, asunto: v })}
            onCuerpo={(v) => setB({ ...b, cuerpo: v })}
            clinica={clinica}
          />
          {b.id && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={b.activa}
                onChange={(e) => setB({ ...b, activa: e.target.checked })}
                className="size-4"
              />
              Activa (desactivada, no aparece al armar una campaña)
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valida || mutacion.isPending}>
              {mutacion.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
