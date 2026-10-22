import { describe, expect, it } from "vitest";

import {
  CLAVE_SALIDA_ALTA,
  erroresDeContactoEmergencia,
  errorDeOrigen,
  errorDePrevision,
  faltantesDeLaFicha,
  guardarSalidaAlta,
  leerSalidaAlta,
  normalizarCodigoReferido,
  origenPorReferido,
  previsionParaGuardar,
  textoPrevision,
  validarNuevoPaciente,
  type DatosNuevoPaciente,
} from "../src/lib/patients/datos-ficha";

/** Ola 1 · Frente Pacientes: previsión, contacto de emergencia, origen y ficha completa. Puro. */

describe("previsión (FIC-02)", () => {
  it("es obligatoria solo para pacientes nuevos de Chile", () => {
    const vacia = { plan: null, tramo: null, institucion: null };
    expect(errorDePrevision(vacia, true)).toMatch(/previsión/);
    expect(errorDePrevision(vacia, false)).toBeNull();
  });
  it("Fonasa pide tramo A-D; el tramo solo existe en Fonasa", () => {
    expect(errorDePrevision({ plan: "fonasa", tramo: null, institucion: null }, true)).toMatch(
      /tramo/,
    );
    expect(errorDePrevision({ plan: "fonasa", tramo: "B", institucion: null }, true)).toBeNull();
    expect(errorDePrevision({ plan: "isapre", tramo: "B", institucion: "Colmena" }, true)).toMatch(
      /solo corresponde a Fonasa/,
    );
  });
  it("isapre pide el nombre; FF. AA. pide Capredena o Dipreca", () => {
    expect(errorDePrevision({ plan: "isapre", tramo: null, institucion: " " }, true)).toMatch(
      /isapre/,
    );
    expect(
      errorDePrevision({ plan: "isapre", tramo: null, institucion: "Colmena" }, true),
    ).toBeNull();
    expect(errorDePrevision({ plan: "ffaa", tramo: null, institucion: "Otra" }, true)).toMatch(
      /Capredena/,
    );
    expect(
      errorDePrevision({ plan: "ffaa", tramo: null, institucion: "Dipreca" }, true),
    ).toBeNull();
  });
  it("particular, extranjero y sin previsión no piden nada más", () => {
    for (const plan of ["particular", "extranjero", "sin_prevision"] as const) {
      expect(errorDePrevision({ plan, tramo: null, institucion: null }, true)).toBeNull();
    }
  });
  it("texto para la ficha, con 'Pendiente' en las fichas viejas", () => {
    expect(textoPrevision({ plan: null, tramo: null, institucion: null })).toBe("Pendiente");
    expect(textoPrevision({ plan: "fonasa", tramo: "C", institucion: null })).toBe("Fonasa C");
    expect(textoPrevision({ plan: "isapre", tramo: null, institucion: "Consalud" })).toBe(
      "Isapre Consalud",
    );
    expect(textoPrevision({ plan: "ffaa", tramo: null, institucion: "Capredena" })).toBe(
      "Capredena",
    );
  });
  it("al guardar descarta tramo e institución que no corresponden", () => {
    expect(previsionParaGuardar({ plan: "particular", tramo: "A", institucion: "X" })).toEqual({
      plan: "particular",
      tramo: null,
      institucion: null,
    });
    expect(previsionParaGuardar({ plan: "isapre", tramo: null, institucion: " Colmena " })).toEqual(
      { plan: "isapre", tramo: null, institucion: "Colmena" },
    );
  });
});

describe("contacto de emergencia (FIC-03)", () => {
  it("es opcional, pero si se empieza hay que completarlo", () => {
    expect(erroresDeContactoEmergencia({ nombre: "", relacion: "", telefono: "" }, "CL")).toEqual(
      {},
    );
    const errores = erroresDeContactoEmergencia(
      { nombre: "Ana", relacion: "Madre", telefono: "" },
      "CL",
    );
    expect(errores.telefono).toMatch(/teléfono/);
  });
  it("valida el teléfono con el país de la clínica", () => {
    expect(
      erroresDeContactoEmergencia({ nombre: "Ana", relacion: "", telefono: "9 1234 5678" }, "CL"),
    ).toEqual({});
    expect(
      erroresDeContactoEmergencia({ nombre: "Ana", relacion: "", telefono: "123" }, "CL").telefono,
    ).toMatch(/No reconocemos/);
  });
});

describe("origen del paciente (FIC-04)", () => {
  it("'Otro' pide detalle", () => {
    expect(errorDeOrigen("Otro", "")).toMatch(/Cuéntanos/);
    expect(errorDeOrigen("Otro", "Feria de salud")).toBeNull();
    expect(errorDeOrigen("Instagram", "")).toBeNull();
  });
  it("con código de referido el origen es Recomendación", () => {
    expect(origenPorReferido({ nombre: "Ana Pérez" })).toEqual({
      origen: "Recomendación",
      detalle: "Referido por Ana Pérez",
    });
    expect(origenPorReferido(null)).toBeNull();
    expect(normalizarCodigoReferido(" ab-12c3 ")).toBe("AB12C3");
  });
});

describe("validarNuevoPaciente (PAC-11)", () => {
  const base: DatosNuevoPaciente = {
    nombre: "José Pérez",
    documentoTipo: "rut",
    documento: "12.345.678-5",
    fechaNacimiento: "1990-01-01",
    prevision: { plan: "fonasa", tramo: "B", institucion: null },
    contacto: { nombre: "", relacion: "", telefono: "" },
    origen: "Google",
    origenDetalle: "",
  };
  it("un alta completa no tiene errores", () => {
    expect(validarNuevoPaciente(base, { esChile: true, pais: "CL" })).toEqual({});
  });
  it("un RUT inválido bloquea el guardado", () => {
    const e = validarNuevoPaciente(
      { ...base, documento: "12.345.678-6" },
      { esChile: true, pais: "CL" },
    );
    expect(e.documento).toMatch(/RUT no es válido/);
  });
  it("sin previsión: error en Chile, nada afuera", () => {
    const sin = { ...base, prevision: { plan: null, tramo: null, institucion: null } };
    expect(validarNuevoPaciente(sin, { esChile: true, pais: "CL" }).prevision).toBeDefined();
    expect(validarNuevoPaciente(sin, { esChile: false, pais: "AR" }).prevision).toBeUndefined();
  });
});

describe("ficha completa (SEG-08)", () => {
  const completa = {
    prevision: "fonasa" as const,
    documento: "12.345.678-5",
    fechaNacimiento: "1990-01-01",
    direccion: "Av. Siempre Viva 123",
    comuna: "Providencia",
    tieneAnamnesis: true,
  };
  it("no falta nada en una ficha completa", () => {
    expect(faltantesDeLaFicha(completa, true)).toEqual([]);
  });
  it("una ficha vieja muestra todo lo que falta, en orden", () => {
    expect(
      faltantesDeLaFicha(
        {
          prevision: null,
          documento: "",
          fechaNacimiento: null,
          direccion: null,
          comuna: null,
          tieneAnamnesis: false,
        },
        true,
      ),
    ).toEqual(["prevision", "documento", "fechaNacimiento", "direccion", "anamnesis"]);
  });
  it("la anamnesis no cuenta si el rol no la puede ver", () => {
    expect(faltantesDeLaFicha({ ...completa, tieneAnamnesis: null }, true)).toEqual([]);
  });
  it("fuera de Chile no se exigen previsión ni domicilio", () => {
    expect(
      faltantesDeLaFicha({ ...completa, prevision: null, direccion: null, comuna: null }, false),
    ).toEqual([]);
  });
  it("dirección sin comuna sigue incompleta", () => {
    expect(faltantesDeLaFicha({ ...completa, comuna: "" }, true)).toEqual(["direccion"]);
  });
});

describe("última salida del alta (PAC-11)", () => {
  it("recuerda la elección y cae a 'ficha' sin almacenamiento", () => {
    const datos = new Map<string, string>();
    const almacen = {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => void datos.set(k, v),
    };
    expect(leerSalidaAlta(almacen)).toBe("ficha");
    guardarSalidaAlta(almacen, "agendar");
    expect(datos.get(CLAVE_SALIDA_ALTA)).toBe("agendar");
    expect(leerSalidaAlta(almacen)).toBe("agendar");
    expect(leerSalidaAlta(null)).toBe("ficha");
  });
  it("si el navegador bloquea el almacenamiento no rompe", () => {
    const roto = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(leerSalidaAlta(roto)).toBe("ficha");
    expect(() => guardarSalidaAlta(roto, "agendar")).not.toThrow();
  });
});
