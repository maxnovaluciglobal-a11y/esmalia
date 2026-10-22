import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  correoAlPaciente,
  textoCorreoDocumento,
  textoCorreoPresupuesto,
} from "@/lib/documentos/correo";
import { BloquesSchema } from "@/lib/documentos/esquemas";
import {
  analizarPlantilla,
  bloqueDeFirma,
  bloquesAHtml,
  bloquesATexto,
  renderPlantilla,
} from "@/lib/documentos/motor";
import { construirHojaPdf, type HojaParaPdf } from "@/lib/documentos/pdf";
import {
  copagoDelPresupuesto,
  nombreDeArchivoPresupuesto,
  PLANTILLA_PRESUPUESTO,
  PRESUPUESTO_DE_EJEMPLO,
  tablaDePrestaciones,
  tablaDeTotales,
  valorDeLinea,
  valoresDePresupuesto,
  type DatosPresupuesto,
} from "@/lib/documentos/presupuesto";
import type { Bloque, TablaDeContexto } from "@/lib/documentos/tipos";
import {
  construirContexto,
  contextoDeEjemplo,
  type DatosParaDocumento,
} from "@/lib/documentos/variables";
import { calcularTotalesDePresupuesto } from "@/lib/finance/calculo-presupuesto";
import { formatMoney } from "@/lib/finance/finance";

/**
 * Ola 4 · PLA-08 (PDF del presupuesto con el motor de documentos), PLA-11
 * (firma del profesional) y el correo al paciente de PLA-09 / DOC-07. Puro:
 * sin base ni red. Con `DOCUMENTOS_PDF_DIR` deja el PDF del presupuesto en esa
 * carpeta para revisarlo a ojo.
 */

const SQL = readFileSync(
  new URL("../supabase/migrations/20261025200100_plantilla_presupuesto.sql", import.meta.url),
  "utf8",
);

/**
 * Un presupuesto armado con el MISMO cálculo que guarda el servidor
 * (`calcularTotalesDePresupuesto`), mapeado a `DatosPresupuesto` como lo hace
 * `armarPresupuestoParaPdf` con las filas guardadas.
 */
function presupuestoCalculado(opciones: {
  descuentoPct?: number | null;
  descuentoCents?: number;
  conCobertura?: boolean;
}) {
  const lineas = [
    {
      procedureId: "endo",
      quantity: 1,
      unitPriceCents: 180_000,
      discountCents: 0,
      phaseLabel: "Urgencia",
      phasePosition: 1,
      nombre: "Endodoncia molar",
      pieza: 46,
    },
    {
      procedureId: "corona",
      quantity: 1,
      unitPriceCents: 250_000,
      discountCents: 0,
      discountPct: 12.5,
      phaseLabel: "Rehabilitación",
      phasePosition: 2,
      nombre: "Corona de porcelana",
      pieza: 46,
    },
    {
      procedureId: "destartraje",
      quantity: 3,
      unitPriceCents: 33_333,
      discountCents: 1_001,
      phaseLabel: "Rehabilitación",
      phasePosition: 2,
      nombre: "Destartraje y pulido",
      pieza: null,
    },
    {
      procedureId: null,
      quantity: 2,
      unitPriceCents: 9_999,
      discountCents: 0,
      phaseLabel: null,
      phasePosition: 0,
      nombre: "Radiografía (texto libre)",
      pieza: null,
    },
  ];
  const cobertura = opciones.conCobertura
    ? new Map([
        ["endo", { coveragePct: 40, coverageFixedCents: null }],
        ["corona", { coveragePct: null, coverageFixedCents: 50_000 }],
      ])
    : undefined;
  const t = calcularTotalesDePresupuesto(
    lineas,
    opciones.descuentoCents ?? 0,
    opciones.descuentoPct ?? null,
    cobertura,
  );
  const datos: DatosPresupuesto = {
    numero: "P-2026-0099",
    creadoEn: "2026-10-22T15:00:00Z",
    validoHasta: "2026-11-21",
    profesional: "Dra. Ana Soto",
    moneda: "CLP",
    lineas: t.items.map((it) => ({
      seccion: it.phaseLabel,
      nombre: it.nombre,
      pieza: it.pieza,
      cantidad: it.quantity,
      precioUnitarioCents: it.unitPriceCents,
      descuentoCents: it.discountCents,
      descuentoPct: it.discountPct,
      aceptada: null,
    })),
    subtotalCents: t.subtotal,
    descuentoCents: t.discountCents,
    descuentoPct: t.commercialDiscountPct,
    totalCents: t.total,
    convenio: opciones.conCobertura ? "Convenio Vida Sur" : null,
    coberturaCents: t.coverageTotalCents,
    notas: null,
  };
  return { t, datos };
}

function celdaFinal(tabla: TablaDeContexto, etiqueta: string): string | undefined {
  return tabla.filas.find((f) => f[0] === etiqueta)?.at(-1);
}

describe("plantilla del presupuesto (PLA-08)", () => {
  it("la migración siembra exactamente el texto de PLANTILLA_PRESUPUESTO", () => {
    const m = /v_cuerpo constant text := \$t\$([\s\S]*?)\$t\$;/.exec(SQL);
    expect(m?.[1]).toBe(PLANTILLA_PRESUPUESTO);
    expect(SQL).toContain("'presupuesto', 'esmalia_model', 'presupuesto'");
  });

  it("solo usa variables que el motor conoce y deja las tablas solas en su línea", () => {
    const a = analizarPlantilla(PLANTILLA_PRESUPUESTO);
    expect(a.problemas).toEqual([]);
    expect(a.campos).toEqual([]);
    expect(a.variables).toContain("presupuesto.prestaciones");
    expect(a.variables).toContain("presupuesto.totales");
  });

  it("con datos completos no le falta nada y firma el profesional con su registro SIS", () => {
    const datos: DatosParaDocumento = {
      zona: "America/Santiago",
      ahora: "2026-10-22T15:00:00Z",
      moneda: "CLP",
      paciente: {
        nombre: "Ana Pérez",
        tipoDocumento: "rut",
        documento: "123456785",
        fechaNacimiento: "1990-03-04",
        prevision: { plan: "fonasa", tramo: "B", institucion: null },
        direccion: null,
        comuna: null,
        telefono: null,
        email: null,
      },
      clinica: {
        nombre: "Clínica Sonrisa",
        razonSocial: "Sonrisa SpA",
        rut: "761234560",
        giro: "Servicios odontológicos",
        direccionTributaria: "Av. Grecia 1",
        comunaTributaria: "Ñuñoa",
        direccion: null,
        telefono: null,
        tipoBoleta: "exenta",
      },
      profesional: { nombre: "Dra. Ana Soto", registroSis: "123456", especialidad: "Endodoncia" },
      campos: {},
      presupuesto: PRESUPUESTO_DE_EJEMPLO,
    };
    const r = renderPlantilla(PLANTILLA_PRESUPUESTO, construirContexto(datos), {
      firma: bloqueDeFirma(datos.profesional!),
    });
    expect(r.desconocidas).toEqual([]);
    expect(r.faltantes).toEqual([]);
    const texto = bloquesATexto(r.bloques);
    expect(texto).toContain("Presupuesto P-2026-0012");
    expect(texto).toContain("Registro Superintendencia de Salud N.º 123456");
    expect(texto).toContain("Endodoncia");
    expect(r.bloques.at(-1)).toMatchObject({ tipo: "firma", nombre: "Dra. Ana Soto" });
    // Lo que se guarda/viaja pasa la validación de bloques.
    expect(BloquesSchema.safeParse(r.bloques).success).toBe(true);
  });

  it("la vista previa del editor tiene datos de ejemplo para todo el grupo presupuesto", () => {
    const r = renderPlantilla(PLANTILLA_PRESUPUESTO, contextoDeEjemplo());
    expect(r.faltantes).toEqual([]);
  });
});

describe("totales del PDF = calculo-presupuesto.ts", () => {
  it.each([
    ["sin descuento ni convenio", {}],
    ["descuento comercial en %", { descuentoPct: 7.5 }],
    ["descuento comercial en pesos", { descuentoCents: 12_345 }],
    ["descuento y convenio", { descuentoPct: 5, conCobertura: true }],
  ] as const)("%s", (_n, opciones) => {
    const { t, datos } = presupuestoCalculado(opciones);

    // Cada línea: cantidad × unitario − su descuento propio, y la suma de las
    // líneas es el subtotal que guarda el cálculo.
    const valores = datos.lineas.map(valorDeLinea);
    expect(valores.reduce((s, v) => s + v, 0)).toBe(t.subtotal);
    expect(datos.subtotalCents - datos.descuentoCents).toBe(t.total);

    const prest = tablaDePrestaciones(datos);
    const filasDeLineas = prest.filas.filter((_, i) => !prest.destacadas?.includes(i));
    expect(filasDeLineas.map((f) => f.at(-1))).toEqual(valores.map((v) => formatMoney(v, "CLP")));
    expect(prest.pie?.at(-1)).toBe(formatMoney(t.subtotal, "CLP"));

    const tot = tablaDeTotales(datos);
    expect(celdaFinal(tot, "Subtotal")).toBe(formatMoney(t.subtotal, "CLP"));
    expect(celdaFinal(tot, "Total del presupuesto")).toBe(formatMoney(t.total, "CLP"));
    const copago =
      t.coverageTotalCents === null ? t.total : Math.max(0, t.total - t.coverageTotalCents);
    expect(tot.pie).toEqual(["Total a pagar por el paciente", formatMoney(copago, "CLP")]);
    expect(copagoDelPresupuesto(datos)).toBe(copago);

    const descuento = tot.filas.find((f) => f[0].startsWith("Descuento comercial"));
    if (t.discountCents > 0) {
      expect(descuento?.[1]).toBe(`-${formatMoney(t.discountCents, "CLP")}`);
    } else {
      expect(descuento).toBeUndefined();
    }
    const convenio = tot.filas.find((f) => f[0].startsWith("Cubre"));
    if (t.coverageTotalCents !== null) {
      expect(convenio?.[1]).toBe(`-${formatMoney(t.coverageTotalCents, "CLP")}`);
    } else {
      expect(convenio).toBeUndefined();
    }

    const v = valoresDePresupuesto(datos, "America/Santiago");
    expect(v["presupuesto.total"]).toBe(formatMoney(t.total, "CLP"));
    expect(v["presupuesto.subtotal"]).toBe(formatMoney(t.subtotal, "CLP"));
    expect(v["presupuesto.copago"]).toBe(formatMoney(copago, "CLP"));
  });

  it("agrupa por sección con filas destacadas y la columna de descuento solo si hay", () => {
    const { datos } = presupuestoCalculado({});
    const prest = tablaDePrestaciones(datos);
    expect(prest.columnas.map((c) => c.titulo)).toEqual([
      "Pieza",
      "Prestación",
      "Cant.",
      "Valor unitario",
      "Descuento",
      "Total",
    ]);
    const secciones = (prest.destacadas ?? []).map((i) => prest.filas[i][1]);
    expect(secciones).toEqual(["Urgencia", "Rehabilitación", "Sin sección"]);
    // Una línea con el descuento negociado en % lo muestra.
    expect(prest.filas.some((f) => f[4].startsWith("12,5 %"))).toBe(true);

    const sinDescuento: DatosPresupuesto = {
      ...datos,
      lineas: datos.lineas.map((l) => ({ ...l, descuentoCents: 0, descuentoPct: null })),
    };
    expect(tablaDePrestaciones(sinDescuento).columnas.map((c) => c.titulo)).not.toContain(
      "Descuento",
    );
  });

  it("sin convenio no inventa un cero (regla 11) y respeta la moneda", () => {
    const usd: DatosPresupuesto = {
      ...PRESUPUESTO_DE_EJEMPLO,
      moneda: "USD",
      convenio: null,
      coberturaCents: null,
    };
    const v = valoresDePresupuesto(usd, "America/Santiago");
    expect(v["presupuesto.cobertura"]).toBe("Sin convenio");
    expect(v["presupuesto.total"]).toBe(formatMoney(usd.totalCents, "USD"));
    expect(tablaDeTotales(usd).filas.some((f) => f[0].startsWith("Cubre"))).toBe(false);
  });
});

describe("filas destacadas en el motor", () => {
  it("el HTML canónico las marca y una tabla sin destacadas queda igual que antes", () => {
    const tabla: Bloque = {
      tipo: "tabla",
      columnas: [{ titulo: "A", alineacion: "izquierda" }],
      filas: [["Sección"], ["línea"]],
      destacadas: [0],
    };
    expect(bloquesAHtml([tabla])).toContain('<tr class="seccion"><td>Sección</td></tr>');
    const { destacadas: _d, ...sin } = tabla;
    expect(bloquesAHtml([sin])).toBe(
      "<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>Sección</td></tr><tr><td>línea</td></tr></tbody></table>",
    );
  });
});

describe("PDF del presupuesto con jsPDF (también en el servidor)", () => {
  it("arma el PDF con los totales y la firma, y lo deja para revisar si se pide", async () => {
    const { datos: p } = presupuestoCalculado({ descuentoPct: 5, conCobertura: true });
    const ctx = construirContexto({
      zona: "America/Santiago",
      ahora: "2026-10-22T15:00:00Z",
      moneda: "CLP",
      paciente: {
        nombre: "Ana Pérez",
        tipoDocumento: "rut",
        documento: "123456785",
        fechaNacimiento: null,
        prevision: { plan: null, tramo: null, institucion: null },
        direccion: null,
        comuna: null,
        telefono: null,
        email: null,
      },
      clinica: {
        nombre: "Clínica Sonrisa",
        razonSocial: "Sonrisa SpA",
        rut: "761234560",
        giro: null,
        direccionTributaria: null,
        comunaTributaria: null,
        direccion: null,
        telefono: null,
        tipoBoleta: null,
      },
      profesional: { nombre: "Dra. Ana Soto", registroSis: "123456", especialidad: null },
      campos: {},
      presupuesto: p,
    });
    const r = renderPlantilla(PLANTILLA_PRESUPUESTO, ctx, {
      firma: bloqueDeFirma({ nombre: "Dra. Ana Soto", registroSis: "123456", especialidad: null }),
    });
    const hoja: HojaParaPdf = {
      clinicName: "Clínica Sonrisa",
      lineasEncabezado: ["Sonrisa SpA · RUT 76.123.456-0", "Giro: Servicios odontológicos"],
      referencia: "Presupuesto P-2026-0099 · 22 de octubre de 2026",
      aviso: null,
      bloques: r.bloques,
      // Una imagen de 1×1 como data URL: el PDF la incrusta sin red.
      signatureUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      pie: "Presupuesto P-2026-0099 · Clínica Sonrisa",
    };
    const doc = await construirHojaPdf(hoja);
    const salida = doc.output();
    expect(salida.startsWith("%PDF-")).toBe(true);
    expect(salida).toContain(formatMoney(p.totalCents, "CLP").replace("$", ""));
    expect(salida).toContain("/Subtype /Image");
    const dir = process.env.DOCUMENTOS_PDF_DIR;
    if (dir) {
      writeFileSync(
        path.join(dir, nombreDeArchivoPresupuesto(p.numero)),
        Buffer.from(doc.output("arraybuffer")),
      );
    }
  });

  it("nombre del archivo sin tildes ni símbolos", () => {
    expect(nombreDeArchivoPresupuesto("P-2026-0012")).toBe("presupuesto-p-2026-0012.pdf");
    expect(nombreDeArchivoPresupuesto("Nº 12/ñ")).toBe("presupuesto-n-12-n.pdf");
  });
});

describe("correo al paciente (PLA-09, DOC-07)", () => {
  it("escapa el mensaje, respeta saltos y signos $, y lleva la baja en el pie", () => {
    const c = correoAlPaciente({
      appUrl: "https://esmalia.com",
      asunto: "Presupuesto P-1 de Clínica <Sonrisa>",
      mensaje: "Hola, Ana:\n\nEl total es $451.250 <b>sin</b> sorpresas.\nSegunda línea.",
      clinica: "Clínica Sonrisa",
      adjunto: "presupuesto-p-1.pdf",
      bajaUrl: "https://esmalia.com/correos/baja?token=abc",
    });
    expect(c.html).not.toContain("<b>sin</b>");
    expect(c.html).toContain("&lt;b&gt;sin&lt;/b&gt;");
    expect(c.html).toContain("$451.250");
    expect(c.html).toContain("sorpresas.<br>Segunda línea.");
    expect(c.html).toContain("https://esmalia.com/correos/baja?token=abc");
    expect(c.html).toContain("No quiero recibir más correos de Clínica Sonrisa");
    expect(c.text).toContain("presupuesto-p-1.pdf");
    expect(c.subject).toBe("Presupuesto P-1 de Clínica <Sonrisa>");
  });

  it("sin secreto de baja, el pie no inventa un enlace", () => {
    const c = correoAlPaciente({
      appUrl: "https://esmalia.com",
      asunto: "x",
      mensaje: "Hola",
      clinica: "C",
      adjunto: "a.pdf",
      bajaUrl: null,
    });
    expect(c.html).not.toContain("/correos/baja");
  });

  it("los textos por defecto saludan al tutor cuando el paciente es menor", () => {
    const t = textoCorreoPresupuesto({
      paciente: "Tomás Rojas",
      clinica: "Clínica Sonrisa",
      numero: "P-7",
      destinatario: "María González",
    });
    expect(t.asunto).toBe("Presupuesto P-7 de Clínica Sonrisa");
    expect(t.mensaje.startsWith("Hola, María:")).toBe(true);
    expect(t.mensaje).toContain("de Tomás Rojas");
    const d = textoCorreoDocumento({
      paciente: "Ana Pérez",
      clinica: "Clínica Sonrisa",
      titulo: "Certificado de atención",
      folio: "N.º 2026-0003",
    });
    expect(d.mensaje).toContain('"Certificado de atención" (N.º 2026-0003)');
    expect(d.mensaje.startsWith("Hola, Ana:")).toBe(true);
  });
});
