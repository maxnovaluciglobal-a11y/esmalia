// Archivos de ejemplo para los visores, generados en el momento.
//
// Los usan los tests (fixtures chicos) y la página de prueba de desarrollo.
// No hay datos de pacientes: la arcada es procedural y el "CBCT" es un
// fantoma geométrico (arco óseo con piezas). Nada de esto se versiona como
// binario.

import { zipSync } from "fflate";

// ─── Mallas ──────────────────────────────────────────────────────────────

export type MallaSimple = { posiciones: number[]; indices: number[]; colores?: number[] };

/** Tetraedro: el fixture mínimo (4 vértices, 4 caras). */
export function tetraedro(): MallaSimple {
  return {
    posiciones: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10],
    indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
    colores: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
  };
}

function triangulosPlanos(m: MallaSimple): number[] {
  const out: number[] = [];
  for (const i of m.indices)
    out.push(m.posiciones[i * 3], m.posiciones[i * 3 + 1], m.posiciones[i * 3 + 2]);
  return out;
}

export function aStlBinario(m: MallaSimple): Uint8Array {
  const plano = triangulosPlanos(m);
  const n = plano.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const v = new DataView(buf);
  const cabecera = "Esmalia ejemplo";
  for (let i = 0; i < cabecera.length; i++) v.setUint8(i, cabecera.charCodeAt(i));
  v.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12;
    for (let k = 0; k < 9; k++) {
      v.setFloat32(o, plano[t * 9 + k], true);
      o += 4;
    }
    o += 2;
  }
  return new Uint8Array(buf);
}

export function aStlAscii(m: MallaSimple): Uint8Array {
  const plano = triangulosPlanos(m);
  let s = "solid ejemplo\n";
  for (let t = 0; t < plano.length; t += 9) {
    s += "  facet normal 0 0 0\n    outer loop\n";
    for (let k = 0; k < 9; k += 3)
      s += `      vertex ${plano[t + k]} ${plano[t + k + 1]} ${plano[t + k + 2]}\n`;
    s += "    endloop\n  endfacet\n";
  }
  s += "endsolid ejemplo\n";
  return new TextEncoder().encode(s);
}

export function aPlyAscii(m: MallaSimple): Uint8Array {
  const nv = m.posiciones.length / 3;
  const nf = m.indices.length / 3;
  const color = m.colores ? "property uchar red\nproperty uchar green\nproperty uchar blue\n" : "";
  let s = `ply\nformat ascii 1.0\ncomment Esmalia ejemplo\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n${color}element face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`;
  for (let i = 0; i < nv; i++) {
    const p = m.posiciones.slice(i * 3, i * 3 + 3).join(" ");
    const c = m.colores
      ? " " +
        m.colores
          .slice(i * 3, i * 3 + 3)
          .map((x) => Math.round(x * 255))
          .join(" ")
      : "";
    s += p + c + "\n";
  }
  for (let f = 0; f < nf; f++) s += `3 ${m.indices.slice(f * 3, f * 3 + 3).join(" ")}\n`;
  return new TextEncoder().encode(s);
}

export function aPlyBinario(m: MallaSimple): Uint8Array {
  const nv = m.posiciones.length / 3;
  const nf = m.indices.length / 3;
  const color = m.colores ? "property uchar red\nproperty uchar green\nproperty uchar blue\n" : "";
  const cabecera = new TextEncoder().encode(
    `ply\nformat binary_little_endian 1.0\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n${color}element face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`,
  );
  const porVertice = 12 + (m.colores ? 3 : 0);
  const buf = new Uint8Array(cabecera.length + nv * porVertice + nf * 13);
  buf.set(cabecera);
  const v = new DataView(buf.buffer);
  let o = cabecera.length;
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      v.setFloat32(o, m.posiciones[i * 3 + k], true);
      o += 4;
    }
    if (m.colores)
      for (let k = 0; k < 3; k++) v.setUint8(o++, Math.round(m.colores[i * 3 + k] * 255));
  }
  for (let f = 0; f < nf; f++) {
    v.setUint8(o++, 3);
    for (let k = 0; k < 3; k++) {
      v.setInt32(o, m.indices[f * 3 + k], true);
      o += 4;
    }
  }
  return buf;
}

export function aObj(m: MallaSimple): Uint8Array {
  let s = "# Esmalia ejemplo\no ejemplo\n";
  for (let i = 0; i < m.posiciones.length; i += 3)
    s += `v ${m.posiciones[i]} ${m.posiciones[i + 1]} ${m.posiciones[i + 2]}\n`;
  s += "vn 0 0 1\n";
  for (let f = 0; f < m.indices.length; f += 3) {
    s += `f ${m.indices[f] + 1}//1 ${m.indices[f + 1] + 1}//1 ${m.indices[f + 2] + 1}//1\n`;
  }
  return new TextEncoder().encode(s);
}

/**
 * Arcada de ejemplo: base en herradura y 14 piezas como cúpulas, en mm
 * (unos 50 × 45 × 15 mm, como un modelo de yeso). Z es oclusal.
 */
export function arcadaDeEjemplo(): MallaSimple {
  const posiciones: number[] = [];
  const indices: number[] = [];
  const cupula = (cx: number, cy: number, cz: number, rx: number, ry: number, h: number) => {
    const base = posiciones.length / 3;
    const anillos = 8;
    const sectores = 16;
    for (let a = 0; a <= anillos; a++) {
      const t = (a / anillos) * (Math.PI / 2);
      for (let s = 0; s < sectores; s++) {
        const f = (s / sectores) * Math.PI * 2;
        const ondula = 1 + 0.08 * Math.cos(f * 4) * Math.sin(t);
        posiciones.push(
          cx + Math.cos(t) * rx * Math.cos(f) * ondula,
          cy + Math.cos(t) * ry * Math.sin(f) * ondula,
          cz + Math.sin(t) * h,
        );
      }
    }
    for (let a = 0; a < anillos; a++) {
      for (let s = 0; s < sectores; s++) {
        const i0 = base + a * sectores + s;
        const i1 = base + a * sectores + ((s + 1) % sectores);
        const i2 = i0 + sectores;
        const i3 = i1 + sectores;
        indices.push(i0, i1, i3, i0, i3, i2);
      }
    }
  };
  // Base: un tubo en herradura (media elipse).
  const pasos = 48;
  const lados = 12;
  const baseInicio = posiciones.length / 3;
  for (let p = 0; p <= pasos; p++) {
    const u = Math.PI * (p / pasos);
    const cx = Math.cos(u) * 22;
    const cy = Math.sin(u) * 20;
    const nx = Math.cos(u);
    const ny = Math.sin(u);
    for (let l = 0; l < lados; l++) {
      const w = (l / lados) * Math.PI * 2;
      posiciones.push(cx + nx * Math.cos(w) * 6, cy + ny * Math.cos(w) * 6, Math.sin(w) * 4);
    }
  }
  for (let p = 0; p < pasos; p++) {
    for (let l = 0; l < lados; l++) {
      const i0 = baseInicio + p * lados + l;
      const i1 = baseInicio + p * lados + ((l + 1) % lados);
      indices.push(i0, i0 + lados, i1, i1, i0 + lados, i1 + lados);
    }
  }
  // 14 piezas: molares más anchos atrás, incisivos adelante.
  for (let k = 0; k < 14; k++) {
    const u = Math.PI * ((k + 0.5) / 14);
    const centro = Math.abs(k - 6.5) / 6.5; // 0 adelante, 1 atrás
    const r = 2.6 + centro * 2.4;
    cupula(Math.cos(u) * 22, Math.sin(u) * 20, 3, r, r * 0.9, 6 + (1 - centro) * 3);
  }
  return { posiciones, indices };
}

// ─── DICOM ───────────────────────────────────────────────────────────────

type Elemento = { tag: number; vr: string; valor: string | number[] | Uint8Array };

const VR_LARGOS = new Set(["OB", "OW", "SQ", "UN", "UT"]);

function bytesDeValor(vr: string, valor: Elemento["valor"]): Uint8Array {
  if (valor instanceof Uint8Array) return valor;
  if (vr === "US") {
    const b = new Uint8Array((valor as number[]).length * 2);
    const v = new DataView(b.buffer);
    (valor as number[]).forEach((n, i) => v.setUint16(i * 2, n, true));
    return b;
  }
  let s = Array.isArray(valor) ? valor.join("\\") : valor;
  if (s.length % 2) s += vr === "UI" ? "\0" : " ";
  return new TextEncoder().encode(s);
}

/** Escribe un DICOM Part 10 (con preámbulo y metainformación). */
export function escribirDicom(
  elementos: Elemento[],
  opciones: { sintaxis?: "explicita" | "implicita" } = {},
): Uint8Array {
  const implicita = opciones.sintaxis === "implicita";
  const partes: Uint8Array[] = [new Uint8Array(128), new TextEncoder().encode("DICM")];
  const escribir = (e: Elemento, explicita: boolean) => {
    const datos = bytesDeValor(e.vr, e.valor);
    const largo = explicita && VR_LARGOS.has(e.vr) ? 12 : 8;
    const b = new Uint8Array(largo + datos.length);
    const v = new DataView(b.buffer);
    v.setUint16(0, e.tag >>> 16, true);
    v.setUint16(2, e.tag & 0xffff, true);
    if (!explicita) v.setUint32(4, datos.length, true);
    else if (VR_LARGOS.has(e.vr)) {
      b[4] = e.vr.charCodeAt(0);
      b[5] = e.vr.charCodeAt(1);
      v.setUint32(8, datos.length, true);
    } else {
      b[4] = e.vr.charCodeAt(0);
      b[5] = e.vr.charCodeAt(1);
      v.setUint16(6, datos.length, true);
    }
    b.set(datos, largo);
    partes.push(b);
  };
  escribir(
    { tag: 0x00020010, vr: "UI", valor: implicita ? "1.2.840.10008.1.2" : "1.2.840.10008.1.2.1" },
    true,
  );
  for (const e of [...elementos].sort((a, b) => a.tag - b.tag)) escribir(e, !implicita);
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export type OpcionesFantoma = {
  lado?: number;
  cortes?: number;
  espaciado?: number;
  espesor?: number;
  sintaxis?: "explicita" | "implicita";
  /** Agrega un nombre de paciente de mentira para probar que no se lee. */
  conNombreFalso?: boolean;
};

/**
 * Fantoma de CBCT: aire (−1000 HU), tejido blando (40), un arco óseo en
 * herradura (1000) y piezas (2200) que cambian con la altura. Un archivo
 * por corte, en una misma serie, en orden de instancia mezclado.
 */
export function fantomaCbct(o: OpcionesFantoma = {}): Uint8Array[] {
  const lado = o.lado ?? 64;
  const cortes = o.cortes ?? 48;
  const esp = o.espaciado ?? 0.5;
  const espesor = o.espesor ?? esp;
  const archivos: Uint8Array[] = [];
  const centro = lado / 2;
  for (let z = 0; z < cortes; z++) {
    const px = new Uint8Array(lado * lado * 2);
    const v = new DataView(px.buffer);
    const altura = z / (cortes - 1); // 0 abajo, 1 arriba
    for (let y = 0; y < lado; y++) {
      for (let x = 0; x < lado; x++) {
        const dx = (x - centro) / (lado * 0.42);
        const dy = (y - centro * 1.2) / (lado * 0.4);
        const r = Math.hypot(dx, dy);
        let hu = -1000;
        if (r < 1.05) hu = 40;
        const enArco = dy < 0.15 && Math.abs(r - 0.7) < 0.12;
        if (enArco && altura < 0.6) hu = 1000;
        if (enArco && altura >= 0.45 && altura < 0.9) {
          // Piezas: 10 bloques a lo largo del arco.
          const ang = Math.atan2(dy, dx);
          if (Math.abs(Math.sin(ang * 5)) > 0.35) hu = 2200;
        }
        // Valor guardado con intercepto −1024 (como la mayoría de los equipos).
        v.setUint16((y * lado + x) * 2, hu + 1024, true);
      }
    }
    const elementos: Elemento[] = [
      { tag: 0x00080020, vr: "DA", valor: "20260312" },
      { tag: 0x00080060, vr: "CS", valor: "CT" },
      { tag: 0x00180050, vr: "DS", valor: [espesor] },
      { tag: 0x0020000e, vr: "UI", valor: "1.2.826.0.1.3680043.10.1.1" },
      { tag: 0x00200013, vr: "IS", valor: [z + 1] },
      { tag: 0x00200032, vr: "DS", valor: [-16, -16, z * espesor] },
      { tag: 0x00200037, vr: "DS", valor: [1, 0, 0, 0, 1, 0] },
      { tag: 0x00280002, vr: "US", valor: [1] },
      { tag: 0x00280004, vr: "CS", valor: "MONOCHROME2" },
      { tag: 0x00280010, vr: "US", valor: [lado] },
      { tag: 0x00280011, vr: "US", valor: [lado] },
      { tag: 0x00280030, vr: "DS", valor: [esp, esp] },
      { tag: 0x00280100, vr: "US", valor: [16] },
      { tag: 0x00280101, vr: "US", valor: [16] },
      { tag: 0x00280103, vr: "US", valor: [0] },
      { tag: 0x00281050, vr: "DS", valor: [500] },
      { tag: 0x00281051, vr: "DS", valor: [2500] },
      { tag: 0x00281052, vr: "DS", valor: [-1024] },
      { tag: 0x00281053, vr: "DS", valor: [1] },
      { tag: 0x7fe00010, vr: "OW", valor: px },
    ];
    if (o.conNombreFalso) {
      elementos.push(
        { tag: 0x00100010, vr: "PN", valor: "PRUEBA^NO MOSTRAR" },
        { tag: 0x00100020, vr: "LO", valor: "11.111.111-1" },
        { tag: 0x00100030, vr: "DA", valor: "19800101" },
      );
    }
    archivos.push(escribirDicom(elementos, { sintaxis: o.sintaxis }));
  }
  // Orden mezclado: el visor tiene que ordenar por posición.
  return archivos
    .map((a, i) => ({ a, k: (i * 7919) % archivos.length }))
    .sort((p, q) => p.k - q.k)
    .map((p) => p.a);
}

/** El fantoma en un solo ZIP, como lo entregaría el software del equipo. */
export function fantomaCbctZip(o: OpcionesFantoma = {}): Uint8Array {
  const archivos = fantomaCbct(o);
  const entradas: Record<string, Uint8Array> = {};
  archivos.forEach((a, i) => (entradas[`estudio/IM${String(i).padStart(4, "0")}.dcm`] = a));
  return zipSync(entradas, { level: 6 });
}
