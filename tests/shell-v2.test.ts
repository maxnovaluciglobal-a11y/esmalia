import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PastillaConexionVista } from "@/components/pastilla-conexion";
import { resolverFlag } from "@/lib/flags";
import {
  accionesRapidas,
  claseItemNav,
  decidirAbrirCaja,
  interpretarNuevaCita,
  leerNuevaCita,
  leerPedidoAbrirCaja,
  propsItemNav,
  textoConexion,
} from "@/lib/shell-v2";

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

  describe("las acciones del ⌘K abren el diálogo, no solo la página", () => {
    it("cada acción lleva el pedido en la URL", () => {
      const porId = Object.fromEntries(accionesRapidas("owner").map((a) => [a.id, a.href]));
      expect(porId).toEqual({
        "nueva-cita": "/agenda?nueva=1",
        "abrir-caja": "/cajas?abrir=1",
      });
    });

    it("agenda: lee ?nueva=1 aunque el parser lo entregue como número", () => {
      expect(leerNuevaCita(1)).toBe("1");
      expect(leerNuevaCita("1")).toBe("1");
      expect(leerNuevaCita(" abc ")).toBe("abc");
      expect(leerNuevaCita("")).toBeUndefined();
      expect(leerNuevaCita(undefined)).toBeUndefined();
      expect(leerNuevaCita({ a: 1 })).toBeUndefined();
      expect(leerNuevaCita(Number.NaN)).toBeUndefined();
    });

    it("agenda: 1 abre vacía; un id abre con ese paciente; vacío no abre", () => {
      expect(interpretarNuevaCita("1")).toEqual({ abrir: true, pacienteId: null });
      const id = "7f3c2a1e-0000-4000-8000-000000000001";
      expect(interpretarNuevaCita(id)).toEqual({ abrir: true, pacienteId: id });
      expect(interpretarNuevaCita(undefined)).toEqual({ abrir: false, pacienteId: null });
      expect(interpretarNuevaCita("  ")).toEqual({ abrir: false, pacienteId: null });
    });

    it("caja: solo 1 cuenta como pedido", () => {
      expect(leerPedidoAbrirCaja(1)).toBe("1");
      expect(leerPedidoAbrirCaja("1")).toBe("1");
      expect(leerPedidoAbrirCaja("0")).toBeUndefined();
      expect(leerPedidoAbrirCaja(true)).toBeUndefined();
      expect(leerPedidoAbrirCaja(undefined)).toBeUndefined();
    });

    it("caja: espera la carga, no abre un segundo turno y descarta si falla", () => {
      const base = { pedido: true, cargando: false, conError: false, cajaAbierta: false };
      expect(decidirAbrirCaja({ ...base, pedido: false })).toBe("nada");
      expect(decidirAbrirCaja({ ...base, cargando: true })).toBe("esperar");
      expect(decidirAbrirCaja(base)).toBe("abrir");
      expect(decidirAbrirCaja({ ...base, cajaAbierta: true })).toBe("ya-abierta");
      expect(decidirAbrirCaja({ ...base, conError: true })).toBe("descartar");
    });

    it("las rutas leen el pedido y lo borran de la URL", () => {
      const agenda = leer("src/routes/_authenticated/_clinic/agenda.tsx");
      expect(agenda).toContain("nueva: leerNuevaCita(search.nueva)");
      expect(agenda).toContain("interpretarNuevaCita(pacienteInicial)");
      const cajas = leer("src/routes/_authenticated/_clinic/cajas.tsx");
      expect(cajas).toContain("abrir: leerPedidoAbrirCaja(search.abrir)");
      expect(cajas).toMatch(/abrir: undefined \}\), replace: true/);
    });
  });

  describe("agenda a 390 px", () => {
    it("la columna de la agenda no crece al ancho de la grilla", () => {
      const agenda = leer("src/routes/_authenticated/_clinic/agenda.tsx");
      expect(agenda).toContain('className="grid grid-cols-1 gap-8 xl:grid-cols-12"');
      expect(agenda).toContain('className="min-w-0 space-y-4 xl:col-span-9"');
      expect(agenda).toContain('className="min-w-0 space-y-4 xl:col-span-3"');
    });
  });

  describe("sidebar en tinta", () => {
    it("recupera la tinta de la página en vez de la hundida de .dark", () => {
      const css = leer("src/styles.css");
      expect(css).toContain("--night-pagina: var(--night);");
      expect(css).toMatch(/\.dark\.tinta-de-pagina \{\s*--night: var\(--night-pagina\);/);
    });
  });

  describe("con el flag apagado el shell no cambia", () => {
    const shell = leer("src/components/app-shell.tsx");
    const tabla = leer("src/components/ui/table.tsx");
    const franja = leer("src/components/status-strip.tsx");

    it("el aside conserva bg-sidebar y la tinta solo entra con el flag", () => {
      expect(shell).toMatch(
        /shellV2\s*\?\s*"dark tinta-de-pagina border-r border-night-line bg-night text-on-night"/,
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
