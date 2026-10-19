import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Share2 } from "lucide-react";
import { toast } from "sonner";

import { buildWaMeUrl } from "@/lib/messaging/messaging";
import { getWhatsAppAccountStatus } from "@/lib/messaging/whatsapp.functions";
import { cn } from "@/lib/utils";

interface Props {
  clinicId: string;
  /** País de la clínica: hace falta si Meta devolvió el número sin "+". */
  clinicCountry: string | null;
  patientName: string;
  referralCode: string | null;
}

/**
 * Código de referido del paciente (Fase 4) + link pre-armado para que lo
 * reenvíe a un amigo. El link apunta al WhatsApp de LA CLÍNICA (no al del
 * paciente) con el código ya en el texto — cuando un amigo lo abre, le
 * escribe directo a la clínica y el webhook detecta el código solo
 * (ver findReferrerByCode en api.whatsapp-webhook.ts).
 */
export function ReferralCodeCard({ clinicId, clinicCountry, patientName, referralCode }: Props) {
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const fetchAccount = useServerFn(getWhatsAppAccountStatus);
  const { data: account } = useQuery({
    queryKey: ["whatsapp-account", clinicId],
    queryFn: () => fetchAccount({ data: { clinicId } }),
  });

  if (!referralCode) return null;

  const shareUrl =
    account?.status === "connected" && account.displayPhone
      ? buildWaMeUrl(
          account.displayPhone,
          `¡Hola! Te recomiendo mucho a mi dentista, escríbeles con este código: ${referralCode}`,
          clinicCountry,
        )
      : null;

  async function copyCode() {
    await navigator.clipboard.writeText(referralCode!);
    setCopiedAt(Date.now());
    setTimeout(() => setCopiedAt(null), 2000);
    toast.success("Código copiado");
  }

  function share() {
    if (!shareUrl) return;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-2 rounded-lg border border-hairline bg-card p-3">
      <p className="text-xs text-muted-foreground">
        Código de referido de {patientName.split(" ")[0]}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm font-semibold tracking-wide text-foreground">
          {referralCode}
        </code>
        <button
          type="button"
          onClick={copyCode}
          className={cn(
            "shrink-0 rounded-lg border border-hairline bg-background p-1.5 text-muted-foreground hover:text-foreground",
            copiedAt && "text-brand-700",
          )}
          aria-label="Copiar código"
        >
          {copiedAt ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
        {shareUrl ? (
          <button
            type="button"
            onClick={share}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-brand bg-transparent px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand/12"
          >
            <Share2 className="size-3.5" /> Compartir
          </button>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            Conecta WhatsApp para compartir por link
          </span>
        )}
      </div>
    </div>
  );
}
