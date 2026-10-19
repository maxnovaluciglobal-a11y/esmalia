import { createContext, useContext } from "react";

/** Lo provee `SoloLecturaProvider` (components/solo-lectura.tsx), dentro del AppShell. */
export const SoloLecturaContext = createContext(false);

/** `true` si la clínica activa está en modo solo lectura (BIL-01). */
export function useSoloLectura(): boolean {
  return useContext(SoloLecturaContext);
}
