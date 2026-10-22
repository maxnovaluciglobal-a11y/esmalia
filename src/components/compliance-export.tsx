import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, Loader2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatoFechaHora } from "@/lib/clinical/clinical-notes";
import {
  ORIGEN_LABELS,
  etiquetaAccion,
  exportarComplianceCsv,
  exportarCompliancePdf,
} from "@/lib/compliance-export";
import { esUuid, getComplianceLog } from "@/lib/compliance.functions";
import { coincide } from "@/lib/search";

function isoDia(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}

interface Props {
  clinicId: string;
  clinicName: string;
  /** El rol puede abrir fichas (`patients:view`): el nombre enlaza a la ficha. */
  puedeAbrirFichas?: boolean;
}

/** Panel de compliance: historial filtrado de auditoría y revisión, exportable a CSV/PDF. */
export function ComplianceExport({ clinicId, clinicName, puedeAbrirFichas = false }: Props) {
  const hoy = useMemo(() => new Date(), []);
  const hace30 = useMemo(() => new Date(hoy.getTime() - 29 * 86400000), [hoy]);

  const [desde, setDesde] = useState(isoDia(hace30));
  const [hasta, setHasta] = useState(isoDia(hoy));
  const [origen, setOrigen] = useState<"all" | "audit" | "review">("all");
  const [paciente, setPaciente] = useState("");

  const fetchLog = useServerFn(getComplianceLog);
  const rangoValido = desde <= hasta;

  // Un id pegado tal cual filtra en el servidor; un nombre filtra acá.
  const terminoPaciente = paciente.trim();
  const refExacta = esUuid(terminoPaciente) ? terminoPaciente : undefined;

  const { data, isFetching, error } = useQuery({
    queryKey: ["compliance-log", clinicId, desde, hasta, origen, refExacta ?? ""],
    enabled: rangoValido,
    queryFn: () =>
      fetchLog({
        data: {
          clinicId,
          desde,
          hasta,
          source: origen,
          patientRef: refExacta,
          limit: 1000,
        },
      }),
  });

  const eventos = useMemo(() => {
    const todos = data?.events ?? [];
    if (!terminoPaciente || refExacta) return todos;
    return todos.filter((e) => coincide(terminoPaciente, e.patientName));
  }, [data, terminoPaciente, refExacta]);
  const ctx = {
    clinicaNombre: clinicName,
    desde,
    hasta,
    origen,
    pacienteRef: terminoPaciente || undefined,
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            Exportación del historial de auditoría
          </CardTitle>
          <CardDescription>
            Filtra el historial de auditoría y revisión clínica de la clínica por rango de fechas y
            descárgalo en CSV o PDF. Solo se incluyen eventos de clínicas donde tienes acceso.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="compliance-desde">Desde</Label>
              <Input
                id="compliance-desde"
                type="date"
                value={desde}
                max={hasta}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compliance-hasta">Hasta</Label>
              <Input
                id="compliance-hasta"
                type="date"
                value={hasta}
                min={desde}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compliance-origen">Origen</Label>
              <Select value={origen} onValueChange={(v) => setOrigen(v as typeof origen)}>
                <SelectTrigger id="compliance-origen">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ORIGEN_LABELS) as Array<keyof typeof ORIGEN_LABELS>).map((k) => (
                    <SelectItem key={k} value={k}>
                      {ORIGEN_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compliance-paciente">Paciente (opcional)</Label>
              <Input
                id="compliance-paciente"
                placeholder="Nombre del paciente"
                value={paciente}
                onChange={(e) => setPaciente(e.target.value)}
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
              {error instanceof Error ? error.message : "No pudimos cargar el historial."}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!eventos.length}
              onClick={() => exportarComplianceCsv(eventos, ctx)}
            >
              <Download className="size-4" aria-hidden />
              Exportar CSV
            </Button>
            <Button
              type="button"
              disabled={!eventos.length}
              onClick={() => void exportarCompliancePdf(eventos, ctx)}
            >
              <FileText className="size-4" aria-hidden />
              Exportar PDF
            </Button>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {eventos.length} evento{eventos.length === 1 ? "" : "s"} en el rango
              {data?.truncated ? " (resultado limitado a 1000 por origen)" : ""}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vista previa del historial</CardTitle>
          <CardDescription>
            {ORIGEN_LABELS[origen]} · {desde} a {hasta}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[840px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Origen</th>
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Nota</th>
                <th className="px-4 py-3 font-medium">Acción</th>
                <th className="px-4 py-3 font-medium">Responsable</th>
                <th className="px-4 py-3 font-medium">Revisor</th>
              </tr>
            </thead>
            <tbody>
              {eventos.slice(0, 100).map((e) => (
                <tr key={`${e.source}-${e.id}`} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatoFechaHora(e.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={e.source === "review" ? "default" : "secondary"}>
                      {e.source === "review" ? "Revisión" : "Auditoría"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {e.patientId && e.patientName && puedeAbrirFichas ? (
                      <Link
                        to="/pacientes/$pacienteId"
                        params={{ pacienteId: e.patientId }}
                        className="underline decoration-border underline-offset-4 hover:text-brand-700 hover:decoration-brand"
                      >
                        {e.patientName}
                      </Link>
                    ) : (
                      (e.patientName ?? (
                        <span className="text-muted-foreground">Paciente sin ficha</span>
                      ))
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {e.noteTitle ?? "—"}
                    {e.noteVersion ? (
                      <span className="ml-1 text-muted-foreground">v{e.noteVersion}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{etiquetaAccion(e)}</span>
                    {e.detail ? (
                      <span className="block text-xs text-muted-foreground">{e.detail}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{e.actorName ?? "—"}</td>
                  <td className="px-4 py-3">{e.reviewerName ?? "—"}</td>
                </tr>
              ))}
              {!eventos.length && !isFetching ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No hay eventos registrados con estos filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {eventos.length > 100 ? (
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              Mostrando los 100 eventos más recientes. La exportación incluye los {eventos.length}.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
