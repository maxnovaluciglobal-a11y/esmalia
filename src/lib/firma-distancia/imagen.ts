/**
 * Firma dibujada → PNG en tinta oscura (navegador).
 *
 * El lienzo de firma (`SignaturePad`) dibuja con el color del texto, que en
 * modo oscuro es claro: esa imagen, puesta sobre el papel blanco del PDF, no
 * se vería. Antes de enviarla se repinta cada trazo en tinta casi negra
 * (conservando la transparencia), igual en claro que en oscuro.
 */
const TINTA = [25, 25, 25] as const;

export function firmaEnTintaOscura(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0);
      const datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = datos.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        px[i] = TINTA[0];
        px[i + 1] = TINTA[1];
        px[i + 2] = TINTA[2];
      }
      ctx.putImageData(datos, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("No pudimos leer la firma dibujada."));
    img.src = dataUrl;
  });
}
