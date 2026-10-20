import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PastillaConexionVista } from "@/components/pastilla-conexion";
import { resolverFlag } from "@/lib/flags";
import { accionesRapidas, claseItemNav, propsItemNav, textoConexion } from "@/lib/shell-v2";

const leer = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

describe("shell A+ (flag shell-v2)", () => {
  it("el flag arranca apagado", () => {
    expect(resolverFlag({})).toBe(false);
  });

  describe("ítems del nav lateral", () => {
    it("con el flag apagado quedan las clases de siempre", () => {
      expect(claseItemNav(true, false)).toBe(
        "flex items-center gap-3 rounded-md border px-3 py-2 text-[15px] transition-colors border-brand/50 text-brand-800",
      );
      expect(claseItemNav(false, false)).toBe(
        "flex items-center gap-3 rounded-md border px-3 py-2 text-[15px] transition-colors border-transparent text-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
      );
    });

    it("con el flag encendido usan --row-h y el activo lleva el filete ocre", () => {
      const activo = claseItemNav(true, true);
      const inactivo = claseItemNav(false, true);
      expect(activo).toContain("min-h-(--row-h)");
      expect(inactivo).toContain("min-h-(--row-h)");
      expect(activo).toContain("before:bg-brand-on-night");
      expect(inactivo).not.toContain("before:");
      expect(inactivo).toContain("text-on-night-2");
    });

    it("solo el ítem activo lleva aria-current=page, con y sin flag", () => {
      for (const v2 of [false, true]) {
        expect(propsItemNav(true, v2)["aria-current"]).toBe("page");
        expect(propsItemNav(false, v2)["aria-current"]).toBeUndefined();
      }
    });
  });

  describe("pastilla de conexión", () => {
    it("dice el estado y los pendientes reales de la cola", () => {
      expect(textoConexion({ online: true, pendientes: 0 })).toBe("En línea");
      expect(textoConexion({ online: false, pendientes: 0 })).toBe("Sin conexión");
      expect(textoConexion({ online: false, pendientes: 1 })).toBe("Sin conexión · 1 pendiente");
      expect(textoConexion({ online: false, pendientes: 2 })).toBe("Sin conexión · 2 pendientes");
      expect(textoConexion({ online: true, pendientes: 3 })).toBe("En línea · 3 pendientes");
    });

    it("se pinta con tokens y marca el estado", () => {
      const sin = renderToStaticMarkup(
        createElement(PastillaConexionVista, { online: false, pendientes: 2 }),
      );
      expect(sin).toContain('data-estado="sin-conexion"');
      expect(sin).toContain("Sin conexión · 2 pendientes");
      expect(sin).toContain("text-warning");
      const con = renderToStaticMarkup(
        createElement(PastillaConexionVista, { online: true, pendientes: 0 }),
      );
      expect(con).toContain('data-estado="en-linea"');
      expect(con).toContain("bg-success");
    });
  });

  describe("acciones del buscador ⌘K", () => {
    it("recepción puede agendar y abrir caja", () => {
      expect(accionesRapidas("reception").map((a) => a.label)).toEqual([
        "Nueva cita",
        "Abrir caja",
      ]);
    });

    it("solo ofrece lo que el rol puede hacer", () => {
      expect(accionesRapidas("dentist").map((a) => a.id)).toEqual(["nueva-cita"]);
      expect(accionesRapidas("accounting").map((a) => a.id)).toEqual(["abrir-caja"]);
      expect(accionesRapidas("assistant")).toEqual([]);
      expect(accionesRapidas(null)).toEqual([]);
    });

    it("filtra por lo escrito, sin mayúsculas", () => {
      expect(accionesRapidas("owner", "CAJA").map((a) => a.id)).toEqual(["abrir-caja"]);
      expect(accionesRapidas("owner", "paciente")).toEqual([]);
    });
  });

  describe("con el flag apagado el shell no cambia", () => {
    const shell = leer("src/components/app-shell.tsx");
    const tabla = leer("src/components/ui/table.tsx");
    const franja = leer("src/components/status-strip.tsx");

    it("el aside conserva bg-sidebar y la tinta solo entra con el flag", () => {
      expect(shell).toMatch(
        /shellV2\s*\?\s*"dark border-r border-night-line bg-night text-on-night"/,
      );
      expect(shell).toContain(': "border-r border-border bg-sidebar"');
      expect(shell).toContain('data-shell-v2={shellV2 ? "" : undefined}');
    });

    it("la altura de fila de la tabla depende de data-shell-v2", () => {
      expect(tabla).toContain("[[data-shell-v2]_&]:h-(--row-h)");
      expect(tabla.match(/--row-h/g)).toHaveLength(1);
    });

    it("sin flag siguen los banners de conexión y de sincronización", () => {
      expect(franja).toContain("return <OfflineBanner />;");
      expect(franja).toContain("return <PendingSyncBanner userId={access.userId} />;");
      // Con el flag, fallidos y conflictos siguen a la vista (piden decisión).
      expect(franja).toContain("<PendingSyncBanner userId={access.userId} soloAccionables />");
    });
  });
});
