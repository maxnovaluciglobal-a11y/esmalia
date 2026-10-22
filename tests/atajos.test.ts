import { describe, expect, it } from "vitest";

import {
  esAtajoAyuda,
  esAtajoBuscar,
  esAtajoGuardar,
  esAtajoNuevaCita,
  esCampoEditable,
  gruposDeAtajos,
  hayDialogoAbierto,
} from "@/lib/atajos";

// NAV-03 (`/` busca paciente) y NAV-05 lite (`?` muestra los atajos).

const boton = { tagName: "BUTTON" };
const texto = { tagName: "INPUT", type: "text" };

describe("atajos de teclado", () => {
  it("reconoce los campos donde se escribe", () => {
    expect(esCampoEditable(texto)).toBe(true);
    expect(esCampoEditable({ tagName: "INPUT" })).toBe(true);
    expect(esCampoEditable({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(esCampoEditable({ tagName: "TEXTAREA" })).toBe(true);
    expect(esCampoEditable({ tagName: "SELECT" })).toBe(true);
    expect(esCampoEditable({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(esCampoEditable({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(esCampoEditable(boton)).toBe(false);
    expect(esCampoEditable(null)).toBe(false);
  });

  it("`/` abre la búsqueda solo si nadie está escribiendo", () => {
    expect(esAtajoBuscar({ key: "/", target: boton })).toBe(true);
    expect(esAtajoBuscar({ key: "/", target: null })).toBe(true);
    expect(esAtajoBuscar({ key: "/", target: texto })).toBe(false);
    expect(esAtajoBuscar({ key: "/", target: boton, ctrlKey: true })).toBe(false);
    expect(esAtajoBuscar({ key: "/", target: boton, metaKey: true })).toBe(false);
    expect(esAtajoBuscar({ key: "/", target: boton }, true)).toBe(false);
    expect(esAtajoBuscar({ key: "/", target: boton, defaultPrevented: true })).toBe(false);
  });

  it("`?` abre la hoja de atajos (con Shift, como en casi todos los teclados)", () => {
    expect(esAtajoAyuda({ key: "?", target: boton })).toBe(true);
    expect(esAtajoAyuda({ key: "?", target: texto })).toBe(false);
  });

  it("`N` abre Nueva cita; ⌘/Ctrl + Enter guarda", () => {
    expect(esAtajoNuevaCita({ key: "n", target: boton })).toBe(true);
    expect(esAtajoNuevaCita({ key: "N", target: boton })).toBe(true);
    expect(esAtajoNuevaCita({ key: "n", target: texto })).toBe(false);
    expect(esAtajoNuevaCita({ key: "n", target: boton }, true)).toBe(false);
    expect(esAtajoGuardar({ key: "Enter", metaKey: true })).toBe(true);
    expect(esAtajoGuardar({ key: "Enter", ctrlKey: true })).toBe(true);
    expect(esAtajoGuardar({ key: "Enter" })).toBe(false);
  });

  it("detecta un diálogo abierto", () => {
    expect(hayDialogoAbierto({ querySelector: () => null })).toBe(false);
    expect(hayDialogoAbierto({ querySelector: () => ({}) as Element })).toBe(true);
  });

  it("la hoja lista ⌘K, / y los atajos de la agenda", () => {
    const mac = gruposDeAtajos("⌘").flatMap((g) => g.atajos.map((a) => a.teclas.join("+")));
    expect(mac).toContain("⌘+K");
    expect(mac).toContain("/");
    expect(mac).toContain("?");
    expect(mac).toContain("N");
    expect(gruposDeAtajos("Ctrl").flatMap((g) => g.atajos.map((a) => a.teclas[0]))).toContain(
      "Ctrl",
    );
  });
});
