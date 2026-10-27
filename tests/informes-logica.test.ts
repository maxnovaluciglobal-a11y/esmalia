import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/lib/access/access";
import {
  ConfigInforme,
  CORTES,
  DEF_METRICAS,
  METRICAS,
  armarMapaDeCalor,
  ausentismo,
  corteAdmitido,
  etiquetaClave,
  formatearMinutos,
  formatearValor,
  mayorCaida,
  metricasVisibles,
  NOMBRES_VACIOS,
  nombreSugerido,
  ocupacionBox,
  ordenarPorCorte,
  pasosDelEmbudo,
  porcentaje,
  rangoDeComparacion,
  rangoDeConfig,
  sumarEmbudo,
  totalDe,
  totalesPorClave,
  unirComparacion,
  variacion,
  type FilaMetrica,
} from "@/lib/reportes/informes";

/**
 * Ola 11 · frente A (INF-02 a INF-12): cálculos puros de los informes. Las
 * sumas las hace Postgres (tests/informes-db.test.ts); acá, el catálogo,
 * la comparación entre períodos, el orden, el mapa de calor y el embudo.
 */

const fila = (
  clave: string | null,
  valor: number,
  clave2: string | null = "total",
): FilaMetrica => ({
  clave,
  clave2,
  valor,
  n: valor,
  pacientes: valor,
});

describe("catálogo de métricas y cortes", () => {
  it("las métricas de dinero exigen finance:view y las demás no", () => {
    for (const m of METRICAS) {
      const def = DEF_METRICAS[m];
      expect(def.permiso === "finance:view").toBe(def.unidad === "dinero");
    }
  });

  it("hora, box, estado y canal solo aplican a métricas de agenda (espejo del SQL)", () => {
    expect(corteAdmitido("citas", "hora")).toBe(true);
    expect(corteAdmitido("atenciones", "box")).toBe(true);
    expect(corteAdmitido("produccion", "hora")).toBe(false);
    expect(corteAdmitido("pacientes_nuevos", "box")).toBe(false);
    expect(corteAdmitido("cobrado", "canal")).toBe(false);
    for (const m of METRICAS) {
      for (const c of [
        "total",
        "dia",
        "mes",
        "profesional",
        "sucursal",
        "edad",
        "comuna",
        "prevision",
        "origen",
        "sexo",
      ] as const) {
        expect(corteAdmitido(m, c)).toBe(true);
      }
    }
    expect(CORTES).toHaveLength(16);
  });

  it("sin finanzas no hay métricas de dinero; recepción ve agenda y pacientes", () => {
    const recepcion = metricasVisibles(permissionsForRole("reception"));
    expect(recepcion).toContain("citas");
    expect(recepcion).toContain("pacientes_nuevos");
    expect(recepcion.some((m) => DEF_METRICAS[m].unidad === "dinero")).toBe(false);
    const asistente = metricasVisibles(permissionsForRole("assistant"));
    expect(asistente.some((m) => DEF_METRICAS[m].unidad === "dinero")).toBe(false);
    const contabilidad = metricasVisibles(permissionsForRole("accounting"));
    expect(contabilidad).toContain("produccion");
    expect(contabilidad).not.toContain("citas"); // accounting no tiene agenda:view
    expect(metricasVisibles(permissionsForRole("owner"))).toEqual([...METRICAS]);
  });
});

describe("INF-02 · comparación entre períodos", () => {
  it("un mes calendario se compara con el mes anterior completo", () => {
    expect(rangoDeComparacion({ desde: "2026-03-01", hasta: "2026-03-31" }, "anterior")).toEqual({
      desde: "2026-02-01",
      hasta: "2026-02-28",
    });
  });

  it("un rango cualquiera se compara con los mismos días justo antes", () => {
    expect(rangoDeComparacion({ desde: "2026-10-01", hasta: "2026-10-27" }, "anterior")).toEqual({
      desde: "2026-09-04",
      hasta: "2026-09-30",
    });
    expect(rangoDeComparacion({ desde: "2026-10-27", hasta: "2026-10-27" }, "anterior")).toEqual({
      desde: "2026-10-26",
      hasta: "2026-10-26",
    });
  });

  it("el mismo período del año pasado ajusta el 29 de febrero", () => {
    expect(rangoDeComparacion({ desde: "2028-02-01", hasta: "2028-02-29" }, "anio")).toEqual({
      desde: "2027-02-01",
      hasta: "2027-02-28",
    });
  });

  it("variación: sin dato no hay variación y sin base no hay porcentaje (regla 11)", () => {
    expect(variacion(null, 10)).toBeNull();
    expect(variacion(10, null)).toBeNull();
    expect(variacion(15, 10)).toEqual({ diferencia: 5, pct: 50, sentido: "sube" });
    expect(variacion(5, 10)).toEqual({ diferencia: -5, pct: -50, sentido: "baja" });
    expect(variacion(7, 0)).toEqual({ diferencia: 7, pct: null, sentido: "sube" });
    expect(variacion(3, 3)?.sentido).toBe("igual");
  });

  it("une por clave y, en cortes de tiempo, por posición", () => {
    const porProfesional = unirComparacion(
      "profesional",
      [fila("a", 5), fila("b", 2)],
      [fila("a", 3), fila("c", 4)],
    );
    expect(porProfesional).toEqual([
      { clave: "a", valor: 5, anterior: 3 },
      { clave: "b", valor: 2, anterior: 0 },
      { clave: "c", valor: 0, anterior: 4 },
    ]);
    expect(unirComparacion("profesional", [fila("a", 5)], [])).toEqual([
      { clave: "a", valor: 5, anterior: null },
    ]);
    const porDia = unirComparacion(
      "dia",
      [fila("2026-10-02", 1), fila("2026-10-01", 2)],
      [fila("2026-09-01", 7)],
    );
    expect(porDia).toEqual([
      { clave: "2026-10-01", valor: 2, anterior: 7 },
      { clave: "2026-10-02", valor: 1, anterior: null },
    ]);
  });

  it("total sin filas es 'sin datos', no cero", () => {
    expect(totalDe([])).toBeNull();
    expect(totalDe([fila("a", 0)])).toBe(0);
  });
});

describe("orden y etiquetas", () => {
  it("día de la semana de lunes a domingo, edad por tramo y 'Sin dato' al final", () => {
    const dias = ordenarPorCorte("dia_semana", [
      fila("0", 9),
      fila("3", 1),
      fila("1", 2),
      fila(null, 5),
    ]);
    expect(dias.map((f) => f.clave)).toEqual(["1", "3", "0", null]);
    const edad = ordenarPorCorte("edad", [fila("60+", 1), fila("0-11", 1), fila("18-29", 9)]);
    expect(edad.map((f) => f.clave)).toEqual(["0-11", "18-29", "60+"]);
    const pro = ordenarPorCorte("profesional", [fila(null, 99), fila("a", 1), fila("b", 3)]);
    expect(pro.map((f) => f.clave)).toEqual(["b", "a", null]);
  });

  it("totales por clave suman el segundo corte", () => {
    expect(totalesPorClave([fila("a", 1, "x"), fila("a", 2, "y"), fila("b", 4, "x")])).toEqual([
      { clave: "a", clave2: "total", valor: 3, n: 3, pacientes: 3 },
      { clave: "b", clave2: "total", valor: 4, n: 4, pacientes: 4 },
    ]);
  });

  it("etiquetas legibles y 'Sin dato' honesto", () => {
    const nombres = { ...NOMBRES_VACIOS, profesionales: { p1: "Dra. Soto" } };
    expect(etiquetaClave("profesional", "p1", nombres)).toBe("Dra. Soto");
    expect(etiquetaClave("profesional", null, nombres)).toBe("Sin profesional");
    expect(etiquetaClave("box", null, nombres)).toBe("Sin box asignado");
    expect(etiquetaClave("comuna", null, nombres)).toBe("Sin dato");
    expect(etiquetaClave("dia_semana", "1", nombres)).toBe("Lunes");
    expect(etiquetaClave("hora", "09", nombres)).toBe("09:00");
    expect(etiquetaClave("prevision", "fonasa", nombres)).toBe("Fonasa");
    expect(etiquetaClave("edad", "18-29", nombres)).toBe("18 a 29 años");
    expect(etiquetaClave("canal", "reserva_en_linea", nombres)).toBe("Reserva en línea");
    expect(etiquetaClave("estado", "ausente", nombres)).toBe("Ausente");
    expect(etiquetaClave("estado", "cancelada", nombres)).toBe("Cancelada");
  });

  it("formatea minutos, conteos y dinero en cents con la moneda", () => {
    expect(formatearMinutos(45)).toBe("45 min");
    expect(formatearMinutos(120)).toBe("2 h");
    expect(formatearMinutos(750)).toBe("12 h 30 min");
    expect(formatearValor("dinero", 15000, "CLP")).toBe("$15.000"); // CLP sin decimales
    expect(formatearValor("conteo", 1234, "CLP")).toBe("1.234");
  });
});

describe("INF-05 · mapa de calor", () => {
  it("calcula % por franja, null sin horario y el resumen", () => {
    const mapa = armarMapaDeCalor([
      { diaSemana: 1, hora: 9, citas: 2, minutosOcupados: 60, minutosDisponibles: 60, dias: 4 },
      { diaSemana: 1, hora: 10, citas: 1, minutosOcupados: 15, minutosDisponibles: 60, dias: 4 },
      { diaSemana: 6, hora: 10, citas: 1, minutosOcupados: 30, minutosDisponibles: 0, dias: 4 },
    ]);
    expect(mapa.conHorario).toBe(true);
    expect(mapa.horas).toEqual([9, 10]);
    expect(mapa.filas.map((f) => f.diaSemana)).toEqual([1, 6]);
    const lunes9 = mapa.filas[0].celdas[0];
    expect(lunes9.pct).toBe(100);
    expect(lunes9.nivel).toBe(4);
    expect(lunes9.texto).toContain("Lunes 09:00: 100% ocupado");
    const sabado10 = mapa.filas[1].celdas[1];
    expect(sabado10.pct).toBeNull();
    expect(sabado10.texto).toContain("sin horario declarado");
    expect(mapa.ocupacionTotal).toBe(63); // 75 de 120
    expect(mapa.franjaMasLlena?.hora).toBe(9);
    expect(mapa.franjaMasLibre?.hora).toBe(10);
  });

  it("sin datos no inventa ocupación", () => {
    const mapa = armarMapaDeCalor([]);
    expect(mapa.ocupacionTotal).toBeNull();
    expect(mapa.filas).toEqual([]);
    expect(mapa.franjaMasLlena).toBeNull();
  });
});

describe("INF-07 · embudo", () => {
  const filas = [
    {
      canal: "reserva_en_linea",
      contactos: 10,
      conCita: 10,
      atendidos: 6,
      conPresupuesto: 4,
      aceptados: 2,
      pagados: 1,
    },
    {
      canal: "otros",
      contactos: 30,
      conCita: 20,
      atendidos: 15,
      conPresupuesto: 10,
      aceptados: 8,
      pagados: 6,
    },
  ];

  it("suma canales y calcula % del total y del paso anterior", () => {
    const total = sumarEmbudo(filas);
    expect(total.contactos).toBe(40);
    const pasos = pasosDelEmbudo(total);
    expect(pasos.map((p) => p.valor)).toEqual([40, 30, 21, 14, 10, 7]);
    expect(pasos[1].pctDelTotal).toBe(75);
    expect(pasos[2].pctDelAnterior).toBe(70);
    expect(pasos[0].pctDelAnterior).toBeNull();
    expect(mayorCaida(pasos)?.clave).toBe("conPresupuesto");
    expect(sumarEmbudo(filas, "reserva_en_linea").contactos).toBe(10);
  });

  it("sin finanzas 'pagado' queda sin dato, no en cero", () => {
    const sinPermiso = filas.map((f) => ({ ...f, pagados: null }));
    const pasos = pasosDelEmbudo(sumarEmbudo(sinPermiso));
    expect(pasos[5].valor).toBeNull();
    expect(pasos[5].pctDelTotal).toBeNull();
  });
});

describe("INF-06 / INF-09 · porcentajes con denominador", () => {
  it("ausentismo y ocupación de box son null sin base", () => {
    expect(ausentismo({ atenciones: 0, ausencias: 0 })).toBeNull();
    expect(ausentismo({ atenciones: 9, ausencias: 1 })).toBe(10);
    expect(ocupacionBox(30, null)).toBeNull();
    expect(ocupacionBox(30, 0)).toBeNull();
    expect(ocupacionBox(30, 120)).toBe(25);
    expect(porcentaje(1, 3)).toBe(33);
  });
});

describe("INF-04 · informes guardados", () => {
  it("valida la configuración y el corte", () => {
    expect(
      ConfigInforme.safeParse({ metrica: "citas", corte: "hora", periodo: "mes" }).success,
    ).toBe(true);
    expect(
      ConfigInforme.safeParse({ metrica: "produccion", corte: "hora", periodo: "mes" }).success,
    ).toBe(false);
    expect(
      ConfigInforme.safeParse({ metrica: "citas", corte: "total", periodo: "personalizado" })
        .success,
    ).toBe(false);
  });

  it("el período se guarda relativo a hoy", () => {
    const c = ConfigInforme.parse({ metrica: "citas", corte: "dia", periodo: "mes" });
    expect(rangoDeConfig(c, "2026-11-05")).toEqual({ desde: "2026-11-01", hasta: "2026-11-05" });
    const fijo = ConfigInforme.parse({
      metrica: "citas",
      corte: "dia",
      periodo: "personalizado",
      desde: "2026-01-01",
      hasta: "2026-01-31",
    });
    expect(rangoDeConfig(fijo, "2026-11-05")).toEqual({ desde: "2026-01-01", hasta: "2026-01-31" });
  });

  it("sugiere un nombre legible", () => {
    expect(nombreSugerido({ metrica: "atenciones", corte: "profesional", corte2: "total" })).toBe(
      "Atenciones por profesional",
    );
    expect(nombreSugerido({ metrica: "citas", corte: "dia_semana", corte2: "hora" })).toBe(
      "Citas por día de la semana y hora",
    );
  });
});
