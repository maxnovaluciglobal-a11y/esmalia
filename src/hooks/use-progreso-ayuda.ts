// src/hooks/use-progreso-ayuda.ts
//
// Avance de la persona en la ayuda: recorridos vistos, lecciones vistas y
// novedades leídas (ONB-03, ONB-04, NAV-10).
//
// Fuente: la tabla `help_progress` (por usuario) MÁS una copia en el
// navegador. Se muestra la unión de las dos:
//   - la copia local responde al instante y cubre un corte de red;
//   - en la demo (un usuario compartido entre visitantes) solo se usa la
//     copia local: lo que vio un visitante no se le oculta al siguiente.
// Si la base falla al guardar, no se avisa con un error: marcar una lección
// no es una operación que la persona necesite confirmar.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  listarProgresoDeAyuda,
  marcarProgresoDeAyuda,
  type ProgresoDeAyuda,
  type TipoProgreso,
} from "@/lib/ayuda/progreso.functions";

const CLAVE_LOCAL = "esmalia:ayuda:progreso";
const EVENTO_LOCAL = "esmalia:ayuda:progreso";
const VACIO: ProgresoDeAyuda = { tour: [], leccion: [], novedad: [] };

function almacen(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function leerLocal(userId: string): ProgresoDeAyuda {
  try {
    const crudo = almacen()?.getItem(`${CLAVE_LOCAL}:${userId}`);
    if (!crudo) return VACIO;
    const v = JSON.parse(crudo) as Partial<ProgresoDeAyuda>;
    return {
      tour: Array.isArray(v.tour) ? v.tour.filter((x) => typeof x === "string") : [],
      leccion: Array.isArray(v.leccion) ? v.leccion.filter((x) => typeof x === "string") : [],
      novedad: Array.isArray(v.novedad) ? v.novedad.filter((x) => typeof x === "string") : [],
    };
  } catch {
    return VACIO;
  }
}

function escribirLocal(userId: string, valor: ProgresoDeAyuda) {
  try {
    almacen()?.setItem(`${CLAVE_LOCAL}:${userId}`, JSON.stringify(valor));
  } catch {
    // Navegador sin almacenamiento (modo privado): queda la base.
  }
  window.dispatchEvent(new Event(EVENTO_LOCAL));
}

// Instantánea estable por usuario para useSyncExternalStore.
const cache = new Map<string, { crudo: string | null; valor: ProgresoDeAyuda }>();
function instantanea(userId: string): ProgresoDeAyuda {
  let crudo: string | null = null;
  try {
    crudo = almacen()?.getItem(`${CLAVE_LOCAL}:${userId}`) ?? null;
  } catch {
    crudo = null;
  }
  const previo = cache.get(userId);
  if (previo && previo.crudo === crudo) return previo.valor;
  const valor = leerLocal(userId);
  cache.set(userId, { crudo, valor });
  return valor;
}

function suscribir(cb: () => void) {
  window.addEventListener(EVENTO_LOCAL, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENTO_LOCAL, cb);
    window.removeEventListener("storage", cb);
  };
}

export type UsoProgresoAyuda = {
  /** ¿Ya vio / leyó este id? */
  hecho: (tipo: TipoProgreso, id: string) => boolean;
  vistos: (tipo: TipoProgreso) => ReadonlySet<string>;
  marcar: (tipo: TipoProgreso, ids: string[], hecho?: boolean) => void;
  /** true mientras no se sabe qué hay en la base (no ofrecer recorridos aún). */
  cargando: boolean;
};

export function useProgresoAyuda({
  userId,
  esDemo,
}: {
  userId: string;
  esDemo: boolean;
}): UsoProgresoAyuda {
  const queryClient = useQueryClient();
  const listar = useServerFn(listarProgresoDeAyuda);
  const guardar = useServerFn(marcarProgresoDeAyuda);
  const queryKey = useMemo(() => ["ayuda-progreso", userId] as const, [userId]);

  const remoto = useQuery({
    queryKey,
    queryFn: () => listar(),
    enabled: !esDemo,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const local = useSyncExternalStore(
    suscribir,
    () => instantanea(userId),
    () => VACIO,
  );

  const conjuntos = useMemo(() => {
    const base = esDemo ? VACIO : (remoto.data ?? VACIO);
    const unir = (t: TipoProgreso) => new Set([...base[t], ...local[t]]);
    return { tour: unir("tour"), leccion: unir("leccion"), novedad: unir("novedad") };
  }, [esDemo, remoto.data, local]);

  const marcar = useCallback(
    (tipo: TipoProgreso, ids: string[], hecho = true) => {
      if (ids.length === 0) return;
      const actual = leerLocal(userId);
      const set = new Set(actual[tipo]);
      for (const id of ids) {
        if (hecho) set.add(id);
        else set.delete(id);
      }
      escribirLocal(userId, { ...actual, [tipo]: [...set] });
      if (esDemo) return;
      queryClient.setQueryData<ProgresoDeAyuda>(queryKey, (previo) => {
        const p = previo ?? VACIO;
        const s = new Set(p[tipo]);
        for (const id of ids) {
          if (hecho) s.add(id);
          else s.delete(id);
        }
        return { ...p, [tipo]: [...s] };
      });
      guardar({ data: { tipo, ids, hecho } }).catch((e: unknown) => {
        console.warn("[ayuda] no se guardó el avance en la base:", e);
      });
    },
    [userId, esDemo, queryClient, queryKey, guardar],
  );

  return {
    hecho: (tipo, id) => conjuntos[tipo].has(id),
    vistos: (tipo) => conjuntos[tipo],
    marcar,
    cargando: !esDemo && remoto.isLoading,
  };
}
