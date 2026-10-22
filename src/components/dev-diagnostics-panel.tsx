import { useSyncExternalStore, useState } from "react";
import { Bug, Trash2, X } from "lucide-react";

import {
  ORIGEN_LABELS,
  leerBloqueos,
  limpiarBloqueos,
  suscribirBloqueos,
  type Diagnostico,
} from "@/lib/block-diagnostics";
import { hora } from "@/lib/formato-fecha";

const VERDICTO_LABEL: Record<string, string> = {
  allow: "La matriz esperaba permitir",
  deny: "La matriz también deniega",
  conditional: "La matriz lo permite solo bajo condición",
};

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{etiqueta}</span>
      <span className="min-w-0 flex-1 break-words">{valor}</span>
    </div>
  );
}

function Tarjeta({ d }: { d: Diagnostico }) {
  return (
    <div className="rounded-lg border border-hairline bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium text-xs">{d.accionLabel}</span>
        <span className="text-[11px] text-muted-foreground">{hora(d.ts)}</span>
      </div>
      <div className="space-y-1">
        <Fila etiqueta="Estado real" valor={d.estadoLabel} />
        <Fila
          etiqueta="Rol"
          valor={`${d.rolReal ?? "sin rol"}${d.rolSimulado ? ` (simulado: ${d.rolSimulado})` : ""}`}
        />
        <Fila
          etiqueta="Relación"
          valor={`autor: ${d.esAutor === null ? "?" : d.esAutor ? "sí" : "no"} · revisor asignado: ${
            d.esRevisor === null ? "?" : d.esRevisor ? "sí" : "no"
          }`}
        />
        <Fila etiqueta="Origen" valor={ORIGEN_LABELS[d.origen]} />
        <Fila etiqueta="Causa" valor={d.causa} />
        {d.matriz && (
          <Fila
            etiqueta="Matriz"
            valor={`${VERDICTO_LABEL[d.matriz.verdict]} — ${d.matriz.detalle}`}
          />
        )}
        <Fila etiqueta="Mensaje" valor={d.mensaje || "(sin mensaje)"} />
      </div>
      {d.discrepancia && (
        <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          Discrepancia: la UI habilitó la acción pero el servidor la bloqueó. Revisa el trigger o la
          política correspondiente.
        </p>
      )}
    </div>
  );
}

/** Panel flotante de diagnóstico. Solo se monta en desarrollo. */
export function DevDiagnosticsPanel() {
  const [abierto, setAbierto] = useState(false);
  const registros = useSyncExternalStore(
    suscribirBloqueos,
    leerBloqueos,
    () => [] as Diagnostico[],
  );

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 print:hidden">
      {abierto ? (
        <div className="flex max-h-[70vh] w-[min(24rem,90vw)] flex-col rounded-xl border border-hairline bg-background shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
            <div>
              <p className="text-xs font-semibold">Diagnóstico de bloqueos</p>
              <p className="text-[11px] text-muted-foreground">
                Solo desarrollo · sin datos clínicos ni identificadores
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={limpiarBloqueos}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Limpiar registros"
              >
                <Trash2 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Cerrar panel"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {registros.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin bloqueos registrados. Intenta una acción no permitida para ver la explicación.
              </p>
            ) : (
              registros.map((d) => <Tarjeta key={d.id} d={d} />)
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="flex items-center gap-2 rounded-full border border-hairline bg-background px-3 py-2 text-xs shadow-sm hover:bg-muted"
        >
          <Bug className="size-3.5" />
          Diagnóstico
          {registros.length > 0 && (
            <span className="rounded-full bg-destructive px-1.5 text-[11px] text-destructive-foreground">
              {registros.length}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
