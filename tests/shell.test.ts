import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PastillaConexionVista } from "@/components/pastilla-conexion";
import {
  accionesRapidas,
  claseItemNav,
  decidirAbrirCaja,
  hrefDeAccion,
  interpretarNuevaCita,
  leerNuevaCita,
  leerPedidoAbrirCaja,
  propsItemNav,
  textoConexion,
} from "@/lib/shell";

const leer = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

describe("shell A+", () => {
  describe("ítems del nav lateral", () => {
    it("usan --row-h y el activo lleva el filete ocre", () => {
      const activo = claseItemNav(true);
      const inactivo = claseItemNav(false);
      expect(activo).toContain("min-h-(--row-h)");
      expect(inactivo).toContain("min-h-(--row-h)");
      expect(activo).toContain("before:bg-brand-on-night");
      expect(inactivo).not.toContain("before:");
      expect(inactivo).toContain("text-on-night-2");
    });

    it("solo el ítem activo lleva aria-current=page", () => {
      expect(propsItemNav(true)["aria-current"]).toBe("page");
      expect(propsItemNav(false)["aria-current"]).toBeUndefined();
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

    it("desde la misma ruta conserva vista, fecha y filtros", () => {
      const nueva = accionesRapidas("owner").find((a) => a.id === "nueva-cita")!;
      // Desde otra página: la URL limpia de la acción.
      expect(hrefDeAccion(nueva, { pathname: "/pacientes", searchStr: "?q=ana" })).toBe(
        "/agenda?nueva=1",
      );
      // Ya en la agenda: se suma el pedido sin tocar el resto (tal cual
      // vino codificado) y sin duplicar un pedido anterior.
      expect(
        hrefDeAccion(nueva, {
          pathname: "/agenda",
          searchStr: "?q=&fecha=2026-10-21&vista=semana&profesional=p%201&nueva=abc",
        }),
      ).toBe("/agenda?q=&fecha=2026-10-21&vista=semana&profesional=p%201&nueva=1");
      expect(hrefDeAccion(nueva, { pathname: "/agenda/", searchStr: "" })).toBe("/agenda?nueva=1");
      const caja = accionesRapidas("owner").find((a) => a.id === "abrir-caja")!;
      expect(hrefDeAccion(caja, { pathname: "/cajas", searchStr: "?x=1" })).toBe(
        "/cajas?x=1&abrir=1",
      );
    });

    it("el buscador navega con hrefDeAccion", () => {
      const buscador = leer("src/components/global-search.tsx");
      expect(buscador).toContain("navigate({ href: hrefDeAccion(accion, ubicacion) })");
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
      // La columna principal: 9 de 12, o 12 en la semana con el panel plegado.
      expect(agenda).toContain('"min-w-0 space-y-4 max-md:space-y-3"');
      expect(agenda).toContain('panelPlegado ? "xl:col-span-12" : "xl:col-span-9"');
      expect(agenda).toContain('"min-w-0 space-y-4 xl:col-span-3"');
    });

    it("lo absoluto de la semana no agranda la página (UX-01)", () => {
      // Sin ancestro posicionado dentro de la caja que se desplaza, los
      // `sr-only` de las iniciales llevaban la página a 1549px.
      const vistas = leer("src/components/agenda-views.tsx");
      expect(vistas).toContain('className="card-clinical relative isolate overflow-x-auto"');
    });
  });

  describe("sidebar en tinta", () => {
    it("recupera la tinta de la página en vez de la hundida de .dark", () => {
      const css = leer("src/styles.css");
      expect(css).toContain("--night-pagina: var(--night);");
      expect(css).toMatch(/\.dark\.tinta-de-pagina \{\s*--night: var\(--night-pagina\);/);
    });
  });

  describe("el shell A+ es el único", () => {
    const shell = leer("src/components/app-shell.tsx");
    const tabla = leer("src/components/ui/table.tsx");
    const franja = leer("src/components/status-strip.tsx");

    it("el aside va en tinta", () => {
      expect(shell).toContain(
        "dark tinta-de-pagina sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-night-line bg-night text-on-night lg:flex",
      );
      expect(shell).not.toContain("bg-sidebar");
    });

    it("la altura de fila de la tabla aplica dentro del shell de la app", () => {
      expect(shell).toContain("data-app-shell");
      expect(tabla).toContain("[[data-app-shell]_&]:h-(--row-h)");
      expect(tabla.match(/--row-h/g)).toHaveLength(1);
    });

    it("la red va en la pastilla; la franja solo muestra fallidos y conflictos", () => {
      expect(shell.match(/<PastillaConexion /g)).toHaveLength(3);
      expect(franja).not.toContain("OfflineBanner");
      expect(franja).toContain("return <PendingSyncBanner userId={access.userId} />;");
      expect(franja).toContain("if (fallidos.length + conflictos.length > 0)");
    });
  });
});
