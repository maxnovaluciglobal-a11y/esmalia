/**
 * Diseño compartido de los correos que Esmalia le manda a la clínica.
 *
 * Una sola pieza para todos (lección de DypOS: tuvo colores mezclados entre
 * correos hasta que lo unificó). Cada plantilla arma una lista de bloques y
 * este archivo los convierte en dos salidas que no pueden desincronizarse:
 * el HTML (tablas + estilos en línea, que es lo único que Gmail y Outlook
 * respetan) y el texto plano alternativo.
 *
 * Puro: sin DB, sin red, sin `process.env`. La URL pública llega como
 * parámetro, así que las muestras de QA (`scripts/email-muestras.ts`) usan
 * exactamente este código.
 */

/** Paleta de Esmalia (tokens de `src/styles.css`, modo claro). */
export const COLORES = {
  papel: "#f4f2ee",
  tarjeta: "#fcfbf9",
  tinta: "#15120f",
  tenue: "#5b554f",
  borde: "#dcd9d5",
  ocre: "#7d5411",
  ocreSuave: "#fff3e4",
  exito: "#3b6b3f",
  peligro: "#9c2c1c",
} as const;

const FUENTE_TITULO = "'Cormorant Garamond', Cormorant, Georgia, 'Times New Roman', serif";
// En los correos la fuente web casi nunca carga: manda el respaldo. Walter
// eligió mantener Georgia (19-oct-2026), así que el correo sigue siendo serif.
const FUENTE_TEXTO = "'Instrument Sans', Georgia, 'Times New Roman', serif";

export const WORDMARK_PATH = "/brand/esmalia-wordmark-email.png";
/** Tamaño de presentación; el PNG está al doble para pantallas retina. */
const WORDMARK_ANCHO = 150;
const WORDMARK_ALTO = 42;

export function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Texto con partes en negrita o con enlace. Todo se escapa al renderizar. */
export type Inline = string | { negrita: string } | { texto: string; href: string };

function inlineHtml(partes: Inline[]): string {
  return partes
    .map((p) => {
      if (typeof p === "string") return escapeHtml(p);
      if ("negrita" in p) return `<strong>${escapeHtml(p.negrita)}</strong>`;
      return `<a href="${escapeHtml(p.href)}" style="color:${COLORES.ocre};text-decoration:underline;">${escapeHtml(p.texto)}</a>`;
    })
    .join("");
}

function inlineTexto(partes: Inline[]): string {
  return partes
    .map((p) => {
      if (typeof p === "string") return p;
      if ("negrita" in p) return p.negrita;
      return `${p.texto} (${p.href})`;
    })
    .join("");
}

export type Bloque =
  | { tipo: "parrafo"; partes: Inline[]; tenue?: boolean }
  | { tipo: "subtitulo"; texto: string }
  | { tipo: "boton"; texto: string; href: string }
  /** Dos acciones lado a lado (la segunda con borde): "Confirmar" / "Cancelar o reagendar". */
  | {
      tipo: "botones";
      principal: { texto: string; href: string };
      secundario?: { texto: string; href: string };
    }
  | { tipo: "pasos"; pasos: { titulo: string; detalle: string; href: string }[] }
  | {
      tipo: "cifra";
      etiqueta: string;
      valor: string;
      detalle?: string;
      tono?: "neutro" | "sube" | "baja";
    }
  | { tipo: "tabla"; filas: { etiqueta: string; valor: string; nota?: string }[] }
  | {
      tipo: "recuadro";
      titulo: string;
      partes: Inline[];
      enlace?: { texto: string; href: string };
    };

export const p = (...partes: Inline[]): Bloque => ({ tipo: "parrafo", partes });
export const pTenue = (...partes: Inline[]): Bloque => ({ tipo: "parrafo", partes, tenue: true });

const estiloParrafo = (tenue = false) =>
  `margin:0 0 16px 0;font-family:${FUENTE_TEXTO};font-size:16px;line-height:1.6;color:${tenue ? COLORES.tenue : COLORES.tinta};`;

function bloqueHtml(b: Bloque): string {
  switch (b.tipo) {
    case "parrafo":
      return `<p style="${estiloParrafo(b.tenue)}">${inlineHtml(b.partes)}</p>`;
    case "subtitulo":
      return `<h2 style="margin:28px 0 12px 0;font-family:${FUENTE_TITULO};font-size:22px;line-height:1.25;font-weight:600;color:${COLORES.tinta};">${escapeHtml(b.texto)}</h2>`;
    case "boton":
      // Botón "a prueba de balas": tabla con fondo + enlace con padding, para
      // que Outlook (que ignora padding en <a>) igual pinte el área.
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td align="center" bgcolor="${COLORES.ocre}" style="border-radius:6px;background:${COLORES.ocre};"><a href="${escapeHtml(b.href)}" style="display:inline-block;padding:13px 24px;font-family:${FUENTE_TEXTO};font-size:16px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(b.texto)}</a></td></tr></table>`;
    case "botones": {
      const principal = `<td align="center" bgcolor="${COLORES.ocre}" style="border-radius:6px;background:${COLORES.ocre};"><a href="${escapeHtml(b.principal.href)}" style="display:inline-block;padding:13px 22px;font-family:${FUENTE_TEXTO};font-size:16px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(b.principal.texto)}</a></td>`;
      const secundario = b.secundario
        ? `<td width="10" style="width:10px;font-size:0;line-height:0;">&nbsp;</td><td align="center" style="border-radius:6px;border:1px solid ${COLORES.ocre};"><a href="${escapeHtml(b.secundario.href)}" style="display:inline-block;padding:12px 20px;font-family:${FUENTE_TEXTO};font-size:16px;font-weight:600;line-height:1.2;color:${COLORES.ocre};text-decoration:none;border-radius:6px;">${escapeHtml(b.secundario.texto)}</a></td>`
        : "";
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr>${principal}${secundario}</tr></table>`;
    }
    case "pasos":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">${b.pasos
        .map(
          (paso, i) =>
            `<tr><td valign="top" width="36" style="padding:0 0 16px 0;font-family:${FUENTE_TITULO};font-size:22px;line-height:1.1;color:${COLORES.ocre};font-weight:600;">${i + 1}.</td><td valign="top" style="padding:0 0 16px 0;font-family:${FUENTE_TEXTO};font-size:16px;line-height:1.5;color:${COLORES.tinta};"><a href="${escapeHtml(paso.href)}" style="color:${COLORES.tinta};font-weight:600;text-decoration:underline;text-decoration-color:${COLORES.ocre};">${escapeHtml(paso.titulo)}</a><br><span style="color:${COLORES.tenue};font-size:15px;">${escapeHtml(paso.detalle)}</span></td></tr>`,
        )
        .join("")}</table>`;
    case "cifra": {
      const colorDetalle =
        b.tono === "sube" ? COLORES.exito : b.tono === "baja" ? COLORES.peligro : COLORES.tenue;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px 0;border-top:1px solid ${COLORES.borde};border-bottom:1px solid ${COLORES.borde};"><tr><td style="padding:20px 0;"><div style="font-family:${FUENTE_TEXTO};font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:${COLORES.tenue};">${escapeHtml(b.etiqueta)}</div><div style="margin-top:6px;font-family:${FUENTE_TITULO};font-size:40px;line-height:1.1;font-weight:600;color:${COLORES.tinta};">${escapeHtml(b.valor)}</div>${b.detalle ? `<div style="margin-top:6px;font-family:${FUENTE_TEXTO};font-size:15px;line-height:1.4;color:${colorDetalle};">${escapeHtml(b.detalle)}</div>` : ""}</td></tr></table>`;
    }
    case "tabla":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">${b.filas
        .map(
          (f) =>
            `<tr><td valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid ${COLORES.borde};font-family:${FUENTE_TEXTO};font-size:15px;line-height:1.4;color:${COLORES.tenue};">${escapeHtml(f.etiqueta)}</td><td valign="top" align="right" style="padding:10px 0;border-bottom:1px solid ${COLORES.borde};font-family:${FUENTE_TEXTO};font-size:16px;line-height:1.4;color:${COLORES.tinta};font-weight:600;">${escapeHtml(f.valor)}${f.nota ? `<div style="font-size:13px;font-weight:400;color:${COLORES.tenue};">${escapeHtml(f.nota)}</div>` : ""}</td></tr>`,
        )
        .join("")}</table>`;
    case "recuadro":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;"><tr><td bgcolor="${COLORES.ocreSuave}" style="padding:18px 20px;background:${COLORES.ocreSuave};border-left:3px solid ${COLORES.ocre};border-radius:4px;"><div style="margin:0 0 6px 0;font-family:${FUENTE_TEXTO};font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:${COLORES.ocre};font-weight:600;">${escapeHtml(b.titulo)}</div><div style="font-family:${FUENTE_TEXTO};font-size:16px;line-height:1.55;color:${COLORES.tinta};">${inlineHtml(b.partes)}</div>${b.enlace ? `<div style="margin-top:10px;font-family:${FUENTE_TEXTO};font-size:15px;"><a href="${escapeHtml(b.enlace.href)}" style="color:${COLORES.ocre};font-weight:600;text-decoration:underline;">${escapeHtml(b.enlace.texto)}</a></div>` : ""}</td></tr></table>`;
  }
}

function bloqueTexto(b: Bloque): string {
  switch (b.tipo) {
    case "parrafo":
      return inlineTexto(b.partes);
    case "subtitulo":
      return b.texto.toUpperCase();
    case "boton":
      return `${b.texto}: ${b.href}`;
    case "botones":
      return [b.principal, b.secundario]
        .filter((x): x is { texto: string; href: string } => Boolean(x))
        .map((x) => `${x.texto}: ${x.href}`)
        .join("\n");
    case "pasos":
      return b.pasos
        .map((s, i) => `${i + 1}. ${s.titulo}\n   ${s.detalle}\n   ${s.href}`)
        .join("\n\n");
    case "cifra":
      return [`${b.etiqueta}: ${b.valor}`, b.detalle].filter(Boolean).join("\n");
    case "tabla":
      return b.filas
        .map((f) => `- ${f.etiqueta}: ${f.valor}${f.nota ? ` (${f.nota})` : ""}`)
        .join("\n");
    case "recuadro":
      return [
        b.titulo.toUpperCase(),
        inlineTexto(b.partes),
        b.enlace ? `${b.enlace.texto}: ${b.enlace.href}` : "",
      ]
        .filter(Boolean)
        .join("\n");
  }
}

export interface PieDeCorreo {
  /** Por qué le llega este correo a esta persona. Siempre visible. */
  motivo: string;
  /** Solo correos no transaccionales: enlace visible para darse de baja. */
  bajaUrl?: string;
  bajaTexto?: string;
}

export interface CorreoRenderizado {
  subject: string;
  html: string;
  text: string;
}

export interface EntradaLayout {
  appUrl: string;
  asunto: string;
  /** Texto que el cliente de correo muestra al lado del asunto. */
  preencabezado: string;
  titulo: string;
  /** Línea chica debajo del título (ej. el rango de fechas del reporte). */
  bajada?: string;
  bloques: Bloque[];
  pie: PieDeCorreo;
}

export const LINEA_MARCA = "Esmalia · software para clínicas dentales";
export const LINEA_EMPRESA = "MAXNOVA & LUCI Global LLC";

export function renderCorreo(e: EntradaLayout): CorreoRenderizado {
  const app = e.appUrl.replace(/\/+$/, "");
  const cuerpo = e.bloques.map(bloqueHtml).join("\n");
  const pieBaja = e.pie.bajaUrl
    ? `<p style="margin:12px 0 0 0;"><a href="${escapeHtml(e.pie.bajaUrl)}" style="color:${COLORES.tenue};text-decoration:underline;">${escapeHtml(e.pie.bajaTexto ?? "Darme de baja de estos correos")}</a></p>`
    : "";

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(e.asunto)}</title>
<style>
  @media (max-width: 480px) {
    .esm-contenedor { padding: 12px !important; }
    .esm-tarjeta { padding: 24px 20px !important; }
    .esm-titulo { font-size: 28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORES.papel};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLORES.papel};">${escapeHtml(e.preencabezado)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORES.papel}" style="background:${COLORES.papel};">
<tr><td align="center" class="esm-contenedor" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td class="esm-tarjeta" bgcolor="${COLORES.tarjeta}" style="background:${COLORES.tarjeta};border:1px solid ${COLORES.borde};border-radius:8px;padding:36px 40px;">
<a href="${escapeHtml(app)}" style="text-decoration:none;"><img src="${escapeHtml(app + WORDMARK_PATH)}" width="${WORDMARK_ANCHO}" height="${WORDMARK_ALTO}" alt="Esmalia" style="display:block;border:0;outline:none;width:${WORDMARK_ANCHO}px;height:${WORDMARK_ALTO}px;color:${COLORES.tinta};font-family:${FUENTE_TITULO};font-size:28px;"></a>
<h1 class="esm-titulo" style="margin:28px 0 ${e.bajada ? "6px" : "20px"} 0;font-family:${FUENTE_TITULO};font-size:32px;line-height:1.15;font-weight:600;color:${COLORES.tinta};">${escapeHtml(e.titulo)}</h1>
${e.bajada ? `<p style="margin:0 0 24px 0;font-family:${FUENTE_TEXTO};font-size:15px;line-height:1.4;color:${COLORES.tenue};">${escapeHtml(e.bajada)}</p>` : ""}
${cuerpo}
</td></tr>
<tr><td style="padding:20px 8px 0 8px;font-family:${FUENTE_TEXTO};font-size:13px;line-height:1.55;color:${COLORES.tenue};">
<p style="margin:0;">${escapeHtml(LINEA_MARCA)}<br>${escapeHtml(LINEA_EMPRESA)}</p>
<p style="margin:12px 0 0 0;">${escapeHtml(e.pie.motivo)}</p>
${pieBaja}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textoPie = [
    "--",
    LINEA_MARCA,
    LINEA_EMPRESA,
    e.pie.motivo,
    e.pie.bajaUrl ? `${e.pie.bajaTexto ?? "Darme de baja de estos correos"}: ${e.pie.bajaUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const text = [e.titulo, e.bajada ?? "", "", e.bloques.map(bloqueTexto).join("\n\n"), "", textoPie]
    .filter((linea, i, arr) => !(linea === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();

  return { subject: e.asunto, html, text: `${text}\n` };
}
