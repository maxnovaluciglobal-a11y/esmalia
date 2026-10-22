import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  esTextoVisible,
  textoJsx,
  textosDeInterfaz,
  todosLosLiterales,
  type Texto,
} from "./helpers/textos-ui";

// Guardia del tuteo neutro (09-oct-2026): Esmalia le habla a clínicas de
// Chile, México, Colombia, Perú y Argentina, así que la interfaz usa "tú"
// sin voseo. El PR #26 pasó la interfaz a tuteo, pero 35 mensajes de error
// del servidor ("Revisá los datos y volvé a intentar") siguieron en voseo
// porque nadie los veía hasta que fallaba algo.
//
// También las formas con pronombre pegado (avisale, escribiles), que no
// llevan tilde y se escaparon de la primera versión del test.
// El 10-oct se colaron "Detectala" y "creés" en /recursos/fugas-clinica-dental:
// la carpeta sí se escaneaba, pero esas formas no estaban en la lista. Se
// sumaron junto con otras del mismo tipo (subjuntivo/presente con tilde y
// enclíticos de imperativo).
// Lista de formas verbales de voseo, no un detector genérico: con tilde final
// en la segunda persona (revisá, tenés, podés) son inequívocas en español.
// `\b` no sirve: en JS trata la "á" como no-letra, así que "esperá" calzaba
// dentro de "esperábamos". Los límites se marcan con letras Unicode.
const VOSEO =
  /(?<!\p{L})(?:probá|revisá|intentá|reintentá|volvé|elegí|describí|escribí|completá|ingresá|mirá|hacé|tenés|podés|querés|necesitás|sabés|confirmás|agregá|guardá|cargá|seleccioná|confirmá|esperá|usá|abrí|cerrá|buscá|creá|activá|editá|borrá|subí|descargá|tocá|pegá|copiá|contactá|avisá|llamá|avisale|avisales|escribile|escribiles|contale|contales|decile|mandale|mandales|pedile|llamale|miralo|miralos|detectala|detectalo|creés|evitá|fijate|acordate|pensás|decís|perdés|pagás|cobrás|empezá|calculá|compará|conocé|enterate)(?!\p{L})/iu;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** Una línea de comentario (// … o * … dentro de un bloque /** *\/). */
function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*");
}

describe("tuteo neutro", () => {
  it("ningún texto del código usa voseo", () => {
    const raiz = path.resolve(__dirname, "../src");
    const hallazgos: string[] = [];
    for (const archivo of archivos(raiz)) {
      readFileSync(archivo, "utf8")
        .split("\n")
        .forEach((linea, i) => {
          if (!esComentario(linea) && VOSEO.test(linea)) {
            hallazgos.push(`${path.relative(raiz, archivo)}:${i + 1}: ${linea.trim()}`);
          }
        });
    }
    expect(hallazgos).toEqual([]);
  });
});

// ─── NAV-12 (Ola 1): más controles de texto de interfaz ──────────────────
//
// Mismo espíritu que el voseo: una lista de formas inequívocas, no un
// detector genérico. Miran solo TEXTO PARA PERSONAS (literales con frase o
// palabra en mayúscula y texto de JSX, ver `tests/helpers/textos-ui.ts`), así
// que identificadores internos como `"/dashboard"`, `email-sandbox` o
// `HYGIENE_RECALL_COOLDOWN_MS` no cuentan.

const RAIZ_SRC = path.resolve(__dirname, "../src");

/** Trato formal: la interfaz tutea ("ingresa", no "ingrese"). */
const USTED =
  /(?<![\p{L}_-])(?:usted|ustedes|ingrese|seleccione|haga clic|verifique|comuníquese|contáctenos|presione|introduzca|digite|intente nuevamente|vuelva a intentar|espere un momento)(?![\p{L}_-])/iu;

/** Plurales rotos: "1 piezas", "los 1". */
const PLURAL_ROTO =
  /(?<![\p{L}\d.,])1 (?:piezas|citas|pacientes|días|horas|minutos|meses|años|tratamientos|sesiones|cuotas|pagos|mensajes|filas|resultados|notas|profesionales|sucursales|boxes|presupuestos|recordatorios|prestaciones|dientes|semanas|veces)(?!\p{L})|(?<!\p{L})(?:los|las) 1(?![\d.,])/iu;

/** Anglicismos que tienen palabra en español en la interfaz. */
const ANGLICISMOS = /(?<![\p{L}_-])(?:dashboard|compliance|sandbox|recall)(?![\p{L}_-])/iu;

/**
 * Portugués (el producto tuvo plantillas brasileñas en su origen). Se mira en
 * TODO literal, no solo en el visible: `{paciente_nome}` es una variable de
 * plantilla que termina en el mensaje al paciente.
 */
const PORTUGUES =
  /(?<!\p{L})(?:atual|atualizar|atualizado|aluguel|você|não|também|agendamento|cadastro|endereço|telefone|obrigatório|senha|usuário|orçamento|paciente_nome|dentista_nome)(?!\p{L})/iu;

/**
 * Excepciones con motivo (archivo relativo a src/ → fragmento exacto). Vacía
 * a propósito: sumar una solo si el texto es un nombre propio o una cita.
 */
const PERMITIDOS: { archivo: string; fragmento: string; motivo: string }[] = [];

function permitido(archivo: string, texto: string): boolean {
  return PERMITIDOS.some((p) => p.archivo === archivo && texto.includes(p.fragmento));
}

function hallazgosDe(regla: RegExp, textos: Texto[]): string[] {
  return textos
    .filter((t) => regla.test(t.texto) && !permitido(t.archivo, t.texto))
    .map((t) => `${t.archivo}:${t.linea}: ${t.texto.trim().slice(0, 120)}`);
}

describe("textos de interfaz (NAV-12)", () => {
  const visibles = textosDeInterfaz(RAIZ_SRC);

  it("el extractor encuentra textos reales y descarta identificadores", () => {
    expect(visibles.length).toBeGreaterThan(1000);
    expect(esTextoVisible("Guardar cambios")).toBe(true);
    expect(esTextoVisible("Guardar")).toBe(true);
    expect(esTextoVisible("/dashboard")).toBe(false);
    expect(esTextoVisible("sandbox")).toBe(false);
    expect(esTextoVisible("recall_due")).toBe(false);
    expect(textoJsx("        Volver al panel")).toEqual(["Volver al panel"]);
    expect(textoJsx("  DEFAULT_EMAIL_SANDBOX,")).toEqual([]);
    expect(textoJsx('<span className="x">Hola equipo</span>')).toEqual(["Hola equipo"]);
  });

  it("las reglas detectan lo que tienen que detectar", () => {
    expect(USTED.test("Ingrese su RUT")).toBe(true);
    expect(USTED.test("animate-pulse rounded")).toBe(false);
    expect(PLURAL_ROTO.test("Quedan 1 piezas")).toBe(true);
    expect(PLURAL_ROTO.test("Mostrando los 1 resultados")).toBe(true);
    expect(PLURAL_ROTO.test("Quedan 11 piezas")).toBe(false);
    expect(PLURAL_ROTO.test("Los 10 más usados")).toBe(false);
    expect(ANGLICISMOS.test("Volver al dashboard")).toBe(true);
    expect(ANGLICISMOS.test("DEFAULT_EMAIL_SANDBOX")).toBe(false);
    expect(PORTUGUES.test("Hola {paciente_nome}")).toBe(true);
    expect(PORTUGUES.test("Valor atual")).toBe(true);
    expect(PORTUGUES.test("Valor actual")).toBe(false);
  });

  it("sin trato formal (usted)", () => {
    expect(hallazgosDe(USTED, visibles)).toEqual([]);
  });

  it("sin plurales rotos ('1 piezas', 'los 1')", () => {
    expect(hallazgosDe(PLURAL_ROTO, visibles)).toEqual([]);
  });

  it("sin anglicismos (Dashboard, Compliance, Sandbox, Recall)", () => {
    expect(hallazgosDe(ANGLICISMOS, visibles)).toEqual([]);
  });

  it("sin portugués, ni en variables de plantilla", () => {
    expect(hallazgosDe(PORTUGUES, todosLosLiterales(RAIZ_SRC))).toEqual([]);
  });

  it("cada excepción explica su motivo", () => {
    for (const p of PERMITIDOS) expect(p.motivo.trim().length).toBeGreaterThan(10);
  });
});
