import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CATALOGO_CHILE,
  posicionEnRango,
  prepararImportacion,
} from "../src/lib/arancel/catalogo-chile";
import {
  agruparPorEspecialidad,
  NOMBRE_ESPECIALIDAD,
  SIN_ESPECIALIDAD,
  SLUGS_ESPECIALIDAD,
  type Especialidad,
} from "../src/lib/arancel/especialidades";

/**
 * ADM-02 (especialidades) y ADM-03 (catálogo chileno propio). Puro: lee el
 * catálogo del código y la migración, sin base.
 */

const MIGRACION = readFileSync(
  new URL(
    "../supabase/migrations/20261024100000_especialidades_y_catalogo_arancel.sql",
    import.meta.url,
  ),
  "utf8",
);

function normalizar(s: string) {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

describe("catálogo semilla", () => {
  it("claves y nombres únicos", () => {
    const claves = CATALOGO_CHILE.map((i) => i.key);
    expect(new Set(claves).size).toBe(claves.length);
    const nombres = CATALOGO_CHILE.map((i) => normalizar(i.name));
    expect(new Set(nombres).size).toBe(nombres.length);
    for (const k of claves) expect(k).toMatch(/^[a-z0-9-]{3,60}$/);
  });

  it("cada ítem pertenece a una especialidad estándar y todas tienen ítems", () => {
    for (const i of CATALOGO_CHILE) expect(SLUGS_ESPECIALIDAD).toContain(i.specialty);
    for (const slug of SLUGS_ESPECIALIDAD)
      expect(CATALOGO_CHILE.some((i) => i.specialty === slug)).toBe(true);
  });

  it("rangos ordenados, positivos y enteros (CLP no tiene subunidad)", () => {
    for (const i of CATALOGO_CHILE) {
      if (!i.rangoClp) continue;
      const [min, max] = i.rangoClp;
      expect(Number.isInteger(min) && Number.isInteger(max), i.key).toBe(true);
      expect(min, i.key).toBeGreaterThan(0);
      expect(max, i.key).toBeGreaterThanOrEqual(min);
    }
  });

  it("no trae códigos Fonasa ni marcas MAI inventadas: los completa la clínica", () => {
    for (const i of CATALOGO_CHILE) {
      expect(i.fonasaCode).toBeNull();
      expect(i.isMai).toBe(false);
    }
  });

  it("duraciones razonables para proponer en la agenda", () => {
    for (const i of CATALOGO_CHILE) {
      if (i.durationMin === null) continue;
      expect(i.durationMin).toBeGreaterThanOrEqual(5);
      expect(i.durationMin).toBeLessThanOrEqual(240);
    }
  });
});

describe("importar del catálogo", () => {
  const [a, b, c] = CATALOGO_CHILE;

  it("copia nombre, especialidad, duración y rango; precio 0 por defecto", () => {
    const { filas, saltadas } = prepararImportacion([a.key], [], "CLP");
    expect(saltadas).toEqual([]);
    expect(filas).toEqual([
      {
        catalogKey: a.key,
        name: a.name,
        specialtySlug: a.specialty,
        durationMin: a.durationMin,
        fonasaCode: null,
        isMai: false,
        defaultPriceCents: 0,
        suggestedMinCents: a.rangoClp![0],
        suggestedMaxCents: a.rangoClp![1],
      },
    ]);
  });

  it("el piso del rango como precio inicial solo si se pide", () => {
    const { filas } = prepararImportacion([a.key], [], "CLP", "piso");
    expect(filas[0].defaultPriceCents).toBe(a.rangoClp![0]);
  });

  it("en otra moneda no copia el rango (está en CLP) ni pone precio", () => {
    const { filas } = prepararImportacion([a.key], [], "MXN", "piso");
    expect(filas[0]).toMatchObject({
      defaultPriceCents: 0,
      suggestedMinCents: null,
      suggestedMaxCents: null,
    });
  });

  it("no duplica: salta lo ya importado (por clave) o con el mismo nombre", () => {
    const { filas, saltadas } = prepararImportacion(
      [a.key, b.key, c.key, a.key, "no-existe"],
      [
        { name: "otra cosa", catalogKey: a.key },
        { name: b.name.toUpperCase(), catalogKey: null },
      ],
      "CLP",
    );
    expect(filas.map((f) => f.catalogKey)).toEqual([c.key]);
    expect(saltadas).toEqual([a.name, b.name]);
  });
});

describe("posición en el rango", () => {
  it("informa debajo, dentro, encima o sin rango", () => {
    expect(posicionEnRango(100, null, null)).toBe("sin-rango");
    expect(posicionEnRango(50, 100, 200)).toBe("debajo");
    expect(posicionEnRango(150, 100, 200)).toBe("dentro");
    expect(posicionEnRango(250, 100, 200)).toBe("encima");
    expect(posicionEnRango(250, 100, null)).toBe("dentro");
  });
});

describe("especialidades: el código y la migración dicen lo mismo", () => {
  it("el CHECK de slug lista exactamente los slugs del código", () => {
    const check = /check \(slug in \(([^)]+)\)\)/.exec(MIGRACION)?.[1] ?? "";
    const enSql = [...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(enSql).toEqual([...SLUGS_ESPECIALIDAD]);
  });

  it("la siembra crea cada slug con el nombre del código", () => {
    for (const slug of SLUGS_ESPECIALIDAD) {
      expect(MIGRACION).toMatch(new RegExp(`\\('${slug}',\\s+'${NOMBRE_ESPECIALIDAD[slug]}',`));
    }
  });

  it("cada nombre estándar se reconoce a sí mismo como alias", () => {
    for (const slug of SLUGS_ESPECIALIDAD) {
      expect(MIGRACION).toContain(`when '${normalizar(NOMBRE_ESPECIALIDAD[slug])}' then '${slug}'`);
    }
  });

  it("la siembra no va en un trigger de clinics (rompería el onboarding en producción)", () => {
    expect(MIGRACION).not.toMatch(/create trigger[\s\S]{0,80}on public\.clinics/i);
  });

  it("asegurar_especialidades exige ser miembro y no la ejecuta anon", () => {
    expect(MIGRACION).toContain("if not public.is_clinic_member(p_clinic_id) then");
    expect(MIGRACION).toContain(
      "revoke all on function public.asegurar_especialidades(uuid) from public, anon;",
    );
    expect(MIGRACION).toContain(
      "revoke all on function public.sembrar_especialidades(uuid) from public, anon, authenticated;",
    );
  });
});

describe("agrupar el arancel por especialidad", () => {
  const esp = (id: string, name: string, position: number): Especialidad => ({
    id,
    name,
    slug: null,
    isActive: true,
    position,
    defaultDurationMin: 30,
  });
  const especialidades = [esp("e2", "Endodoncia", 2), esp("e1", "Operatoria", 1)];

  it("en el orden de la clínica, con Sin especialidad al final", () => {
    const grupos = agruparPorEspecialidad(
      [
        { id: "p1", specialtyId: "e2" },
        { id: "p2", specialtyId: null },
        { id: "p3", specialtyId: "e1" },
        { id: "p4", specialtyId: "borrada" },
      ],
      especialidades,
    );
    expect(grupos.map((g) => g.titulo)).toEqual(["Operatoria", "Endodoncia", SIN_ESPECIALIDAD]);
    expect(grupos[2].items.map((i) => i.id)).toEqual(["p2", "p4"]);
  });

  it("no muestra grupos vacíos", () => {
    expect(agruparPorEspecialidad([{ id: "p", specialtyId: "e1" }], especialidades)).toHaveLength(
      1,
    );
  });
});
