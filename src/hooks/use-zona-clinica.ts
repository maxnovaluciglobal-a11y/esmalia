import { createContext, useContext } from "react";

/**
 * Huso horario de la clínica activa (`access.clinic?.timezone`). Lo provee el
 * AppShell para que cualquier componente formatee fechas con
 * `@/lib/formato-fecha` sin recibir el huso por props. Fuera del shell
 * (portal, páginas públicas) vale `undefined` y el formateador usa Chile.
 */
export const ZonaClinicaContext = createContext<string | undefined>(undefined);

export function useZonaClinica(): string | undefined {
  return useContext(ZonaClinicaContext);
}
