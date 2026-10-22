import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Download, Loader2, Pill, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SignaturePad } from "@/components/signature-pad";
import { Badge } from "@/components/ui/badge";
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
import {
  issuePrescription,
  listPatientPrescriptions,
  listProfesionalesClinicos,
  voidPrescription,
  type RecetaDeFicha,
} from "@/lib/clinical/prescriptions.functions";
import {
  alertasDeAlergia,
  edadEnAnios,
  folioReceta,
  lineaDePosologia,
  MAX_MEDICAMENTOS,
  nombreConPresentacion,
  RecetaItemsSchema,
  VADEMECUM,
  type RecetaItem,
} from "@/lib/clinical/recetas";
import { fecha, fechaHora } from "@/lib/formato-fecha";
import { TituloSeccion } from "@/components/titulo-seccion";

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

const ITEM_VACIO: RecetaItem = {
  medication: "",
  presentation: "",
  dose: "",
  frequency: "",
  duration: "",
  instructions: "",
};

function fechaEnZona(iso: string, timeZone: string, conHora = false): string {
  return conHora ? fechaHora(iso, timeZone) : fecha(iso, timeZone);
}

/** YYYY-MM-DD de una fecha en la zona de la clínica (para calcular la edad). */
function diaEnZona(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

export function PatientPrescriptionsCard({
  clinicId,
  patientId,
  patientDocument,
  allergies,
  timezone,
  myProfessionalId,
  puedeEmitir,
}: {
  clinicId: string;
  patientId: string;
  patientDocument: string | null;
  allergies: string[];
  timezone: string;
  myProfessionalId: string | null;
  /** owner/admin/dentist con escritura clínica. La base exige además la ficha propia. */
  puedeEmitir: boolean;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const fetchRecetas = useServerFn(listPatientPrescriptions);
  const fetchProfesionales = useServerFn(listProfesionalesClinicos);
  const doIssue = useServerFn(issuePrescription);
  const doVoid = useServerFn(voidPrescription);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecetaItem[]>([{ ...ITEM_VACIO }]);
  const [instructions, setInstructions] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [anular, setAnular] = useState<RecetaDeFicha | null>(null);
  const [motivo, setMotivo] = useState("");
  const [descargando, setDescargando] = useState<string | null>(null);

  const queryKey = ["patient-prescriptions", clinicId, patientId];
  const recetasQuery = useQuery({
    queryKey,
    queryFn: () => fetchRecetas({ data: { clinicId, patientId } }),
  });

  const profesionalesQuery = useQuery({
    queryKey: ["profesionales-clinicos", clinicId],
    queryFn: () => fetchProfesionales({ data: { clinicId } }),
    enabled: open && Boolean(myProfessionalId),
  });
  const yo = profesionalesQuery.data?.find((p) => p.id === myProfessionalId) ?? null;

  const validacion = RecetaItemsSchema.safeParse(items);
  const problema = !myProfessionalId
    ? "Tu cuenta no está vinculada a una ficha de profesional (Equipo)."
    : profesionalesQuery.isSuccess && !yo?.licenseNumber
      ? "Carga tu número de registro profesional en Equipo antes de emitir recetas."
      : validacion.success
        ? null
        : (validacion.error.issues[0]?.message ?? "Revisa los medicamentos.");

  const issueMutation = useMutation({
    mutationFn: () =>
      doIssue({
        data: {
          clinicId,
          patientId,
          professionalId: myProfessionalId!,
          items,
          instructions,
          signatureDataUrl: signatureDataUrl ?? undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Receta emitida y guardada en la ficha.");
      queryClient.invalidateQueries({ queryKey });
      setOpen(false);
      setItems([{ ...ITEM_VACIO }]);
      setInstructions("");
      setSignatureDataUrl(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo emitir la receta."),
  });

  const voidMutation = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      doVoid({ data: { clinicId, prescriptionId: params.id, reason: params.reason } }),
    onSuccess: () => {
      toast.success("Receta anulada.");
      queryClient.invalidateQueries({ queryKey });
      setAnular(null);
      setMotivo("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo anular la receta."),
  });

  async function descargar(r: RecetaDeFicha) {
    setDescargando(r.id);
    try {
      const { descargarRecetaPdf } = await import("@/lib/clinical/receta-pdf");
      await descargarRecetaPdf({
        receta: r,
        fecha: fechaEnZona(r.issuedAt, timezone),
        edad: edadEnAnios(r.patientBirthDate, diaEnZona(r.issuedAt, timezone)),
        documentoPaciente: patientDocument,
        firmaUrl: r.signatureUrl,
      });
    } catch {
      toast.error("No se pudo generar el PDF.");
    } finally {
      setDescargando(null);
    }
  }

  function cambiarItem(i: number, campo: keyof RecetaItem, valor: string) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, [campo]: valor } : it)));
  }

  const data = recetasQuery.data;
  const recetas = data?.recetas ?? [];

  return (
    <div className="card-clinical p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <TituloSeccion>Recetas</TituloSeccion>
          <p className="text-xs text-muted-foreground">
            Una receta emitida no se edita: si hay un error, se anula y se emite otra.
          </p>
        </div>
        {puedeEmitir && data?.disponible && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Pill className="size-3.5" /> Nueva receta
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Emitir receta</DialogTitle>
                <DialogDescription>
                  Sale con tus datos y tu registro profesional, y los de la clínica. Revisa la dosis
                  antes de emitir: después no se puede editar.
                </DialogDescription>
              </DialogHeader>

              {allergies.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Alergias anotadas en la anamnesis: {allergies.join(", ")}.</span>
                </p>
              )}

              <datalist id={`${fid}-vademecum`}>
                {VADEMECUM.map((v) => (
                  <option key={v.nombre} value={v.nombre} />
                ))}
              </datalist>

              <div className="space-y-4">
                {items.map((item, i) => {
                  const avisos = alertasDeAlergia(item.medication, allergies);
                  return (
                    <fieldset key={i} className="space-y-2 rounded-xl border border-hairline p-3">
                      <div className="flex items-center justify-between">
                        <legend className="text-sm font-medium">Medicamento {i + 1}</legend>
                        {items.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Quitar medicamento ${i + 1}`}
                            onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                            className="text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor={`${fid}-med-${i}`}>Medicamento</Label>
                          <input
                            id={`${fid}-med-${i}`}
                            list={`${fid}-vademecum`}
                            value={item.medication}
                            onChange={(e) => cambiarItem(i, "medication", e.target.value)}
                            className={inputClass()}
                            placeholder="Ej. Ibuprofeno"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${fid}-pres-${i}`}>Presentación (opcional)</Label>
                          <input
                            id={`${fid}-pres-${i}`}
                            value={item.presentation ?? ""}
                            onChange={(e) => cambiarItem(i, "presentation", e.target.value)}
                            className={inputClass()}
                            placeholder="Ej. 400 mg, comprimidos"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${fid}-dosis-${i}`}>Dosis</Label>
                          <input
                            id={`${fid}-dosis-${i}`}
                            value={item.dose}
                            onChange={(e) => cambiarItem(i, "dose", e.target.value)}
                            className={inputClass()}
                            placeholder="Ej. 1 comprimido"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${fid}-frec-${i}`}>Frecuencia</Label>
                          <input
                            id={`${fid}-frec-${i}`}
                            value={item.frequency}
                            onChange={(e) => cambiarItem(i, "frequency", e.target.value)}
                            className={inputClass()}
                            placeholder="Ej. cada 8 horas"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${fid}-dur-${i}`}>Duración</Label>
                          <input
                            id={`${fid}-dur-${i}`}
                            value={item.duration}
                            onChange={(e) => cambiarItem(i, "duration", e.target.value)}
                            className={inputClass()}
                            placeholder="Ej. por 3 días"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${fid}-ind-${i}`}>Indicaciones (opcional)</Label>
                          <input
                            id={`${fid}-ind-${i}`}
                            value={item.instructions ?? ""}
                            onChange={(e) => cambiarItem(i, "instructions", e.target.value)}
                            className={inputClass()}
                            placeholder="Ej. después de las comidas"
                          />
                        </div>
                      </div>
                      {avisos.map((aviso) => (
                        <p key={aviso} role="alert" className="text-xs text-destructive">
                          {aviso}
                        </p>
                      ))}
                    </fieldset>
                  );
                })}
                {items.length < MAX_MEDICAMENTOS && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setItems((prev) => [...prev, { ...ITEM_VACIO }])}
                  >
                    <Plus className="size-3.5" /> Agregar medicamento
                  </Button>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor={`${fid}-indicaciones`}>Indicaciones generales (opcional)</Label>
                  <textarea
                    id={`${fid}-indicaciones`}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    rows={3}
                    className={inputClass()}
                    placeholder="Ej. Dieta blanda y fría las primeras 24 horas."
                  />
                </div>
                <SignaturePad label="Tu firma (opcional)" onChange={setSignatureDataUrl} />
                <p className="text-xs text-muted-foreground">
                  Sin firma dibujada, el PDF deja la línea para firmar y timbrar a mano al imprimir.
                </p>
              </div>
              <DialogFooter className="items-center gap-3">
                {problema && <p className="text-xs text-muted-foreground">{problema}</p>}
                <Button
                  onClick={() => issueMutation.mutate()}
                  disabled={issueMutation.isPending || problema !== null}
                >
                  {issueMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Emitir receta
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {recetasQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : recetasQuery.isError ? (
        <p className="text-xs text-destructive">No pudimos cargar las recetas.</p>
      ) : data && !data.disponible ? (
        <p className="text-xs text-muted-foreground">
          Las recetas se activan cuando se aplique la actualización de la base de datos.
        </p>
      ) : recetas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin recetas emitidas todavía.</p>
      ) : (
        <div className="space-y-2">
          {recetas.map((r) => (
            <div key={r.id} className="rounded-xl border border-hairline p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    Receta {folioReceta(r.year, r.number)}
                    {r.voidedAt && <Badge variant="destructive">Anulada</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fechaEnZona(r.issuedAt, timezone, true)} · {r.professionalName} · Reg.{" "}
                    {r.professionalLicense}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {r.items.map((it, i) => (
                      <li key={i}>
                        <span className="font-medium">{nombreConPresentacion(it)}</span>:{" "}
                        {lineaDePosologia(it)}
                      </li>
                    ))}
                  </ul>
                  {r.voidedAt && r.voidReason && (
                    <p className="mt-1 text-xs text-muted-foreground">Motivo: {r.voidReason}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => descargar(r)}
                    disabled={descargando === r.id}
                  >
                    {descargando === r.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    PDF
                  </Button>
                  {puedeEmitir && !r.voidedAt && (
                    <button
                      type="button"
                      onClick={() => setAnular(r)}
                      className="text-xs text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                    >
                      Anular
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={anular !== null}
        onOpenChange={(next) => {
          if (!next) {
            setAnular(null);
            setMotivo("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Anular receta {anular ? folioReceta(anular.year, anular.number) : ""}
            </DialogTitle>
            <DialogDescription>
              La receta queda en la ficha marcada como anulada, con el motivo. No se borra.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-motivo`}>Motivo</Label>
            <input
              id={`${fid}-motivo`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className={inputClass()}
              placeholder="Ej. Error en la dosis"
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={voidMutation.isPending || motivo.trim().length < 3}
              onClick={() => anular && voidMutation.mutate({ id: anular.id, reason: motivo })}
            >
              {voidMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Anular receta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
