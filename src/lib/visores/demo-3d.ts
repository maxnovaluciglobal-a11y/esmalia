// Archivos 3D de ejemplo para la demo comercial: una arcada procedural con 14
// piezas y encía (STL y PLY con color, ~1,5 MB cada uno) y un CBCT sintético
// mínimo (ZIP de ~110 cortes, pocos MB). Se generan en el momento: no hay
// escaneos ni tomografías de nadie y no se versiona ningún binario.
//
// Los usa `/api/demo-reset` (src/lib/demo/examenes.server.ts) y los tests.
// La demo no puede escribir, así que todo lo que se siembra pesa poco.

import { zipSync } from "fflate";

import { escribirDicom, type MallaSimple } from "./ejemplos";

// ─── Arcada ──────────────────────────────────────────────────────────────

type Diente = {
  /** Ancho mesiodistal, ancho vestibulolingual y alto de la corona, en mm. */
  a: number;
  b: number;
  h: number;
  /** Cúspides marcadas (molares y premolares); 0 = borde incisal plano. */
  cuspide: number;
};

/** De un extremo de la arcada al otro: M3-M1, P2-P1, C, I2-I1 y simétrico. */
const MEDIO: Diente[] = [
  { a: 10.5, b: 11, h: 7.5, cuspide: 1 }, // 8
  { a: 10, b: 10.5, h: 7.5, cuspide: 1 }, // 7
  { a: 10.5, b: 11, h: 7.5, cuspide: 1 }, // 6
  { a: 7, b: 9, h: 8, cuspide: 0.6 }, // 5
  { a: 7, b: 9, h: 8.5, cuspide: 0.6 }, // 4
  { a: 7.5, b: 8, h: 10, cuspide: 0 }, // 3 (canino)
  { a: 6.5, b: 6.5, h: 9.5, cuspide: 0 }, // 2
  { a: 8.5, b: 7, h: 10.5, cuspide: 0 }, // 1
];
const DIENTES: Diente[] = [...MEDIO, ...[...MEDIO].reverse()];

const MARFIL: [number, number, number] = [0.95, 0.92, 0.83];
const ENCIA: [number, number, number] = [0.84, 0.52, 0.52];

type Parte = { pos: number[]; idx: number[]; col: number[] };

/** Agrega una malla en grilla (filas × columnas) con color uniforme. */
function grilla(
  m: Parte,
  filas: number,
  columnas: number,
  cierraColumnas: boolean,
  punto: (i: number, j: number) => [number, number, number],
  color: [number, number, number],
) {
  const base = m.pos.length / 3;
  for (let i = 0; i <= filas; i++)
    for (let j = 0; j < columnas; j++) {
      m.pos.push(...punto(i, j));
      m.col.push(...color);
    }
  const ancho = columnas;
  for (let i = 0; i < filas; i++)
    for (let j = 0; j < columnas; j++) {
      const j1 = j + 1 < columnas ? j + 1 : cierraColumnas ? 0 : -1;
      if (j1 < 0) continue;
      const a = base + i * ancho + j;
      const b = base + i * ancho + j1;
      const c = base + (i + 1) * ancho + j;
      const d = base + (i + 1) * ancho + j1;
      m.idx.push(a, b, d, a, d, c);
    }
}

/**
 * Arcada superior de ejemplo, ~50 × 45 × 18 mm (como un modelo de yeso), con
 * Z oclusal. Piezas con corona redondeada, cúspides en molares y premolares,
 * borde incisal en el sector anterior y encía rosada en herradura.
 */
export function arcadaDemo(): MallaSimple {
  const m: Parte = { pos: [], idx: [], col: [] };
  const radioX = 24;
  const radioY = 21;
  const zEncia = 4;

  // Encía: tubo en herradura (sección elíptica) que sostiene las piezas.
  const pasos = 160;
  const lados = 20;
  grilla(
    m,
    pasos,
    lados,
    true,
    (i, j) => {
      const t = Math.PI * (i / pasos);
      const cx = Math.cos(t) * radioX;
      const cy = Math.sin(t) * radioY;
      // Normal hacia afuera de la herradura.
      const nx = Math.cos(t) / radioX;
      const ny = Math.sin(t) / radioY;
      const l = Math.hypot(nx, ny);
      const ux = nx / l;
      const uy = ny / l;
      const w = (j / lados) * Math.PI * 2;
      const ancho = 9.5;
      const alto = 5.5;
      return [
        cx + ux * Math.cos(w) * ancho,
        cy + uy * Math.cos(w) * ancho,
        zEncia - 1 + Math.sin(w) * alto,
      ];
    },
    ENCIA,
  );

  // Piezas.
  DIENTES.forEach((d, k) => {
    const t = Math.PI * ((k + 0.5) / DIENTES.length);
    const cx = Math.cos(t) * radioX;
    const cy = Math.sin(t) * radioY;
    // Tangente a la herradura y normal hacia adentro.
    const tx = -Math.sin(t) * radioX;
    const ty = Math.cos(t) * radioY;
    const lt = Math.hypot(tx, ty);
    const ex = tx / lt;
    const ey = ty / lt;
    const ix = -ey;
    const iy = ex;
    const anillos = 24;
    const sectores = 40;
    grilla(
      m,
      anillos,
      sectores,
      true,
      (i, j) => {
        const u = (i / anillos) * (Math.PI / 2); // 0 base, π/2 tope
        const f = (j / sectores) * Math.PI * 2;
        const perfil = Math.pow(Math.cos(u), 0.55); // corona: hombros redondeados
        const sx = (d.a / 2) * perfil * Math.cos(f);
        const sy = (d.b / 2) * perfil * Math.sin(f);
        let z = zEncia + Math.pow(Math.sin(u), 0.8) * d.h;
        // Cúspides en molares y premolares; incisivos y caninos con borde plano.
        if (d.cuspide > 0) z += d.cuspide * 0.9 * Math.cos(2 * f) * Math.pow(Math.sin(u), 3);
        else z = Math.min(z, zEncia + d.h - 0.25 * Math.abs(Math.sin(f)));
        // Apenas más angosto hacia el borde incisal en el sector anterior.
        return [cx + ex * sx + ix * sy, cy + ey * sx + iy * sy, z];
      },
      MARFIL,
    );
  });

  return { posiciones: m.pos, indices: m.idx, colores: m.col };
}

/** La misma arcada espejada y más baja: la "inferior" del PLY de ejemplo. */
export function arcadaInferiorDemo(): MallaSimple {
  const s = arcadaDemo();
  const pos = s.posiciones.slice();
  for (let i = 0; i < pos.length; i += 3) {
    pos[i + 1] = -pos[i + 1] + 4; // espejo adelante-atrás
    pos[i + 2] = pos[i + 2] * 0.85;
  }
  // El espejo invierte las caras: se corrige el orden de los índices.
  const idx = s.indices.slice();
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  return { posiciones: pos, indices: idx, colores: s.colores };
}

// ─── CBCT ────────────────────────────────────────────────────────────────

/** Ruido determinista y barato (sin Math.random: el archivo es reproducible). */
function ruido(i: number, sigma: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296 + (Math.imul(h, 2654435761) >>> 0) / 4294967296 - 1) * sigma * 1.7;
}

export type OpcionesCbctDemo = {
  lado?: number;
  cortes?: number;
  /** mm por vóxel (en los tres ejes). */
  espaciado?: number;
  sigma?: number;
};

/**
 * Cabeza sintética: cráneo, cerebro, senos, maxilar con el arco dental
 * (esmalte y dentina), mandíbula y lengua. Un archivo DICOM por corte, sin
 * comprimir (Explicit VR Little Endian, 16 bits con intercepto −1024), todos
 * dentro de un ZIP como lo entrega el software del equipo.
 */
export function cbctDemoZip(o: OpcionesCbctDemo = {}): Uint8Array {
  const lado = o.lado ?? 160;
  const cortes = o.cortes ?? 112;
  const esp = o.espaciado ?? 1;
  const sigma = o.sigma ?? 18;
  const centro = lado / 2;
  const entradas: Record<string, Uint8Array> = {};
  for (let z = 0; z < cortes; z++) {
    const px = new Uint8Array(lado * lado * 2);
    const v = new DataView(px.buffer);
    const h = z / (cortes - 1); // 0 base de la mandíbula, 1 vértex
    for (let y = 0; y < lado; y++) {
      for (let x = 0; x < lado; x++) {
        const dx = (x - centro) / (lado * 0.36);
        const dy = (y - centro * 1.05) / (lado * 0.42);
        const dz = (h - 0.66) / 0.66;
        const rr = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let hu = -1000;
        if (rr < 1) hu = 40; // tejido blando
        if (rr < 0.97 && rr > 0.86) hu = 760; // cráneo
        if (rr <= 0.86) hu = 28 + 10 * Math.sin(y * 0.2 + z * 0.15); // cerebro
        // Senos maxilares: dos huecos de aire a los lados del arco.
        if (
          h > 0.62 &&
          h < 0.82 &&
          Math.abs(dx) > 0.22 &&
          Math.abs(dx) < 0.5 &&
          dy > -0.1 &&
          dy < 0.3
        )
          hu = -900;
        // Maxilar, mandíbula y arco dental.
        if (h < 0.74) {
          const ay = dy + 0.05;
          const rad = Math.hypot(dx, ay);
          const anillo = Math.abs(rad - 0.6);
          const delante = ay > -0.2;
          if (delante && anillo < 0.17) hu = 1150; // hueso alveolar
          if (delante && anillo < 0.075 && h > 0.34 && h < 0.66) {
            const ang = Math.atan2(ay, dx);
            hu = Math.abs(Math.sin(ang * 7)) > 0.3 ? 2650 : 1500; // esmalte / separación
          }
          if (h < 0.56 && rad < 0.46 && delante) hu = 110; // lengua
        }
        const val = Math.round(hu + ruido((z * lado + y) * lado + x, sigma));
        v.setUint16((y * lado + x) * 2, Math.max(0, Math.min(65535, val + 1024)), true);
      }
    }
    entradas[`estudio/IM${String(z).padStart(4, "0")}.dcm`] = escribirDicom([
      { tag: 0x00080020, vr: "DA", valor: "20261020" },
      { tag: 0x00080060, vr: "CS", valor: "CT" },
      { tag: 0x00180050, vr: "DS", valor: [esp] },
      { tag: 0x0020000e, vr: "UI", valor: "1.2.826.0.1.3680043.10.1.77" },
      { tag: 0x00200013, vr: "IS", valor: [z + 1] },
      {
        tag: 0x00200032,
        vr: "DS",
        valor: [(-lado * esp) / 2, (-lado * esp) / 2, Math.round(z * esp * 100) / 100],
      },
      { tag: 0x00200037, vr: "DS", valor: [1, 0, 0, 0, 1, 0] },
      { tag: 0x00280002, vr: "US", valor: [1] },
      { tag: 0x00280004, vr: "CS", valor: "MONOCHROME2" },
      { tag: 0x00280010, vr: "US", valor: [lado] },
      { tag: 0x00280011, vr: "US", valor: [lado] },
      { tag: 0x00280030, vr: "DS", valor: [esp, esp] },
      { tag: 0x00280100, vr: "US", valor: [16] },
      { tag: 0x00280101, vr: "US", valor: [16] },
      { tag: 0x00280103, vr: "US", valor: [0] },
      { tag: 0x00281050, vr: "DS", valor: [400] },
      { tag: 0x00281051, vr: "DS", valor: [2500] },
      { tag: 0x00281052, vr: "DS", valor: [-1024] },
      { tag: 0x00281053, vr: "DS", valor: [1] },
      { tag: 0x7fe00010, vr: "OW", valor: px },
    ]);
  }
  return zipSync(entradas, { level: 6 });
}
