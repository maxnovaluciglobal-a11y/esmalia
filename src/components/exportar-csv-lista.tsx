import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { SujetoDePermisos } from "@/lib/access/access";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { descargarCsv, nombreArchivoCsv } from "@/lib/csv-export";
import {
  columnasParaRol,
  csvDeLista,
  nombreArchivoLista,
  puedeExportarLista,
  type ColumnaLista,
  type ListaCsv,
} from "@/lib/exportacion/listas-csv";
import { registrarExportacionDeLista } from "@/lib/exportacion/listas-csv.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

interface Props<T> {
  clinicId: string;
  rol: SujetoDePermisos;
  lista: ListaCsv;
  /** Lo que la lista muestra con los filtros aplicados (sin paginar). */
  filas: readonly T[];
  columnas: readonly ColumnaLista<T>[];
  timezone: string;
  /** Filtros vigentes, para el registro de la exportación. */
  filtros?: Record<string, string>;
  /**
   * Nombre base del archivo si no es el título de la lista (p. ej. la caja
   * exporta los movimientos del día además de los turnos). Opcional.
   */
  archivo?: string;
  className?: string;
  /** Texto del botón cuando la pantalla tiene más de una exportación. */
  etiqueta?: string;
}

/**
 * Lógica de "Exportar CSV" de una lista (EXP-04), para el botón de abajo o
 * para un ítem de menú. Exporta exactamente lo filtrado, en el formato de
 * Excel en español, sin las columnas de dinero si la persona no ve finanzas.
 * Antes de descargar anota la exportación en el historial de la clínica; si
 * no se puede anotar, no descarga.
 */
export function useExportarCsvLista<T>({
  clinicId,
  rol,
  lista,
  filas,
  columnas,
  timezone,
  filtros,
  archivo,
}: Omit<Props<T>, "className">) {
  const registrar = useServerFn(registrarExportacionDeLista);
  const [enCurso, setEnCurso] = useState(false);
  const puede = puedeExportarLista(rol, lista);

  async function exportar() {
    const visibles = columnasParaRol(columnas, rol, lista);
    setEnCurso(true);
    try {
      const limpios = Object.fromEntries(
        Object.entries(filtros ?? {}).filter(([, v]) => v !== "" && v !== undefined),
      );
      await registrar({
        data: {
          clinicId,
          lista,
          filas: filas.length,
          conDinero: visibles.some((c) => c.dinero),
          filtros: limpios,
          columnas: visibles.map((c) => c.header),
        },
      });
      descargarCsv(
        csvDeLista(filas, visibles),
        archivo
          ? nombreArchivoCsv(archivo, hoyISO(timezone))
          : nombreArchivoLista(lista, hoyISO(timezone)),
      );
      toast.success(
        `${filas.length} ${filas.length === 1 ? "fila exportada" : "filas exportadas"}`,
        { description: "Revisa tu carpeta de descargas. Se abre con Excel." },
      );
    } catch (e) {
      toast.error("No pudimos exportar la lista", { description: mensajeDeError(e) });
    } finally {
      setEnCurso(false);
    }
  }

  return { puede, enCurso, vacia: filas.length === 0, exportar };
}

/** Botón "Exportar CSV" de una lista. No se muestra sin el permiso de la lista. */
export function ExportarCsvLista<T>({ className, etiqueta, ...props }: Props<T>) {
  const { puede, enCurso, vacia, exportar } = useExportarCsvLista(props);
  if (!puede) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => void exportar()}
      disabled={enCurso || vacia}
      title={vacia ? "No hay filas para exportar con estos filtros" : undefined}
    >
      {enCurso ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      {etiqueta ?? "Exportar CSV"}
    </Button>
  );
}
