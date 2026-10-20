import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guardia tipográfica A+ (19-oct-2026). Las fuentes salen del propio sitio
// (fontsource), porque la CSP solo permite `font-src 'self'` y no queremos
// una conexión a Google. Cormorant queda para títulos, Instrument Sans para el
// texto y la UI, y Geist Mono solo para datos con la utilidad `cifra`.

const RAIZ = path.resolve(__dirname, "..");
const SRC = path.join(RAIZ, "src");
const PUBLIC = path.join(RAIZ, "public");
const STYLES = readFileSync(path.join(SRC, "styles.css"), "utf8");

function archivos(dir: string, extensiones: RegExp): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta, extensiones);
    return extensiones.test(nombre) ? [ruta] : [];
  });
}

const relativo = (ruta: string) => path.relative(RAIZ, ruta);

describe("tipografía A+", () => {
  it("styles.css solo importa fuentes de fontsource", () => {
    const imports = [...STYLES.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
    const deFuentes = imports.filter((i) => !["tailwindcss", "tw-animate-css"].includes(i));
    expect(deFuentes.length).toBeGreaterThan(0);
    for (const i of deFuentes) expect(i).toMatch(/^@fontsource(?:-variable)?\//);

    // Las @font-face escritas a mano también apuntan a fontsource.
    const urls = [...STYLES.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    for (const u of urls) expect(u).toMatch(/node_modules\/@fontsource(?:-variable)?\//);
  });

  it("no hay Google Fonts en src/ ni en public/", () => {
    const conGoogle = [
      ...archivos(SRC, /\.(tsx?|css|html|md)$/),
      ...archivos(PUBLIC, /\.(html|css|js|json|webmanifest|svg)$/),
    ].filter((ruta) => /fonts\.(?:googleapis|gstatic)\.com/.test(readFileSync(ruta, "utf8")));
    expect(conGoogle.map(relativo)).toEqual([]);
  });

  it("no quedan las fuentes anteriores (Lora, Manrope, Esmalia Cifras) en src/", () => {
    const conViejas = archivos(SRC, /\.(tsx?|css)$/).filter((ruta) =>
      /\b(?:Lora|Manrope|Esmalia Cifras)\b|@fontsource\/(?:lora|manrope)/i.test(
        readFileSync(ruta, "utf8"),
      ),
    );
    expect(conViejas.map(relativo)).toEqual([]);
  });

  it("package.json no depende de las fuentes anteriores", () => {
    const pkg = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps).not.toContain("@fontsource/lora");
    expect(deps).not.toContain("@fontsource/manrope");
    expect(deps).toContain("@fontsource-variable/instrument-sans");
    expect(deps).toContain("@fontsource-variable/geist-mono");
  });

  it("define las familias de texto y de datos, y la utilidad cifra", () => {
    expect(STYLES).toMatch(/--font-body:\s*"Instrument Sans"/);
    expect(STYLES).toMatch(/--font-data:\s*"Geist Mono"/);
    expect(STYLES).toMatch(/--font-heading:\s*"Cormorant Garamond"/);
    expect(STYLES).toMatch(/--font-mono:\s*var\(--font-data\)/);
    expect(STYLES).toMatch(
      /@utility cifra\s*\{[^}]*font-family:\s*var\(--font-data\);[^}]*font-variant-numeric:\s*tabular-nums;/,
    );
  });

  it("ya no mezcla los dígitos de la app con otra fuente por unicode-range", () => {
    expect(STYLES).not.toMatch(/:root:has\(\[data-app-shell\]\)/);
  });

  it("nadie usa la clase font-heading, que no existe en el tema", () => {
    // `--font-heading` es una variable de :root, no un token de @theme: la
    // clase no generaba CSS. Los títulos usan `font-display`.
    const conClase = archivos(SRC, /\.tsx?$/).filter((ruta) =>
      /\bfont-heading\b/.test(readFileSync(ruta, "utf8")),
    );
    expect(conClase.map(relativo)).toEqual([]);
  });
});
