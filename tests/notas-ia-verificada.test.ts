import { describe, expect, it } from "vitest";

import {
  SUFIJO_AUDITORIA_IA,
  hayEvidenciaDeIa,
  verificarAsistenciaIa,
  type EventoIaDeNota,
} from "@/lib/clinical/clinical-notes";

const AUTOR = "u-1";
const NOTA = "n-1";

const version = (
  over: Partial<Parameters<typeof verificarAsistenciaIa>[0]["versions"][number]>,
) => ({
  noteId: NOTA,
  authorId: AUTOR,
  createdAt: "2026-10-20T12:00:00Z",
  aiAssisted: true,
  aiAction: "draft" as string | null,
  ...over,
});

const auditoria = (detail: string | null, over: Record<string, unknown> = {}) => ({
  noteId: NOTA as string | null,
  actorId: AUTOR,
  createdAt: "2026-10-20T12:00:00Z",
  detail,
  ...over,
});

describe("asistencia de IA verificada", () => {
  it("sin eventos de IA (Patty en habilitación) nada queda como asistido", () => {
    const r = verificarAsistenciaIa({
      versions: [version({})],
      audit: [auditoria(`v1${SUFIJO_AUDITORIA_IA}`)],
      eventosIa: [],
    });
    expect(r.versions[0]).toMatchObject({ aiAssisted: false, aiAction: null });
    expect(r.audit[0].detail).toBe("v1");
  });

  it("con un evento de IA previo del mismo autor en la nota se conserva", () => {
    const eventos: EventoIaDeNota[] = [
      { noteId: NOTA, actorId: AUTOR, createdAt: "2026-10-20T11:58:00Z" },
    ];
    const r = verificarAsistenciaIa({
      versions: [version({})],
      audit: [auditoria(`v1${SUFIJO_AUDITORIA_IA}`)],
      eventosIa: eventos,
    });
    expect(r.versions[0]).toMatchObject({ aiAssisted: true, aiAction: "draft" });
    expect(r.audit[0].detail).toBe(`v1${SUFIJO_AUDITORIA_IA}`);
  });

  it("un evento sobre una nota todavía sin guardar (note_id nulo) cuenta", () => {
    expect(
      hayEvidenciaDeIa([{ noteId: null, actorId: AUTOR, createdAt: "2026-10-20T11:00:00Z" }], {
        noteId: NOTA,
        actorId: AUTOR,
        hasta: "2026-10-20T12:00:00Z",
      }),
    ).toBe(true);
  });

  it("no cuenta un evento de otro autor, de otra nota o posterior", () => {
    const caso = { noteId: NOTA, actorId: AUTOR, hasta: "2026-10-20T12:00:00Z" };
    expect(
      hayEvidenciaDeIa([{ noteId: NOTA, actorId: "u-2", createdAt: "2026-10-20T11:00:00Z" }], caso),
    ).toBe(false);
    expect(
      hayEvidenciaDeIa(
        [{ noteId: "n-2", actorId: AUTOR, createdAt: "2026-10-20T11:00:00Z" }],
        caso,
      ),
    ).toBe(false);
    expect(
      hayEvidenciaDeIa([{ noteId: NOTA, actorId: AUTOR, createdAt: "2026-10-20T13:00:00Z" }], caso),
    ).toBe(false);
  });

  it("no toca versiones no asistidas ni auditoría sin el sufijo", () => {
    const r = verificarAsistenciaIa({
      versions: [version({ aiAssisted: false, aiAction: null })],
      audit: [auditoria("v2"), auditoria(null)],
      eventosIa: [],
    });
    expect(r.versions[0].aiAssisted).toBe(false);
    expect(r.audit.map((a) => a.detail)).toEqual(["v2", null]);
  });
});
