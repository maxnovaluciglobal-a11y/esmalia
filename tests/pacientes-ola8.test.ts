import { describe, expect, it } from "vitest";

import {
  contarQuienesPasan,
  cumpleEsteMes,
  describirFiltros,
  edadEn,
  hayFiltros,
  normalizarFiltros,
  pasaFiltros,
  restarMeses,
  sinFiltrosDeFinanzas,
  sinVisitaHace,
  usaFinanzas,
  type FilaFiltrable,
} from "../src/lib/patients/filtros-pacientes";
import {
  CLASES_COLOR_ETIQUETA,
  COLORES_ETIQUETA,
  colorEtiqueta,
  errorDeNombreEtiqueta,
  estadoDeEtiquetas,
  ordenarEtiquetas,
} from "../src/lib/patients/etiquetas";
import {
  errorDeMotivoDeArchivo,
  MOTIVOS_DE_ARCHIVO_SUGERIDOS,
  tituloArchivoMasivo,
} from "../src/lib/patients/archivo";
import {
  ATAJOS_DE_PANTALLA,
  atajosQueCoinciden,
  expandirConSinonimos,
  unirSinRepetir,
} from "../src/lib/search";
import { accionesRapidas } from "../src/lib/shell";
import {
  esAtajoFiltrar,
  esAtajoNuevoPaciente,
  EVENTO_ABRIR_ATAJOS,
  gruposDeAtajos,
} from "../src/lib/atajos";

/**
 * Pruebas puras (sin base) de la Ola 8 · frente A: filtros de la lista y de
 * los segmentos (PAC-04/05/06), etiquetas (PAC-07), motivo de archivo
 * (PAC-15), sinónimos y atajos del ⌘K (NAV-04) y la hoja de atajos (NAV-05).
 */

const HOY = "2026-10-27";
const ctx = { hoy: HOY, zona: "America/Santiago" };
const ETQ_VIP = "11111111-1111-4111-8111-111111111111";
const ETQ_ORTO = "22222222-2222-4222-8222-222222222222";
const PROF = "33333333-3333-4333-8333-333333333333";

const fila = (cambios: Partial<FilaFiltrable> = {}): FilaFiltrable => ({
  nombre: "Ana Pérez",
  documento: "12.345.678-5",
  email: "ana@correo.cl",
  telefono: "+56911112222",
  sucursalId: "",
  profesionalId: PROF,
  estado: "activo",
  ultimaVisitaISO: "2026-09-10",
  proximoControl: null,
  saldo: null,
  faltantes: [],
  archivadaEl: null,
  creadaEl: "2025-01-10T12:00:00Z",
  fechaNacimiento: "1990-10-05",
  prevision: "fonasa",
  etiquetaIds: [],
  etiquetas: [],
  ...cambios,
});

describe("filtros de pacientes (PAC-05)", () => {
  it("normaliza: descarta claves y valores desconocidos", () => {
    expect(
      normalizarFiltros({
        conSaldo: "1",
        menores: true,
        prevision: "fonasa",
        sinVisitaMeses: "12",
        etiqueta: ETQ_VIP,
        estado: "borrado",
        otra: "x",
        sucursal: "no-es-uuid",
        desde: "2026/01/01",
      }),
    ).toEqual({
      conSaldo: true,
      menores: true,
      prevision: "fonasa",
      sinVisitaMeses: 12,
      etiqueta: ETQ_VIP,
    });
    expect(normalizarFiltros(null)).toEqual({});
    expect(normalizarFiltros([1, 2])).toEqual({});
    expect(normalizarFiltros({ sinVisitaMeses: 7, prevision: "inventada" })).toEqual({});
  });

  it("sin filtros todo pasa; hayFiltros lo detecta", () => {
    expect(hayFiltros({})).toBe(false);
    expect(hayFiltros({ menores: true })).toBe(true);
    expect(pasaFiltros(fila(), {}, ctx)).toBe(true);
  });

  it("con saldo: solo quien debe (null o 0 no cuentan)", () => {
    expect(pasaFiltros(fila({ saldo: 5000 }), { conSaldo: true }, ctx)).toBe(true);
    expect(pasaFiltros(fila({ saldo: 0 }), { conSaldo: true }, ctx)).toBe(false);
    expect(pasaFiltros(fila({ saldo: null }), { conSaldo: true }, ctx)).toBe(false);
  });

  it("sin próxima cita y fichas incompletas", () => {
    expect(pasaFiltros(fila({ proximoControl: "3 nov" }), { sinCita: true }, ctx)).toBe(false);
    expect(pasaFiltros(fila(), { sinCita: true }, ctx)).toBe(true);
    expect(pasaFiltros(fila({ faltantes: ["prevision"] }), { incompletas: true }, ctx)).toBe(true);
    expect(pasaFiltros(fila(), { incompletas: true }, ctx)).toBe(false);
  });

  it("cumpleaños del mes, en el mes de la clínica", () => {
    expect(cumpleEsteMes("1990-10-05", HOY)).toBe(true);
    expect(cumpleEsteMes("1990-11-05", HOY)).toBe(false);
    expect(cumpleEsteMes(null, HOY)).toBe(false);
    expect(pasaFiltros(fila({ fechaNacimiento: "2001-10-31" }), { cumpleMes: true }, ctx)).toBe(
      true,
    );
  });

  it("menores: edad cumplida a hoy; sin fecha no cuenta", () => {
    expect(edadEn("2008-10-27", HOY)).toBe(18);
    expect(edadEn("2008-10-28", HOY)).toBe(17);
    expect(edadEn(null, HOY)).toBeNull();
    expect(pasaFiltros(fila({ fechaNacimiento: "2008-10-28" }), { menores: true }, ctx)).toBe(true);
    expect(pasaFiltros(fila({ fechaNacimiento: "2008-10-27" }), { menores: true }, ctx)).toBe(
      false,
    );
    expect(pasaFiltros(fila({ fechaNacimiento: null }), { menores: true }, ctx)).toBe(false);
  });

  it("previsión, incluida la pendiente (sin cargar)", () => {
    expect(pasaFiltros(fila(), { prevision: "fonasa" }, ctx)).toBe(true);
    expect(pasaFiltros(fila(), { prevision: "isapre" }, ctx)).toBe(false);
    expect(pasaFiltros(fila({ prevision: null }), { prevision: "pendiente" }, ctx)).toBe(true);
    expect(pasaFiltros(fila(), { prevision: "pendiente" }, ctx)).toBe(false);
  });

  it("sin visita hace N meses: quien nunca vino no cuenta", () => {
    expect(restarMeses("2026-10-27", 6)).toBe("2026-04-27");
    expect(restarMeses("2026-08-31", 6)).toBe("2026-02-28");
    expect(restarMeses("2026-03-15", 12)).toBe("2025-03-15");
    expect(sinVisitaHace("2026-01-10", 6, HOY)).toBe(true);
    expect(sinVisitaHace("2026-06-10", 6, HOY)).toBe(false);
    expect(sinVisitaHace("", 6, HOY)).toBe(false);
  });

  it("etiqueta: la ficha tiene que tenerla", () => {
    expect(pasaFiltros(fila({ etiquetaIds: [ETQ_VIP] }), { etiqueta: ETQ_VIP }, ctx)).toBe(true);
    expect(pasaFiltros(fila({ etiquetaIds: [ETQ_ORTO] }), { etiqueta: ETQ_VIP }, ctx)).toBe(false);
  });

  it("la búsqueda por texto encuentra por etiqueta y tolera tildes", () => {
    expect(pasaFiltros(fila({ etiquetas: ["VIP"] }), { q: "vip" }, ctx)).toBe(true);
    expect(pasaFiltros(fila(), { q: "ana perez" }, ctx)).toBe(true);
    expect(pasaFiltros(fila(), { q: "12345678" }, ctx)).toBe(true);
    expect(pasaFiltros(fila(), { q: "zzz" }, ctx)).toBe(false);
  });

  it("rango de última visita: sin visitas no entra en un rango", () => {
    expect(pasaFiltros(fila(), { desde: "2026-09-01", hasta: "2026-09-30" }, ctx)).toBe(true);
    expect(pasaFiltros(fila({ ultimaVisitaISO: "" }), { hasta: "2026-09-30" }, ctx)).toBe(false);
  });

  it("los filtros se combinan (y) y se cuentan igual que en la lista", () => {
    const filas = [
      fila({ saldo: 1000, prevision: "fonasa" }),
      fila({ saldo: 1000, prevision: "isapre" }),
      fila({ saldo: null, prevision: "fonasa" }),
    ];
    expect(contarQuienesPasan(filas, { conSaldo: true, prevision: "fonasa" }, ctx)).toBe(1);
  });

  it("el saldo es un filtro de finanzas (regla 15)", () => {
    expect(usaFinanzas({ conSaldo: true })).toBe(true);
    expect(usaFinanzas({ menores: true })).toBe(false);
    expect(sinFiltrosDeFinanzas({ conSaldo: true, menores: true })).toEqual({ menores: true });
  });

  it("describe un segmento en palabras, con los ids resueltos", () => {
    expect(
      describirFiltros(
        {
          conSaldo: true,
          menores: true,
          prevision: "fonasa",
          etiqueta: ETQ_VIP,
          profesional: PROF,
        },
        { etiqueta: () => "VIP", profesional: () => "Dra. Soto" },
      ),
    ).toEqual(["Dra. Soto", "Con saldo", "Menores de edad", "Fonasa", "Etiqueta VIP"]);
    expect(describirFiltros({ etiqueta: ETQ_VIP })).toEqual(["Etiqueta (borrada)"]);
  });
});

describe("etiquetas (PAC-07)", () => {
  it("cada color de la paleta tiene clases de tokens (nada de colores sueltos)", () => {
    for (const c of COLORES_ETIQUETA) {
      expect(CLASES_COLOR_ETIQUETA[c]).toMatch(/^border-[a-z-0-9]+ bg-[a-z-0-9]+ text-[a-z-0-9]+$/);
      expect(CLASES_COLOR_ETIQUETA[c]).not.toMatch(/amber|emerald|sky|slate|zinc|red-|blue-/);
    }
    expect(colorEtiqueta("fucsia")).toBe("gris");
    expect(colorEtiqueta("verde")).toBe("verde");
  });

  it("valida el nombre: vacío, largo y repetido sin distinguir mayúsculas", () => {
    expect(errorDeNombreEtiqueta("  ")).toMatch(/Escribe/);
    expect(errorDeNombreEtiqueta("x".repeat(41))).toMatch(/40/);
    expect(errorDeNombreEtiqueta(" vip ", ["VIP"])).toMatch(/Ya existe/);
    expect(errorDeNombreEtiqueta("Ortodoncia 2026", ["VIP"])).toBeNull();
  });

  it("ordena por nombre en español", () => {
    expect(
      ordenarEtiquetas([{ nombre: "Ñandú" }, { nombre: "árbol" }, { nombre: "Zeta" }]).map(
        (e) => e.nombre,
      ),
    ).toEqual(["árbol", "Ñandú", "Zeta"]);
  });

  it("estado de cada etiqueta en una selección: todas, algunas o ninguna", () => {
    expect(estadoDeEtiquetas(["a", "b", "c"], [["a", "b"], ["a"]])).toEqual({
      a: "todas",
      b: "algunas",
      c: "ninguna",
    });
    expect(estadoDeEtiquetas(["a"], [])).toEqual({ a: "ninguna" });
  });
});

describe("archivar de forma segura (PAC-15)", () => {
  it("pide un motivo de al menos 3 letras y hasta 500", () => {
    expect(errorDeMotivoDeArchivo("")).toMatch(/por qué/);
    expect(errorDeMotivoDeArchivo("  ab ")).toMatch(/por qué/);
    expect(errorDeMotivoDeArchivo("x".repeat(501))).toMatch(/500/);
    for (const m of MOTIVOS_DE_ARCHIVO_SUGERIDOS) expect(errorDeMotivoDeArchivo(m)).toBeNull();
  });

  it("la confirmación masiva dice la cifra", () => {
    expect(tituloArchivoMasivo(1)).toBe("Archivar 1 ficha");
    expect(tituloArchivoMasivo(12)).toBe("Archivar 12 fichas");
  });
});

describe("⌘K con acciones y sinónimos (NAV-04)", () => {
  it("cobrar, pagar y abono llevan a Registrar pago", () => {
    for (const t of ["cobrar", "pagar", "abono", "Abonar"]) {
      expect(expandirConSinonimos(t)).toContain("Registrar pago");
      const acciones = unirSinRepetir(
        expandirConSinonimos(t).map((x) => accionesRapidas("owner", x)),
        (a) => a.id,
      );
      expect(acciones.map((a) => a.id)).toContain("registrar-pago");
    }
  });

  it("turno y hora llevan a Nueva cita", () => {
    for (const t of ["turno", "hora", "pedir hora"]) {
      const acciones = unirSinRepetir(
        expandirConSinonimos(t).map((x) => accionesRapidas("reception", x)),
        (a) => a.id,
      );
      expect(acciones.map((a) => a.id)).toContain("nueva-cita");
    }
  });

  it("configuración lleva a Ajustes; sin término no expande", () => {
    expect(expandirConSinonimos("configuración")).toEqual(["configuración", "Ajustes"]);
    expect(expandirConSinonimos("  ")).toEqual([""]);
  });

  it("los sinónimos no le dan acciones a un rol que no las tiene", () => {
    const acciones = unirSinRepetir(
      expandirConSinonimos("abono").map((x) => accionesRapidas("assistant", x)),
      (a) => a.id,
    );
    expect(acciones).toEqual([]);
  });

  it("atajos de pantalla: por permiso, y el de saldo solo con finanzas", () => {
    const todo = () => true;
    const sinFinanzas = (p: string) => p !== "finance:view";
    expect(atajosQueCoinciden(["saldo"], todo).map((a) => a.id)).toContain("pacientes-con-saldo");
    expect(atajosQueCoinciden(["saldo"], sinFinanzas).map((a) => a.id)).not.toContain(
      "pacientes-con-saldo",
    );
    expect(atajosQueCoinciden(["cumple"], todo).map((a) => a.id)).toEqual(["pacientes-cumpleanos"]);
    expect(atajosQueCoinciden([""], todo)).toEqual([]);
  });

  it("los atajos que filtran usan claves que entiende la lista", () => {
    for (const a of ATAJOS_DE_PANTALLA) {
      if (!a.href?.startsWith("/pacientes?")) continue;
      const params = Object.fromEntries(new URLSearchParams(a.href.split("?")[1]));
      const { etiquetas: _e, segmentos: _s, ...filtros } = params;
      if (Object.keys(filtros).length > 0)
        expect(hayFiltros(normalizarFiltros(filtros))).toBe(true);
    }
    expect(ATAJOS_DE_PANTALLA.find((a) => a.id === "ver-atajos")?.evento).toBe(EVENTO_ABRIR_ATAJOS);
  });

  it("unirSinRepetir conserva el orden de llegada", () => {
    expect(unirSinRepetir([[1, 2], [2, 3], [1]], String)).toEqual([1, 2, 3]);
  });
});

describe("hoja de atajos (NAV-05)", () => {
  const input = { tagName: "INPUT", type: "text" };

  it("N y F en Pacientes, nunca mientras se escribe ni con un diálogo abierto", () => {
    expect(esAtajoNuevoPaciente({ key: "n" })).toBe(true);
    expect(esAtajoNuevoPaciente({ key: "n", target: input })).toBe(false);
    expect(esAtajoFiltrar({ key: "f" })).toBe(true);
    expect(esAtajoFiltrar({ key: "F" })).toBe(true);
    expect(esAtajoFiltrar({ key: "f", metaKey: true })).toBe(false);
    expect(esAtajoFiltrar({ key: "f" }, true)).toBe(false);
  });

  it("muestra los atajos nuevos: buscador con sinónimos y Pacientes", () => {
    const grupos = gruposDeAtajos("⌘");
    const titulos = grupos.map((g) => g.titulo);
    expect(titulos).toContain("Pacientes");
    expect(titulos).toContain("En el buscador (⌘ K)");
    const pacientes = grupos.find((g) => g.titulo === "Pacientes")!;
    expect(pacientes.atajos.map((a) => a.teclas.join("+"))).toEqual(
      expect.arrayContaining(["N", "F", "Esc"]),
    );
    // Descripciones únicas dentro de cada grupo (son la key de React).
    for (const g of grupos)
      expect(new Set(g.atajos.map((a) => a.descripcion)).size).toBe(g.atajos.length);
  });
});
