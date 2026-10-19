import { describe, expect, it } from "vitest";

import { INCIDENTES, type Incidente } from "@/content/incidentes";
import {
  estadoGeneral,
  incidentesEnCurso,
  incidentesRecientes,
  interpretarSalud,
  problemasDeIncidentes,
} from "@/lib/estado-servicio";
import { respuestaDeSalud } from "@/lib/salud";

// Página pública /estado y /api/health. Puro: sin red ni base.

const resuelto: Incidente = {
  id: "2026-10-01-agenda-lenta",
  titulo: "La agenda cargaba lento",
  impacto: "menor",
  componentes: ["aplicacion"],
  inicio: "2026-10-01T12:00:00Z",
  fin: "2026-10-01T12:30:00Z",
  actualizaciones: [
    { fecha: "2026-10-01T12:05:00Z", fase: "investigando", mensaje: "Revisando." },
    { fecha: "2026-10-01T12:30:00Z", fase: "resuelto", mensaje: "Normalizado." },
  ],
};

const abierto: Incidente = {
  id: "2026-10-19-whatsapp",
  titulo: "Los mensajes de WhatsApp no salen",
  impacto: "parcial",
  componentes: ["whatsapp"],
  inicio: "2026-10-19T10:00:00Z",
  fin: null,
  actualizaciones: [{ fecha: "2026-10-19T10:05:00Z", fase: "identificado", mensaje: "Meta." }],
};

describe("/api/health", () => {
  it("responde 200 ok o 503 error, sin caché y solo con status y timestamp", async () => {
    const ok = respuestaDeSalud(true, "2026-10-19T00:00:00.000Z");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(await ok.json()).toEqual({ status: "ok", timestamp: "2026-10-19T00:00:00.000Z" });

    const caida = respuestaDeSalud(false);
    expect(caida.status).toBe(503);
    expect(Object.keys(await caida.json()).sort()).toEqual(["status", "timestamp"]);
  });
});

describe("estado del servicio", () => {
  it("traduce la respuesta del health", () => {
    expect(interpretarSalud(200, { status: "ok" })).toBe("ok");
    expect(interpretarSalud(503, { status: "error" })).toBe("base-caida");
    expect(interpretarSalud(null, null)).toBe("sin-respuesta");
    // Un 200 que no es el JSON esperado (p. ej. una página de error del CDN) no es "ok".
    expect(interpretarSalud(200, "<html>")).toBe("sin-respuesta");
    expect(interpretarSalud(502, null)).toBe("sin-respuesta");
  });

  it("un incidente abierto manda aunque el health dé ok", () => {
    expect(estadoGeneral("ok", [])).toBe("operativo");
    expect(estadoGeneral("ok", [resuelto])).toBe("operativo");
    expect(estadoGeneral("ok", [abierto])).toBe("con-incidentes");
    expect(estadoGeneral("ok", [{ ...abierto, impacto: "total" }])).toBe("interrumpido");
    expect(estadoGeneral("base-caida", [])).toBe("interrumpido");
    expect(estadoGeneral("sin-respuesta", [])).toBe("desconocido");
    expect(estadoGeneral(null, [])).toBe("desconocido");
  });

  it("separa en curso de historial y recorta a la ventana", () => {
    const ahora = new Date("2026-10-20T00:00:00Z");
    expect(incidentesEnCurso([resuelto, abierto]).map((i) => i.id)).toEqual([abierto.id]);
    expect(incidentesRecientes([resuelto, abierto], ahora).map((i) => i.id)).toEqual([resuelto.id]);
    expect(incidentesRecientes([resuelto], new Date("2027-03-01T00:00:00Z"))).toEqual([]);
  });

  it("valida la forma de los incidentes", () => {
    expect(problemasDeIncidentes([resuelto, abierto])).toEqual([]);
    expect(problemasDeIncidentes([resuelto, resuelto])).toContain(
      "2026-10-01-agenda-lenta: id repetido",
    );
    expect(
      problemasDeIncidentes([
        { ...resuelto, actualizaciones: resuelto.actualizaciones.slice(0, 1) },
      ]),
    ).toEqual(["2026-10-01-agenda-lenta: cerrado sin una actualización 'resuelto'"]);
    expect(problemasDeIncidentes([{ ...resuelto, inicio: "2026-10-01 12:00" }])).not.toEqual([]);
  });

  it("src/content/incidentes.ts es válido", () => {
    expect(problemasDeIncidentes(INCIDENTES)).toEqual([]);
  });
});
