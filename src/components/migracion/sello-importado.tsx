// src/components/migracion/sello-importado.tsx
//
// EXP-06: sello "Importado de <origen> el <fecha>" en la ficha de un paciente
// que vino de otro sistema, con el dato de origen (la fila del archivo tal
// como venía) de solo lectura. La ficha se completa y edita como cualquier
// otra; lo que no se edita es lo que trajo el archivo.

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, FileInput } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fecha } from "@/lib/formato-fecha";
import { origenDeLaFicha } from "@/lib/migracion/migracion.functions";
import { nombreDelOrigen } from "@/lib/migracion/perfiles";

export function SelloImportado({
  clinicId,
  patientId,
  zona,
}: {
  clinicId: string;
  patientId: string;
  zona: string | null | undefined;
}) {
  const leer = useServerFn(origenDeLaFicha);
  const { data } = useQuery({
    queryKey: ["origen-importado", clinicId, patientId],
    queryFn: () => leer({ data: { clinicId, patientId } }),
    staleTime: 5 * 60_000,
  });
  if (!data) return null;

  const campos = Object.entries(data.original ?? {});
  const origen = nombreDelOrigen(data.origen);

  return (
    <Collapsible className="mt-4 rounded-lg border border-hairline bg-secondary/40 text-sm">
      <CollapsibleTrigger
        disabled={campos.length === 0}
        className="group flex w-full min-h-11 items-center gap-2 px-4 py-2 text-left text-muted-foreground enabled:hover:text-foreground"
      >
        <FileInput className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          Importado de <span className="font-medium text-foreground">{origen}</span> el{" "}
          {fecha(data.importadoEn, zona ?? undefined)}
          {campos.length > 0 && <span className="hidden sm:inline"> · ver datos de origen</span>}
        </span>
        {campos.length > 0 && (
          <ChevronDown
            className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        )}
      </CollapsibleTrigger>
      {campos.length > 0 && (
        <CollapsibleContent className="border-t border-hairline px-4 py-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Así venía en el archivo de {origen}. Es de solo lectura: si un dato cambió, corrígelo en
            la ficha.
          </p>
          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {campos.map(([k, v]) => (
              <div key={k} className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-muted-foreground">{k}:</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
