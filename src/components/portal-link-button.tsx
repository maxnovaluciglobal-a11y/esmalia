import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, CheckCircle2, Copy, Link2, Loader2, MessageCircle, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { LlamadaDesbloqueo } from "@/components/llamada-desbloqueo";
import { generatePortalLink, revokePortalAccess } from "@/lib/patients/portal.functions";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

interface Props {
  clinicId: string;
  patientId: string;
  /** Seteado por el padre cuando `requiereLlamadaOSuscripcion` da true para
   * esta clínica — reemplaza el botón por `LlamadaDesbloqueo` en vez de dejar
   * generar el link. Ver billing.ts. */
  bloqueado?: {
    feature: string;
    descripcion: string;
    clinicName?: string | null;
    clinicEmail?: string | null;
  };
}

/**
 * Botón en la ficha del paciente (admin) para generar un link firmado
 * del portal (7 días de validez por default), copiarlo o mandarlo por
 * WhatsApp al paciente. Sin login, sin Twilio — el link vale por sí solo.
 */
export function PortalLinkButton({ clinicId, patientId, bloqueado }: Props) {
  const generate = useServerFn(generatePortalLink);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      generate({
        data: {
          clinicId,
          patientId,
          ttlDays: 7,
        },
      }),
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (bloqueado) {
    return (
      <LlamadaDesbloqueo
        feature={bloqueado.feature}
        descripcion={bloqueado.descripcion}
        clinicName={bloqueado.clinicName}
        clinicEmail={bloqueado.clinicEmail}
        variante="inline"
      />
    );
  }

  async function copy() {
    if (!mut.data) return;
    await navigator.clipboard.writeText(mut.data.url);
    setCopiedAt(Date.now());
    setTimeout(() => setCopiedAt(null), 2000);
    toast.success("Link copiado al portapapeles");
  }

  function openWhatsApp() {
    if (!mut.data?.waUrl) return;
    window.open(mut.data.waUrl, "_blank", "noopener,noreferrer");
  }

  if (!mut.data) {
    return (
      <button
        type="button"
        onClick={() => mut.mutate()}
        disabled={mut.isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-card px-3 py-1.5 text-xs font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        {mut.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Link2 className="size-3.5 text-brand" />
        )}
        Generar link del portal
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-hairline bg-card p-3">
      <p className="text-xs text-muted-foreground">
        Link válido {mut.data.expiresInDays} día{mut.data.expiresInDays === 1 ? "" : "s"}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs text-foreground/80">
          {mut.data.url}
        </code>
        <button
          type="button"
          onClick={copy}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-background text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
            copiedAt && "text-brand-700",
          )}
          aria-label="Copiar link"
        >
          {copiedAt ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
        {mut.data.viaApi && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-soft px-2 py-1.5 text-xs font-medium text-brand-700">
            <CheckCircle2 className="size-3.5" /> Enviado
          </span>
        )}
        {!mut.data.viaApi && mut.data.waUrl && (
          <button
            type="button"
            onClick={openWhatsApp}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-brand bg-transparent px-2 py-1.5 text-xs font-medium text-brand-700 outline-none hover:bg-brand/12 focus-visible:ring-1 focus-visible:ring-ring"
          >
            <MessageCircle className="size-3.5" /> WhatsApp
          </button>
        )}
      </div>
      {mut.data.dadoDeBajaWhatsApp && (
        <p className="text-xs text-muted-foreground">
          Este paciente pidió la baja de WhatsApp: no se le envió nada. Puedes copiar el link y
          dárselo por otro medio.
        </p>
      )}
    </div>
  );
}

/**
 * Corta todos los links del portal ya emitidos para este paciente — para
 * cuando uno se filtró o se reenvió a quien no correspondía. No hace
 * falta "restaurar": el próximo link que se genere ya funciona solo.
 */
export function RevokePortalAccessButton({ clinicId, patientId }: Props) {
  const revoke = useServerFn(revokePortalAccess);

  const mut = useMutation({
    mutationFn: () => revoke({ data: { clinicId, patientId } }),
    onSuccess: () => toast.success("Acceso al portal revocado. Los links anteriores ya no sirven."),
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  function handleClick() {
    const ok = window.confirm(
      "¿Revocar el acceso al portal de este paciente? Todos los links que se hayan enviado antes van a dejar de funcionar. Puedes generar uno nuevo después sin problema.",
    );
    if (ok) mut.mutate();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={mut.isPending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground outline-none hover:border-destructive/40 hover:text-destructive focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
    >
      {mut.isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <ShieldOff className="size-3.5" />
      )}
      Revocar acceso al portal
    </button>
  );
}
