import { describe, expect, it } from "vitest";

import { atiendePacientes } from "@/lib/clinic-operations/cita-formulario";
import { minutosDeHHMM, type ContextoSugerencia } from "@/lib/clinic-operations/disponibilidad";
import {
  horasDisponibles,
  horaSigueLibre,
  type EntradaHoras,
} from "@/lib/reserva/disponibilidad-reserva";
import {
  enlaceGestionCita,
  tokenGestionCita,
  tokenRecallReserva,
  verificarTokenGestionCita,
  verificarTokenRecall,
} from "@/lib/reserva/enlace-cita.server";
import { momentoLocal, partirHoraLocal } from "@/lib/reserva/hora-local";
import { codigoLegible, lineaDeReserva } from "@/lib/reserva/mensajes";
import { matrizQr, pathSvgQr, snippetWidget } from "@/lib/reserva/qr";
import {
  enmascararEmail,
  mensajeDeReserva,
  normalizarSlug,
  problemaDeSlug,
  rutDeReserva,
  slugsDeProfesionales,
  SolicitudReservaSchema,
  textoCanonicoSolicitud,
} from "@/lib/reserva/reserva";
import { validarBusquedaReserva } from "@/lib/reserva/busqueda-reserva";
import { frameAncestorsPara } from "@/router";

const CITA = "6d61d4bb-5e0d-467a-a383-bf16b3841917";
const CLINICA = "20cea989-de9b-4a3e-852a-31347dc3fe83";

describe("slug de la reserva", () => {
  it("normaliza tildes, eñes y espacios", () => {
    expect(normalizarSlug("Clínica Dental Ñuñoa ")).toBe("clinica-dental-nunoa");
    expect(normalizarSlug("--Sonrisa  & Co--")).toBe("sonrisa-co");
  });
  it("explica un slug inválido", () => {
    expect(problemaDeSlug("ab")).toMatch(/al menos 3/);
    expect(problemaDeSlug("-hola")).toMatch(/guiones/);
    expect(problemaDeSlug("Hola")).toMatch(/minúsculas/);
    expect(problemaDeSlug("clinica-sonrisa")).toBeNull();
  });
  it("slug por profesional sin choques", () => {
    const m = slugsDeProfesionales([
      { id: "aaaa1111", nombre: "Dra. Paz Rojas" },
      { id: "bbbb2222", nombre: "Dra. Paz Rojas" },
      { id: "cccc3333", nombre: "Dr. Tomás Vidal" },
    ]);
    expect(m.get("aaaa1111")).toBe("dra-paz-rojas");
    expect(m.get("bbbb2222")).toBe("dra-paz-rojas-bbbb");
    expect(m.get("cccc3333")).toBe("dr-tomas-vidal");
  });
});

describe("datos del paciente y solicitud", () => {
  it("RUT opcional y validado", () => {
    expect(rutDeReserva("")).toBeNull();
    expect(rutDeReserva("123456785")).toBe("12.345.678-5");
    expect(rutDeReserva("12.345.678-9")).toBe("invalido");
  });
  it("enmascara el correo", () => {
    expect(enmascararEmail("JPerez@Gmail.com")).toBe("j•••@gmail.com");
  });
  it("valida la solicitud y la trampa de bots queda vacía por defecto", () => {
    const s = SolicitudReservaSchema.parse({
      slug: "clinica-demo",
      sucursalId: CLINICA,
      profesionalId: CITA,
      motivo: { tipo: "tipo", id: CITA },
      inicio: "2026-10-28T09:00",
      nombre: "  Ana  Pérez ",
      email: "ANA@example.com",
      telefono: "912345678",
    });
    expect(s.sitioWeb).toBe("");
    expect(() => SolicitudReservaSchema.parse({ ...s, email: "sin-arroba" })).toThrow();
    // El texto canónico ignora mayúsculas del correo y espacios del nombre.
    const t1 = textoCanonicoSolicitud(s, "+56912345678", null);
    const t2 = textoCanonicoSolicitud(
      { ...s, nombre: "Ana Pérez", email: "ana@example.com" },
      "+56912345678",
      null,
    );
    expect(t1).toBe(t2);
    // Cambiar el horario cambia la solicitud (el código queda atado a ella).
    expect(
      textoCanonicoSolicitud({ ...s, inicio: "2026-10-28T09:15" }, "+56912345678", null),
    ).not.toBe(t1);
  });
  it("mensajes conocidos y uno genérico", () => {
    expect(mensajeDeReserva("ocupado")).toMatch(/horario/);
    expect(mensajeDeReserva("cualquier-cosa")).toBe(mensajeDeReserva("invalida"));
  });
});

describe("link firmado de la cita (contrato enlaceGestionCita)", () => {
  it("arma una URL absoluta /mi-cita/<token> de forma síncrona", () => {
    const url = enlaceGestionCita({ appointmentId: CITA, clinicId: CLINICA });
    expect(typeof url).toBe("string");
    expect(url).toMatch(/^https?:\/\/[^/]+\/mi-cita\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const token = url.split("/mi-cita/")[1];
    const v = verificarTokenGestionCita(token);
    expect(v.ok && v.cita).toMatchObject({ appointmentId: CITA, clinicId: CLINICA });
  });
  it("rechaza un token manipulado, vencido o de otro propósito", () => {
    const token = tokenGestionCita({ appointmentId: CITA, clinicId: CLINICA });
    const [cuerpo, firma] = token.split(".");
    const otro = Buffer.from(
      JSON.stringify({ v: 1, p: "mi-cita", a: CITA, c: CITA, e: 9_999_999_999 }),
    ).toString("base64url");
    expect(verificarTokenGestionCita(`${otro}.${firma}`).ok).toBe(false);
    // Se cambia el PRIMER carácter: el último de un base64url de 32 bytes lleva
    // bits de relleno y cambiarlo puede no alterar la firma (test intermitente).
    const adulterada = `${firma[0] === "A" ? "B" : "A"}${firma.slice(1)}`;
    expect(verificarTokenGestionCita(`${cuerpo}.${adulterada}`).ok).toBe(false);
    const vencido = tokenGestionCita({
      appointmentId: CITA,
      clinicId: CLINICA,
      expiraEn: new Date(Date.now() - 1000),
    });
    expect(verificarTokenGestionCita(vencido)).toEqual({ ok: false, motivo: "vencido" });
    // El token del recall no abre una cita, ni al revés.
    const recall = tokenRecallReserva({ patientId: CITA, clinicId: CLINICA });
    expect(verificarTokenGestionCita(recall).ok).toBe(false);
    expect(verificarTokenRecall(token).ok).toBe(false);
    expect(verificarTokenRecall(recall)).toEqual({ ok: true, patientId: CITA, clinicId: CLINICA });
    expect(verificarTokenGestionCita("basura").ok).toBe(false);
  });
  it("no guarda nada en claro: el token no tiene datos del paciente", () => {
    const token = tokenGestionCita({ appointmentId: CITA, clinicId: CLINICA });
    const datos = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    expect(Object.keys(datos).sort()).toEqual(["a", "c", "e", "p", "v"]);
  });
});

describe("horas disponibles (motor de la agenda)", () => {
  // 2026-10-28 es miércoles.
  const FECHA = "2026-10-28";
  const base = (over: Partial<ContextoSugerencia> = {}): ContextoSugerencia => ({
    profesionales: [
      { id: "p1", sucursalId: "s1", atiende: true },
      { id: "p2", sucursalId: "s1", atiende: true },
    ],
    horarios: {
      p1: [{ dayOfWeek: 3, startTime: "09:00", endTime: "11:00", branchId: "s1" }],
      p2: [{ dayOfWeek: 3, startTime: "10:00", endTime: "12:00", branchId: "s1" }],
    },
    horarioSucursal: { s1: [] },
    citas: [],
    excepciones: [],
    paso: 30,
    ...over,
  });
  const entrada = (over: Partial<EntradaHoras> = {}): EntradaHoras => ({
    ctx: base(),
    sucursalId: "s1",
    profesionalIds: ["p1"],
    duracion: 30,
    desde: FECHA,
    dias: 1,
    minimo: { fecha: "2026-10-27", minutos: 0 },
    ultimoDia: "2026-11-30",
    boxes: [],
    ocupacionBoxes: [],
    boxPorDefecto: {},
    ...over,
  });
  const horas = (e: EntradaHoras) => horasDisponibles(e)[0].horas.map((h) => h.inicio);
  const m = minutosDeHHMM;

  it("ofrece el horario declarado del profesional, por paso", () => {
    expect(horas(entrada())).toEqual([m("09:00"), m("09:30"), m("10:00"), m("10:30")]);
  });
  it("respeta la duración del motivo", () => {
    expect(horas(entrada({ duracion: 60 }))).toEqual([m("09:00"), m("09:30"), m("10:00")]);
  });
  it("no ofrece encima de una cita existente (salvo la propia al reagendar)", () => {
    const ctx = base({
      citas: [
        {
          id: "c1",
          profesionalId: "p1",
          sucursalId: "s1",
          fecha: FECHA,
          inicio: m("09:30"),
          duracion: 30,
          estado: "tentativa",
        },
      ],
    });
    expect(horas(entrada({ ctx }))).not.toContain(m("09:30"));
    expect(horas(entrada({ ctx, ignorarCitaId: "c1" }))).toContain(m("09:30"));
  });
  it("respeta bloqueos y la anticipación mínima", () => {
    const ctx = base({
      excepciones: [
        {
          id: "b1",
          tipo: "bloqueo",
          motivo: "almuerzo",
          nota: null,
          profesionalId: "p1",
          sucursalId: null,
          boxId: null,
          boxNombre: null,
          inicio: `${FECHA}T10:00`,
          fin: `${FECHA}T11:00`,
          repetirSemanal: false,
          repetirHasta: null,
        },
      ],
    });
    expect(horas(entrada({ ctx }))).toEqual([m("09:00"), m("09:30")]);
    expect(horas(entrada({ minimo: { fecha: FECHA, minutos: m("10:00") } }))).toEqual([
      m("10:00"),
      m("10:30"),
    ]);
  });
  it("sin horario declarado de nadie no ofrece nada (no inventa jornada)", () => {
    const ctx = base({ horarios: {}, horarioSucursal: { s1: [] } });
    expect(horas(entrada({ ctx }))).toEqual([]);
  });
  it("respeta el horario de la sucursal si el profesional no declaró", () => {
    const ctx = base({
      horarios: {},
      horarioSucursal: { s1: [{ dayOfWeek: 3, startTime: "15:00", endTime: "16:00" }] },
    });
    expect(horas(entrada({ ctx }))).toEqual([m("15:00"), m("15:30")]);
  });
  it("con 'cualquiera' une profesionales y asigna el primero libre", () => {
    const dia = horasDisponibles(entrada({ profesionalIds: ["p1", "p2"] }))[0];
    expect(dia.horas.map((h) => [h.inicio, h.profesionalId])).toEqual([
      [m("09:00"), "p1"],
      [m("09:30"), "p1"],
      [m("10:00"), "p1"],
      [m("10:30"), "p1"],
      [m("11:00"), "p2"],
      [m("11:30"), "p2"],
    ]);
  });
  it("quien no atiende pacientes no ofrece horas", () => {
    const ctx = base({ profesionales: [{ id: "p1", sucursalId: "s1", atiende: false }] });
    expect(horas(entrada({ ctx }))).toEqual([]);
  });
  it("necesita un box libre si la sucursal tiene boxes (el del profesional primero)", () => {
    const boxes = [
      { id: "b1", sucursalId: "s1" },
      { id: "b2", sucursalId: "s1" },
    ];
    const libre = horasDisponibles(entrada({ boxes, boxPorDefecto: { p1: "b2" } }))[0].horas[0];
    expect(libre.boxId).toBe("b2");
    const ocupacionBoxes = ["b1", "b2"].map((boxId) => ({
      boxId,
      fecha: FECHA,
      inicio: m("09:00"),
      duracion: 30,
    }));
    expect(horas(entrada({ boxes, ocupacionBoxes }))).not.toContain(m("09:00"));
  });
  it("no pasa del último día reservable y vuelve a mirar una hora exacta", () => {
    expect(horasDisponibles(entrada({ ultimoDia: "2026-10-27" }))).toHaveLength(0);
    expect(horaSigueLibre(entrada(), FECHA, m("09:00"), "p1")?.inicio).toBe(m("09:00"));
    expect(horaSigueLibre(entrada(), FECHA, m("13:00"), "p1")).toBeNull();
  });
});

describe("hora local", () => {
  it("convierte un instante a la hora de pared de la sucursal", () => {
    expect(momentoLocal("2026-10-28T12:00:00Z", "America/Santiago")).toEqual({
      fecha: "2026-10-28",
      minutos: m("09:00"),
    });
    expect(partirHoraLocal("2026-10-28T09:30")).toEqual({
      fecha: "2026-10-28",
      minutos: m("09:30"),
    });
    expect(partirHoraLocal("2026-10-28 09:30")).toBeNull();
  });
  const m = minutosDeHHMM;
});

describe("widget, QR, recall y marco embebido", () => {
  it("snippet con iframe embed=1 y texto escapado", () => {
    const s = snippetWidget("https://esmalia.com/reservar/x", 'Clínica "A" <b>');
    expect(s).toContain('src="https://esmalia.com/reservar/x?embed=1"');
    expect(s).not.toContain("<b>");
    expect(s).toContain("&lt;b&gt;");
  });
  it("QR con módulos y margen", () => {
    const mat = matrizQr("https://esmalia.com/reservar/clinica-demo");
    expect(mat.length).toBeGreaterThanOrEqual(21);
    const { d, lado } = pathSvgQr(mat);
    expect(lado).toBe(mat.length + 8);
    expect(d.startsWith("M")).toBe(true);
  });
  it("solo la reserva acepta marcos de otros sitios", () => {
    expect(frameAncestorsPara("/reservar/clinica-demo")).toContain("https:");
    expect(frameAncestorsPara("/reservar/clinica-demo/dra-paz")).toContain("https:");
    expect(frameAncestorsPara("/mi-cita/abc")).toBe("frame-ancestors 'self'");
    expect(frameAncestorsPara("/agenda")).toBe("frame-ancestors 'self'");
  });
  it("búsqueda de la página y textos", () => {
    expect(validarBusquedaReserva({ embed: "1", r: "tok" })).toEqual({ embed: true, r: "tok" });
    expect(validarBusquedaReserva({ embed: "no" })).toEqual({});
    expect(codigoLegible("123456")).toBe("123 456");
    expect(lineaDeReserva("https://x/reservar/y")).toContain("https://x/reservar/y");
  });
});

describe("EQU-04 · Atiende pacientes", () => {
  it("la marca manda sobre el rol", () => {
    expect(atiendePacientes("reception")).toBe(false);
    expect(atiendePacientes("reception", true)).toBe(true);
    expect(atiendePacientes("dentist", false)).toBe(false);
    expect(atiendePacientes(null, null)).toBe(true);
  });
});
