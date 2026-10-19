/**
 * Orquesta la exportación completa en el navegador: registra, baja cada tabla
 * página por página, baja los archivos de Storage si entran y arma el ZIP.
 *
 * Recibe las llamadas al servidor y `fetch` como dependencias para poder
 * probarse sin red.
 */
import {
  MAX_BYTES_ARCHIVOS,
  TABLAS_EXPORTACION,
  archivosDeStorage,
  armarZip,
  conBom,
  construirLeeme,
  csvDeTabla,
  type FilaExportacion,
} from "@/lib/exportacion/exportacion-clinica";

export interface DependenciasExportacion {
  iniciar: (clinicId: string) => Promise<{ exportId: string }>;
  leer: (args: {
    clinicId: string;
    exportId: string;
    clave: string;
    offset: number;
  }) => Promise<{ filas: FilaExportacion[]; siguiente: number | null }>;
  firmar: (args: {
    clinicId: string;
    exportId: string;
    rutas: string[];
  }) => Promise<Array<{ ruta: string; url: string | null }>>;
  descargar: (url: string) => Promise<Uint8Array>;
}

export interface AvanceExportacion {
  etapa: "registrando" | "tablas" | "archivos" | "comprimiendo";
  /** Texto corto para mostrar en pantalla. */
  detalle: string;
  hecho: number;
  total: number;
}

export interface OpcionesExportacion {
  clinicId: string;
  clinicaNombre: string;
  generadoPor: string;
  generadoEn: string;
  onAvance?: (a: AvanceExportacion) => void;
  maxBytesArchivos?: number;
}

const LOTE_FIRMA = 50;

export async function generarExportacion(
  deps: DependenciasExportacion,
  op: OpcionesExportacion,
): Promise<{ zip: Uint8Array; conteos: Record<string, number> }> {
  const avisar = op.onAvance ?? (() => {});
  avisar({ etapa: "registrando", detalle: "Registrando la exportación", hecho: 0, total: 1 });
  const { exportId } = await deps.iniciar(op.clinicId);

  const datos: Record<string, FilaExportacion[]> = {};
  const conteos: Record<string, number> = {};
  const textos: Record<string, string> = {};

  let i = 0;
  for (const tabla of TABLAS_EXPORTACION) {
    avisar({
      etapa: "tablas",
      detalle: `Preparando ${tabla.archivo}`,
      hecho: i,
      total: TABLAS_EXPORTACION.length,
    });
    const filas: FilaExportacion[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const pagina = await deps.leer({
        clinicId: op.clinicId,
        exportId,
        clave: tabla.clave,
        offset,
      });
      filas.push(...pagina.filas);
      offset = pagina.siguiente;
    }
    datos[tabla.clave] = filas;
    conteos[tabla.clave] = filas.length;
    textos[tabla.archivo] = conBom(csvDeTabla(tabla, filas));
    i += 1;
  }

  // Archivos de Storage: entran si el total cabe en memoria con holgura.
  const archivos = archivosDeStorage(op.clinicId, {
    documentos: datos.documentos,
    consentimientos: datos.consentimientos,
    presupuestos: datos.presupuestos,
  });
  const totalBytes = archivos.reduce((s, a) => s + a.bytes, 0);
  const tope = op.maxBytesArchivos ?? MAX_BYTES_ARCHIVOS;
  const binarios: Record<string, Uint8Array> = {};
  let omitidos = 0;
  let motivoOmision: string | undefined;

  if (archivos.length && totalBytes > tope) {
    omitidos = archivos.length;
    motivoOmision = `pesan ${Math.round(totalBytes / (1024 * 1024))} MB, más de lo que se puede armar en el navegador`;
  } else {
    for (let desde = 0; desde < archivos.length; desde += LOTE_FIRMA) {
      const lote = archivos.slice(desde, desde + LOTE_FIRMA);
      avisar({
        etapa: "archivos",
        detalle: "Descargando radiografías, documentos y firmas",
        hecho: desde,
        total: archivos.length,
      });
      let firmadas: Array<{ ruta: string; url: string | null }> = [];
      try {
        firmadas = await deps.firmar({
          clinicId: op.clinicId,
          exportId,
          rutas: lote.map((a) => a.ruta),
        });
      } catch {
        firmadas = [];
      }
      const urlPorRuta = new Map(firmadas.map((f) => [f.ruta, f.url]));
      for (const archivo of lote) {
        const url = urlPorRuta.get(archivo.ruta);
        if (!url) {
          omitidos += 1;
          continue;
        }
        try {
          binarios[archivo.destino] = await deps.descargar(url);
        } catch {
          omitidos += 1;
        }
      }
    }
    if (omitidos) motivoOmision = "no se pudieron descargar";
  }

  avisar({
    etapa: "comprimiendo",
    detalle: "Armando el archivo ZIP",
    hecho: TABLAS_EXPORTACION.length,
    total: TABLAS_EXPORTACION.length,
  });
  textos["LEEME.txt"] = conBom(
    construirLeeme({
      clinicaNombre: op.clinicaNombre,
      generadoEn: op.generadoEn,
      generadoPor: op.generadoPor,
      conteos,
      archivosIncluidos: Object.keys(binarios).length,
      archivosOmitidos: omitidos,
      motivoOmision,
    }),
  );

  return { zip: armarZip(textos, binarios), conteos };
}
