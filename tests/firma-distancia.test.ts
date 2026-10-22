import { describe, expect, it } from "vitest";

import { bloquesAHtml, renderPlantilla } from "@/lib/documentos/motor";
import { contextoDeEjemplo } from "@/lib/documentos/variables";
import {
  estadoDeSolicitud,
  estaAbierta,
  sePuedeCancelar,
  sePuedeReenviar,
  textoDeAceptacion,
} from "@/lib/firma-distancia/estado";
import {
  entradaDeEvidencia,
  fechaUtcDeEvidencia,
  filasDeConstancia,
  hojaDeCopiaFirmada,
  huellaDeEvidencia,
  leerHojaGuardada,
  nombreDeCopiaFirmada,
  type Constancia,
} from "@/lib/firma-distancia/evidencia";
import {
  codigoLegible,
  correoCodigoDeFirma,
  correoLinkDeFirma,
  textoWhatsAppDeFirma,
} from "@/lib/firma-distancia/mensajes";
import {
  esTokenValido,
  generarCodigo,
  generarSecreto,
  huellaDeCodigo,
  huellaDeSecreto,
  normalizarCodigo,
} from "@/lib/firma-distancia/token";

/**
 * Firma a distancia (Ola 5 · DOC-05), lógica pura: token, código, estados,
 * evidencia, copia firmada y textos que salen al paciente. El par en la base
 * (huella de la evidencia, un solo uso, intentos) está en
 * tests/firma-distancia-db.test.ts.
 */

describe("token, sesión y código", () => {
  it("el token es de 256 bits en base64url y no se repite", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generarSecreto();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(esTokenValido(t)).toBe(true);
      vistos.add(t);
    }
    expect(vistos.size).toBe(200);
  });

  it("rechaza tokens con otra forma (un JWT del portal, rutas, vacíos)", () => {
    for (const malo of [
      "",
      "abc",
      "eyJhbGciOiJIUzI1NiJ9.x.y",
      "../../etc/passwd",
      "a".repeat(44),
    ]) {
      expect(esTokenValido(malo)).toBe(false);
    }
  });

  it("la base guarda el sha256 del token, nunca el token", async () => {
    const t = generarSecreto();
    const h = await huellaDeSecreto(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(await huellaDeSecreto(t)).toBe(h);
  });

  it("el código tiene 6 dígitos y cubre todo el rango", () => {
    const primeros = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generarCodigo();
      expect(c).toMatch(/^\d{6}$/);
      primeros.add(c[0]);
    }
    // Con 2000 muestras aparecen los 10 primeros dígitos (sin sesgo hacia el 0-4).
    expect(primeros.size).toBe(10);
  });

  it("normaliza lo que escribe el paciente", () => {
    expect(normalizarCodigo(" 123 456 ")).toBe("123456");
    expect(normalizarCodigo("123-456")).toBe("123456");
    expect(normalizarCodigo("12345")).toBeNull();
    expect(normalizarCodigo("12a456")).toBeNull();
    expect(codigoLegible("123456")).toBe("123 456");
  });

  it("la huella del código está atada a la solicitud", async () => {
    const a = await huellaDeSecreto(generarSecreto());
    const b = await huellaDeSecreto(generarSecreto());
    expect(await huellaDeCodigo(a, "123456")).not.toBe(await huellaDeCodigo(b, "123456"));
    expect(await huellaDeCodigo(a, "123456")).toBe(await huellaDeCodigo(a, "123456"));
  });
});

describe("estado de la solicitud", () => {
  const ahora = new Date("2026-10-22T12:00:00Z");
  it("una abierta vencida se ve vencida; las cerradas no cambian", () => {
    expect(estadoDeSolicitud({ status: "enviada", expiresAt: "2026-10-22T11:59:59Z" }, ahora)).toBe(
      "vencida",
    );
    expect(estadoDeSolicitud({ status: "abierta", expiresAt: "2026-10-25T12:00:00Z" }, ahora)).toBe(
      "abierta",
    );
    expect(estadoDeSolicitud({ status: "firmada", expiresAt: "2026-10-01T00:00:00Z" }, ahora)).toBe(
      "firmada",
    );
    expect(estadoDeSolicitud({ status: "rara", expiresAt: "2026-10-25T00:00:00Z" }, ahora)).toBe(
      "cancelada",
    );
  });

  it("reenviar sirve para abiertas y vencidas; cancelar solo para abiertas", () => {
    expect(sePuedeReenviar("vencida")).toBe(true);
    expect(sePuedeReenviar("firmada")).toBe(false);
    expect(sePuedeCancelar("vencida")).toBe(false);
    expect(sePuedeCancelar("enviada")).toBe(true);
    expect(estaAbierta("reemplazada")).toBe(false);
  });

  it("la declaración nombra lo que se acepta y la ley", () => {
    expect(textoDeAceptacion({ tipo: "presupuesto", titulo: "Presupuesto P-12" })).toMatch(
      /acepto completo.*Ley 19\.799/,
    );
    expect(textoDeAceptacion({ tipo: "documento", titulo: "Consentimiento" })).toMatch(
      /"Consentimiento" y lo acepto/,
    );
  });
});

function constancia(extra: Partial<Constancia> = {}): Constancia {
  return {
    id: "6f1c0d7e-1b7a-4a0e-9a64-2a3c1d0e9b11",
    documentSha256: "d".repeat(64),
    signerRole: "paciente",
    signerName: "Ana Pérez Soto",
    signerRutSha256: "e".repeat(64),
    signerRutMasked: "•••6785",
    codeChannel: "correo",
    codeRecipientMasked: "a•••@paciente.test",
    signedAt: "2026-10-22T18:04:05.123+00:00",
    signedIp: "203.0.113.7",
    signedUserAgent: "Mozilla/5.0 (iPhone)",
    acceptedText: "Leí completo el documento y lo acepto.",
    signatureSha256: null,
    linkChannel: "whatsapp",
    signedAtLocal: "22-10-2026 15:04:05 (America/Santiago)",
    evidenceSha256: "f".repeat(64),
    patientName: "Ana Pérez Soto",
    timezone: "America/Santiago",
    ...extra,
  };
}

describe("evidencia", () => {
  it("la fecha va en UTC con milisegundos, como la formatea la base", () => {
    expect(fechaUtcDeEvidencia("2026-10-22T18:04:05.123+00:00")).toBe("2026-10-22T18:04:05.123Z");
    expect(fechaUtcDeEvidencia("2026-10-22T15:04:05.123-03:00")).toBe("2026-10-22T18:04:05.123Z");
  });

  it("la entrada separa los campos con U+001F y un dato ausente cuenta vacío", () => {
    const partes = entradaDeEvidencia(constancia()).split("\u001f");
    expect(partes).toHaveLength(13);
    expect(partes[0]).toBe("6f1c0d7e-1b7a-4a0e-9a64-2a3c1d0e9b11");
    expect(partes[8]).toBe("2026-10-22T18:04:05.123Z");
    expect(partes[12]).toBe("");
  });

  it("cambiar cualquier dato cambia la huella", async () => {
    const base = await huellaDeEvidencia(constancia());
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    for (const cambio of [
      { signerName: "Otra Persona" },
      { signedIp: "198.51.100.1" },
      { signedAt: "2026-10-22T18:04:05.124+00:00" },
      { documentSha256: "0".repeat(64) },
      { signatureSha256: "1".repeat(64) },
      { acceptedText: "Otro texto aceptado." },
    ] satisfies Partial<Constancia>[]) {
      expect(await huellaDeEvidencia(constancia(cambio))).not.toBe(base);
    }
  });

  it("la constancia muestra lo que pide la ley y la huella", () => {
    const filas = new Map(filasDeConstancia(constancia({ signerRole: "tutor" })));
    expect(filas.get("En calidad de")).toBe("Tutor o representante legal de Ana Pérez Soto");
    expect(filas.get("RUT verificado")).toBe("•••6785");
    expect(filas.get("Fecha y hora (UTC)")).toBe("2026-10-22T18:04:05.123Z");
    expect(filas.get("Dirección IP")).toBe("203.0.113.7");
    expect(filas.get("Huella SHA-256 de la evidencia")).toBe("f".repeat(64));
    expect(filas.get("Huella SHA-256 de la firma manuscrita")).toBe("Sin firma manuscrita");
  });
});

describe("copia firmada", () => {
  const bloques = renderPlantilla(
    "# Consentimiento informado\nYo, {{paciente.nombre}}, acepto la exodoncia.",
    contextoDeEjemplo(),
  ).bloques;
  const sheet = {
    clinicName: "Clínica Sonrisa",
    lineasEncabezado: ["Sonrisa SpA · RUT 76.123.456-7"],
    referencia: "N.º 2026-0007 · Emitido el 22 oct 2026",
    pie: "N.º 2026-0007",
  };

  it("lee la hoja guardada y descarta una con otra forma", () => {
    expect(leerHojaGuardada(sheet)).toEqual(sheet);
    expect(leerHojaGuardada({ clinicName: 1 })).toBeNull();
  });

  it("agrega la constancia y la firma del paciente al documento", () => {
    const h = hojaDeCopiaFirmada({ sheet, bloques }, constancia(), {
      firmaProfesionalUrl: null,
      firmaPacienteUrl: null,
    });
    expect(h.bloques).toEqual(bloques);
    expect(bloquesAHtml(h.bloquesFinales ?? [])).toContain(
      "Constancia de firma electrónica simple",
    );
    expect(h.pie).toMatch(/Firmado por el paciente · Evidencia SHA-256 ffff/);
    expect(h.firmaPaciente?.nombre).toBe("Ana Pérez Soto");
    expect(h.firmaPaciente?.detalle).toBe("Paciente · RUT •••6785");
  });

  it("arma el PDF (también en el servidor)", async () => {
    const { construirHojaPdf } = await import("@/lib/documentos/pdf");
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const doc = await construirHojaPdf(
      hojaDeCopiaFirmada({ sheet, bloques }, constancia(), {
        firmaProfesionalUrl: null,
        firmaPacienteUrl: png,
      }),
    );
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("nombre del archivo sin tildes ni espacios, con la fecha de la clínica", () => {
    expect(
      nombreDeCopiaFirmada("Consentimiento informado", "2026-10-23T02:00:00Z", "America/Santiago"),
    ).toBe("copia-firmada-consentimiento-informado-2026-10-22.pdf");
  });
});

describe("lo que sale al paciente no lleva datos clínicos", () => {
  const url = `https://esmalia.com/firmar/${"A".repeat(43)}`;

  it("WhatsApp: saludo, clínica, link y vencimiento", () => {
    const t = textoWhatsAppDeFirma({ nombre: "Ana Pérez", clinica: "Clínica Sonrisa", url });
    expect(t).toContain("Hola, Ana.");
    expect(t).toContain(url);
    expect(t).toContain("72 horas");
    expect(t).not.toMatch(/consentimiento|presupuesto|exodoncia/i);
  });

  it("correo del link: botón y baja, sin el nombre del documento", () => {
    const c = correoLinkDeFirma({
      appUrl: "https://esmalia.com",
      clinica: "Clínica Sonrisa",
      nombre: "Ana",
      url,
      bajaUrl: "https://esmalia.com/correos/baja?t=x",
    });
    expect(c.subject).toBe("Clínica Sonrisa te pide una firma");
    expect(c.html).toContain(url);
    expect(c.html).toContain("No quiero recibir más correos");
    expect(c.text).not.toMatch(/consentimiento|exodoncia/i);
  });

  it("correo del código: el código legible y sin link de firma", () => {
    const c = correoCodigoDeFirma({
      appUrl: "https://esmalia.com",
      clinica: "Clínica Sonrisa",
      nombre: "Ana",
      codigo: "042517",
    });
    expect(c.subject).toBe("Tu código para firmar: 042 517");
    expect(c.text).toContain("042 517");
    expect(c.html).not.toContain("/firmar/");
  });
});
