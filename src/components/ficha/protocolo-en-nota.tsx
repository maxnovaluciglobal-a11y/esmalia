/**
 * FIC-15 · Aplicar un protocolo clínico a la nota que se está escribiendo.
 * Copia el texto del protocolo (pasos numerados e indicaciones) al final de
 * la nota: queda registrado en la versión que se guarda y en su firma.
 * Los protocolos se administran en Ajustes → Protocolos clínicos.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";

import { listProtocolosClinicos } from "@/lib/clinical/protocolos.functions";
import { textoDeProtocolo, type ProtocoloClinico } from "@/lib/clinical/protocolos";

export function SelectorDeProtocolo({
  clinicId,
  onAplicar,
  puedeAdministrar,
}: {
  clinicId: string;
  onAplicar: (bloque: string, protocolo: ProtocoloClinico) => void;
  puedeAdministrar: boolean;
}) {
  const listar = useServerFn(listProtocolosClinicos);
  const { data: protocolos = [], isLoading } = useQuery({
    queryKey: ["protocolos-clinicos", clinicId, "activos"],
    queryFn: () => listar({ data: { clinicId, soloActivos: true } }),
    staleTime: 60_000,
  });
  const [elegido, setElegido] = useState("");
  const protocolo = protocolos.find((p) => p.id === elegido) ?? null;

  return (
    <div className="rounded-[14px] border border-hairline p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
          <ClipboardCheck className="size-4" aria-hidden /> Protocolo clínico
        </span>
        {protocolos.length > 0 && (
          <select
            aria-label="Protocolo a aplicar"
            value={elegido}
            onChange={(e) => setElegido(e.target.value)}
            className="h-9 w-full min-w-0 rounded-full border border-control bg-card px-3 text-sm sm:w-auto sm:max-w-sm pointer-coarse:h-11 pointer-coarse:text-base"
          >
            <option value="">Elegir protocolo…</option>
            {protocolos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.procedureLabel ? `${p.name} · ${p.procedureLabel}` : p.name}
              </option>
            ))}
          </select>
        )}
        {protocolo && (
          <button
            type="button"
            onClick={() => {
              onAplicar(textoDeProtocolo(protocolo), protocolo);
              setElegido("");
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3.5 text-sm font-semibold text-background pointer-coarse:h-11"
          >
            Aplicar a la nota
          </button>
        )}
      </div>
      {protocolo ? (
        <ol className="ml-5 list-decimal space-y-0.5 text-sm text-muted-foreground">
          {protocolo.steps.map((paso, i) => (
            <li key={i}>{paso}</li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {isLoading
            ? "Cargando protocolos…"
            : protocolos.length === 0
              ? "La clínica todavía no tiene protocolos."
              : "Sus pasos e indicaciones se agregan al final de la nota y quedan en su versión."}{" "}
          {puedeAdministrar && !isLoading && (
            <Link to="/protocolos-clinicos" className="font-semibold text-foreground underline">
              {protocolos.length === 0 ? "Crear protocolos" : "Administrar protocolos"}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
