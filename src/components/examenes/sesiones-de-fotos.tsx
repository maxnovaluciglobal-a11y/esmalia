/**
 * IMG-02 · Sesiones de fotos clínicas: fecha, motivo, etapa y plan de
 * tratamiento; cada sesión muestra sus fotos y permite sumar más. Desde acá
 * se abre la comparación antes/después.
 */
import { useEffect, useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Columns2, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { CLASE_CAMPO } from "@/components/cita-formulario";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  archivarSesionDeFotos,
  guardarSesionDeFotos,
  type ExamenDeFicha,
  type SesionDeFotos,
} from "@/lib/examenes/examenes.functions";
import { ETAPAS_SESION, ETIQUETA_ETAPA, type EtapaSesion } from "@/lib/examenes/tipos";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";

import { ArchivarConMotivo } from "./archivar-con-motivo";
import { CompararAntesDespues } from "./comparar-antes-despues";

export function SesionesDeFotos({
  clinicId,
  patientId,
  timezone,
  sesiones,
  fotos,
  planes,
  puedeEditar,
  onAgregarFotos,
  onCambio,
}: {
  clinicId: string;
  patientId: string;
  timezone: string | undefined;
  sesiones: SesionDeFotos[];
  fotos: ExamenDeFicha[];
  planes: { id: string; name: string }[];
  puedeEditar: boolean;
  onAgregarFotos: (sessionId: string) => void;
  onCambio: () => void;
}) {
  const [editando, setEditando] = useState<SesionDeFotos | "nueva" | null>(null);
  const [archivando, setArchivando] = useState<SesionDeFotos | null>(null);
  const [comparando, setComparando] = useState(false);
  const archivar = useServerFn(archivarSesionDeFotos);
  const vigentes = sesiones.filter((s) => !s.archivedAt);
  const fotosVigentes = fotos.filter((f) => !f.archivedAt);

  return (
    <section
      aria-labelledby="sesiones-de-fotos"
      className="rounded-panel border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="sesiones-de-fotos" className="font-display text-[26px] leading-none font-medium">
            Sesiones de fotos
            {vigentes.length > 0 && (
              <em className="text-brand-600">
                {" "}
                · <span className="cifra not-italic">{vigentes.length}</span>
              </em>
            )}
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Agrupa las fotos por fecha y etapa del tratamiento para comparar antes y después.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setComparando(true)}
            disabled={fotosVigentes.length < 2}
            title={fotosVigentes.length < 2 ? "Hacen falta al menos dos fotos clínicas" : undefined}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control px-3.5 text-sm font-semibold hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:h-11"
          >
            <Columns2 className="size-4" aria-hidden /> Antes y después
          </button>
          {puedeEditar && (
            <button
              type="button"
              onClick={() => setEditando("nueva")}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3.5 text-sm font-semibold text-background pointer-coarse:h-11"
            >
              <Plus className="size-4" aria-hidden /> Nueva sesión
            </button>
          )}
        </div>
      </div>

      {vigentes.length === 0 ? (
        <p className="mt-4 text-base text-muted-foreground">
          Todavía no hay sesiones. Crea una antes de empezar un tratamiento estético u ortodóncico.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-hairline rounded-[14px] border border-hairline">
          {vigentes.map((s) => {
            const propias = fotosVigentes.filter((f) => f.photoSessionId === s.id);
            return (
              <li key={s.id} className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold">
                      {s.reason}
                      {s.stage && (
                        <span className="ml-2 inline-flex h-[24px] items-center rounded-full border border-control px-2 align-middle text-[12px] font-semibold">
                          {ETIQUETA_ETAPA[s.stage]}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="cifra">{fecha(s.sessionDate, timezone)}</span> ·{" "}
                      <span className="cifra">{propias.length}</span>{" "}
                      {propias.length === 1 ? "foto" : "fotos"}
                      {s.treatmentPlanName && <> · Plan: {s.treatmentPlanName}</>}
                    </p>
                    {s.notes && <p className="mt-1 text-sm text-muted-foreground">{s.notes}</p>}
                  </div>
                  {puedeEditar && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onAgregarFotos(s.id)}
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-control px-3 text-[13px] font-semibold hover:border-foreground pointer-coarse:h-11"
                      >
                        <Camera className="size-3.5" aria-hidden /> Agregar fotos
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditando(s)}
                        aria-label={`Editar la sesión ${s.reason}`}
                        className="grid size-8 place-items-center rounded-full border border-control hover:border-foreground pointer-coarse:size-11"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
                {propias.length > 0 && (
                  <ul
                    className="mt-2 flex gap-2 overflow-x-auto pb-1"
                    aria-label={`Fotos de ${s.reason}`}
                  >
                    {propias.slice(0, 8).map((f) => (
                      <li
                        key={f.id}
                        className="size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
                      >
                        {f.thumbUrl ? (
                          <img
                            src={f.thumbUrl}
                            alt={f.filename}
                            className="size-full object-cover"
                            loading="lazy"
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <SesionDialog
        abierto={editando !== null}
        sesion={editando === "nueva" ? null : editando}
        onCerrar={() => setEditando(null)}
        onArchivar={(s) => {
          setEditando(null);
          setArchivando(s);
        }}
        clinicId={clinicId}
        patientId={patientId}
        timezone={timezone}
        planes={planes}
        onListo={onCambio}
      />
      <ArchivarConMotivo
        abierto={archivando !== null}
        titulo="Archivar la sesión"
        descripcion="La sesión deja de verse en la ficha, pero no se borra: queda con el motivo, quién y cuándo. Sus fotos siguen en la lista de exámenes."
        onCerrar={() => setArchivando(null)}
        onConfirmar={async (motivo) => {
          if (!archivando) return;
          await archivar({ data: { clinicId, sessionId: archivando.id, motivo } });
          toast.success("Sesión archivada.");
          onCambio();
        }}
      />
      <CompararAntesDespues
        abierto={comparando}
        onCerrar={() => setComparando(false)}
        clinicId={clinicId}
        fotos={fotosVigentes}
        sesiones={sesiones}
      />
    </section>
  );
}

function SesionDialog({
  abierto,
  sesion,
  onCerrar,
  onArchivar,
  clinicId,
  patientId,
  timezone,
  planes,
  onListo,
}: {
  abierto: boolean;
  sesion: SesionDeFotos | null;
  onCerrar: () => void;
  onArchivar: (s: SesionDeFotos) => void;
  clinicId: string;
  patientId: string;
  timezone: string | undefined;
  planes: { id: string; name: string }[];
  onListo: () => void;
}) {
  const id = useId();
  const guardar = useServerFn(guardarSesionDeFotos);
  const [sessionDate, setSessionDate] = useState("");
  const [reason, setReason] = useState("");
  const [stage, setStage] = useState<EtapaSesion | "">("");
  const [plan, setPlan] = useState("");
  const [notes, setNotes] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setSessionDate(sesion?.sessionDate ?? hoyISO(timezone));
    setReason(sesion?.reason ?? "");
    setStage(sesion?.stage ?? "antes");
    setPlan(sesion?.treatmentPlanId ?? "");
    setNotes(sesion?.notes ?? "");
  }, [abierto, sesion, timezone]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await guardar({
        data: {
          clinicId,
          patientId,
          sessionId: sesion?.id,
          sessionDate,
          reason,
          stage: stage || null,
          treatmentPlanId: plan || null,
          notes,
        },
      });
      toast.success(sesion ? "Sesión actualizada." : "Sesión creada.");
      onListo();
      onCerrar();
    } catch (err) {
      toast.error(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !guardando && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-medium">
            {sesion ? "Editar sesión" : "Nueva sesión de fotos"}
          </DialogTitle>
          <DialogDescription>
            Después agrega las fotos desde la sesión o al subir.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-fecha`}>Fecha</Label>
              <input
                id={`${id}-fecha`}
                type="date"
                required
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className={CLASE_CAMPO}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-etapa`}>Etapa</Label>
              <select
                id={`${id}-etapa`}
                value={stage}
                onChange={(e) => setStage(e.target.value as EtapaSesion | "")}
                className={CLASE_CAMPO}
              >
                <option value="">Sin etapa</option>
                {ETAPAS_SESION.map((x) => (
                  <option key={x} value={x}>
                    {ETIQUETA_ETAPA[x]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-motivo`}>Motivo</Label>
            <input
              id={`${id}-motivo`}
              required
              minLength={2}
              maxLength={200}
              placeholder="Ej.: inicio de blanqueamiento"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={CLASE_CAMPO}
            />
          </div>
          {planes.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-plan`}>Plan de tratamiento (opcional)</Label>
              <select
                id={`${id}-plan`}
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className={CLASE_CAMPO}
              >
                <option value="">Sin plan</option>
                {planes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-nota`}>Nota (opcional)</Label>
            <textarea
              id={`${id}-nota`}
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={CLASE_CAMPO}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {sesion ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => onArchivar(sesion)}
                disabled={guardando}
              >
                Archivar sesión
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onCerrar} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Guardar
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
