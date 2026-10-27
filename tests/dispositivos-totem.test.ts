import { describe, expect, it } from "vitest";

import { dispositivoDesdeFila } from "@/lib/dispositivos/dispositivo.server";
import {
  ALFABETO_CODIGO,
  estadoDispositivo,
  etiquetaDeSala,
  formatearCodigoVinculacion,
  generarCodigoVinculacion,
  huellaDeCodigo,
  inicialesDe,
  nombreCortoDe,
  normalizarCodigoVinculacion,
  ultimoUsoLegible,
} from "@/lib/dispositivos/dispositivos";
import {
  actualYSiguiente,
  esDiaYMesPosible,
  mensajeDeTotem,
  normalizarVerificacion,
  type CitaDeBox,
} from "@/lib/totem/totem";

/**
 * Ola 14 · Dispositivos y tótem (AUT-01 a AUT-06): lógica pura, sin base.
 */

describe("código de vinculación", () => {
  it("tiene 8 caracteres del alfabeto sin ambiguos", () => {
    for (let i = 0; i < 200; i++) {
      const c = generarCodigoVinculacion();
      expect(c).toHaveLength(8);
      for (const ch of c) expect(ALFABETO_CODIGO).toContain(ch);
    }
    expect(ALFABETO_CODIGO).not.toMatch(/[01IOL]/);
  });

  it("se normaliza como lo escribe una persona y rechaza lo que no puede ser", () => {
    expect(normalizarCodigoVinculacion("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizarCodigoVinculacion(" ab cd ef gh ")).toBe("ABCDEFGH");
    expect(normalizarCodigoVinculacion("ABCD-EFG")).toBeNull();
    expect(normalizarCodigoVinculacion("ABCD-EFG0")).toBeNull(); // 0 no existe
    expect(normalizarCodigoVinculacion(42)).toBeNull();
    expect(formatearCodigoVinculacion("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  it("la huella es estable, hexadecimal y distinta del código", async () => {
    const h = await huellaDeCodigo("ABCDEFGH");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await huellaDeCodigo("ABCDEFGH")).toBe(h);
    expect(await huellaDeCodigo("ABCDEFGJ")).not.toBe(h);
  });
});

describe("estado y último uso del dispositivo", () => {
  const ahora = new Date("2026-11-10T12:00:00Z");
  it("revocado manda; un código vigente se muestra; si no, vinculado o no", () => {
    expect(estadoDispositivo({ revocado: true, vinculado: true, codigoVenceEn: null }, ahora)).toBe(
      "revocado",
    );
    expect(
      estadoDispositivo(
        { revocado: false, vinculado: true, codigoVenceEn: "2026-11-10T12:05:00Z" },
        ahora,
      ),
    ).toBe("codigo_vigente");
    expect(
      estadoDispositivo(
        { revocado: false, vinculado: true, codigoVenceEn: "2026-11-10T11:55:00Z" },
        ahora,
      ),
    ).toBe("vinculado");
    expect(
      estadoDispositivo({ revocado: false, vinculado: false, codigoVenceEn: null }, ahora),
    ).toBe("sin_vincular");
  });

  it("último uso legible", () => {
    expect(ultimoUsoLegible(null, ahora)).toBe("Nunca");
    expect(ultimoUsoLegible("2026-11-10T11:59:30Z", ahora)).toBe("Recién");
    expect(ultimoUsoLegible("2026-11-10T11:30:00Z", ahora)).toBe("Hace 30 min");
    expect(ultimoUsoLegible("2026-11-10T09:00:00Z", ahora)).toBe("Hace 3 h");
    expect(ultimoUsoLegible("2026-11-09T09:00:00Z", ahora)).toBe("Hace 1 día");
    expect(ultimoUsoLegible("2026-11-01T09:00:00Z", ahora)).toBe("Hace 9 días");
  });
});

describe("privacidad en la sala de espera (AUT-04)", () => {
  it("iniciales y nombre corto según cómo se escribe el nombre en Chile", () => {
    expect(inicialesDe("maría josé gonzález pérez")).toBe("M. G.");
    expect(inicialesDe("Juan González Pérez")).toBe("J. G.");
    expect(inicialesDe("Ana Rojas")).toBe("A. R.");
    expect(inicialesDe("Cher")).toBe("C.");
    expect(inicialesDe("  ")).toBe("");
    expect(nombreCortoDe("maría josé gonzález pérez")).toBe("María G.");
    expect(nombreCortoDe("Juan González Pérez")).toBe("Juan G.");
  });

  it("nunca deja pasar el nombre completo", () => {
    const nombre = "María José González Pérez";
    for (const modo of ["iniciales", "turno", "nombre_corto"] as const) {
      const e = etiquetaDeSala(nombre, 12, modo);
      expect(JSON.stringify(e)).not.toContain("González");
      expect(JSON.stringify(e)).not.toContain("José");
      expect(e.turno).toBe("12");
    }
    expect(etiquetaDeSala(nombre, 12, "turno")).toEqual({ turno: "12", nombre: null });
    expect(etiquetaDeSala(nombre, 12, "iniciales")).toEqual({ turno: "12", nombre: "M. G." });
    expect(etiquetaDeSala(nombre, 12, "nombre_corto")).toEqual({
      turno: "12",
      nombre: "María G.",
    });
    // Sin turno y en modo "solo número": un genérico, nunca el nombre.
    expect(etiquetaDeSala(nombre, null, "turno")).toEqual({ turno: null, nombre: "Paciente" });
  });
});

describe("verificación del tótem (AUT-01)", () => {
  it("solo 4 dígitos", () => {
    expect(normalizarVerificacion("43 21")).toBe("4321");
    expect(normalizarVerificacion("07/03")).toBe("0703");
    expect(normalizarVerificacion("432")).toBeNull();
    expect(normalizarVerificacion("43210")).toBeNull();
    expect(normalizarVerificacion(null)).toBeNull();
  });

  it("día y mes posibles", () => {
    expect(esDiaYMesPosible("0703")).toBe(true);
    expect(esDiaYMesPosible("3112")).toBe(true);
    expect(esDiaYMesPosible("3213")).toBe(false);
    expect(esDiaYMesPosible("0000")).toBe(false);
  });

  it("los mensajes no dicen si el RUT existe y no usan voseo", () => {
    const m = mensajeDeTotem("datos", 2);
    expect(m).toContain("2 intentos");
    expect(mensajeDeTotem("datos", 1)).toContain("1 intento)");
    for (const motivo of ["datos", "bloqueado_rut", "sesion", "ocupado", null]) {
      const t = mensajeDeTotem(motivo);
      expect(t).not.toMatch(/no existe|no está registrado|no encontramos tu rut/i);
      expect(t).not.toMatch(/\b(acercate|revisá|intentá|elegí)\b/i);
    }
  });
});

describe("pantalla del box (AUT-05)", () => {
  const ahora = new Date("2026-11-10T13:00:00Z");
  const cita = (
    id: string,
    h: number,
    estado: CitaDeBox["estado"],
    llamado?: string,
  ): CitaDeBox => ({
    id,
    inicio: `2026-11-10T${String(h).padStart(2, "0")}:00:00Z`,
    fin: `2026-11-10T${String(h).padStart(2, "0")}:45:00Z`,
    estado,
    llamadoEn: llamado ?? null,
    llamadoAqui: Boolean(llamado),
  });

  it("actual = última llamada a este box que sigue en sala; siguiente = quien ya llegó", () => {
    const citas = [
      cita("a", 12, "finalizada", "2026-11-10T12:01:00Z"),
      cita("b", 13, "en-sala", "2026-11-10T13:02:00Z"),
      cita("c", 14, "confirmada"),
      cita("d", 15, "en-sala"),
    ];
    const r = actualYSiguiente(citas, ahora);
    expect(r.actual?.id).toBe("b");
    expect(r.llamable?.id).toBe("d");
    expect(r.siguiente?.id).toBe("d");
  });

  it("sin nadie en sala no hay a quién llamar, pero se muestra la próxima de la agenda", () => {
    const r = actualYSiguiente([cita("a", 12, "finalizada"), cita("c", 14, "confirmada")], ahora);
    expect(r.actual).toBeNull();
    expect(r.llamable).toBeNull();
    expect(r.siguiente?.id).toBe("c");
  });

  it("quien ya fue llamado no vuelve a ser el siguiente", () => {
    const citas = [
      cita("a", 11, "en-sala", "2026-11-10T11:01:00Z"),
      cita("b", 12, "en-sala", "2026-11-10T12:30:00Z"),
      cita("c", 13, "en-sala"),
    ];
    const r = actualYSiguiente(citas, ahora);
    expect(r.actual?.id).toBe("b");
    expect(r.llamable?.id).toBe("c");
  });

  it("un llamado a otro box no cuenta como actual", () => {
    const otra = { ...cita("b", 13, "en-sala", "2026-11-10T13:02:00Z"), llamadoAqui: false };
    const r = actualYSiguiente([otra, cita("c", 14, "en-sala")], ahora);
    expect(r.actual).toBeNull();
    expect(r.llamable?.id).toBe("c");
  });
});

describe("dispositivo desde la fila de la base", () => {
  it("exige id, clínica, sucursal y un tipo conocido", () => {
    const base = {
      id: "d",
      clinic_id: "c",
      branch_id: "b",
      kind: "sala",
      privacidad: "turno",
      zona: "America/Santiago",
    };
    expect(dispositivoDesdeFila(base)).toMatchObject({ tipo: "sala", privacidad: "turno" });
    expect(dispositivoDesdeFila({ ...base, kind: "admin" })).toBeNull();
    expect(dispositivoDesdeFila({ ...base, branch_id: null })).toBeNull();
    expect(dispositivoDesdeFila(null)).toBeNull();
    // Privacidad desconocida: la más reservada por defecto de las que muestran algo.
    expect(dispositivoDesdeFila({ ...base, privacidad: "rut" })?.privacidad).toBe("iniciales");
  });
});
