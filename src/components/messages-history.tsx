import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import { MESSAGE_STATUS_LABELS, MESSAGE_TEMPLATE_KIND_LABELS } from "@/lib/messaging/messaging";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { listMessages } from "@/lib/messaging/messaging.functions";
import { useZonaClinica } from "@/hooks/use-zona-clinica";
import { fechaCortaHora } from "@/lib/formato-fecha";

interface Props {
  clinicId: string;
  patientId: string;
}

/** Historial de mensajes enviados al paciente (WhatsApp, SMS, email). */
export function MessagesHistory({ clinicId, patientId }: Props) {
  const zona = useZonaClinica();
  const fetchMessages = useServerFn(listMessages);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages", clinicId, patientId],
    queryFn: () => fetchMessages({ data: { clinicId, patientId } }),
  });

  return (
    <div className="card-clinical p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">Comunicaciones</h3>
          <p className="text-xs text-muted-foreground">
            Mensajes enviados al paciente y respuestas suyas.
          </p>
        </div>
        <Link
          to="/conversaciones"
          search={{ paciente: patientId }}
          className="shrink-0 rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          Abrir conversación
        </Link>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Cargando…</p>}

      {!isLoading && messages.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Todavía no se enviaron mensajes al paciente. Desde la agenda o los presupuestos puedes
          disparar recordatorios y envíos por WhatsApp.
        </p>
      )}

      {!isLoading && messages.length > 0 && (
        <div className="space-y-2">
          {messages.map((m) => {
            const entrante = m.direction === "inbound";
            return (
              <div
                key={m.id}
                className={cn(
                  "rounded-lg border p-3",
                  entrante ? "border-brand/30 bg-brand-soft/40" : "border-hairline",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    {entrante ? (
                      <ArrowDownLeft className="size-3.5 text-brand" />
                    ) : (
                      <ArrowUpRight className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="font-medium uppercase tracking-wide">{m.channel}</span>
                    {m.templateKind && (
                      <span>· {MESSAGE_TEMPLATE_KIND_LABELS[m.templateKind]}</span>
                    )}
                    {!entrante && <span>· {MESSAGE_STATUS_LABELS[m.status]}</span>}
                  </div>
                  <span className="cifra">{fechaCortaHora(m.createdAt, zona)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/90">{m.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {entrante ? `del paciente · ${m.recipient}` : `a ${m.recipient}`}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
