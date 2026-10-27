import { describe, expect, it } from "vitest";

import { huecosSignificativos } from "@/components/agenda-hueco";
import { telefonoEnmascarado, tituloDeAgenda } from "@/components/agenda-titulo";
import { apellidoDe } from "@/components/agenda-bloque";

// Minutos desde las 08:00 (unidad de Cita.inicio).
const h = (hhmm: string) => {
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm - 8 * 60;
};

describe("huecosSignificativos (A+)", () => {
  const manana = { inicio: h("09:00"), fin: h("13:00") };
  const tarde = { inicio: h("14:00"), fin: h("18:00") };

  it("marca solo lo libre dentro del horario, sin la colación", () => {
    const huecos = huecosSignificativos({
      atendido: [manana, tarde],
      citas: [
        { inicio: h("09:00"), duracion: 60 },
        { inicio: h("10:30"), duracion: 150 },
        { inicio: h("14:00"), duracion: 240 },
      ],
    });
    expect(huecos).toEqual([{ inicio: h("10:00"), fin: h("10:30") }]);
  });

  it("descarta huecos cortos y respeta el mínimo", () => {
    const citas = [
      { inicio: h("09:00"), duracion: 45 },
      { inicio: h("10:00"), duracion: 180 },
    ];
    expect(huecosSignificativos({ atendido: [manana], citas })).toEqual([]);
    expect(huecosSignificativos({ atendido: [manana], citas, minimo: 15 })).toEqual([
      { inicio: h("09:45"), fin: h("10:00") },
    ]);
  });

  it("no ofrece bloqueos ni lo que ya pasó", () => {
    const huecos = huecosSignificativos({
      atendido: [manana],
      citas: [],
      noAgendables: [{ inicio: h("11:00"), fin: h("12:00") }],
      desdeMin: h("09:40"),
    });
    expect(huecos).toEqual([
      { inicio: h("09:40"), fin: h("11:00") },
      { inicio: h("12:00"), fin: h("13:00") },
    ]);
  });

  it("citas que se pisan cuentan una vez y sin horario no hay huecos", () => {
    expect(
      huecosSignificativos({
        atendido: [manana],
        citas: [
          { inicio: h("09:00"), duracion: 120 },
          { inicio: h("10:00"), duracion: 60 },
        ],
      }),
    ).toEqual([{ inicio: h("11:00"), fin: h("13:00") }]);
    expect(huecosSignificativos({ atendido: [], citas: [] })).toEqual([]);
  });
});

describe("tituloDeAgenda", () => {
  it("semana dentro de un mes, entre meses y entre años", () => {
    expect(tituloDeAgenda("semana", "2026-10-21")).toEqual({
      antes: "Semana del",
      enfasis: "19 al 25 de octubre",
    });
    expect(tituloDeAgenda("semana", "2026-10-27").enfasis).toBe("26 de octubre al 1 de noviembre");
    expect(tituloDeAgenda("semana", "2026-12-30").enfasis).toBe(
      "28 de diciembre de 2026 al 3 de enero de 2027",
    );
  });

  it("día, lista y mes", () => {
    expect(tituloDeAgenda("dia", "2026-10-26")).toEqual({
      antes: "Lunes",
      enfasis: "26 de octubre",
    });
    expect(tituloDeAgenda("lista", "2026-10-28").antes).toBe("Miércoles");
    expect(tituloDeAgenda("mes", "2026-10-28")).toEqual({ antes: "Octubre", enfasis: "2026" });
  });
});

describe("cajón de la cita", () => {
  it("enmascara el teléfono y deja los últimos 4", () => {
    expect(telefonoEnmascarado("+56 9 8765 1746")).toBe("+56 9 •••• 1746");
    expect(telefonoEnmascarado("+52 55 1234 5678")).toBe("+52 •••• 5678");
    expect(telefonoEnmascarado("987651746")).toBe("•••• 1746");
    expect(telefonoEnmascarado("")).toBeNull();
    expect(telefonoEnmascarado(null)).toBeNull();
  });

  it("apellido paterno para los carriles angostos", () => {
    expect(apellidoDe("Valentina Muñoz Soto")).toBe("Muñoz");
    expect(apellidoDe("Diego Rojas")).toBe("Rojas");
    expect(apellidoDe("Cher")).toBe("Cher");
  });
});
