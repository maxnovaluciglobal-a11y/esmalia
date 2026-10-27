import qrcode from "qrcode-generator";

/**
 * Código QR del link de reserva (RES-07). Matriz de módulos con corrección
 * de errores media (M); el dibujo (SVG en pantalla, PNG para descargar) lo
 * hace quien la usa.
 */
export function matrizQr(texto: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(texto, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, f) => Array.from({ length: n }, (_, c) => qr.isDark(f, c)));
}

/** Path SVG (un rectángulo por módulo oscuro) en unidades de módulo, con margen. */
export function pathSvgQr(matriz: boolean[][], margen = 4): { d: string; lado: number } {
  const partes: string[] = [];
  matriz.forEach((fila, y) =>
    fila.forEach((oscuro, x) => {
      if (oscuro) partes.push(`M${x + margen} ${y + margen}h1v1h-1z`);
    }),
  );
  return { d: partes.join(""), lado: matriz.length + margen * 2 };
}

/** Nombre de archivo del QR: "qr-reserva-clinica-sonrisa.png". */
export function nombreArchivoQr(slug: string): string {
  return `qr-reserva-${slug}.png`;
}

/** Snippet para pegar en la web de la clínica (iframe + link de respaldo). */
export function snippetWidget(url: string, clinica: string): string {
  const titulo = `Reserva tu hora en ${clinica}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return [
    `<iframe src="${url}?embed=1" title="${titulo}" width="100%" height="760" style="border:0;max-width:640px" loading="lazy"></iframe>`,
    `<p><a href="${url}" target="_blank" rel="noopener">${titulo}</a></p>`,
  ].join("\n");
}
