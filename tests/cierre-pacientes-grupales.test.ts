import { describe, expect, it } from "vitest";

import { AYUDA_PANTALLAS } from "@/content/ayuda/pantallas";
import { AJUSTES } from "@/lib/access/navegacion";
import { estadoParaInscrito, unirCitasDelPaciente } from "@/lib/clinic-operations/citas-grupales";
import { CAMPOS_FICHA_OLA1 } from "@/lib/patients/editar-paciente";
import {
  ETIQUETA_SEXO,
  SEXOS,
  cambiosDeFicha,
  esSexo,
  estadoCamposDe,
  estadoCamposVacio,
  parcheDeFichaOla1,
} from "@/lib/patients/datos-ficha";
import {
  CORTES,
  CORTES_DEMOGRAFICOS,
  DEF_METRICAS,
  armarMapaDeCalor,
  corteAdmitido,
  etiquetaClave,
  NOMBRES_VACIOS,
} from "@/lib/reportes/informes";

/**
 * Cierre de la fase · Bloque 5 (ítems 4, 6, 7 y 8): lógica pura. Lo que toca
 * la base va en los tests *-db.
 */

describe("ítem 7 · sexo de la ficha (opcional)", () => {
  it("ofrece «prefiere no decir» además de las demás opciones, con etiquetas en español", () => {
    expect(SEXOS).toEqual(["femenino", "masculino", "otro", "prefiere_no_decir"]);
    expect(ETIQUETA_SEXO.prefiere_no_decir).toBe("Prefiere no decir");
    expect(esSexo("femenino")).toBe(true);
    expect(esSexo("")).toBe(false);
    expect(esSexo(null)).toBe(false);
  });

  it("el formulario arranca sin registrar y carga el sexo de una ficha existente", () => {
    expect(estadoCamposVacio("rut").sexo).toBe("");
    expect(estadoCamposDe({ sexo: "otro" }, "rut").sexo).toBe("otro");
    expect(estadoCamposDe({ sexo: null }, "rut").sexo).toBe("");
  });

  it("editar manda el sexo solo si cambió, y «sin registrar» lo borra", () => {
    const antes = estadoCamposDe({ sexo: "femenino" }, "rut");
    expect(cambiosDeFicha(antes, { ...antes }).sexo).toBeUndefined();
    expect(cambiosDeFicha(antes, { ...antes, sexo: "masculino" }).sexo).toBe("masculino");
    expect(cambiosDeFicha(antes, { ...antes, sexo: "" }).sexo).toBeNull();
  });

  it("el servidor escribe la columna `sex`, la limpia con null y no la exige nunca", () => {
    const ctx = { pais: "CL", esAlta: true, documentoFinal: null, tipoFinal: null };
    const con = parcheDeFichaOla1(
      {
        sexo: "prefiere_no_decir",
        prevision: { plan: "particular", tramo: null, institucion: null },
      },
      ctx,
    );
    expect(con.error).toBeNull();
    expect(con.parche.sex).toBe("prefiere_no_decir");
    const sin = parcheDeFichaOla1(
      { prevision: { plan: "particular", tramo: null, institucion: null } },
      ctx,
    );
    expect(sin.error).toBeNull();
    expect("sex" in sin.parche).toBe(false);
    const borra = parcheDeFichaOla1({ sexo: null }, { ...ctx, esAlta: false });
    expect(borra.parche.sex).toBeNull();
  });

  it("el esquema del formulario acepta las cuatro opciones y rechaza cualquier otra", () => {
    for (const s of SEXOS) expect(CAMPOS_FICHA_OLA1.safeParse({ sexo: s }).success).toBe(true);
    expect(CAMPOS_FICHA_OLA1.safeParse({ sexo: null }).success).toBe(true);
    expect(CAMPOS_FICHA_OLA1.safeParse({}).success).toBe(true);
    expect(CAMPOS_FICHA_OLA1.safeParse({ sexo: "x" }).success).toBe(false);
  });

  it("Informes tiene el corte por sexo, también para las métricas que no son de agenda", () => {
    expect(CORTES).toContain("sexo");
    expect(CORTES_DEMOGRAFICOS).toContain("sexo");
    expect(corteAdmitido("pacientes_nuevos", "sexo")).toBe(true);
    expect(corteAdmitido("produccion", "sexo")).toBe(true);
    expect(etiquetaClave("sexo", "prefiere_no_decir", NOMBRES_VACIOS)).toBe("Prefiere no decir");
    expect(etiquetaClave("sexo", "femenino", NOMBRES_VACIOS)).toBe("Femenino");
    expect(etiquetaClave("sexo", null, NOMBRES_VACIOS)).toBe("Sin dato");
  });
});

describe("ítem 6 · «Seguros y coberturas» frente a «Empresas con convenio»", () => {
  const items = AJUSTES.flatMap((g) => g.items);
  const seguros = items.find((i) => i.to === "/convenios");
  const empresas = items.find((i) => i.to === "/empresas-con-convenio");

  it("los dos ajustes tienen nombres distintos y ninguno se llama solo «Convenios»", () => {
    expect(seguros?.label).toBe("Seguros y coberturas");
    expect(empresas?.label).toBe("Empresas con convenio");
    expect(items.some((i) => i.label.trim() === "Convenios")).toBe(false);
    expect(seguros?.label).not.toBe(empresas?.label);
  });

  it("buscar «convenios» sigue llevando a los dos", () => {
    expect(seguros?.sinonimos).toContain("convenios");
    expect(empresas?.sinonimos).toContain("convenio");
  });

  it("la ayuda de Ajustes explica la diferencia", () => {
    const ajustes = AYUDA_PANTALLAS.find((p) => p.id === "ajustes");
    const texto = JSON.stringify(ajustes);
    expect(texto).toContain("Seguros y coberturas");
    expect(texto).toContain("Empresas con convenio");
  });
});

describe("ítem 4 · cita grupal para todos los inscritos", () => {
  it("cada inscrito ve la cita con su propia asistencia", () => {
    expect(estadoParaInscrito("confirmada", "pendiente")).toBe("confirmada");
    expect(estadoParaInscrito("confirmada", "asistio")).toBe("finalizada");
    expect(estadoParaInscrito("finalizada", "ausente")).toBe("ausente");
    expect(estadoParaInscrito("finalizada", "pendiente")).toBe("finalizada");
  });

  it("una cita cancelada manda sobre la asistencia", () => {
    expect(estadoParaInscrito("cancelada", "asistio")).toBe("cancelada");
    expect(estadoParaInscrito("cancelada", "pendiente")).toBe("cancelada");
  });

  it("las citas del paciente suman las suyas y las grupales sin repetir al titular", () => {
    const propia = { id: "a", starts_at: "2026-11-10T10:00:00Z" };
    const delTitular = { id: "g", starts_at: "2026-11-05T10:00:00Z" };
    const lista = unirCitasDelPaciente(
      [propia, delTitular],
      [delTitular, { id: "h", starts_at: "2026-11-07T10:00:00Z" }],
    );
    expect(lista.map((c) => c.id)).toEqual(["g", "h", "a"]);
    expect(unirCitasDelPaciente([propia], [delTitular], true).map((c) => c.id)).toEqual(["a", "g"]);
  });

  it("las métricas de asistencia lo dicen: en una grupal cuenta cada paciente", () => {
    expect(DEF_METRICAS.atenciones.descripcion).toMatch(/cita grupal/);
    expect(DEF_METRICAS.ausencias.descripcion).toMatch(/cita grupal/);
    // Las citas, las horas y las cancelaciones siguen contando la sesión una vez.
    expect(DEF_METRICAS.citas.descripcion).not.toMatch(/grupal/);
  });
});

describe("ítem 8 · mapa de calor con la disponibilidad neta", () => {
  const filas = [
    {
      diaSemana: 1,
      hora: 9,
      citas: 1,
      minutosOcupados: 60,
      minutosDisponibles: 120,
      dias: 3,
      minutosBloqueados: 0,
      minutosFeriado: 60,
    },
    {
      diaSemana: 1,
      hora: 12,
      citas: 0,
      minutosOcupados: 0,
      minutosDisponibles: 0,
      dias: 3,
      minutosBloqueados: 120,
      minutosFeriado: 60,
    },
  ];

  it("el porcentaje se calcula sobre el horario neto y la celda dice qué se descontó", () => {
    const mapa = armarMapaDeCalor(filas);
    const lunes9 = mapa.filas[0].celdas[0];
    expect(lunes9.pct).toBe(50);
    expect(lunes9.minutosFeriado).toBe(60);
    expect(lunes9.texto).toContain("1 h en feriado");
  });

  it("una franja con todo el horario descontado no se muestra como «sin horario ni citas»", () => {
    const mapa = armarMapaDeCalor(filas);
    const lunes12 = mapa.filas[0].celdas.find((c) => c.hora === 12);
    expect(lunes12?.pct).toBeNull();
    expect(lunes12?.texto).toContain("sin horario disponible");
    expect(lunes12?.texto).toContain("2 h bloqueados");
  });

  it("suma lo descontado en todo el período", () => {
    const mapa = armarMapaDeCalor(filas);
    expect(mapa.minutosBloqueados).toBe(120);
    expect(mapa.minutosFeriado).toBe(120);
  });

  it("sin bloqueos ni feriados sigue siendo el mapa de siempre", () => {
    const mapa = armarMapaDeCalor([
      { diaSemana: 1, hora: 9, citas: 2, minutosOcupados: 60, minutosDisponibles: 60, dias: 4 },
    ]);
    expect(mapa.filas[0].celdas[0].texto).not.toContain("descontaron");
    expect(mapa.minutosBloqueados).toBe(0);
    expect(mapa.ocupacionTotal).toBe(100);
  });
});
