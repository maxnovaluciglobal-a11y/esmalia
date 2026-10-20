import { useEffect, useState } from "react";

import { minutosAhoraEnZona } from "@/components/agenda-hueco";

/**
 * Minutos desde HORA_INICIO de "ahora" en el huso de la clínica, o null si la
 * vista no es hoy. Arranca en null y se calcula en el efecto: en SSR el reloj
 * del servidor no tiene por qué coincidir con el del navegador (hydration).
 */
export function useMinutosAhora(activo: boolean, timeZone: string | undefined): number | null {
  const [minutos, setMinutos] = useState<number | null>(null);
  useEffect(() => {
    if (!activo) {
      setMinutos(null);
      return;
    }
    const actualizar = () => setMinutos(minutosAhoraEnZona(timeZone, new Date()));
    actualizar();
    const id = window.setInterval(actualizar, 60_000);
    return () => window.clearInterval(id);
  }, [activo, timeZone]);
  return minutos;
}
