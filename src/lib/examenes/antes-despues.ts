/**
 * IMG-02 · Par por defecto para comparar antes y después (puro): la primera
 * foto de una sesión "antes" (o la más antigua) contra la última de una
 * sesión "después" (o la más nueva).
 */
import type { EtapaSesion } from "@/lib/examenes/tipos";

interface FotoParaComparar {
  id: string;
  takenOn: string;
  createdAt: string;
  photoSessionId: string | null;
}

export function parPorDefecto(
  fotos: readonly FotoParaComparar[],
  sesiones: readonly { id: string; stage: EtapaSesion | null }[],
): [string, string] | null {
  if (fotos.length < 2) return null;
  const porFecha = [...fotos].sort(
    (a, b) => a.takenOn.localeCompare(b.takenOn) || a.createdAt.localeCompare(b.createdAt),
  );
  const etapa = new Map(sesiones.map((s) => [s.id, s.stage]));
  const antes = porFecha.find((f) => f.photoSessionId && etapa.get(f.photoSessionId) === "antes");
  const despues = [...porFecha]
    .reverse()
    .find((f) => f.photoSessionId && etapa.get(f.photoSessionId) === "despues");
  const a = antes ?? porFecha[0];
  const b = despues && despues.id !== a.id ? despues : porFecha[porFecha.length - 1];
  return a.id === b.id ? [porFecha[0].id, porFecha[porFecha.length - 1].id] : [a.id, b.id];
}
