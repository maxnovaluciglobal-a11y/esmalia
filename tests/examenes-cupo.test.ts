import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  busquedaConPestana,
  parsePieza,
  pestanaVisible,
  validarBusquedaFicha,
} from "../src/components/ficha-busqueda";
import { parPorDefecto } from "../src/lib/examenes/antes-despues";
import {
  CUPO_POR_PLAN,
  GB,
  avisoDelCupo,
  cabeEnElCupo,
  estadoDelCupo,
} from "../src/lib/examenes/cupo";
import {
  INFO_TIPO,
  LIMITE_LIVIANO,
  LIMITE_PESADO,
  MB,
  MIME_ADMITIDOS,
  TIPOS_EXAMEN,
  acceptDe,
  esImagen,
  formatearBytes,
  formatoVisor,
  limitePorArchivo,
  mimeDeArchivo,
  nombreSeguro,
  normalizarPiezas,
  problemaDeArchivo,
} from "../src/lib/examenes/tipos";

/**
 * Ola 13 · frente A: cálculo del cupo y tipos de examen (tests puros).
 * Además fija que la app y las migraciones digan lo mismo: cupo por plan,
 * límite por archivo, tipos admitidos y MIME del bucket.
 */

const MIG_CUPO = readFileSync(
  new URL("../supabase/migrations/20261109100000_cupo_de_almacenamiento.sql", import.meta.url),
  "utf8",
);
const MIG_EXAMENES = readFileSync(
  new URL("../supabase/migrations/20261109100100_examenes_y_fotos_clinicas.sql", import.meta.url),
  "utf8",
);

describe("cupo por plan (propuesta 5 GB Solo / 20 GB Clínica, decisión de Walter)", () => {
  it("la app y la migración tienen los mismos valores", () => {
    expect(CUPO_POR_PLAN.solo).toBe(5 * GB);
    expect(CUPO_POR_PLAN.clinica).toBe(20 * GB);
    expect(MIG_CUPO).toContain(`('solo', ${CUPO_POR_PLAN.solo})`);
    expect(MIG_CUPO).toContain(`('clinica', ${CUPO_POR_PLAN.clinica})`);
  });

  it("estado normal, aviso desde el 80 % y lleno al 100 %", () => {
    expect(estadoDelCupo(0, 100).nivel).toBe("normal");
    expect(estadoDelCupo(79, 100)).toMatchObject({ nivel: "normal", porcentaje: 79 });
    expect(estadoDelCupo(80, 100)).toMatchObject({ nivel: "aviso", porcentaje: 80 });
    // 99,9 % todavía no es lleno ni se muestra como 100.
    expect(estadoDelCupo(999, 1000)).toMatchObject({ nivel: "aviso", porcentaje: 99 });
    expect(estadoDelCupo(100, 100)).toMatchObject({ nivel: "lleno", porcentaje: 100, restante: 0 });
    // Si el uso pasó el cupo (se bajó el cupo después), no se pasa de 100.
    expect(estadoDelCupo(150, 100)).toMatchObject({ nivel: "lleno", porcentaje: 100, restante: 0 });
    expect(estadoDelCupo(10, 0).nivel).toBe("lleno");
  });

  it("cabe un archivo hasta el borde exacto, igual que el trigger", () => {
    expect(cabeEnElCupo(6000, 10000, 4000)).toBe(true);
    expect(cabeEnElCupo(6000, 10000, 4001)).toBe(false);
  });

  it("el aviso cambia con el nivel", () => {
    expect(avisoDelCupo(estadoDelCupo(10, 100))).toBeNull();
    expect(avisoDelCupo(estadoDelCupo(85, 100))).toContain("85 %");
    expect(avisoDelCupo(estadoDelCupo(100, 100))).toContain("No se pueden subir");
  });
});

describe("tipos de examen", () => {
  it("son los mismos en la app y en el CHECK de la tabla", () => {
    const check = MIG_EXAMENES.match(/patient_exams_kind_check check \(\s*kind in \(([^)]*)\)/);
    expect(check).not.toBeNull();
    const enSql = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(enSql).toEqual([...TIPOS_EXAMEN]);
    for (const t of TIPOS_EXAMEN) expect(INFO_TIPO[t].etiqueta).toBeTruthy();
  });

  it("el límite por archivo es el mismo en la app y en la base", () => {
    expect(limitePorArchivo("cbct_dicom")).toBe(200 * MB);
    expect(limitePorArchivo("escaneo_intraoral")).toBe(200 * MB);
    for (const t of TIPOS_EXAMEN.filter((t) => t !== "cbct_dicom" && t !== "escaneo_intraoral")) {
      expect(limitePorArchivo(t), t).toBe(20 * MB);
    }
    expect(MIG_EXAMENES).toContain(
      `when p_kind in ('cbct_dicom', 'escaneo_intraoral') then ${LIMITE_PESADO}::bigint`,
    );
    expect(MIG_EXAMENES).toContain(`else ${LIMITE_LIVIANO}::bigint`);
    // El techo del bucket es el límite más alto.
    expect(MIG_EXAMENES).toContain(`  ${LIMITE_PESADO}, -- 200 MB`);
  });

  it("los MIME admitidos son los del bucket", () => {
    const bloque = MIG_EXAMENES.slice(
      MIG_EXAMENES.indexOf("'clinical-exams',\n  false"),
      MIG_EXAMENES.indexOf("on conflict (id) do nothing"),
    );
    const enSql = [...bloque.matchAll(/'([a-z]+\/[a-z0-9.+-]+)'/g)].map((m) => m[1]);
    expect(enSql.sort()).toEqual([...MIME_ADMITIDOS].sort());
  });

  it("valida extensión y tamaño por tipo", () => {
    expect(problemaDeArchivo("foto_clinica", { name: "a.JPG", size: 1000 })).toBeNull();
    expect(problemaDeArchivo("foto_clinica", { name: "a.stl", size: 1000 })?.tipo).toBe(
      "extension",
    );
    expect(problemaDeArchivo("foto_clinica", { name: "a.jpg", size: 21 * MB })?.tipo).toBe(
      "tamano",
    );
    expect(
      problemaDeArchivo("escaneo_intraoral", { name: "arcada.stl", size: 150 * MB }),
    ).toBeNull();
    expect(problemaDeArchivo("cbct_dicom", { name: "ct.zip", size: 201 * MB })?.tipo).toBe(
      "tamano",
    );
    expect(problemaDeArchivo("panoramica", { name: "pano.dcm", size: 5 * MB })).toBeNull();
    expect(problemaDeArchivo("documento", { name: "x.pdf", size: 0 })?.tipo).toBe("vacio");
    expect(acceptDe("escaneo_intraoral")).toBe(".stl,.ply,.obj,.zip");
  });

  it("decide el MIME por la extensión (el navegador manda vacío para STL o DICOM)", () => {
    expect(mimeDeArchivo("arcada.stl", "")).toBe("model/stl");
    expect(mimeDeArchivo("ct.DCM", "application/octet-stream")).toBe("application/dicom");
    expect(mimeDeArchivo("foto.jpeg", "")).toBe("image/jpeg");
    expect(mimeDeArchivo("raro", "text/html")).toBe("application/octet-stream");
    expect(esImagen("image/webp")).toBe(true);
    expect(esImagen("application/pdf")).toBe(false);
  });

  it("formato de visor para el frente B", () => {
    expect(formatoVisor("arcada.STL", "model/stl")).toBe("stl");
    expect(formatoVisor("malla.ply", "")).toBe("ply");
    expect(formatoVisor("malla.obj", "")).toBe("obj");
    expect(formatoVisor("ct.dcm", "")).toBe("dicom");
    expect(formatoVisor("serie.zip", "application/dicom")).toBe("dicom");
    expect(formatoVisor("foto.jpg", "image/jpeg")).toBeNull();
    expect(formatoVisor("serie.zip", "application/zip")).toBeNull();
  });

  it("piezas, bytes y nombres seguros", () => {
    expect(normalizarPiezas([36, 11, 36, 19, 85])).toEqual([11, 36, 85]);
    expect(formatearBytes(512)).toBe("512 B");
    expect(formatearBytes(1536)).toBe("1,5 KB");
    expect(formatearBytes(20 * MB)).toBe("20 MB");
    expect(formatearBytes(5 * GB)).toBe("5 GB");
    expect(formatearBytes(-1)).toBe("Sin datos");
    expect(nombreSeguro("Radiografía pieza 16.jpg")).toBe("Radiografia_pieza_16.jpg");
    expect(nombreSeguro("../../etc")).toBe("etc");
  });
});

describe("FIC-17: pestaña Exámenes y filtro por pieza en la URL", () => {
  it("la pestaña es clínica y la pieza solo vale en Exámenes", () => {
    expect(pestanaVisible("examenes", false)).toBe("resumen");
    expect(validarBusquedaFicha({ pestana: "examenes", pieza: "36" })).toEqual({
      pestana: "examenes",
      pieza: 36,
    });
    expect(validarBusquedaFicha({ pestana: "notas", pieza: "36" })).toEqual({ pestana: "notas" });
    expect(parsePieza("19")).toBeNull();
    expect(parsePieza(85)).toBe(85);
    expect(busquedaConPestana({ pestana: "examenes", pieza: 36 }, "notas")).toEqual({
      pestana: "notas",
    });
  });
});

describe("antes y después: par por defecto", () => {
  const foto = (id: string, takenOn: string, photoSessionId: string | null = null) => ({
    id,
    takenOn,
    createdAt: `${takenOn}T10:00:00Z`,
    photoSessionId,
  });

  it("toma la primera foto de 'antes' y la última de 'después'", () => {
    const sesiones = [
      { id: "s1", stage: "antes" as const },
      { id: "s2", stage: "despues" as const },
      { id: "s3", stage: "control" as const },
    ];
    const fotos = [
      foto("a", "2026-01-10"),
      foto("b", "2026-02-01", "s1"),
      foto("c", "2026-05-01", "s2"),
      foto("d", "2026-06-01", "s3"),
    ];
    expect(parPorDefecto(fotos, sesiones)).toEqual(["b", "c"]);
  });

  it("sin etapas, la más antigua contra la más nueva; con menos de dos, nada", () => {
    expect(parPorDefecto([foto("x", "2026-03-01"), foto("y", "2026-01-01")], [])).toEqual([
      "y",
      "x",
    ]);
    expect(parPorDefecto([foto("x", "2026-03-01")], [])).toBeNull();
  });
});
