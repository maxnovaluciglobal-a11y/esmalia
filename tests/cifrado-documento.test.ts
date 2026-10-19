import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  documentoQuedoEnClaro,
  idsConDocumentoEnClaro,
  mensajeDocumentoEnClaro,
} from "../src/lib/patients/documento-cifrado";
import { vigilarCifradoDeDocumento } from "../src/lib/patients/documento-cifrado.server";

/**
 * Cifrado del documento de identidad (SEG-03 / GOB-02). Tests puros: leen
 * las migraciones como texto y usan un cliente simulado. El backfill y el
 * trigger se probaron contra una base local al escribir la migración.
 */

const DIR = new URL("../supabase/migrations/", import.meta.url);
const ARCHIVOS = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const MIGRACION = readFileSync(
  new URL("20261019160100_cifrado_documento_backfill.sql", DIR),
  "utf8",
);

/** Última definición (por orden de migración) de una función de public. */
function ultimaDefinicion(funcion: string): { archivo: string; cuerpo: string } {
  let ultima: { archivo: string; cuerpo: string } | null = null;
  const inicio = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${funcion}\\(`, "gi");
  for (const archivo of ARCHIVOS) {
    const sql = readFileSync(new URL(archivo, DIR), "utf8");
    for (const m of sql.matchAll(inicio)) {
      const resto = sql.slice(m.index);
      // Hasta el cierre del cuerpo con dollar quoting ($$ o $function$).
      const fin = resto.search(/\$(function)?\$;\s*$/m);
      ultima = { archivo, cuerpo: resto.slice(0, fin === -1 ? 3000 : fin) };
    }
  }
  if (!ultima) throw new Error(`No se encontró public.${funcion}`);
  return ultima;
}

describe("documentoQuedoEnClaro", () => {
  it("documento escrito sin cifrar → en claro", () => {
    expect(
      documentoQuedoEnClaro({ id: "a", document_id: "12.345.678-9", document_id_enc: null }),
    ).toBe(true);
  });

  it("documento cifrado → bien", () => {
    expect(
      documentoQuedoEnClaro({ id: "a", document_id: "12.345.678-9", document_id_enc: "\\xc30d04" }),
    ).toBe(false);
  });

  it("sin documento o en blanco → no hay nada que cifrar", () => {
    expect(documentoQuedoEnClaro({ id: "a", document_id: null, document_id_enc: null })).toBe(
      false,
    );
    expect(documentoQuedoEnClaro({ id: "a", document_id: "   ", document_id_enc: null })).toBe(
      false,
    );
  });

  it("idsConDocumentoEnClaro devuelve solo ids, nunca el documento", () => {
    const ids = idsConDocumentoEnClaro([
      { id: "a", document_id: "1-9", document_id_enc: null },
      { id: "b", document_id: "2-7", document_id_enc: "\\x01" },
      { id: "c", document_id: null, document_id_enc: null },
    ]);
    expect(ids).toEqual(["a"]);
  });

  it("el mensaje para Sentry no lleva datos del paciente", () => {
    const m = mensajeDocumentoEnClaro("importacion", 3);
    expect(m).toContain("3 documento");
    expect(m).toContain("importación");
    expect(m).toContain("SEG-03");
  });
});

describe("vigilarCifradoDeDocumento", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function cliente(filas: unknown[] | null, error: { message: string } | null = null) {
    const inFn = vi.fn().mockResolvedValue({ data: filas, error });
    const select = vi.fn().mockReturnValue({ in: inFn });
    const from = vi.fn().mockReturnValue({ select });
    return {
      from,
      inFn,
      db: { from } as unknown as Parameters<typeof vigilarCifradoDeDocumento>[0],
    };
  }

  it("avisa a Sentry si un alta dejó el documento en claro", async () => {
    const { db, inFn } = cliente([
      { id: "p1", document_id: "12.345.678-9", document_id_enc: null },
    ]);
    const reportar = vi.fn();
    const ids = await vigilarCifradoDeDocumento(db, ["p1"], "alta", reportar);
    expect(inFn).toHaveBeenCalledWith("id", ["p1"]);
    expect(ids).toEqual(["p1"]);
    expect(reportar).toHaveBeenCalledTimes(1);
    expect((reportar.mock.calls[0][0] as Error).message).not.toContain("12.345.678-9");
  });

  it("no avisa si quedó cifrado", async () => {
    const { db } = cliente([{ id: "p1", document_id: "12.345.678-9", document_id_enc: "\\x01" }]);
    const reportar = vi.fn();
    expect(await vigilarCifradoDeDocumento(db, ["p1"], "edicion", reportar)).toEqual([]);
    expect(reportar).not.toHaveBeenCalled();
  });

  it("sin ids no consulta la base", async () => {
    const { db, from } = cliente([]);
    await vigilarCifradoDeDocumento(db, [], "importacion", vi.fn());
    expect(from).not.toHaveBeenCalled();
  });

  it("si la verificación falla, no rompe el alta", async () => {
    const { db } = cliente(null, { message: "timeout" });
    const reportar = vi.fn();
    await expect(vigilarCifradoDeDocumento(db, ["p1"], "alta", reportar)).resolves.toEqual([]);
  });
});

describe("migración de cifrado", () => {
  it("set_patient_document_id tiene `extensions` en el search_path (regresión del 01-sep)", () => {
    // 20260822160000 lo agregó porque pgcrypto vive en `extensions`;
    // 20260901120000 y 20261014000000 lo volvieron a sacar y la función dejó
    // de poder cifrar. Ninguna redefinición futura puede repetirlo.
    const { archivo, cuerpo } = ultimaDefinicion("set_patient_document_id");
    // 20261019230000 (RLS aal2) la redefine para agregarle el guard de MFA,
    // copiando esta misma definición: vale cualquier redefinición posterior.
    expect(archivo >= "20261019160100_cifrado_documento_backfill.sql").toBe(true);
    expect(cuerpo).toMatch(/SET search_path = [^\n]*\bextensions\b/);
  });

  it("toda función que usa pgcrypto sin calificar tiene `extensions` en el search_path", () => {
    for (const fn of [
      "cifrar_documento_id",
      "set_patient_document_id",
      "get_patient_document_id",
    ]) {
      const { cuerpo } = ultimaDefinicion(fn);
      if (/(?<!extensions\.)\b(pgp_sym_encrypt|pgp_sym_decrypt|hmac)\(/.test(cuerpo)) {
        expect(cuerpo, fn).toMatch(/search_path (=|TO) [^\n]*'?extensions'?/);
      }
    }
  });

  it("un trigger cifra todo alta o cambio de documento (incluida la demo)", () => {
    expect(MIGRACION).toMatch(
      /CREATE TRIGGER patients_cifrar_documento\s+BEFORE INSERT OR UPDATE OF document_id ON public\.patients/,
    );
  });

  it("la función interna no la puede llamar nadie de la API", () => {
    expect(MIGRACION).toMatch(
      /REVOKE ALL ON FUNCTION public\.cifrar_documento_id\(text\) FROM PUBLIC, anon, authenticated;/,
    );
  });

  it("el backfill es idempotente y la verificación revierte si algo queda en claro", () => {
    expect(MIGRACION).toMatch(/AND p\.document_id_enc IS NULL;/);
    expect(MIGRACION).toMatch(/RAISE EXCEPTION 'Quedan % de % documentos sin cifrar\.'/);
    expect(MIGRACION).toMatch(
      /pgp_sym_decrypt\(document_id_enc, v_key\) IS DISTINCT FROM document_id/,
    );
  });

  it("todavía NO corta la lectura del texto en claro (eso es la Fase 1b)", () => {
    expect(MIGRACION).not.toMatch(/SET\s+document_id\s*=\s*NULL/i);
    expect(MIGRACION).not.toMatch(/DROP COLUMN/i);
  });
});
