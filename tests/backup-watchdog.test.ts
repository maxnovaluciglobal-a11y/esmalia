import { describe, expect, it } from "vitest";

import {
  armarAviso,
  evaluarFrescuraDelBackup,
  MAX_HORAS_SIN_BACKUP,
  tocaAvisar,
  type CorridaDeBackup,
} from "@/lib/backup-watchdog";

const ahora = new Date("2026-10-28T10:00:00Z");
const hace = (horas: number) => new Date(ahora.getTime() - horas * 3_600_000).toISOString();
const exito = (h: number): CorridaDeBackup => ({
  status: "completed",
  conclusion: "success",
  updated_at: hace(h),
});
const falla = (h: number): CorridaDeBackup => ({
  status: "completed",
  conclusion: "failure",
  updated_at: hace(h),
  html_url: "https://github.com/x/y/actions/runs/1",
});

describe("evaluarFrescuraDelBackup", () => {
  it("un éxito reciente está bien", () => {
    const e = evaluarFrescuraDelBackup([exito(3), exito(27)], ahora);
    expect(e.estado).toBe("ok");
  });

  it("no da falsa alarma con el peor retraso observado entre corridas programadas (25,7 h)", () => {
    // 12:35 UTC del 25-oct → 14:18 UTC del 26-oct; a las 14:17 del 26-oct el último éxito tiene 25,7 h.
    expect(evaluarFrescuraDelBackup([exito(25.7)], ahora).estado).toBe("ok");
    expect(MAX_HORAS_SIN_BACKUP).toBeGreaterThan(26);
  });

  it("pasado el límite avisa, con las horas y el último éxito", () => {
    const e = evaluarFrescuraDelBackup([exito(33), exito(57)], ahora);
    expect(e.estado).toBe("atrasado");
    if (e.estado !== "atrasado") return;
    expect(Math.round(e.horasDesdeElUltimoExito ?? 0)).toBe(33);
    expect(e.ultimaFalla).toBeNull();
    expect(e.enCurso).toBe(false);
  });

  it("sin ninguna corrida exitosa (ni una lista vacía) avisa", () => {
    for (const corridas of [[], [falla(2), falla(26)]]) {
      const e = evaluarFrescuraDelBackup(corridas, ahora);
      expect(e.estado).toBe("atrasado");
      if (e.estado === "atrasado") {
        expect(e.horasDesdeElUltimoExito).toBeNull();
        expect(e.ultimoExito).toBeNull();
      }
    }
  });

  it("menciona la falla solo si es más nueva que el último éxito", () => {
    const conFallaNueva = evaluarFrescuraDelBackup([exito(40), falla(5)], ahora);
    const conFallaVieja = evaluarFrescuraDelBackup([exito(40), falla(60)], ahora);
    expect(conFallaNueva.estado === "atrasado" && conFallaNueva.ultimaFalla?.html_url).toBeTruthy();
    expect(conFallaVieja.estado === "atrasado" && conFallaVieja.ultimaFalla).toBeNull();
  });

  it("un run en curso no cuenta como backup, pero se informa", () => {
    const enCurso: CorridaDeBackup = {
      status: "in_progress",
      conclusion: null,
      updated_at: hace(0.1),
    };
    const e = evaluarFrescuraDelBackup([enCurso, exito(40)], ahora);
    expect(e.estado).toBe("atrasado");
    if (e.estado === "atrasado") expect(e.enCurso).toBe(true);
  });

  it("ignora corridas con fecha inválida y una cancelada no cuenta como éxito", () => {
    const rota: CorridaDeBackup = {
      status: "completed",
      conclusion: "success",
      updated_at: "nada",
    };
    const cancelada: CorridaDeBackup = {
      status: "completed",
      conclusion: "cancelled",
      updated_at: hace(1),
    };
    expect(evaluarFrescuraDelBackup([rota, cancelada], ahora).estado).toBe("atrasado");
  });

  it("el límite es inclusivo hacia el lado seguro: justo en el límite sigue bien", () => {
    expect(evaluarFrescuraDelBackup([exito(MAX_HORAS_SIN_BACKUP)], ahora).estado).toBe("ok");
    expect(evaluarFrescuraDelBackup([exito(MAX_HORAS_SIN_BACKUP + 0.1)], ahora).estado).toBe(
      "atrasado",
    );
  });
});

describe("tocaAvisar", () => {
  it("manda 4 correos al día como máximo (horas UTC 0, 6, 12, 18)", () => {
    const horas = Array.from({ length: 24 }, (_, h) => h).filter((h) =>
      tocaAvisar(new Date(Date.UTC(2026, 9, 28, h, 52))),
    );
    expect(horas).toEqual([0, 6, 12, 18]);
  });
});

describe("armarAviso", () => {
  it("dice cuánto hace, qué hacer y escapa el HTML", () => {
    const e = evaluarFrescuraDelBackup([exito(40), falla(5)], ahora);
    if (e.estado !== "atrasado") throw new Error("debía estar atrasado");
    const a = armarAviso(e, "maxnovaluciglobal-a11y/esmalia");
    expect(a.asunto).toContain("backup");
    expect(a.texto).toContain("40 h");
    expect(a.texto).toContain("actions/workflows/backup.yml");
    expect(a.texto).toContain("actions/runs/1");
    expect(a.html).not.toContain("<script");
    expect(a.html.startsWith("<p>")).toBe(true);
  });

  it("sin ningún éxito lo dice sin inventar una fecha", () => {
    const e = evaluarFrescuraDelBackup([], ahora);
    if (e.estado !== "atrasado") throw new Error("debía estar atrasado");
    const a = armarAviso(e, "x/y");
    expect(a.texto).toContain("ningún backup exitoso");
    expect(a.texto).not.toContain("null");
  });
});
