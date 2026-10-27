// NAV-02 (Ola 12): avance de la puesta en marcha. Lógica pura: no toca Postgres.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CLINIC_ROLES, hasPermission } from "@/lib/access/access";
import { AJUSTES, DESTINOS } from "@/lib/access/navegacion";
import {
  PACIENTES_PARA_DAR_POR_CARGADOS,
  avanceDe,
  enlaceDelPaso,
  mostrarPuestaEnMarcha,
  pasosDePuestaEnMarcha,
  puedeVerPuestaEnMarcha,
  type DatosPuestaEnMarcha,
} from "@/lib/panel/puesta-en-marcha";

const NADA: DatosPuestaEnMarcha = {
  datosDeLaClinica: false,
  horariosDeSucursal: false,
  horariosDeProfesionales: false,
  integrantes: 1,
  prestacionesConPrecio: 0,
  pacientes: 0,
  importoPacientes: false,
  hayCitas: false,
  reservaEnLinea: false,
  correosAPacientes: false,
  llamadaHecha: false,
  descartadoAt: null,
};

const TODO: DatosPuestaEnMarcha = {
  ...NADA,
  datosDeLaClinica: true,
  horariosDeSucursal: true,
  horariosDeProfesionales: true,
  integrantes: 3,
  prestacionesConPrecio: 40,
  importoPacientes: true,
  hayCitas: true,
  reservaEnLinea: true,
  correosAPacientes: true,
  llamadaHecha: true,
};

describe("avance de la puesta en marcha (NAV-02)", () => {
  it("cubre los pasos del plan: clínica, sucursales y horarios, equipo, arancel, reserva, correos, pacientes", () => {
    const ids = pasosDePuestaEnMarcha(NADA).map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "datos",
        "sucursales",
        "profesionales",
        "equipo",
        "arancel",
        "reserva",
        "correos",
        "pacientes",
      ]),
    );
  });

  it("empieza en cero y termina completo", () => {
    expect(avanceDe(pasosDePuestaEnMarcha(NADA))).toMatchObject({
      hechos: 0,
      porcentaje: 0,
      completo: false,
    });
    expect(avanceDe(pasosDePuestaEnMarcha(NADA)).siguiente?.id).toBe("datos");
    expect(avanceDe(pasosDePuestaEnMarcha(TODO))).toMatchObject({
      porcentaje: 100,
      completo: true,
      siguiente: null,
    });
  });

  it("cada paso depende de su dato real", () => {
    const hecho = (d: Partial<DatosPuestaEnMarcha>, id: string) =>
      pasosDePuestaEnMarcha({ ...NADA, ...d }).find((p) => p.id === id)!.hecho;
    expect(hecho({ integrantes: 1 }, "equipo")).toBe(false);
    expect(hecho({ integrantes: 2 }, "equipo")).toBe(true);
    expect(hecho({ prestacionesConPrecio: 1 }, "arancel")).toBe(true);
    expect(hecho({ pacientes: PACIENTES_PARA_DAR_POR_CARGADOS - 1 }, "pacientes")).toBe(false);
    expect(hecho({ pacientes: PACIENTES_PARA_DAR_POR_CARGADOS }, "pacientes")).toBe(true);
    expect(hecho({ importoPacientes: true }, "pacientes")).toBe(true);
    expect(hecho({ reservaEnLinea: true }, "reserva")).toBe(true);
    expect(hecho({ correosAPacientes: true }, "correos")).toBe(true);
    expect(hecho({ hayCitas: true }, "primera-cita")).toBe(true);
  });

  it("nunca dice 100 % si falta algo", () => {
    const casi = avanceDe(pasosDePuestaEnMarcha({ ...TODO, correosAPacientes: false }));
    expect(casi.completo).toBe(false);
    expect(casi.porcentaje).toBeLessThan(100);
    expect(casi.siguiente?.id).toBe("correos");
  });

  it("se oculta al completar o al descartarlo", () => {
    expect(mostrarPuestaEnMarcha(NADA)).toBe(true);
    expect(mostrarPuestaEnMarcha(TODO)).toBe(false);
    expect(mostrarPuestaEnMarcha({ ...NADA, descartadoAt: "2026-10-27T12:00:00Z" })).toBe(false);
    expect(mostrarPuestaEnMarcha(undefined)).toBe(false);
  });

  it("solo la ven propietario y administración, nunca en la demo", () => {
    for (const rol of CLINIC_ROLES) {
      expect(puedeVerPuestaEnMarcha(rol, { isDemo: false }), rol).toBe(
        rol === "owner" || rol === "admin",
      );
      expect(puedeVerPuestaEnMarcha(rol, { isDemo: true }), rol).toBe(false);
    }
    expect(puedeVerPuestaEnMarcha("owner", null)).toBe(false);
  });

  it("cada paso lleva a una pantalla del menú con el mismo permiso que su ruta", () => {
    const menu = [...DESTINOS.flatMap((d) => d.pestanas), ...AJUSTES.flatMap((g) => g.items)];
    for (const paso of pasosDePuestaEnMarcha(NADA)) {
      if (!paso.to) continue;
      const item = menu.find((m) => m.to === paso.to);
      expect(item, paso.to).toBeDefined();
      expect(item!.permisos, paso.to).toContain(paso.permiso);
    }
  });

  it("no ofrece un enlace que la persona no puede abrir", () => {
    const equipo = pasosDePuestaEnMarcha(NADA).find((p) => p.id === "equipo")!;
    expect(enlaceDelPaso("owner", equipo)).toBe("/equipo");
    const sinEquipo = { role: "admin" as const, permissions: [] };
    expect(hasPermission(sinEquipo, "team:view")).toBe(false);
    expect(enlaceDelPaso(sinEquipo, equipo)).toBeNull();
    const llamada = pasosDePuestaEnMarcha(NADA).find((p) => p.id === "llamada")!;
    expect(enlaceDelPaso("owner", llamada)).toBeNull();
  });

  it("par en el servidor: lee y descarta solo con settings:manage, y descartar no corre en la demo", () => {
    const src = readFileSync("src/lib/panel/puesta-en-marcha.functions.ts", "utf8");
    expect(src.match(/requireClinicPermission\([^)]*"settings:manage"\)/g)?.length).toBe(2);
    expect(src).toContain("assertNotDemoClinic");
    // Solo conteos: ninguna fila de pacientes viaja al navegador.
    expect(src).not.toMatch(/from\("patients"\)\s*\.select\("\*"/);
  });

  it("la migración es aditiva y no crea tablas ni toca políticas", () => {
    const sql = readFileSync(
      "supabase/migrations/20261108200000_puesta_en_marcha_descartada.sql",
      "utf8",
    ).replace(/--.*$/gm, "");
    expect(sql).toMatch(/add column if not exists setup_guide_dismissed_at/i);
    expect(sql).not.toMatch(/\bdrop\b|create table|create policy|^\s*(update|delete|insert)\b/im);
  });
});
