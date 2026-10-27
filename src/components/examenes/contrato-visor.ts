/**
 * Contrato con el frente B de la Ola 13 (visores 3D y DICOM, rama
 * `ola13/visores`). Este frente NO implementa visores: solo deja el punto de
 * integración en la lista de exámenes.
 *
 * Lo que B tiene que exportar en `src/components/visores/visor-de-examen.tsx`:
 *
 *   export function VisorDeExamen(props: VisorDeExamenProps): JSX.Element
 *
 * - `tipo`: formato del archivo ("stl" | "ply" | "obj" | "dicom"). Lo decide
 *   `formatoVisor()` de `@/lib/examenes/tipos` por extensión y MIME.
 * - `url`: URL firmada de Storage, válida 5 minutos. Se pide recién al abrir
 *   el visor; si el visor necesita volver a bajar el archivo después de ese
 *   plazo, que llame a `pedirUrl()` para una nueva.
 * - `nombre`: nombre original del archivo (para el título y la descarga).
 * - `onCerrar`: cierra el diálogo que lo contiene.
 *
 * El visor se monta dentro de un diálogo a pantalla casi completa que pone
 * este frente (`BotonVisor`), así que B no necesita su propio modal.
 *
 * Activación: un único `import.meta.glob` (abajo). Mientras el archivo de B
 * no exista, el glob queda vacío y el botón sale deshabilitado con el motivo
 * "visor disponible pronto". Cuando B mergea su archivo, el botón se activa
 * solo, sin tocar nada de este frente. Vite resuelve el glob al compilar y lo
 * parte en su propio chunk (three.js / cornerstone no entran en la ficha).
 */
import type { ComponentType } from "react";

import type { FormatoVisor } from "@/lib/examenes/tipos";

export interface VisorDeExamenProps {
  tipo: FormatoVisor;
  url: string;
  nombre: string;
  onCerrar?: () => void;
  pedirUrl?: () => Promise<string>;
}

type ModuloVisor = { VisorDeExamen?: ComponentType<VisorDeExamenProps> };

/** Ruta del módulo del frente B (relativa a la raíz del proyecto). */
export const RUTA_VISOR = "/src/components/visores/visor-de-examen.tsx";

const modulos = import.meta.glob<ModuloVisor>("/src/components/visores/visor-de-examen.tsx");

/** Cargador del visor, o null si el frente B todavía no lo agregó. */
export const cargarVisor: (() => Promise<ModuloVisor>) | null = modulos[RUTA_VISOR] ?? null;

export const MOTIVO_VISOR_PENDIENTE = "Visor disponible pronto";
