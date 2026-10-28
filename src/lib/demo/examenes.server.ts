import { deflateSync } from "node:zlib";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { DEMO_CLINIC_ID, PACIENTE_OLA9_DEMO } from "@/lib/demo/ola9.server";
import { arcadaDemo, arcadaInferiorDemo, cbctDemoZip } from "@/lib/visores/demo-3d";
import { aPlyBinario, aStlBinario } from "@/lib/visores/ejemplos";

/**
 * Paso de `/api/demo-reset` para la Ola 13 · frente A: exámenes y fotos de
 * ejemplo en la ficha del paciente de la Ola 9, para que la demo muestre la
 * pestaña Exámenes, las miniaturas, el filtro por pieza, las sesiones de
 * fotos y el antes/después.
 *
 * Las imágenes se GENERAN acá (PNG de pocos KB dibujados con formas simples):
 * no hay radiografías ni fotos reales de nadie. Los escaneos son arcadas
 * procedurales (STL y PLY con color, ~1,5 MB cada una) y el CBCT es un fantoma
 * de cabeza de ~110 cortes en un ZIP de pocos MB (`src/lib/visores/demo-3d.ts`):
 * lucen bien en el visor y casi no pesan, porque la demo no escribe y no tiene
 * que cargar el bucket con archivos grandes.
 *
 * Idempotente (si la clínica ya tiene exámenes, no hace nada; el reset borra
 * la clínica y sus filas en cascada, y los archivos se pisan con upsert en la
 * misma ruta) y nunca lanza: un error se registra y el reset sigue.
 */

type Admin = SupabaseClient<Database>;

const DEMO_USER_ID = "139dd209-8495-415c-b6cd-6bbc63367bad";
const BUCKET = "clinical-exams";

// ── PNG mínimo (RGB, sin dependencias) ─────────────────────────────────────

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloque(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

type Pintor = (x: number, y: number) => [number, number, number];

/** PNG RGB de `ancho`×`alto` con el color de cada píxel que da `pintar`. */
export function pngGenerado(ancho: number, alto: number, pintar: Pintor): Buffer {
  const fila = ancho * 3 + 1;
  const crudo = Buffer.alloc(fila * alto);
  for (let y = 0; y < alto; y++) {
    crudo[y * fila] = 0; // sin filtro
    for (let x = 0; x < ancho; x++) {
      const [r, g, b] = pintar(x, y);
      const i = y * fila + 1 + x * 3;
      crudo[i] = r;
      crudo[i + 1] = g;
      crudo[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque("IHDR", ihdr),
    bloque("IDAT", deflateSync(crudo, { level: 9 })),
    bloque("IEND", Buffer.alloc(0)),
  ]);
}

const gris = (v: number): [number, number, number] => {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return [c, c, c];
};

/** Elipse normalizada: < 1 adentro. */
const elipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;

/** Radiografía periapical esquemática: una pieza clara con su raíz. */
export function periapical(): Buffer {
  return pngGenerado(240, 320, (x, y) => {
    const corona = elipse(x, y, 120, 105, 62, 70);
    const raiz = elipse(x, y, 120, 215, 26, 95);
    const pulpa = elipse(x, y, 120, 160, 9, 95);
    let v = 38 + (y / 320) * 22;
    if (raiz < 1) v = 165;
    if (corona < 1) v = 215;
    if (pulpa < 1 && y > 95) v = 95;
    return gris(v);
  });
}

/** Panorámica esquemática: dos arcadas de piezas claras. */
export function panoramica(): Buffer {
  return pngGenerado(640, 280, (x, y) => {
    let v = 30 + Math.abs(320 - x) / 12;
    for (let i = 0; i < 14; i++) {
      const cx = 70 + i * 38.5;
      const curva = ((cx - 320) / 320) ** 2 * 30;
      if (elipse(x, y, cx, 95 + curva, 15, 34) < 1) v = 205;
      if (elipse(x, y, cx, 190 - curva, 15, 34) < 1) v = 195;
    }
    return gris(v);
  });
}

/** Foto clínica esquemática (sonrisa): encía rosada y piezas, más blancas "después". */
function sonrisa(diente: [number, number, number]): Buffer {
  return pngGenerado(480, 360, (x, y) => {
    const boca = elipse(x, y, 240, 190, 200, 95);
    if (boca >= 1) return [196, 140, 120];
    for (let i = 0; i < 6; i++) {
      const cx = 115 + i * 50;
      if (elipse(x, y, cx, 175, 22, 38) < 1) {
        return diente;
      }
    }
    return y < 160 ? [205, 105, 115] : [120, 40, 50];
  });
}

function diaEn(zona: string, offsetDias: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDias * 86_400_000));
}

export async function sembrarExamenesDeLaDemo(admin: Admin): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id, timezone")
      .eq("id", DEMO_CLINIC_ID)
      .eq("is_demo", true)
      .maybeSingle();
    if (!clinica) return;
    const zona = clinica.timezone || "America/Santiago";

    const { count } = await admin
      .from("patient_exams")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica.id);
    if ((count ?? 0) > 0) return;

    const [{ data: paciente }, { data: profesional }] = await Promise.all([
      admin
        .from("patients")
        .select("id")
        .eq("clinic_id", clinica.id)
        .eq("full_name", PACIENTE_OLA9_DEMO)
        .limit(1)
        .maybeSingle(),
      admin
        .from("professionals")
        .select("id")
        .eq("clinic_id", clinica.id)
        .eq("user_id", DEMO_USER_ID)
        .limit(1)
        .maybeSingle(),
    ]);
    if (!paciente) return;

    const { data: sesiones, error: errSes } = await admin
      .from("clinical_photo_sessions")
      .insert([
        {
          clinic_id: clinica.id,
          patient_id: paciente.id,
          session_date: diaEn(zona, -120),
          reason: "Inicio del blanqueamiento",
          stage: "antes",
          notes: "Fotos de ejemplo de la demo de Esmalia (imágenes generadas).",
          created_by: DEMO_USER_ID,
        },
        {
          clinic_id: clinica.id,
          patient_id: paciente.id,
          session_date: diaEn(zona, -7),
          reason: "Control final del blanqueamiento",
          stage: "despues",
          created_by: DEMO_USER_ID,
        },
      ])
      .select("id, stage");
    if (errSes) throw errSes;
    const sesionAntes = sesiones?.find((s) => s.stage === "antes")?.id ?? null;
    const sesionDespues = sesiones?.find((s) => s.stage === "despues")?.id ?? null;

    const archivos = [
      {
        kind: "periapical",
        nombre: "periapical-36.png",
        mime: "image/png",
        datos: periapical(),
        dias: -30,
        teeth: [36],
        notes: "Control de la endodoncia de la 36.",
        sesion: null,
      },
      {
        kind: "panoramica",
        nombre: "panoramica-inicial.png",
        mime: "image/png",
        datos: panoramica(),
        dias: -150,
        teeth: [],
        notes: "Panorámica de ingreso.",
        sesion: null,
      },
      {
        kind: "foto_clinica",
        nombre: "sonrisa-antes.png",
        mime: "image/png",
        datos: sonrisa([232, 211, 158]),
        dias: -120,
        teeth: [11, 12, 13, 21, 22, 23],
        notes: null,
        sesion: sesionAntes,
      },
      {
        kind: "foto_clinica",
        nombre: "sonrisa-despues.png",
        mime: "image/png",
        datos: sonrisa([250, 247, 238]),
        dias: -7,
        teeth: [11, 12, 13, 21, 22, 23],
        notes: null,
        sesion: sesionDespues,
      },
      {
        kind: "escaneo_intraoral",
        nombre: "arcada-superior.stl",
        mime: "model/stl",
        datos: Buffer.from(aStlBinario(arcadaDemo())),
        dias: -60,
        teeth: [],
        notes: "Escaneo de ejemplo para el visor 3D (arcada generada).",
        sesion: null,
      },
      {
        kind: "escaneo_intraoral",
        nombre: "arcada-inferior-color.ply",
        mime: "model/ply",
        datos: Buffer.from(aPlyBinario(arcadaInferiorDemo())),
        dias: -60,
        teeth: [],
        notes: "Escaneo de ejemplo con color (arcada generada).",
        sesion: null,
      },
      {
        kind: "cbct_dicom",
        nombre: "cbct-ejemplo.zip",
        mime: "application/zip",
        datos: Buffer.from(cbctDemoZip()),
        dias: -90,
        teeth: [],
        notes: "CBCT de ejemplo para el visor DICOM (cabeza sintética de 112 cortes).",
        sesion: null,
      },
    ] as const;

    for (const a of archivos) {
      // Ruta fija por archivo: el reset siguiente la pisa con upsert.
      const ruta = `${clinica.id}/${paciente.id}/demo/${a.nombre}`;
      const { error: errSubida } = await admin.storage
        .from(BUCKET)
        .upload(ruta, a.datos, { contentType: a.mime, upsert: true });
      if (errSubida) throw errSubida;
      const { error } = await admin.from("patient_exams").insert({
        clinic_id: clinica.id,
        patient_id: paciente.id,
        kind: a.kind,
        taken_on: diaEn(zona, a.dias),
        teeth: [...a.teeth],
        professional_id: profesional?.id ?? null,
        notes: a.notes,
        photo_session_id: a.sesion,
        storage_path: ruta,
        filename: a.nombre,
        mime_type: a.mime,
        size_bytes: a.datos.length,
        status: "listo",
        confirmed_at: new Date().toISOString(),
        uploaded_by: DEMO_USER_ID,
      });
      if (error) throw error;
    }
  } catch (e) {
    console.error("[demo-reset] no se pudieron sembrar los exámenes de ejemplo", e);
  }
}
