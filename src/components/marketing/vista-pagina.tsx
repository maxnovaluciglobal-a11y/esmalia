import { PaginaContenidoView } from "@/components/marketing/pagina-contenido";
import type { DatosPagina } from "@/lib/marketing/ruta-contenido";

export function VistaPagina({ datos }: { datos: DatosPagina }) {
  return <PaginaContenidoView pagina={datos.pagina} relacionados={datos.relacionados} />;
}
