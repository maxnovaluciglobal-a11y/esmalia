import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileSignature, Loader2, ShieldCheck, ShieldX } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  listConsentTemplates,
  listPatientConsents,
  revokePatientConsent,
  signPatientConsent,
} from "@/lib/clinical/clinical-documents.functions";
import { SignaturePad } from "@/components/signature-pad";
import { useGuardians } from "@/hooks/use-guardians";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { esMenorDeEdad, parentescoLegible, tutoresVigentes } from "@/lib/patients/tutor";

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PatientConsentsCard({
  clinicId,
  patientId,
  patientName,
  fechaNacimiento,
  timezone,
  puedeEditar,
  puedeGestionar,
}: {
  clinicId: string;
  patientId: string;
  patientName: string;
  /** YYYY-MM-DD. Un menor firma por medio de su tutor (CLI-11). */
  fechaNacimiento?: string | null;
  timezone?: string;
  puedeEditar: boolean;
  puedeGestionar: boolean;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const fetchTemplates = useServerFn(listConsentTemplates);
  const fetchConsents = useServerFn(listPatientConsents);
  const doSign = useServerFn(signPatientConsent);
  const doRevoke = useServerFn(revokePatientConsent);

  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [signedByName, setSignedByName] = useState(patientName);
  // "" = firma el paciente; si no, el id del tutor que firma por él.
  const [firmanteId, setFirmanteId] = useState<string>("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  // El canvas de firma es un widget de puntero puro — no hay forma
  // significativa de "dibujar" por teclado. Sin esta alternativa, un
  // paciente o miembro del staff que usa teclado o lector de pantalla no
  // podía completar el flujo de consentimiento (auditoría de
  // accesibilidad, 30-ago): "Guardar firma" quedaba deshabilitado para
  // siempre. Mismo criterio que ya usa la aceptación de presupuestos
  // (setQuoteStatus): firmar sin trazo sigue siendo válido, el nombre
  // tipeado es la evidencia.
  const [firmaElectronica, setFirmaElectronica] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const guardiansQuery = useGuardians(clinicId, patientId);
  const tutores = tutoresVigentes(guardiansQuery.data?.items ?? []);
  const tutoresDisponibles = guardiansQuery.data?.disponible ?? false;
  // La base exige el tutor para un menor (trigger stamp_patient_consent_signer);
  // esto solo lo avisa antes de que el paciente firme.
  const esMenor = esMenorDeEdad(fechaNacimiento, hoyISO(timezone)) === true;
  const tutorFirmante = tutores.find((t) => t.id === firmanteId) ?? null;
  const faltaTutor = esMenor && !tutorFirmante;

  function abrirDialogo(next: boolean) {
    setOpen(next);
    if (!next) return;
    // Un menor firma por su tutor principal; un adulto, por sí mismo.
    const sugerido = esMenor ? (tutores[0] ?? null) : null;
    setFirmanteId(sugerido?.id ?? "");
    setSignedByName(sugerido?.fullName ?? patientName);
  }

  function elegirFirmante(id: string) {
    setFirmanteId(id);
    const tutor = tutores.find((t) => t.id === id);
    setSignedByName(tutor?.fullName ?? patientName);
  }

  const templatesQuery = useQuery({
    queryKey: ["consent-templates", clinicId],
    queryFn: () => fetchTemplates({ data: { clinicId } }),
    enabled: open,
  });

  const consentsQueryKey = ["patient-consents", clinicId, patientId];
  const consentsQuery = useQuery({
    queryKey: consentsQueryKey,
    queryFn: () => fetchConsents({ data: { clinicId, patientId } }),
  });

  const signMutation = useMutation({
    mutationFn: () =>
      doSign({
        data: {
          clinicId,
          patientId,
          templateId: templateId || undefined,
          titleSnapshot: title,
          bodySnapshot: body,
          signedByName,
          guardianId: tutorFirmante?.id,
          signatureDataUrl: firmaElectronica ? undefined : (signatureDataUrl ?? undefined),
        },
      }),
    onSuccess: () => {
      toast.success("Consentimiento firmado y guardado.");
      queryClient.invalidateQueries({ queryKey: consentsQueryKey });
      setOpen(false);
      setTemplateId("");
      setTitle("");
      setBody("");
      setSignatureDataUrl(null);
      setFirmaElectronica(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la firma."),
  });

  const revokeMutation = useMutation({
    mutationFn: (consentId: string) => doRevoke({ data: { clinicId, consentId } }),
    onSuccess: () => {
      toast.success("Consentimiento revocado.");
      queryClient.invalidateQueries({ queryKey: consentsQueryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo revocar."),
    onSettled: () => setConfirmRevokeId(null),
  });

  function aplicarTemplate(id: string) {
    setTemplateId(id);
    const template = templatesQuery.data?.find((t) => t.id === id);
    if (template) {
      setTitle(template.title);
      setBody(template.body);
    }
  }

  const consents = consentsQuery.data ?? [];

  return (
    <div className="card-clinical p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Consentimientos</h3>
          <p className="text-xs text-muted-foreground">
            Firma capturada en el momento, con el texto exacto que firmó el paciente.
          </p>
        </div>
        {puedeEditar && (
          <Dialog open={open} onOpenChange={abrirDialogo}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <FileSignature className="size-3.5" /> Nuevo consentimiento
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Firmar consentimiento</DialogTitle>
                <DialogDescription>
                  El paciente firma en esta pantalla. El texto queda guardado tal como se muestra
                  aquí, aunque la plantilla cambie después.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {templatesQuery.data && templatesQuery.data.length > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${fid}-plantilla`}>Plantilla (opcional)</Label>
                    <select
                      id={`${fid}-plantilla`}
                      value={templateId}
                      onChange={(e) => aplicarTemplate(e.target.value)}
                      className={inputClass()}
                    >
                      <option value="">Redactar desde cero</option>
                      {templatesQuery.data
                        .filter((t) => t.active)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor={`${fid}-titulo`}>Título</Label>
                  <input
                    id={`${fid}-titulo`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className={inputClass()}
                    placeholder="Ej. Consentimiento para extracción"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fid}-texto`}>Texto del consentimiento</Label>
                  <textarea
                    id={`${fid}-texto`}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={5}
                    className={inputClass()}
                    placeholder="Explica el procedimiento, riesgos y alternativas…"
                  />
                </div>
                {tutoresDisponibles && (esMenor || tutores.length > 0) && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${fid}-quien`}>Quién firma</Label>
                    <select
                      id={`${fid}-quien`}
                      value={firmanteId}
                      onChange={(e) => elegirFirmante(e.target.value)}
                      className={inputClass()}
                    >
                      {esMenor ? (
                        <option value="" disabled>
                          Elige al tutor o representante
                        </option>
                      ) : (
                        <option value="">El paciente ({patientName})</option>
                      )}
                      {tutores.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.fullName} · {parentescoLegible(t)}
                        </option>
                      ))}
                    </select>
                    {tutorFirmante && (
                      <p className="text-xs text-muted-foreground">
                        Firma en representación de {patientName}. Doc. {tutorFirmante.documentId}.
                      </p>
                    )}
                  </div>
                )}
                {faltaTutor && (
                  <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {tutores.length === 0
                      ? "El paciente es menor de edad. Registra a su tutor en la ficha (pestaña Resumen) antes de firmar."
                      : "El paciente es menor de edad: firma su tutor o representante legal."}
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor={`${fid}-firmante`}>Firma a nombre de</Label>
                  <input
                    id={`${fid}-firmante`}
                    value={signedByName}
                    onChange={(e) => setSignedByName(e.target.value)}
                    readOnly={Boolean(tutorFirmante)}
                    className={inputClass()}
                  />
                </div>
                {!firmaElectronica && <SignaturePad onChange={setSignatureDataUrl} />}
                <label className="-mx-2 flex min-h-11 cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={firmaElectronica}
                    onChange={(e) => {
                      setFirmaElectronica(e.target.checked);
                      if (e.target.checked) setSignatureDataUrl(null);
                    }}
                    className="mt-0.5 size-4 shrink-0 pointer-coarse:size-5"
                  />
                  Firmar electrónicamente con el nombre de arriba, sin trazo manuscrito — usar
                  cuando quien firma no puede dibujar con mouse, dedo o trackpad (teclado, lector de
                  pantalla, etc).
                </label>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => signMutation.mutate()}
                  disabled={
                    signMutation.isPending ||
                    faltaTutor ||
                    !title.trim() ||
                    body.trim().length < 10 ||
                    !signedByName.trim() ||
                    (!firmaElectronica && !signatureDataUrl)
                  }
                >
                  {signMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Guardar firma
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {consentsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : consents.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin consentimientos firmados todavía.</p>
      ) : (
        <div className="space-y-2">
          {consents.map((c) => (
            <div
              key={c.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-hairline p-3"
            >
              <div className="flex items-start gap-3">
                {c.signatureUrl && (
                  <img
                    src={c.signatureUrl}
                    alt="Firma"
                    className="h-10 w-20 rounded border border-hairline bg-white object-contain"
                  />
                )}
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {c.revokedAt ? (
                      <ShieldX className="size-3.5 text-destructive" />
                    ) : (
                      <ShieldCheck className="size-3.5 text-success" />
                    )}
                    {c.titleSnapshot}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Firmado por {c.signedByName}
                    {c.signerRole === "tutor" &&
                      ` (${[c.signerRelationship, c.signerDocument && `Doc. ${c.signerDocument}`]
                        .filter(Boolean)
                        .join(", ")}) en representación del paciente`}{" "}
                    · {formatFechaHora(c.signedAt)}
                    {c.revokedAt && ` · Revocado ${formatFechaHora(c.revokedAt)}`}
                  </p>
                </div>
              </div>
              {puedeGestionar && !c.revokedAt && (
                <button
                  type="button"
                  aria-label={`Revocar consentimiento ${c.titleSnapshot}`}
                  onClick={() => setConfirmRevokeId(c.id)}
                  className="shrink-0 text-xs text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  Revocar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={confirmRevokeId !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmRevokeId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revocar consentimiento</AlertDialogTitle>
            <AlertDialogDescription>
              El consentimiento queda marcado como revocado. La firma original y el texto que firmó
              el paciente se conservan como historial, no se borran. ¿Confirmas revocarlo?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={revokeMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmRevokeId) revokeMutation.mutate(confirmRevokeId);
              }}
            >
              {revokeMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Revocar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
