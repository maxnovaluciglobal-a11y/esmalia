import { toast } from "sonner";

import { numeroDeCiclo } from "@/lib/esterilizacion/esterilizacion";
import type { Ciclo, Paquete } from "@/lib/esterilizacion/esterilizacion.functions";
import { fecha, fechaCortaHora } from "@/lib/formato-fecha";
import { matrizQr, pathSvgQr } from "@/lib/reserva/qr";

/** Etiquetas imprimibles con QR (el código del paquete, que se escanea al usarlo). */
export function imprimirEtiquetas(
  paquetes: readonly Paquete[],
  ciclos: ReadonlyMap<string, Ciclo>,
  clinica: string,
  zona: string,
) {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const etiquetas = paquetes
    .map((p) => {
      const { d, lado } = pathSvgQr(matrizQr(p.code), 2);
      const c = ciclos.get(p.cycleId);
      return `<div class="e"><svg viewBox="0 0 ${lado} ${lado}" width="88" height="88" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg><div><b>${esc(p.code)}</b><br>${esc(p.contents)}<br>Ciclo ${c ? esc(numeroDeCiclo(c)) : ""} · ${c ? esc(fechaCortaHora(c.runAt, zona)) : ""}<br><b>Vence ${esc(fecha(p.expiresOn))}</b><br><small>${esc(clinica)}</small></div></div>`;
    })
    .join("");
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) {
    toast.error(
      "El navegador bloqueó la ventana de impresión: permite ventanas emergentes para este sitio.",
    );
    return;
  }
  w.document.write(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas de esterilización</title><style>body{font:12px/1.35 system-ui,sans-serif;margin:8mm;color:#000}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:4mm}.e{display:flex;gap:3mm;align-items:center;border:1px dashed #999;padding:3mm;break-inside:avoid}</style></head><body><div class="g">${etiquetas}</div><script>window.onload=function(){window.print()}</script></body></html>`,
  );
  w.document.close();
}
