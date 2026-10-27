import { describe, expect, it } from "vitest";

import { aplicarMapeo, autoDetectMapping } from "@/lib/csv/column-mapping";
import { filasDeMatriz, indiceDeColumna } from "@/lib/migracion/leer-archivo";
import {
  afectadas,
  explicarBloqueo,
  filaOriginal,
  leerEstadoCita,
  leerFecha,
  leerHora,
  leerPrevision,
  normalizarNombrePersona,
  prepararCitas,
  prepararPacientes,
  type FilaVistaPrevia,
} from "@/lib/migracion/normalizar";
import {
  camposDelPerfil,
  nombreDelOrigen,
  PERFILES_DE_MIGRACION,
  sugerirPerfil,
} from "@/lib/migracion/perfiles";

/**
 * Reglas puras de la migración asistida (EXP-05, EXP-07): lectura de
 * valores de exports latinoamericanos, filas válidas / con error /
 * repetidas, perfiles de columnas y la cifra que se confirma.
 */

describe("lectura de valores", () => {
  it("fechas con el día primero, ISO y número de serie de Excel", () => {
    expect(leerFecha("01/03/1980")).toBe("1980-03-01");
    expect(leerFecha("1-3-80")).toBe("1980-03-01");
    expect(leerFecha("05.11.2024")).toBe("2024-11-05");
    expect(leerFecha("2024-11-05")).toBe("2024-11-05");
    expect(leerFecha("2024-11-05 10:30")).toBe("2024-11-05");
    expect(leerFecha("31/02/1990")).toBeNull();
    expect(leerFecha("ayer")).toBeNull();
    expect(leerFecha("")).toBeNull();
    // 45658 = 1 de enero de 2025 en Excel.
    expect(leerFecha("45658")).toBe("2025-01-01");
  });

  it("horas en 24 h, con AM/PM, sin separador y como fracción de Excel", () => {
    expect(leerHora("9:30")).toBe("09:30");
    expect(leerHora("09:30:00")).toBe("09:30");
    expect(leerHora("1730")).toBe("17:30");
    expect(leerHora("2:15 PM")).toBe("14:15");
    expect(leerHora("12:00 a.m.")).toBe("00:00");
    expect(leerHora("0.5")).toBe("12:00");
    expect(leerHora("25:00")).toBeNull();
    expect(leerHora("tarde")).toBeNull();
  });

  it("previsión desde texto libre", () => {
    expect(leerPrevision("Fonasa B")).toEqual({
      prevision: "fonasa",
      tramo: "B",
      institucion: null,
    });
    expect(leerPrevision("FONASA")).toEqual({
      prevision: "fonasa",
      tramo: null,
      institucion: null,
    });
    expect(leerPrevision("Isapre Colmena")?.institucion).toBe("Colmena");
    expect(leerPrevision("Banmédica")?.prevision).toBe("isapre");
    expect(leerPrevision("Capredena")).toEqual({
      prevision: "ffaa",
      tramo: null,
      institucion: "Capredena",
    });
    expect(leerPrevision("Particular")?.prevision).toBe("particular");
    expect(leerPrevision("Banco X")).toBeNull();
  });

  it("estado de cita del sistema anterior", () => {
    expect(leerEstadoCita("Atendido")).toBe("finalizada");
    expect(leerEstadoCita("No asistió")).toBe("ausente");
    expect(leerEstadoCita("Anulada por paciente")).toBe("cancelada");
    expect(leerEstadoCita("Confirmado")).toBe("confirmada");
    expect(leerEstadoCita("No confirmado")).toBe("tentativa");
    expect(leerEstadoCita("")).toBe("tentativa");
  });

  it("nombre normalizado igual que la función SQL", () => {
    expect(normalizarNombrePersona("  Ána   PÉREZ  Núñez ")).toBe("ana perez nunez");
    expect(normalizarNombrePersona("   ")).toBeNull();
  });
});

describe("prepararPacientes", () => {
  it("marca errores, avisos y repetidos dentro del archivo", () => {
    const filas = prepararPacientes(
      [
        { nombre: "Ana", apellidos: "Pérez", documento: "11111111-1", nacimiento: "01/03/1980" },
        { nombre: "", apellidos: "" },
        { nombre: "ANA", apellidos: "perez", nacimiento: "1980-03-01" },
        { nombre: "Jorge", documento: "12.345.678-0", email: "malo", prevision: "Banco X" },
        { nombre: "Luis", externo: "7" },
        { nombre: "Luis Bis", externo: "7" },
      ],
      "CL",
    );
    expect(filas.map((f) => f.estado)).toEqual([
      "valida",
      "error",
      "duplicada",
      "valida",
      "valida",
      "duplicada",
    ]);
    expect(filas[0]).toMatchObject({
      nombre: "Ana Pérez",
      documento: "11.111.111-1",
      documentoTipo: "rut",
      nacimiento: "1980-03-01",
    });
    expect(filas[1].errores).toEqual(["Falta el nombre."]);
    expect(filas[2].repiteFila).toBe(1);
    expect(filas[3].documentoTipo).toBe("otro");
    expect(filas[3].email).toBeNull();
    expect(filas[3].avisos).toHaveLength(3);
    expect(filas[5].repiteFila).toBe(5);
  });

  it("fuera de Chile el documento es DNI y no se valida como RUT", () => {
    const [f] = prepararPacientes([{ nombre: "Ana", documento: "30123456" }], "AR");
    expect(f).toMatchObject({ documento: "30123456", documentoTipo: "dni", avisos: [] });
  });
});

describe("prepararCitas", () => {
  it("arma inicio local, duración y estado; exige paciente, fecha y hora", () => {
    const filas = prepararCitas([
      {
        paciente_externo: "101",
        fecha: "10/05/2025",
        hora: "09:00",
        hora_fin: "09:45",
        estado: "Atendido",
        motivo: "Control",
      },
      { paciente_nombre: "Luis", fecha: "12/05/2025 10:00", duracion: "60" },
      { paciente_nombre: "Sin hora", fecha: "12/05/2025" },
      { fecha: "12/05/2025", hora: "10:00" },
      {
        paciente_externo: "101",
        fecha: "10/05/2025",
        hora: "09:00",
      },
    ]);
    expect(filas[0]).toMatchObject({
      estado: "valida",
      inicioLocal: "2025-05-10T09:00",
      duracionMin: 45,
      estadoCita: "finalizada",
      motivo: "Control",
    });
    expect(filas[1]).toMatchObject({
      estado: "valida",
      inicioLocal: "2025-05-12T10:00",
      duracionMin: 60,
    });
    expect(filas[2].estado).toBe("error");
    expect(filas[3].errores[0]).toMatch(/paciente/);
    expect(filas[4]).toMatchObject({ estado: "duplicada", repiteFila: 1 });
  });
});

describe("perfiles de columnas (EXP-07)", () => {
  it("Dentalink es provisional y el genérico no", () => {
    expect(PERFILES_DE_MIGRACION.dentalink.provisional).toBe(true);
    expect(PERFILES_DE_MIGRACION.generico.provisional).toBe(false);
    expect(nombreDelOrigen("dentalink")).toBe("Dentalink");
    expect(nombreDelOrigen("otro_sistema")).toBe("otro_sistema");
  });

  it("detecta las columnas típicas de Dentalink y sugiere el perfil", () => {
    const headers = [
      "N° Ficha",
      "Nombre",
      "Apellido Paterno",
      "Apellido Materno",
      "RUT",
      "Fecha de Nacimiento",
      "Teléfono Celular",
      "Correo Electrónico",
    ];
    expect(sugerirPerfil("pacientes", headers)).toBe("dentalink");
    expect(sugerirPerfil("pacientes", ["nombre", "rut"])).toBe("generico");

    const campos = camposDelPerfil("pacientes", "dentalink");
    const mapeo = autoDetectMapping(headers, campos);
    expect(mapeo).toMatchObject({
      externo: "N° Ficha",
      nombre: "Nombre",
      apellidos: "Apellido Paterno",
      apellido_materno: "Apellido Materno",
      documento: "RUT",
      nacimiento: "Fecha de Nacimiento",
      telefono: "Teléfono Celular",
      email: "Correo Electrónico",
    });
    const [fila] = aplicarMapeo(
      [
        {
          Nombre: "Ana",
          "Apellido Paterno": "Pérez",
          "Apellido Materno": "Soto",
          RUT: "11.111.111-1",
        },
      ],
      mapeo,
      campos,
    );
    expect(prepararPacientes([fila], "CL")[0].nombre).toBe("Ana Pérez Soto");
  });

  it("citas: el perfil genérico reconoce los encabezados de siempre", () => {
    const mapeo = autoDetectMapping(
      ["RUT Paciente", "Fecha", "Hora inicio", "Profesional", "Estado"],
      camposDelPerfil("citas", "generico"),
    );
    expect(mapeo).toMatchObject({
      paciente_documento: "RUT Paciente",
      fecha: "Fecha",
      hora: "Hora inicio",
      profesional: "Profesional",
      estado: "Estado",
    });
  });
});

describe("lectura del archivo", () => {
  it("columnas de Excel por letra", () => {
    expect(indiceDeColumna("A1")).toBe(0);
    expect(indiceDeColumna("Z9")).toBe(25);
    expect(indiceDeColumna("AB12")).toBe(27);
  });

  it("encabezados repetidos o vacíos y filas en blanco", () => {
    const r = filasDeMatriz([
      ["Nombre", "Nombre", ""],
      ["Ana", "Pérez", "x"],
      ["", "", ""],
      ["Luis"],
    ]);
    expect(r.headers).toEqual(["Nombre", "Nombre (2)", "Columna 3"]);
    expect(r.rows).toEqual([
      { Nombre: "Ana", "Nombre (2)": "Pérez", "Columna 3": "x" },
      { Nombre: "Luis", "Nombre (2)": "", "Columna 3": "" },
    ]);
  });

  it("el dato de origen guarda solo columnas con valor y tiene tope", () => {
    expect(filaOriginal({ Nombre: " Ana ", Vacia: "  " })).toEqual({ Nombre: "Ana" });
    const enorme = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`c${i}`, "x".repeat(500)]),
    );
    expect(JSON.stringify(filaOriginal(enorme)).length).toBeLessThan(8000);
  });
});

describe("cifra que se confirma y motivos de la reversa", () => {
  const fila = (estado: FilaVistaPrevia["estado"], pacienteId: string | null = null) =>
    ({ estado, pacienteId }) as FilaVistaPrevia;

  it("con 'completar' cuentan también las fichas existentes, no los repetidos del archivo", () => {
    const filas = [
      fila("valida"),
      fila("valida"),
      fila("duplicada", "p1"),
      fila("duplicada"),
      fila("error"),
    ];
    expect(afectadas(filas, "omitir")).toBe(2);
    expect(afectadas(filas, "completar")).toBe(3);
  });

  it("explica en palabras por qué no se puede deshacer", () => {
    expect(
      explicarBloqueo({ tabla: "patients", usada_por: "clinical_notes", cantidad: 2 }),
    ).toMatch(/2 notas clínicas/);
    expect(explicarBloqueo({ tabla: "patients", usada_por: "edicion", cantidad: 1 })).toBe(
      "1 ficha se editó después de importarla.",
    );
    expect(explicarBloqueo({ tabla: "patients", usada_por: "appointments", cantidad: 3 })).toMatch(
      /deshaz ese lote primero/,
    );
    expect(explicarBloqueo({ tabla: "appointments", usada_por: "edicion", cantidad: 4 })).toBe(
      "4 citas se editaron después de importarlas.",
    );
  });
});
