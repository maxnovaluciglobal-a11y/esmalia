import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { camposSinCompletar } from "@/lib/documentos/emitir.server";
import { leerBloques } from "@/lib/documentos/esquemas";
import { entradaDeHuella, huellaCorta, huellaDocumento } from "@/lib/documentos/huella";
import {
  LINEA_EN_BLANCO,
  SIN_VALOR,
  analizarPlantilla,
  bloqueDeFirma,
  bloquesAHtml,
  bloquesATexto,
  extraerVariables,
  folioDocumento,
  renderPlantilla,
} from "@/lib/documentos/motor";
import { armarReembolso, periodoValido } from "@/lib/documentos/reembolso";
import type { ContextoDocumento } from "@/lib/documentos/tipos";
import {
  construirContexto,
  contextoDeEjemplo,
  edadEnAnios,
  esVariableConocida,
  type DatosParaDocumento,
} from "@/lib/documentos/variables";

// Motor de plantillas y documentos (Ola 4 · DOC-01). Puro: sin red ni base.

const ctx = (valores: Record<string, string | null>): ContextoDocumento => ({ valores });

describe("render de variables", () => {
  it("reemplaza variables en español, con o sin espacios dentro de las llaves", () => {
    const r = renderPlantilla(
      "Certifico que {{paciente.nombre}}, RUT {{ paciente.rut }}, se atendió.",
      ctx({ "paciente.nombre": "Ana Pérez", "paciente.rut": "12.345.678-5" }),
    );
    expect(bloquesATexto(r.bloques)).toBe("Certifico que Ana Pérez, RUT 12.345.678-5, se atendió.");
    expect(r.variables).toEqual(["paciente.nombre", "paciente.rut"]);
    expect(r.faltantes).toEqual([]);
    expect(r.desconocidas).toEqual([]);
  });

  it("títulos, negrita, saltos de línea, párrafos y listas", () => {
    const r = renderPlantilla(
      [
        "# Certificado",
        "## Detalle",
        "**Paciente:** {{paciente.nombre}}",
        "**Edad:** {{paciente.edad}}",
        "",
        "Segundo párrafo.",
        "- uno",
        "- **dos**",
      ].join("\n"),
      ctx({ "paciente.nombre": "Ana", "paciente.edad": "36 años" }),
    );
    expect(r.bloques.map((b) => b.tipo)).toEqual([
      "titulo",
      "titulo",
      "parrafo",
      "parrafo",
      "lista",
    ]);
    expect(bloquesAHtml(r.bloques)).toBe(
      [
        "<h1>Certificado</h1>",
        "<h2>Detalle</h2>",
        "<p><strong>Paciente:</strong> Ana<br><strong>Edad:</strong> 36 años</p>",
        "<p>Segundo párrafo.</p>",
        "<ul><li>uno</li><li><strong>dos</strong></li></ul>",
      ].join("\n"),
    );
  });

  it("una variable dentro de negrita queda en negrita", () => {
    const r = renderPlantilla("**{{paciente.nombre}}**", ctx({ "paciente.nombre": "Ana" }));
    expect(bloquesAHtml(r.bloques)).toBe("<p><strong>Ana</strong></p>");
  });

  it("escapa el HTML de los valores y del texto de la plantilla", () => {
    const r = renderPlantilla(
      "<b>Hola</b> {{paciente.nombre}} & cía",
      ctx({ "paciente.nombre": '<img src=x onerror="alert(1)">' }),
    );
    const html = bloquesAHtml(r.bloques);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toBe(
      "<p>&lt;b&gt;Hola&lt;/b&gt; &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; cía</p>",
    );
  });

  it("sin dato: línea para completar a mano y queda en faltantes", () => {
    const r = renderPlantilla("RUT {{paciente.rut}}", ctx({ "paciente.rut": null }));
    expect(bloquesATexto(r.bloques)).toBe(`RUT ${LINEA_EN_BLANCO}`);
    expect(r.faltantes).toEqual(["paciente.rut"]);
    const tramo = r.bloques[0].tipo === "parrafo" ? r.bloques[0].tramos[1] : null;
    expect(tramo).toMatchObject({ faltante: true, variable: "paciente.rut" });
  });

  it("un campo opcional vacío imprime un guion y no falta", () => {
    const r = renderPlantilla("Obs: {{campo.observaciones}}", ctx({}));
    expect(bloquesATexto(r.bloques)).toBe(`Obs: ${SIN_VALOR}`);
    expect(r.faltantes).toEqual([]);
  });

  it("una variable desconocida se deja visible y se informa", () => {
    const r = renderPlantilla("Hola {{paciente.apodo}}", ctx({}));
    expect(bloquesATexto(r.bloques)).toBe("Hola {{paciente.apodo}}");
    expect(r.desconocidas).toEqual(["paciente.apodo"]);
    expect(r.faltantes).toEqual([]);
  });

  it("la variable de bloque se imprime como tabla, sola en su línea", () => {
    const ej = contextoDeEjemplo();
    const r = renderPlantilla("Antes\n{{reembolso.prestaciones}}\nDespués", ej);
    expect(r.bloques.map((b) => b.tipo)).toEqual(["parrafo", "tabla", "parrafo"]);
    const html = bloquesAHtml(r.bloques);
    expect(html).toContain('<th class="num">Monto pagado</th>');
    expect(html).toContain("<tfoot>");
  });

  it("agrega la firma al final con el registro de la Superintendencia de Salud", () => {
    const firma = bloqueDeFirma({
      nombre: " Dra. Ana Soto ",
      registroSis: "12345",
      especialidad: null,
    });
    const r = renderPlantilla("Texto", ctx({}), { firma });
    expect(r.bloques.at(-1)).toEqual({
      tipo: "firma",
      nombre: "Dra. Ana Soto",
      registro: "Registro Superintendencia de Salud N.º 12345",
      especialidad: null,
    });
    expect(bloquesAHtml(r.bloques)).toContain(
      '<div class="firma"><p>Dra. Ana Soto</p><p>Registro Superintendencia de Salud N.º 12345</p></div>',
    );
  });

  it("el HTML canónico es estable: mismo texto y contexto, mismo HTML", () => {
    const cuerpo = "# T\n\n{{paciente.nombre}} **{{fecha}}**\n- a\n{{reembolso.prestaciones}}";
    const a = bloquesAHtml(renderPlantilla(cuerpo, contextoDeEjemplo()).bloques);
    const b = bloquesAHtml(renderPlantilla(cuerpo, contextoDeEjemplo()).bloques);
    expect(a).toBe(b);
  });

  it("los bloques sobreviven ida y vuelta por JSON (lo que guarda la base)", () => {
    const r = renderPlantilla(
      "# T\n{{paciente.nombre}}\n- x\n{{reembolso.prestaciones}}",
      contextoDeEjemplo(),
      {
        firma: bloqueDeFirma({ nombre: "A", registroSis: null, especialidad: "Endodoncia" }),
      },
    );
    const guardados = JSON.parse(JSON.stringify(r.bloques));
    const leidos = leerBloques(guardados);
    expect(leidos).not.toBeNull();
    expect(bloquesAHtml(leidos!)).toBe(bloquesAHtml(r.bloques));
    expect(leerBloques([{ tipo: "script", src: "x" }])).toBeNull();
    expect(leerBloques("no es una lista")).toBeNull();
  });
});

describe("validación de plantillas", () => {
  it("acepta variables conocidas y campos propios", () => {
    const a = analizarPlantilla(
      "{{paciente.nombre}} {{campo.motivo}} {{campo.numero_ficha_isapre}}",
    );
    expect(a.problemas).toEqual([]);
    expect(a.campos).toEqual(["motivo", "numero_ficha_isapre"]);
  });

  it("rechaza variables desconocidas", () => {
    const a = analizarPlantilla("Hola {{paciente.apodo}}\n{{doctor.nombre}}");
    expect(a.desconocidas).toEqual(["paciente.apodo", "doctor.nombre"]);
    expect(a.problemas.map((p) => p.tipo)).toEqual(["desconocida", "desconocida"]);
    expect(a.problemas[1].linea).toBe(2);
  });

  it("rechaza variables mal escritas y llaves sin cerrar", () => {
    expect(analizarPlantilla("{{Paciente.Nombre}}").problemas[0].tipo).toBe("mal_escrita");
    expect(analizarPlantilla("{{paciente nombre}}").problemas[0].tipo).toBe("mal_escrita");
    expect(analizarPlantilla("{{paciente.nombre}").problemas[0].tipo).toBe("mal_escrita");
    expect(analizarPlantilla("paciente.nombre}}").problemas[0].tipo).toBe("mal_escrita");
  });

  it("una tabla no puede ir en medio de un párrafo", () => {
    const a = analizarPlantilla("Detalle: {{reembolso.prestaciones}}");
    expect(a.problemas.map((p) => p.tipo)).toEqual(["bloque_en_linea"]);
  });

  it("rechaza una plantilla vacía", () => {
    expect(analizarPlantilla("   \n").problemas[0].tipo).toBe("vacia");
  });

  it("extrae variables sin repetir, en orden", () => {
    expect(extraerVariables("{{a.b}} {{fecha}} {{a.b}}")).toEqual(["a.b", "fecha"]);
  });

  it("conoce las variables del brief", () => {
    for (const v of [
      "paciente.nombre",
      "paciente.rut",
      "paciente.prevision",
      "clinica.nombre",
      "clinica.rut",
      "clinica.razon_social",
      "clinica.giro",
      "profesional.nombre",
      "profesional.registro_sis",
      "fecha",
    ]) {
      expect(esVariableConocida(v), v).toBe(true);
    }
    expect(esVariableConocida("campo.Motivo")).toBe(false);
  });
});

describe("huella de integridad", () => {
  it("es sha256 de HTML + U+001F + huella de la firma (par del trigger de la base)", async () => {
    const html = "<p>Hola</p>";
    const firma = "a".repeat(64);
    const esperado = createHash("sha256").update(`${html}\u001f${firma}`, "utf8").digest("hex");
    expect(await huellaDocumento(html, firma)).toBe(esperado);
    const sinFirma = createHash("sha256").update(`${html}\u001f`, "utf8").digest("hex");
    expect(await huellaDocumento(html, null)).toBe(sinFirma);
    expect(entradaDeHuella("x", null)).toBe("x\u001f");
  });

  it("es estable y cambia con cualquier carácter", async () => {
    const a = await huellaDocumento("<p>Reposo 2 días</p>", null);
    expect(await huellaDocumento("<p>Reposo 2 días</p>", null)).toBe(a);
    expect(await huellaDocumento("<p>Reposo 3 días</p>", null)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaCorta(a, 8)).toBe(`${a.slice(0, 8)}…`);
  });
});

describe("contexto desde la ficha", () => {
  const datos: DatosParaDocumento = {
    zona: "America/Santiago",
    ahora: "2026-10-22T15:00:00Z",
    moneda: "CLP",
    paciente: {
      nombre: "Ana Pérez",
      tipoDocumento: "rut",
      documento: "123456785",
      fechaNacimiento: "1990-10-23",
      prevision: { plan: "fonasa", tramo: "B", institucion: null },
      direccion: "Av. Grecia 1234",
      comuna: " ",
      telefono: null,
      email: null,
    },
    clinica: {
      nombre: "Clínica Sonrisa",
      razonSocial: "Sonrisa SpA",
      rut: "761234560",
      giro: "Servicios odontológicos",
      direccionTributaria: "Av. Providencia 1234",
      comunaTributaria: "Providencia",
      direccion: null,
      telefono: null,
      tipoBoleta: "exenta",
    },
    profesional: { nombre: "Dra. Carolina Rodríguez", registroSis: "123456", especialidad: null },
    campos: { fecha_atencion: "2026-10-20", motivo: "Control", dias_reposo: "2" },
  };

  it("formatea RUT, edad, previsión, fechas y datos tributarios", () => {
    const { valores } = construirContexto(datos);
    expect(valores["paciente.rut"]).toBe("12.345.678-5");
    expect(valores["paciente.tipo_documento"]).toBe("RUT");
    expect(valores["paciente.edad"]).toBe("35 años");
    expect(valores["paciente.prevision"]).toBe("Fonasa B");
    expect(valores["paciente.comuna"]).toBeNull();
    expect(valores["clinica.rut"]).toBe("76.123.456-0");
    expect(valores["clinica.direccion_tributaria"]).toBe("Av. Providencia 1234, Providencia");
    expect(valores["clinica.tipo_boleta"]).toBe("Boleta exenta");
    expect(valores["profesional.registro_sis"]).toBe("123456");
    expect(valores.fecha).toBe("22 de octubre de 2026");
    expect(valores["campo.fecha_atencion"]).toBe("20 de octubre de 2026");
    expect(valores["campo.dias_reposo"]).toBe("2");
  });

  it("un pasaporte no se formatea como RUT", () => {
    const { valores } = construirContexto({
      ...datos,
      paciente: { ...datos.paciente, tipoDocumento: "pasaporte", documento: "AB123" },
    });
    expect(valores["paciente.rut"]).toBe("AB123");
    expect(valores["paciente.tipo_documento"]).toBe("Pasaporte");
  });

  it("edad en años cumplidos", () => {
    expect(edadEnAnios("1990-10-23", "2026-10-22")).toBe(35);
    expect(edadEnAnios("1990-10-22", "2026-10-22")).toBe(36);
    expect(edadEnAnios(null, "2026-10-22")).toBeNull();
  });

  it("campos obligatorios sin completar, con su etiqueta", () => {
    expect(camposSinCompletar(["motivo", "observaciones", "dias_reposo"], { motivo: " " })).toEqual(
      ["Motivo", "Días de reposo"],
    );
  });

  it("folio con año y número de 4 cifras", () => {
    expect(folioDocumento(2026, 7)).toBe("N.º 2026-0007");
  });
});

describe("reembolso de seguro complementario (MKT-04)", () => {
  const zona = "America/Santiago";
  const prestaciones = [
    // 1-sep 02:00 UTC = 31-ago 22:00 en Santiago: queda fuera del período.
    {
      id: "a",
      completadaEn: "2026-09-01T02:00:00Z",
      nombre: "Destartraje",
      pieza: null,
      codigoFonasa: "2701004",
    },
    {
      id: "b",
      completadaEn: "2026-09-15T15:00:00Z",
      nombre: "Resina",
      pieza: 46,
      codigoFonasa: null,
    },
    {
      id: "c",
      completadaEn: "2026-09-05T15:00:00Z",
      nombre: "Endodoncia",
      pieza: 36,
      codigoFonasa: " ",
    },
    { id: "d", completadaEn: null, nombre: "Sin fecha", pieza: null, codigoFonasa: null },
  ];
  const pagos = [
    { treatmentItemId: "b", montoCents: 30000, pagadoEn: "2026-09-15T15:00:00Z", reversado: false },
    { treatmentItemId: "b", montoCents: 20000, pagadoEn: "2026-10-01T15:00:00Z", reversado: false },
    { treatmentItemId: "c", montoCents: 99999, pagadoEn: "2026-09-05T15:00:00Z", reversado: true },
    {
      treatmentItemId: null,
      montoCents: 10000,
      pagadoEn: "2026-09-20T15:00:00Z",
      reversado: false,
    },
  ];

  it("lista lo realizado en el período (día de la clínica), ordenado, con lo pagado por prestación", () => {
    const r = armarReembolso({
      prestaciones,
      pagos,
      desde: "2026-09-01",
      hasta: "2026-09-30",
      zona,
    });
    expect(r.filas).toEqual([
      {
        fecha: "2026-09-05",
        prestacion: "Endodoncia",
        pieza: 36,
        codigoFonasa: null,
        pagadoCents: null,
      },
      {
        fecha: "2026-09-15",
        prestacion: "Resina",
        pieza: 46,
        codigoFonasa: null,
        pagadoCents: 50000,
      },
    ]);
    // Total del período: 30.000 imputado + 10.000 al plan; el reversado y el de octubre no.
    expect(r.totalPagadoCents).toBe(40000);
  });

  it("valida el período", () => {
    expect(periodoValido("2026-09-01", "2026-09-30")).toBe(true);
    expect(periodoValido("2026-09-30", "2026-09-01")).toBe(false);
    expect(periodoValido("", "2026-09-01")).toBe(false);
  });

  it("la tabla imprime código Fonasa y montos con la moneda de la clínica", () => {
    const r = armarReembolso({
      prestaciones,
      pagos,
      desde: "2026-08-01",
      hasta: "2026-09-30",
      zona,
    });
    const { tablas } = construirContexto({
      zona,
      ahora: "2026-10-22T15:00:00Z",
      moneda: "CLP",
      paciente: {
        nombre: "Ana",
        tipoDocumento: null,
        documento: null,
        fechaNacimiento: null,
        prevision: { plan: null, tramo: null, institucion: null },
        direccion: null,
        comuna: null,
        telefono: null,
        email: null,
      },
      clinica: {
        nombre: "C",
        razonSocial: null,
        rut: null,
        giro: null,
        direccionTributaria: null,
        comunaTributaria: null,
        direccion: null,
        telefono: null,
        tipoBoleta: null,
      },
      profesional: null,
      reembolso: r,
      campos: { periodo_desde: "2026-08-01", periodo_hasta: "2026-09-30" },
    });
    const tabla = tablas["reembolso.prestaciones"];
    expect(tabla.filas[0]).toEqual(["31 ago 2026", "Destartraje", "2701004", "—"]);
    expect(tabla.filas[2]).toEqual(["15 sept 2026", "Resina (pieza 46)", "—", "$50.000"]);
    expect(tabla.pie).toEqual(["", "", "Total pagado en el período", "$40.000"]);
  });
});
