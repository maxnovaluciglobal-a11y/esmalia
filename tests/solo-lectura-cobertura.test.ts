import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { ESCRITURA_EXENTA } from "@/lib/solo-lectura";

/**
 * Guardia del modo solo lectura (BIL-01, siguiente paso del PR #69).
 *
 * El chequeo vive en un middleware (`solo-lectura.middleware.ts`). El riesgo
 * de un middleware es olvidárselo: una server function nueva que escribe y
 * no lo usa deja a una clínica morosa crear o editar sin que nadie lo note.
 * Este test recorre TODAS las server functions del código (análisis
 * estático, sin base ni red) y falla si:
 *
 * - una POST no usa un middleware de escritura y no está en
 *   `ESCRITURA_EXENTA` con su motivo;
 * - una exenta usa igual el middleware, o la lista nombra una función que
 *   ya no existe;
 * - una que usa `requireEscritura` no recibe `clinicId` (el middleware no
 *   sabría qué clínica mirar), o `requireEscrituraPorFila` apunta a un campo
 *   que el input no tiene;
 * - una GET escribe en la base (si escribe, tiene que ser POST y pasar por
 *   el chequeo).
 */

const RAIZ = path.resolve(__dirname, "../src");
const MIDDLEWARES_DE_ESCRITURA = [
  "requireEscritura",
  "requireEscrituraPorFila",
  "requireEscrituraDeNotaClinica",
];

type ServerFn = {
  archivo: string;
  nombre: string;
  metodo: string;
  middlewares: string[];
  validador: string;
  handler: string;
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** Texto de las constantes de nivel superior, para seguir `schema.extend(...)`. */
function constantesDelArchivo(fuente: ts.SourceFile): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const st of fuente.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) {
        mapa.set(d.name.text, d.initializer.getText(fuente));
      }
    }
  }
  return mapa;
}

/** Texto del validador más el de las constantes que referencia (recursivo). */
function expandir(texto: string, constantes: Map<string, string>, vistos = new Set<string>()) {
  let total = texto;
  for (const [nombre, valor] of constantes) {
    if (vistos.has(nombre)) continue;
    if (new RegExp(`(?<![\\w$])${nombre}(?![\\w$])`).test(texto)) {
      vistos.add(nombre);
      total += "\n" + expandir(valor, constantes, vistos);
    }
  }
  return total;
}

function serverFnsDe(archivo: string): ServerFn[] {
  const texto = readFileSync(archivo, "utf8");
  if (!texto.includes("createServerFn")) return [];
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true);
  const constantes = constantesDelArchivo(fuente);
  const encontradas: ServerFn[] = [];

  for (const st of fuente.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      // Recorre la cadena createServerFn(...).middleware(...).validator(...).handler(...)
      let nodo: ts.Expression = d.initializer;
      const eslabones = new Map<string, ts.CallExpression>();
      let metodo: string | null = null;
      while (ts.isCallExpression(nodo)) {
        const callee = nodo.expression;
        if (ts.isPropertyAccessExpression(callee)) {
          eslabones.set(callee.name.text, nodo);
          nodo = callee.expression;
          continue;
        }
        if (ts.isIdentifier(callee) && callee.text === "createServerFn") {
          const opciones = nodo.arguments[0]?.getText(fuente) ?? "";
          metodo = /method:\s*"(\w+)"/.exec(opciones)?.[1] ?? "GET";
        }
        break;
      }
      if (!metodo) continue;

      const mw = eslabones.get("middleware")?.arguments[0];
      const middlewares =
        mw && ts.isArrayLiteralExpression(mw) ? mw.elements.map((e) => e.getText(fuente)) : [];
      const val = eslabones.get("validator") ?? eslabones.get("inputValidator");
      encontradas.push({
        archivo: path.relative(RAIZ, archivo),
        nombre: d.name.text,
        metodo,
        middlewares,
        validador: val ? expandir(val.arguments[0]?.getText(fuente) ?? "", constantes) : "",
        handler: eslabones.get("handler")?.arguments[0]?.getText(fuente) ?? "",
      });
    }
  }
  return encontradas;
}

const TODAS = archivos(RAIZ).flatMap(serverFnsDe);
const POST = TODAS.filter((f) => f.metodo === "POST");
const GET = TODAS.filter((f) => f.metodo === "GET");

function middlewareDeEscritura(f: ServerFn): string | null {
  for (const m of f.middlewares) {
    const nombre = m.split("(")[0].trim();
    if (MIDDLEWARES_DE_ESCRITURA.includes(nombre)) return m;
  }
  return null;
}

describe("modo solo lectura: toda escritura pasa por el chequeo central", () => {
  it("encuentra las server functions (el análisis no se quedó ciego)", () => {
    expect(POST.length).toBeGreaterThan(100);
    expect(GET.length).toBeGreaterThan(50);
  });

  it("toda POST usa un middleware de escritura o está exenta con motivo", () => {
    const sinChequeo = POST.filter((f) => !middlewareDeEscritura(f) && !ESCRITURA_EXENTA[f.nombre])
      .map((f) => `${f.archivo} → ${f.nombre}`)
      .sort();
    expect(sinChequeo).toEqual([]);
  });

  it("ninguna exenta usa igual el middleware, y la lista no nombra funciones que no existen", () => {
    const nombresPost = new Set(POST.map((f) => f.nombre));
    const inexistentes = Object.keys(ESCRITURA_EXENTA).filter((n) => !nombresPost.has(n));
    expect(inexistentes).toEqual([]);

    const contradictorias = POST.filter(
      (f) => ESCRITURA_EXENTA[f.nombre] && middlewareDeEscritura(f),
    ).map((f) => f.nombre);
    expect(contradictorias).toEqual([]);

    for (const [nombre, motivo] of Object.entries(ESCRITURA_EXENTA)) {
      expect(motivo.trim().length, `motivo de ${nombre}`).toBeGreaterThan(15);
    }
  });

  it("las que usan requireEscritura reciben clinicId", () => {
    const sinClinica = POST.filter((f) => middlewareDeEscritura(f) === "requireEscritura")
      .filter((f) => !/\bclinicId\b/.test(f.validador))
      .map((f) => `${f.archivo} → ${f.nombre}`);
    expect(sinClinica).toEqual([]);
  });

  it("requireEscrituraPorFila apunta a un campo que el input trae", () => {
    const malas = POST.flatMap((f) => {
      const m = middlewareDeEscritura(f);
      if (!m?.startsWith("requireEscrituraPorFila")) return [];
      const campo = /requireEscrituraPorFila\(\s*"\w+"\s*,\s*"(\w+)"\s*\)/.exec(m)?.[1];
      if (campo && new RegExp(`\\b${campo}\\b`).test(f.validador)) return [];
      return [`${f.archivo} → ${f.nombre} (${m})`];
    });
    expect(malas).toEqual([]);
  });

  it("las notas clínicas (excepción de urgencia) usan su middleware propio", () => {
    for (const nombre of ["saveClinicalNote", "signClinicalNote"]) {
      const f = POST.find((x) => x.nombre === nombre);
      expect(f, nombre).toBeDefined();
      expect(middlewareDeEscritura(f!)).toBe("requireEscrituraDeNotaClinica");
    }
    const otras = POST.filter(
      (f) =>
        middlewareDeEscritura(f) === "requireEscrituraDeNotaClinica" &&
        !["saveClinicalNote", "signClinicalNote"].includes(f.nombre),
    ).map((f) => f.nombre);
    expect(otras).toEqual([]);
  });

  it("ninguna GET escribe en la base", () => {
    const escriben = GET.filter((f) => /\.(insert|update|upsert|delete)\(/.test(f.handler)).map(
      (f) => `${f.archivo} → ${f.nombre}`,
    );
    expect(escriben).toEqual([]);
  });
});
