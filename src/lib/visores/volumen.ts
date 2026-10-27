// Volumen 3D a partir de cortes DICOM y extracción de cortes axial,
// coronal y sagital con ventana/nivel (IMG-04).

import { unzipSync } from "fflate";

import { parsearDicom, pareceDicom, type CorteDicom, type Vec3 } from "./dicom";
import { ErrorDeVisor, MAX_BYTES_DICOM, MAX_VOXELES, MAX_VOXELES_EQUIPO_CHICO } from "./limites";

export { MAX_BYTES_DICOM, MAX_VOXELES, MAX_VOXELES_EQUIPO_CHICO };

export type Plano = "axial" | "coronal" | "sagital";

export type Volumen = {
  /** Columnas (x), filas (y) y cortes (z). */
  ancho: number;
  alto: number;
  profundidad: number;
  /** Valor ya reescalado (unidades Hounsfield en CT) por vóxel: x + y·ancho + z·ancho·alto. */
  datos: Int16Array;
  /** mm por vóxel en x, y, z. */
  espaciado: Vec3;
  minimo: number;
  maximo: number;
  ventanaInicial: { centro: number; ancho: number };
  /** MONOCHROME1: el valor alto se ve oscuro. */
  invertido: boolean;
  /** 1 = resolución completa; 2 = uno de cada dos vóxeles por eje… */
  reduccion: number;
  espaciadoAproximado: boolean;
  /** El espaciado entre cortes no venía en el archivo y se supuso. */
  espesorSupuesto: boolean;
  modalidad: string | null;
  fechaEstudio: string | null;
  /** Series que venían en el mismo ZIP y no se muestran. */
  seriesIgnoradas: number;
};

// ─── Entrada: archivos o ZIP ─────────────────────────────────────────────

const esZip = (b: Uint8Array) =>
  b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * Abre los archivos recibidos (sueltos o dentro de un ZIP) y devuelve los
 * DICOM. Ignora DICOMDIR, miniaturas y lo que no sea DICOM.
 */
export function abrirArchivosDicom(archivos: Uint8Array[]): CorteDicom[] {
  const crudos: Uint8Array[] = [];
  let total = 0;
  for (const a of archivos) {
    if (esZip(a)) {
      let entradas: Record<string, Uint8Array>;
      try {
        entradas = unzipSync(a, {
          filter: (f) => !f.name.endsWith("/") && !/(^|\/)(DICOMDIR|__MACOSX)/i.test(f.name),
        });
      } catch {
        throw new ErrorDeVisor(
          "No se pudo abrir el ZIP: está dañado o usa un formato no soportado.",
        );
      }
      for (const contenido of Object.values(entradas)) {
        total += contenido.byteLength;
        if (total > MAX_BYTES_DICOM * 1.5) {
          throw new ErrorDeVisor(
            `El estudio descomprimido pasa de ${Math.round((MAX_BYTES_DICOM * 1.5) / 1024 / 1024)} MB, más de lo que el navegador maneja bien. Exporta solo la serie que quieres ver.`,
          );
        }
        crudos.push(contenido);
      }
    } else crudos.push(a);
  }
  const cortes: CorteDicom[] = [];
  let primerError: unknown = null;
  for (const c of crudos) {
    if (!pareceDicom(c)) continue;
    try {
      const corte = parsearDicom(c);
      if (corte.pixeles) cortes.push(corte);
    } catch (e) {
      primerError ??= e;
    }
  }
  if (cortes.length === 0) {
    if (primerError instanceof ErrorDeVisor) throw primerError;
    throw new ErrorDeVisor("No se encontró ninguna imagen DICOM en el archivo.");
  }
  return cortes;
}

// ─── Volumen ─────────────────────────────────────────────────────────────

function cruz(a: number[], b: number[]): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
const punto = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

type CuadroFuente = { corte: CorteDicom; cuadro: number; clave: number | null };

/** Factor entero más chico que deja el volumen bajo el presupuesto. */
export function factorDeReduccion(
  ancho: number,
  alto: number,
  prof: number,
  maxVoxeles: number,
): number {
  let f = 1;
  while (Math.ceil(ancho / f) * Math.ceil(alto / f) * Math.ceil(prof / f) > maxVoxeles) f++;
  return f;
}

export function construirVolumen(
  cortesEntrada: CorteDicom[],
  opciones: { maxVoxeles?: number } = {},
): Volumen {
  const maxVoxeles = opciones.maxVoxeles ?? MAX_VOXELES;
  // Una serie por vez: la que tiene más imágenes.
  const porSerie = new Map<string, CorteDicom[]>();
  for (const c of cortesEntrada) {
    const k = c.serieUid ?? "sin-serie";
    porSerie.set(k, [...(porSerie.get(k) ?? []), c]);
  }
  const series = [...porSerie.values()].sort(
    (a, b) => b.reduce((s, c) => s + c.cuadros, 0) - a.reduce((s, c) => s + c.cuadros, 0),
  );
  const cortes = series[0];
  const ref = cortes[0];
  const { filas, columnas } = ref;
  if (!filas || !columnas) throw new ErrorDeVisor("El DICOM no indica el tamaño de la imagen.");
  if (ref.bitsAsignados !== 8 && ref.bitsAsignados !== 16) {
    throw new ErrorDeVisor(
      `El DICOM usa ${ref.bitsAsignados} bits por píxel; el visor lee 8 y 16.`,
    );
  }
  if (cortes.some((c) => c.filas !== filas || c.columnas !== columnas)) {
    throw new ErrorDeVisor("Las imágenes de la serie no tienen todas el mismo tamaño.");
  }

  // Orden de los cuadros a lo largo de la normal del plano.
  const normal = ref.orientacion
    ? cruz(ref.orientacion.slice(0, 3), ref.orientacion.slice(3, 6))
    : null;
  const fuentes: CuadroFuente[] = [];
  for (const c of cortes) {
    for (let f = 0; f < c.cuadros; f++) {
      const pos = c.posicionesPorCuadro[f] ?? (c.cuadros === 1 ? c.posicion : null);
      const clave = normal && pos ? punto(pos, normal) : null;
      fuentes.push({ corte: c, cuadro: f, clave });
    }
  }
  const conClave = fuentes.every((f) => f.clave !== null);
  if (conClave) fuentes.sort((a, b) => (a.clave as number) - (b.clave as number));
  else if (fuentes.every((f) => f.corte.instancia !== null) && cortes.length > 1) {
    fuentes.sort(
      (a, b) =>
        (a.corte.instancia as number) - (b.corte.instancia as number) || a.cuadro - b.cuadro,
    );
  }

  let espesorSupuesto = false;
  let dz: number;
  if (conClave && fuentes.length > 1) {
    const difs = fuentes
      .slice(1)
      .map((f, i) => Math.abs((f.clave as number) - (fuentes[i].clave as number)));
    dz = mediana(difs.filter((d) => d > 1e-6)) ?? 0;
  } else dz = 0;
  if (!(dz > 0)) {
    dz = ref.espacioEntreCortes ?? ref.grosorCorte ?? 0;
    if (!(dz > 0)) {
      dz = ref.espaciadoPixel?.[0] ?? 1;
      espesorSupuesto = fuentes.length > 1;
    }
  }
  const [dx, dy] = ref.espaciadoPixel ?? [1, 1];

  const profundidad0 = fuentes.length;
  const f = factorDeReduccion(columnas, filas, profundidad0, maxVoxeles);
  const ancho = Math.ceil(columnas / f);
  const alto = Math.ceil(filas / f);
  const profundidad = Math.ceil(profundidad0 / f);
  const datos = new Int16Array(ancho * alto * profundidad);

  let minimo = Infinity;
  let maximo = -Infinity;
  for (let z = 0; z < profundidad; z++) {
    const { corte, cuadro } = fuentes[z * f];
    const leer = lectorDePixeles(corte, cuadro);
    const baseZ = z * ancho * alto;
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const v = leer(x * f, y * f);
        const r = Math.max(-32768, Math.min(32767, Math.round(v)));
        datos[baseZ + y * ancho + x] = r;
        if (r < minimo) minimo = r;
        if (r > maximo) maximo = r;
      }
    }
  }

  return {
    ancho,
    alto,
    profundidad,
    datos,
    espaciado: [dx * f, dy * f, dz * f],
    minimo,
    maximo,
    ventanaInicial: ref.ventana ?? ventanaAutomatica(datos, minimo, maximo),
    invertido: ref.fotometrica === "MONOCHROME1",
    reduccion: f,
    espaciadoAproximado: ref.espaciadoAproximado || !ref.espaciadoPixel,
    espesorSupuesto,
    modalidad: ref.modalidad,
    fechaEstudio: ref.fechaEstudio,
    seriesIgnoradas: series.length - 1,
  };
}

/** Devuelve una función (columna, fila) → valor reescalado de un cuadro. */
function lectorDePixeles(c: CorteDicom, cuadro: number): (x: number, y: number) => number {
  const px = c.pixeles as Uint8Array;
  const bytes = c.bitsAsignados / 8;
  const muestras = c.muestrasPorPixel;
  const porCuadro = c.filas * c.columnas * muestras * bytes;
  const inicio = cuadro * porCuadro;
  if (inicio + porCuadro > px.byteLength) {
    throw new ErrorDeVisor("El DICOM está incompleto: faltan píxeles de algunas imágenes.");
  }
  const vista = new DataView(px.buffer, px.byteOffset + inicio, porCuadro);
  const le = c.littleEndian;
  const mascara = c.bitsAlmacenados < c.bitsAsignados ? (1 << c.bitsAlmacenados) - 1 : 0;
  const signo = 1 << (c.bitsAlmacenados - 1);
  const crudo = (i: number): number => {
    let v = bytes === 1 ? vista.getUint8(i) : vista.getUint16(i * 2, le);
    if (mascara) v &= mascara;
    if (c.conSigno) {
      if (mascara) {
        if (v & signo) v -= 1 << c.bitsAlmacenados;
      } else if (bytes === 1) v = (v << 24) >> 24;
      else v = (v << 16) >> 16;
    }
    return v;
  };
  const m = c.pendiente;
  const b = c.intercepto;
  if (muestras === 1) return (x, y) => crudo(y * c.columnas + x) * m + b;
  // Color (RGB): se muestra en escala de grises por luminancia.
  const n = c.filas * c.columnas;
  const planar = c.configuracionPlanar === 1;
  return (x, y) => {
    const i = y * c.columnas + x;
    const [r, g, bl] = planar
      ? [crudo(i), crudo(n + i), crudo(2 * n + i)]
      : [crudo(i * 3), crudo(i * 3 + 1), crudo(i * 3 + 2)];
    return 0.299 * r + 0.587 * g + 0.114 * bl;
  };
}

/** Ventana entre los percentiles 1 y 99 cuando el archivo no trae una. */
export function ventanaAutomatica(datos: Int16Array, minimo: number, maximo: number) {
  if (maximo <= minimo) return { centro: minimo, ancho: 1 };
  const cubetas = 1024;
  const hist = new Uint32Array(cubetas);
  const escala = (cubetas - 1) / (maximo - minimo);
  const paso = Math.max(1, Math.floor(datos.length / 2_000_000));
  let n = 0;
  for (let i = 0; i < datos.length; i += paso) {
    hist[Math.floor((datos[i] - minimo) * escala)]++;
    n++;
  }
  const percentil = (p: number) => {
    let acum = 0;
    for (let k = 0; k < cubetas; k++) {
      acum += hist[k];
      if (acum >= n * p) return minimo + k / escala;
    }
    return maximo;
  };
  const bajo = percentil(0.01);
  const alto = percentil(0.99);
  const ancho = Math.max(1, alto - bajo);
  return { centro: Math.round(bajo + ancho / 2), ancho: Math.round(ancho) };
}

// ─── Cortes ──────────────────────────────────────────────────────────────

export type Corte2d = {
  ancho: number;
  alto: number;
  valores: Int16Array;
  /** mm por píxel en horizontal y vertical. */
  espaciado: [number, number];
};

export function cantidadDeCortes(v: Volumen, plano: Plano): number {
  return plano === "axial" ? v.profundidad : plano === "coronal" ? v.alto : v.ancho;
}

/**
 * Corte de un plano. En coronal y sagital el eje vertical es z, dado vuelta
 * para que lo superior quede arriba (los cortes se ordenan de inferior a
 * superior a lo largo de la normal).
 */
export function extraerCorte(v: Volumen, plano: Plano, indice: number): Corte2d {
  const n = cantidadDeCortes(v, plano);
  const i = Math.max(0, Math.min(n - 1, Math.round(indice)));
  const { ancho: W, alto: H, profundidad: D, datos } = v;
  if (plano === "axial") {
    return {
      ancho: W,
      alto: H,
      valores: datos.subarray(i * W * H, (i + 1) * W * H),
      espaciado: [v.espaciado[0], v.espaciado[1]],
    };
  }
  if (plano === "coronal") {
    const valores = new Int16Array(W * D);
    for (let z = 0; z < D; z++) {
      const fila = D - 1 - z;
      valores.set(datos.subarray(z * W * H + i * W, z * W * H + i * W + W), fila * W);
    }
    return { ancho: W, alto: D, valores, espaciado: [v.espaciado[0], v.espaciado[2]] };
  }
  const valores = new Int16Array(H * D);
  for (let z = 0; z < D; z++) {
    const fila = D - 1 - z;
    for (let y = 0; y < H; y++) valores[fila * H + y] = datos[z * W * H + y * W + i];
  }
  return { ancho: H, alto: D, valores, espaciado: [v.espaciado[1], v.espaciado[2]] };
}

/** Pinta un corte en RGBA con ventana (ancho) y nivel (centro). */
export function aplicarVentana(
  corte: Corte2d,
  centro: number,
  ancho: number,
  invertido: boolean,
  salida: Uint8ClampedArray,
): void {
  const bajo = centro - ancho / 2;
  const escala = 255 / Math.max(1, ancho);
  const { valores } = corte;
  for (let i = 0; i < valores.length; i++) {
    let g = (valores[i] - bajo) * escala;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (invertido) g = 255 - g;
    const o = i * 4;
    salida[o] = g;
    salida[o + 1] = g;
    salida[o + 2] = g;
    salida[o + 3] = 255;
  }
}

/** Preajustes de ventana para CT/CBCT (en unidades Hounsfield). */
export const VENTANAS_CT = [
  { id: "hueso", label: "Hueso", centro: 500, ancho: 2000 },
  { id: "diente", label: "Diente", centro: 1200, ancho: 3000 },
  { id: "blando", label: "Tejido blando", centro: 40, ancho: 400 },
] as const;
