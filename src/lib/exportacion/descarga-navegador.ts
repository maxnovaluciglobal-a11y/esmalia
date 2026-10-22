/** Utilidades de navegador compartidas por las dos exportaciones (clínica y ficha). */
import { fechaHora } from "@/lib/formato-fecha";

export async function descargarBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function guardarZip(zip: Uint8Array, nombre: string) {
  const blob = new Blob([zip as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Fecha y hora legibles de la generación, en la zona de la clínica. */
export function generadoAhora(timezone: string): string {
  return fechaHora(new Date(), timezone);
}
