import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { ChipFiltro } from "@/components/a-plus/lista";
import { EditorDeMensaje } from "@/components/seguimiento/editor-de-mensaje";
import { Chip } from "@/components/seguimiento/piezas";
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
import { mensajeDeError } from "@/lib/mensaje-error";
import { listPatientSegments } from "@/lib/patients/segmentos.functions";
import {
  confirmarCampana,
  guardarBorradorDeCampana,
  previsualizarCampana,
  type Campana,
  type PlantillaDeMensaje,
  type VistaPreviaDeCampana,
} from "@/lib/seguimiento/campanas.functions";
import {
  describirSegmento,
  FILTRO_VACIO,
  OPCIONES_SIN_VISITA,
  type CanalDeCampana,
  type FiltroCampana,
  type SegmentoCampana,
} from "@/lib/seguimiento/campanas";
import { analizarMensaje } from "@/lib/seguimiento/plantillas";

const CAMPO =
  "h-10 w-full rounded-lg border border-control bg-card px-3 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11";

/**
 * CRM-04 · Armar una campaña: mensaje (desde una plantilla o escrito acá),
 * grupo de pacientes, vista previa con la cifra de destinatarios y por qué se
 * omite al resto, y confirmación con la cifra. Confirmar no envía nada: el
 * correo se manda después con «Enviar» y WhatsApp se despacha de a uno.
 */
export function EditorDeCampana({
  clinicId,
  clinica,
  plantillas,
  inicial,
  onCerrar,
  onGuardada,
}: {
  clinicId: string;
  clinica: string;
  plantillas: readonly PlantillaDeMensaje[];
  inicial: Campana | null;
  onCerrar: () => void;
  onGuardada: (campaignId: string, confirmada: boolean) => void;
}) {
  const fid = useId();
  const [id, setId] = useState<string | null>(inicial?.id ?? null);
  const [nombre, setNombre] = useState(inicial?.name ?? "");
  const [canal, setCanal] = useState<CanalDeCampana>(inicial?.channel ?? "correo");
  const [plantillaId, setPlantillaId] = useState<string>("");
  const [asunto, setAsunto] = useState(inicial?.subject ?? "");
  const [cuerpo, setCuerpo] = useState(inicial?.body ?? "");
  const [filtro, setFiltro] = useState<FiltroCampana>(
    inicial?.segment?.tipo === "filtro" ? inicial.segment.filtro : FILTRO_VACIO,
  );
  const [vista, setVista] = useState<VistaPreviaDeCampana | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  // PAC-06: un segmento guardado en Pacientes, o el filtro propio de la campaña.
  const [modo, setModo] = useState<"segmento" | "filtro">(
    inicial?.segment?.tipo === "segmento" ? "segmento" : "filtro",
  );
  const [segmentoId, setSegmentoId] = useState<string>(
    inicial?.segment?.tipo === "segmento" ? inicial.segment.segmentoId : "",
  );
  const listarSegmentos = useServerFn(listPatientSegments);
  const segmentos = useQuery({
    queryKey: ["patient-segments", clinicId],
    queryFn: () => listarSegmentos({ data: { clinicId } }),
  });
  const elegido = (segmentos.data ?? []).find((x) => x.id === segmentoId);
  const segmento: SegmentoCampana =
    modo === "segmento" && elegido
      ? { tipo: "segmento", segmentoId: elegido.id, nombre: elegido.nombre }
      : { tipo: "filtro", filtro };
  const grupoListo = modo === "filtro" || Boolean(elegido);
  const datos = () => ({
    clinicId,
    id,
    nombre,
    canal,
    plantillaId: plantillaId || null,
    asunto: canal === "correo" ? asunto : null,
    cuerpo,
    segmento,
  });

  const previsualizar = useServerFn(previsualizarCampana);
  const preview = useMutation({
    mutationFn: () =>
      previsualizar({
        data: { clinicId, canal, segmento, asunto: canal === "correo" ? asunto : null, cuerpo },
      }),
    onSuccess: setVista,
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const guardar = useServerFn(guardarBorradorDeCampana);
  const confirmar = useServerFn(confirmarCampana);
  const guardado = useMutation({
    mutationFn: async (conConfirmar: boolean) => {
      const { id: nuevoId } = await guardar({ data: datos() });
      setId(nuevoId);
      if (!conConfirmar) return { id: nuevoId, confirmada: false };
      const r = await confirmar({
        data: { clinicId, campaignId: nuevoId, esperados: vista?.resumen.elegibles ?? 0 },
      });
      if (!r.ok) throw new Error(r.motivo);
      return { id: nuevoId, confirmada: true, destinatarios: r.destinatarios };
    },
    onSuccess: (r) => {
      toast.success(
        r.confirmada
          ? canal === "correo"
            ? "Campaña confirmada. Ahora puedes enviarla."
            : "Campaña confirmada. La cola de WhatsApp está lista para despachar."
          : "Borrador guardado.",
      );
      onGuardada(r.id, r.confirmada);
    },
    onError: (e: Error) => {
      toast.error(mensajeDeError(e));
      setConfirmando(false);
      // El grupo pudo cambiar: se recalcula la vista previa.
      if (vista) preview.mutate();
    },
  });

  const elegirPlantilla = (pid: string) => {
    setPlantillaId(pid);
    const p = plantillas.find((x) => x.id === pid);
    if (!p) return;
    setCuerpo(p.body);
    if (p.subject) setAsunto(p.subject);
  };

  const cambiar = (f: Partial<FiltroCampana>) => {
    setFiltro({ ...filtro, ...f });
    setVista(null);
  };

  const problemas = analizarMensaje(cuerpo, canal === "correo" ? asunto : null).problemas;
  const mensajeValido =
    nombre.trim().length >= 2 &&
    problemas.length === 0 &&
    (canal !== "correo" || asunto.trim().length >= 2);
  const elegibles = vista?.resumen.elegibles ?? 0;
  const disponibles = plantillas.filter((p) => p.active && p.channel === canal);

  return (
    <Dialog open onOpenChange={(v) => !v && !guardado.isPending && onCerrar()}>
      <DialogContent className="max-h-[94dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{id ? "Editar campaña" : "Nueva campaña"}</DialogTitle>
          <DialogDescription>
            Un mensaje para un grupo de pacientes. Revisas a quién le llega antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-nombre`}>Nombre de la campaña</Label>
            <Input
              id={`${fid}-nombre`}
              value={nombre}
              maxLength={120}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej.: Control anual de octubre"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Canal</legend>
            <div className="flex flex-wrap gap-1.5">
              <ChipFiltro
                activo={canal === "correo"}
                onClick={() => {
                  setCanal("correo");
                  setPlantillaId("");
                  setVista(null);
                }}
              >
                Correo
              </ChipFiltro>
              <ChipFiltro
                activo={canal === "whatsapp"}
                onClick={() => {
                  setCanal("whatsapp");
                  setPlantillaId("");
                  setVista(null);
                }}
              >
                WhatsApp asistido
              </ChipFiltro>
            </div>
            <p className="text-sm text-muted-foreground">
              {canal === "correo"
                ? "Sale desde Esmalia respetando el modo de prueba de tu correo, las bajas y al tutor de los menores."
                : "Se arma una cola: abres cada mensaje en tu WhatsApp y lo envías tú. Solo a pacientes que aceptaron WhatsApp de la clínica. Nada sale solo."}
            </p>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-plantilla`}>Partir de una plantilla</Label>
            <select
              id={`${fid}-plantilla`}
              value={plantillaId}
              onChange={(e) => elegirPlantilla(e.target.value)}
              className={CAMPO}
            >
              <option value="">
                {disponibles.length
                  ? "Escribir el mensaje acá"
                  : "No hay plantillas para este canal"}
              </option>
              {disponibles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <EditorDeMensaje
            canal={canal}
            asunto={asunto}
            cuerpo={cuerpo}
            onAsunto={setAsunto}
            onCuerpo={setCuerpo}
            clinica={clinica}
          />

          <fieldset className="space-y-3 rounded-[14px] border border-hairline p-4">
            <legend className="px-1 font-display text-[20px] font-medium">
              Grupo de pacientes
            </legend>
            <div
              role="radiogroup"
              aria-label="Cómo elegir el grupo"
              className="flex flex-wrap gap-1.5"
            >
              <ChipFiltro
                activo={modo === "segmento"}
                onClick={() => {
                  setModo("segmento");
                  setVista(null);
                }}
              >
                Segmento guardado
              </ChipFiltro>
              <ChipFiltro
                activo={modo === "filtro"}
                onClick={() => {
                  setModo("filtro");
                  setVista(null);
                }}
              >
                Filtro de la campaña
              </ChipFiltro>
            </div>
            {modo === "segmento" && (
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-segmento`}>Segmento</Label>
                <select
                  id={`${fid}-segmento`}
                  value={segmentoId}
                  onChange={(e) => {
                    setSegmentoId(e.target.value);
                    setVista(null);
                  }}
                  className={CAMPO}
                >
                  <option value="">
                    {(segmentos.data ?? []).length
                      ? "Elige un segmento"
                      : "Todavía no hay segmentos guardados"}
                  </option>
                  {(segmentos.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-muted-foreground">
                  Los segmentos se guardan en{" "}
                  <Link
                    to="/pacientes"
                    search={{
                      q: "",
                      sucursal: "",
                      profesional: "",
                      estado: "",
                      desde: "",
                      hasta: "",
                      page: 1,
                    }}
                    className="font-semibold text-brand-700 underline-offset-4 hover:underline"
                  >
                    Pacientes
                  </Link>
                  . Las bajas y el consentimiento de cada canal se aplican igual.
                </p>
              </div>
            )}
            {modo === "filtro" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${fid}-visita`}>Última visita</Label>
                    <select
                      id={`${fid}-visita`}
                      value={filtro.sinVisitaDesdeMeses}
                      onChange={(e) => cambiar({ sinVisitaDesdeMeses: Number(e.target.value) })}
                      className={CAMPO}
                    >
                      {OPCIONES_SIN_VISITA.map((m) => (
                        <option key={m} value={m}>
                          {m === 0 ? "Da igual" : `Hace ${m} meses o más (o nunca)`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${fid}-edadmin`}>Edad desde</Label>
                      <input
                        id={`${fid}-edadmin`}
                        type="number"
                        min={0}
                        max={120}
                        inputMode="numeric"
                        value={filtro.edadMinima ?? ""}
                        onChange={(e) =>
                          cambiar({
                            edadMinima: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className={CAMPO}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${fid}-edadmax`}>hasta</Label>
                      <input
                        id={`${fid}-edadmax`}
                        type="number"
                        min={0}
                        max={120}
                        inputMode="numeric"
                        value={filtro.edadMaxima ?? ""}
                        onChange={(e) =>
                          cambiar({
                            edadMaxima: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className={CAMPO}
                      />
                    </div>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[15px]">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={filtro.sinCitaFutura}
                    onChange={(e) => cambiar({ sinCitaFutura: e.target.checked })}
                  />
                  Solo sin cita agendada
                </label>
                <label className="flex items-center gap-2 text-[15px]">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={filtro.conPresupuestoPendiente}
                    onChange={(e) => cambiar({ conPresupuestoPendiente: e.target.checked })}
                  />
                  Solo con un presupuesto sin aceptar
                </label>
              </>
            )}
            <p className="text-sm text-muted-foreground">{describirSegmento(segmento)}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => preview.mutate()}
              disabled={preview.isPending || !grupoListo}
            >
              {preview.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Users className="size-4" aria-hidden />
              )}
              Ver a quién le llega
            </Button>

            {vista && (
              <div className="space-y-2 border-t border-hairline pt-3" aria-live="polite">
                <p className="text-[15px]">
                  <span className="cifra font-semibold">{vista.resumen.enGrupo}</span> pacientes en
                  el grupo ·{" "}
                  <b className="font-semibold">
                    <span className="cifra">{vista.resumen.elegibles}</span>{" "}
                    {canal === "correo" ? "recibirán el correo" : "entran a la cola de WhatsApp"}
                  </b>
                </p>
                {vista.omitidos.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Se omiten">
                    {vista.omitidos.map((o) => (
                      <li key={o.motivo}>
                        <Chip tono="tenue">
                          {o.motivo}: <span className="cifra">{o.cantidad}</span>
                        </Chip>
                      </li>
                    ))}
                  </ul>
                )}
                {vista.tope && (
                  <p className="text-sm font-semibold text-destructive">{vista.tope}</p>
                )}
                {vista.muestra.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Por ejemplo:{" "}
                    {vista.muestra
                      .map((m) => (m.para === "tutor" ? `${m.nombre} (a su tutor)` : m.nombre))
                      .join(", ")}
                    {vista.resumen.elegibles > vista.muestra.length ? "…" : "."}
                  </p>
                )}
                {vista.ejemplo && (
                  <div className="rounded-lg border border-hairline bg-secondary/60 px-3 py-2.5">
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">
                      Así le llega a {vista.muestra[0]?.nombre ?? "el primer destinatario"}
                    </p>
                    {vista.ejemplo.asunto && (
                      <p className="mb-1 text-sm font-semibold">{vista.ejemplo.asunto}</p>
                    )}
                    <p className="whitespace-pre-line text-sm">{vista.ejemplo.cuerpo}</p>
                  </div>
                )}
              </div>
            )}
          </fieldset>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={guardado.isPending}>
            Cerrar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!mensajeValido || guardado.isPending}
            onClick={() => guardado.mutate(false)}
          >
            Guardar borrador
          </Button>
          <Button
            type="button"
            disabled={
              !mensajeValido ||
              !vista ||
              elegibles === 0 ||
              Boolean(vista?.tope) ||
              guardado.isPending
            }
            onClick={() => setConfirmando(true)}
            title={!vista ? "Primero revisa a quién le llega" : undefined}
          >
            Confirmar ({elegibles})
          </Button>
        </DialogFooter>
        {!vista && mensajeValido && (
          <p className="text-right text-sm text-muted-foreground">
            Para confirmar, primero revisa a quién le llega.
          </p>
        )}

        <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {canal === "correo"
                  ? `¿Confirmas la campaña para ${elegibles} pacientes?`
                  : `¿Armas la cola de WhatsApp para ${elegibles} pacientes?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {canal === "correo"
                  ? "Después de confirmar, el mensaje y el grupo ya no cambian. Los correos salen cuando aprietes «Enviar», respetando el modo de prueba, las bajas y los tutores."
                  : "Después de confirmar, el mensaje y el grupo ya no cambian. Ningún mensaje sale solo: los abres de a uno en tu WhatsApp."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={guardado.isPending}>Volver</AlertDialogCancel>
              <AlertDialogAction
                disabled={guardado.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  guardado.mutate(true);
                }}
              >
                {guardado.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Confirmar para {elegibles}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
