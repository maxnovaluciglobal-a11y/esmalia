import { describe, expect, it } from "vitest";

import {
  boxEfectivo,
  choquesDelMovimiento,
  conflictosDeCandidata,
  detectarConflictos,
  SIN_BOX,
  tiposDe,
  type CitaConflicto,
  type ProfesionalConflicto,
} from "@/components/agenda-conflictos";
import {
  destinoPorTeclado,
  indiceDeCarril,
  minutosDeHora,
  type Carril,
} from "@/components/agenda-movimiento";
import {
  carrilesPorBox,
  moverEnLista,
  nombreDeBoxValido,
  nombreRepetido,
} from "@/lib/clinic-operations/boxes";
import { boxAlCambiarProfesional } from "@/lib/clinic-operations/cita-formulario";
import type { Cita, Profesional } from "@/lib/clinic-operations/clinic-data";

// Ola 2 · frente boxes y grilla: AGE-04 (box real de la cita), AGE-02
// (arrastre en la semana) y ADM-06 (orden de boxes).

const m = minutosDeHora;
const DIA = "2026-10-21";

const profesionales: (ProfesionalConflicto & Pick<Profesional, "boxId">)[] = [
  { id: "soto", nombre: "Dr. Soto", box: "Box 1", boxId: "b1", sucursalId: "lc" },
  { id: "rojas", nombre: "Dra. Rojas", box: "Box 2", boxId: "b2", sucursalId: "lc" },
  { id: "herrera", nombre: "Dra. Herrera", box: SIN_BOX, boxId: null, sucursalId: "lc" },
  { id: "lagos", nombre: "Dr. Lagos", box: "Box A", boxId: "bp", sucursalId: "prov" },
];

let n = 0;
function cita(
  profesionalId: string,
  desde: string,
  hasta: string,
  extra: Partial<CitaConflicto> = {},
): CitaConflicto & Cita {
  n += 1;
  const sucursalId = profesionales.find((p) => p.id === profesionalId)?.sucursalId ?? "";
  return {
    id: `c${n}`,
    pacienteId: `pac${n}`,
    paciente: `Paciente ${n}`,
    profesionalId,
    sucursalId,
    fecha: DIA,
    inicio: m(desde),
    duracion: m(hasta) - m(desde),
    estado: "confirmada",
    tratamiento: "Control",
    ...extra,
  };
}

describe("box efectivo de la cita (AGE-04)", () => {
  it("manda el box de la cita; el del profesional solo si la cita no tiene", () => {
    const soto = profesionales[0];
    expect(boxEfectivo({ boxId: "b9", box: "Box 9" }, soto)).toEqual({
      id: "b9",
      nombre: "Box 9",
      propio: true,
    });
    expect(boxEfectivo({ boxId: null }, soto)).toEqual({
      id: "b1",
      nombre: "Box 1",
      propio: false,
    });
    expect(boxEfectivo({}, profesionales[2])).toBeNull();
    // El nombre vigente del catálogo gana sobre el guardado.
    expect(boxEfectivo({ boxId: "b9", box: "Viejo" }, soto, () => "Box 9 nuevo")?.nombre).toBe(
      "Box 9 nuevo",
    );
  });

  it("choca por el box real aunque los profesionales tengan otro por defecto", () => {
    const a = cita("soto", "10:00", "11:00", { boxId: "b3" });
    const b = cita("rojas", "10:30", "11:30", { boxId: "b3" });
    const mapa = detectarConflictos([a, b], profesionales);
    expect(tiposDe(mapa.get(a.id))).toEqual(["box"]);
    expect(tiposDe(mapa.get(b.id))).toEqual(["box"]);
  });

  it("ya no choca si una cita eligió otro box que el por defecto del profesional", () => {
    // Antes (Ola 0) los dos usaban Box 1 por ser el de Soto; ahora la segunda
    // cita de Rojas está en Box 1 por elección y la de Soto se fue al Box 2.
    const a = cita("soto", "10:00", "11:00", { boxId: "b2" });
    const b = cita("herrera", "10:00", "11:00", { boxId: "b1" });
    expect(detectarConflictos([a, b], profesionales).size).toBe(0);
  });

  it("una cita sin box usa el por defecto de su profesional y choca con el box real de otra", () => {
    const a = cita("soto", "09:00", "10:00"); // sin box → b1 (de Soto)
    const b = cita("herrera", "09:30", "10:30", { boxId: "b1" });
    expect(tiposDe(detectarConflictos([a, b], profesionales).get(a.id))).toEqual(["box"]);
  });

  it("la candidata del formulario usa el box elegido", () => {
    const existente = cita("rojas", "12:00", "13:00", { boxId: "b1" });
    const conBox = conflictosDeCandidata(
      {
        pacienteId: "otro",
        profesionalId: "herrera",
        fecha: DIA,
        inicio: m("12:30"),
        duracion: 30,
        boxId: "b1",
      },
      [existente],
      profesionales,
    );
    expect(conBox.map((x) => x.tipo)).toEqual(["box"]);
    const sinBox = conflictosDeCandidata(
      {
        pacienteId: "otro",
        profesionalId: "herrera",
        fecha: DIA,
        inicio: m("12:30"),
        duracion: 30,
      },
      [existente],
      profesionales,
    );
    expect(sinBox).toEqual([]);
  });
});

describe("choques de un movimiento (AGE-02)", () => {
  it("devuelve paciente y box, no el mismo profesional (eso lo bloquea validarDestino)", () => {
    const movida = cita("soto", "08:00", "09:00", { boxId: "b1", pacienteId: "ana" });
    const delMismoPaciente = cita("rojas", "11:00", "12:00", { pacienteId: "ana", boxId: "b2" });
    const delMismoProfesional = cita("soto", "11:00", "11:30", { boxId: "b9" });
    const enElMismoBox = cita("herrera", "11:00", "11:30", { boxId: "b1" });
    const choques = choquesDelMovimiento(
      movida,
      { fecha: DIA, inicio: m("11:00"), profesionalId: "soto" },
      [movida, delMismoPaciente, delMismoProfesional, enElMismoBox],
      profesionales,
    );
    expect(choques.map((x) => [x.tipo, x.cita.id])).toEqual([
      ["paciente", delMismoPaciente.id],
      ["box", enElMismoBox.id],
    ]);
  });

  it("al pasar a un profesional de otra sucursal, el box de la cita se suelta", () => {
    const movida = cita("soto", "08:00", "09:00", { boxId: "b1" });
    const enBoxA = cita("lagos", "10:00", "11:00", { boxId: "bp", sucursalId: "prov" });
    const enB1 = cita("rojas", "10:00", "11:00", { boxId: "b1" });
    // Destino: Dr. Lagos (sucursal prov). Ya no está en b1: cuenta el box de Lagos.
    const choques = choquesDelMovimiento(
      movida,
      { fecha: DIA, inicio: m("10:00"), profesionalId: "lagos" },
      [movida, enBoxA, enB1],
      profesionales,
    );
    expect(choques).toEqual([]); // Lagos con su propia cita = mismo profesional, filtrado
    const mismaSucursal = choquesDelMovimiento(
      movida,
      { fecha: DIA, inicio: m("10:00"), profesionalId: "rojas" },
      [movida, enB1],
      profesionales,
    );
    expect(mismaSucursal).toEqual([]); // Rojas ocupa su carril: lo bloquea validarDestino
  });

  it("sin choques, la lista viene vacía", () => {
    const movida = cita("soto", "08:00", "09:00");
    expect(
      choquesDelMovimiento(
        movida,
        { fecha: "2026-10-22", inicio: m("08:00"), profesionalId: "soto" },
        [movida],
        profesionales,
      ),
    ).toEqual([]);
  });
});

describe("arrastre en la semana (AGE-02)", () => {
  const dias = ["2026-10-19", "2026-10-20", "2026-10-21"];
  const carriles: Carril[] = dias.flatMap((d) =>
    ["soto", "rojas"].map((p) => ({ fecha: d, profesionalId: p })),
  );
  const rango = { desde: 0, hasta: 12 * 60 };

  it("Alt + → pasa al profesional vecino y, en el borde, al día siguiente", () => {
    const c = { fecha: "2026-10-19", inicio: m("10:00"), duracion: 30, profesionalId: "soto" };
    expect(destinoPorTeclado(c, "ArrowRight", carriles, rango)).toEqual({
      fecha: "2026-10-19",
      inicio: m("10:00"),
      profesionalId: "rojas",
    });
    const ultimo = { ...c, profesionalId: "rojas" };
    expect(destinoPorTeclado(ultimo, "ArrowRight", carriles, rango)).toEqual({
      fecha: "2026-10-20",
      inicio: m("10:00"),
      profesionalId: "soto",
    });
    const primero = { ...c, profesionalId: "soto" };
    expect(destinoPorTeclado(primero, "ArrowLeft", carriles, rango)).toBeNull();
  });

  it("Alt + ↑/↓ cambia la hora sin cambiar el día", () => {
    const c = { fecha: "2026-10-21", inicio: m("10:00"), duracion: 30, profesionalId: "rojas" };
    expect(destinoPorTeclado(c, "ArrowDown", carriles, rango)).toEqual({
      fecha: "2026-10-21",
      inicio: m("10:15"),
      profesionalId: "rojas",
    });
  });

  it("los días ocultos en el celular (ancho 0) no reciben la cita", () => {
    // Tres carriles: el del medio oculto. Soltar sobre él va al más cercano visible.
    const rects = [
      { izquierda: 0, derecha: 40 },
      { izquierda: 40, derecha: 40 },
      { izquierda: 40, derecha: 80 },
    ];
    expect(indiceDeCarril(39, rects)).toBe(0);
    expect(indiceDeCarril(41, rects)).toBe(2);
  });
});

describe("boxes de la sucursal (ADM-06)", () => {
  it("sube y baja sin salirse de la lista", () => {
    expect(moverEnLista(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moverEnLista(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moverEnLista(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moverEnLista(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("valida el nombre y avisa si se repite en la sucursal", () => {
    expect(nombreDeBoxValido("  Box   3 ")).toBe("Box 3");
    expect(nombreDeBoxValido("   ")).toBeNull();
    expect(nombreDeBoxValido("x".repeat(61))).toBeNull();
    const boxes = [
      { id: "1", name: "Box 1" },
      { id: "2", name: "Pabellón" },
    ];
    expect(nombreRepetido(" box 1", boxes)).toBe(true);
    expect(nombreRepetido("Box 1", boxes, "1")).toBe(false);
    expect(nombreRepetido("Box 3", boxes)).toBe(false);
  });

  it("arma un carril por box en orden, con las citas en su box efectivo y 'Sin box' al final", () => {
    const boxes = [
      { id: "b2", nombre: "Box 2", sucursalId: "lc" },
      { id: "b1", nombre: "Box 1", sucursalId: "lc" },
    ];
    const enB1 = cita("rojas", "09:00", "10:00", { boxId: "b1" });
    const porDefecto = cita("rojas", "11:00", "12:00"); // sin box → b2 (de Rojas)
    const sinNada = cita("herrera", "09:00", "10:00");
    const desactivado = cita("soto", "13:00", "14:00", { boxId: "b-viejo", box: "Box viejo" });
    const carriles = carrilesPorBox({
      boxes,
      citas: [enB1, porDefecto, sinNada, desactivado],
      profesionales,
    });
    expect(carriles.map((c) => [c.titulo, c.citas.map((x) => x.id)])).toEqual([
      ["Box 2", [porDefecto.id]],
      ["Box 1", [enB1.id]],
      ["Box viejo", [desactivado.id]],
      ["Sin box", [sinNada.id]],
    ]);
  });

  it("sin citas sin box no hay carril 'Sin box'", () => {
    const carriles = carrilesPorBox({
      boxes: [{ id: "b1", nombre: "Box 1", sucursalId: "lc" }],
      citas: [],
      profesionales,
    });
    expect(carriles.map((c) => c.titulo)).toEqual(["Box 1"]);
  });
});

describe("box por defecto en el formulario (AGE-04)", () => {
  const boxes = [
    { id: "b1", sucursalId: "lc" },
    { id: "b2", sucursalId: "lc" },
    { id: "bp", sucursalId: "prov" },
  ];

  it("precarga el box del profesional elegido", () => {
    expect(
      boxAlCambiarProfesional({
        boxActual: "",
        anterior: undefined,
        nuevo: { boxId: "b2" },
        boxes,
        sucursalId: "lc",
      }),
    ).toBe("b2");
  });

  it("al cambiar de profesional cambia el box que había puesto el formulario", () => {
    expect(
      boxAlCambiarProfesional({
        boxActual: "b1",
        anterior: { boxId: "b1" },
        nuevo: { boxId: "b2" },
        boxes,
        sucursalId: "lc",
      }),
    ).toBe("b2");
  });

  it("respeta el box elegido a mano", () => {
    expect(
      boxAlCambiarProfesional({
        boxActual: "b1",
        anterior: { boxId: "b2" },
        nuevo: { boxId: "b2" },
        boxes,
        sucursalId: "lc",
      }),
    ).toBe("b1");
  });

  it("no precarga un box de otra sucursal ni uno desactivado", () => {
    expect(
      boxAlCambiarProfesional({
        boxActual: "",
        anterior: undefined,
        nuevo: { boxId: "bp" },
        boxes,
        sucursalId: "lc",
      }),
    ).toBe("");
    expect(
      boxAlCambiarProfesional({
        boxActual: "",
        anterior: undefined,
        nuevo: { boxId: "inactivo" },
        boxes,
        sucursalId: "lc",
      }),
    ).toBe("");
  });

  it("profesional sin box por defecto deja 'Sin box' si el anterior lo había puesto", () => {
    expect(
      boxAlCambiarProfesional({
        boxActual: "b1",
        anterior: { boxId: "b1" },
        nuevo: { boxId: null },
        boxes,
        sucursalId: "lc",
      }),
    ).toBe("");
  });
});
