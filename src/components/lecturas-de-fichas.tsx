import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatoFechaHora } from "@/lib/clinical/clinical-notes";
import { MINUTOS_DEDUP_LECTURA, etiquetaSeccion } from "@/lib/clinical/lecturas-ficha";
import { getLecturasDeFichas } from "@/lib/compliance.functions";

function isoDia(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}

/** Cuántas filas se muestran en pantalla; la consulta trae hasta 1000. */
const FILAS_VISIBLES = 200;

interface Props {
  clinicId: string;
}

/**
 * Quién abrió qué ficha y cuándo (SEG-02). Solo lectura: el registro lo
 * escribe la base y nadie lo edita. La pantalla de Compliance ya exige
 * `team:manage`, y la RLS de `clinical_access_log` deja leer solo a
 * owner/admin.
 */
export function LecturasDeFichas({ clinicId }: Props) {
  const hoy = useMemo(() => new Date(), []);
  const hace7 = useMemo(() => new Date(hoy.getTime() - 6 * 86400000), [hoy]);

  const [desde, setDesde] = useState(isoDia(hace7));
  const [hasta, setHasta] = useState(isoDia(hoy));
  const [filtro, setFiltro] = useState("");

  const fetchLecturas = useServerFn(getLecturasDeFichas);
  const rangoValido = desde <= hasta;

  const { data, isFetching, error } = useQuery({
    queryKey: ["lecturas-fichas", clinicId, desde, hasta],
    enabled: rangoValido,
    queryFn: () => fetchLecturas({ data: { clinicId, desde, hasta, limit: 1000 } }),
  });

  const texto = filtro.trim().toLowerCase();
  const lecturas = (data?.lecturas ?? []).filter(
    (l) =>
      !texto ||
      (l.patientName ?? "").toLowerCase().includes(texto) ||
      (l.actorName ?? "").toLowerCase().includes(texto),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="size-4 text-primary" aria-hidden />
          Lecturas de fichas clínicas
        </CardTitle>
        <CardDescription>
          Cada vez que alguien del equipo abre una sección de la ficha de un paciente (datos, notas,
          odontograma, periodontograma, anamnesis o documentos) queda registrado quién fue y cuándo.
          Se anota una vez por persona, paciente y sección cada {MINUTOS_DEDUP_LECTURA} minutos.
          Nadie puede editar ni borrar este registro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="lecturas-desde">Desde</Label>
            <Input
              id="lecturas-desde"
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lecturas-hasta">Hasta</Label>
            <Input
              id="lecturas-hasta"
              type="date"
              value={hasta}
              min={desde}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lecturas-filtro">Paciente o integrante del equipo</Label>
            <Input
              id="lecturas-filtro"
              placeholder="Buscar por nombre"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
          </div>
        </div>

        {!rangoValido ? (
          <p className="text-sm text-destructive">
            La fecha inicial debe ser anterior o igual a la fecha final.
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "No pudimos cargar las lecturas."}
          </p>
        ) : null}

        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {lecturas.length} lectura{lecturas.length === 1 ? "" : "s"} en el rango
          {data?.truncated ? " (resultado limitado a las 1000 más recientes)" : ""}
        </p>

        <div className="-mx-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-6 py-3 font-medium">Fecha</th>
                <th className="px-6 py-3 font-medium">Quién</th>
                <th className="px-6 py-3 font-medium">Paciente</th>
                <th className="px-6 py-3 font-medium">Sección</th>
              </tr>
            </thead>
            <tbody>
              {lecturas.slice(0, FILAS_VISIBLES).map((l) => (
                <tr key={l.id} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap px-6 py-3 text-muted-foreground">
                    {formatoFechaHora(l.accessedAt)}
                  </td>
                  <td className="px-6 py-3">{l.actorName ?? "Usuario eliminado"}</td>
                  <td className="px-6 py-3">{l.patientName ?? "Paciente eliminado"}</td>
                  <td className="px-6 py-3">{etiquetaSeccion(l.section)}</td>
                </tr>
              ))}
              {!lecturas.length && !isFetching ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">
                    No hay lecturas registradas con estos filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {lecturas.length > FILAS_VISIBLES ? (
          <p className="text-xs text-muted-foreground">
            Mostrando las {FILAS_VISIBLES} más recientes de {lecturas.length}. Acota el rango de
            fechas para ver el resto.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
