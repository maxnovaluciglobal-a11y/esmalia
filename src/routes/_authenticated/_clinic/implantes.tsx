import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldAlert } from "lucide-react";

import { BuscadorCompacto, EncabezadoEditorial } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { ChipEstadoImplante } from "@/components/ficha/implantes-card";
import { requirePermission } from "@/lib/access/route-guards";
import { ETIQUETA_ESTADO_IMPLANTE, estaEnBoca } from "@/lib/clinical/implantes";
import {
  buscarImplantesPorLote,
  type ImplanteEncontrado,
} from "@/lib/clinical/implantes.functions";
import { fechaPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * MKT-09 · Búsqueda de implantes por lote (Ola 9). Cuando un fabricante
 * retira un lote, la clínica escribe el lote y ve a todos sus pacientes con
 * ese implante, con su contacto, para avisarles; la lista se exporta en CSV.
 * Solo roles clínicos (`clinical:view`), igual que la RLS de
 * `patient_implants`.
 */
export const Route = createFileRoute("/_authenticated/_clinic/implantes")({
  beforeLoad: requirePermission("clinical:view"),
  head: () => ({
    meta: [
      { title: "Implantes | Esmalia" },
      {
        name: "description",
        content:
          "Busca implantes por lote para avisar a los pacientes de un retiro del fabricante.",
      },
    ],
  }),
  component: ImplantesPage,
});

const COLUMNAS_CSV = (zona: string): ColumnaLista<ImplanteEncontrado>[] => [
  { header: "Paciente", value: (i) => i.patientName },
  { header: "Teléfono", value: (i) => i.patientPhone },
  { header: "Correo", value: (i) => i.patientEmail },
  { header: "Pieza", value: (i) => String(i.tooth) },
  { header: "Marca", value: (i) => i.brand },
  { header: "Modelo", value: (i) => i.model },
  { header: "Lote", value: (i) => i.lot },
  { header: "Referencia", value: (i) => i.reference },
  { header: "Fecha de colocación", value: (i) => fechaPlanilla(i.placedOn, zona) },
  { header: "Profesional", value: (i) => i.professionalName },
  { header: "Estado", value: (i) => ETIQUETA_ESTADO_IMPLANTE[i.status] },
];

function ImplantesPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const zona = access.clinic?.timezone ?? "America/Santiago";
  const [texto, setTexto] = useState("");
  const [lote, setLote] = useState("");
  // Busca al dejar de escribir (no en cada tecla).
  useEffect(() => {
    const t = setTimeout(() => setLote(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto]);

  const buscar = useServerFn(buscarImplantesPorLote);
  const consulta = useQuery({
    queryKey: ["implantes-por-lote", clinicId, lote],
    queryFn: () => buscar({ data: { clinicId: clinicId as string, lote } }),
    enabled: Boolean(clinicId) && lote.length >= 2,
  });
  const resultados = consulta.data ?? [];
  const pacientes = new Set(resultados.map((r) => r.patientId)).size;
  const enBoca = resultados.filter((r) => estaEnBoca(r.status)).length;

  return (
    <AppShell title="Implantes" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-7">
        <EncabezadoEditorial
          contexto={["Pacientes", "Seguimiento de implantes"]}
          titulo="Implantes por"
          enfasis="lote"
          acciones={
            clinicId && resultados.length > 0 ? (
              <ExportarCsvLista
                clinicId={clinicId}
                rol={access.role}
                lista="implantes"
                filas={resultados}
                columnas={COLUMNAS_CSV(zona)}
                timezone={zona}
                filtros={{ lote }}
              />
            ) : null
          }
        >
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            Si un fabricante retira un lote, escríbelo acá: aparecen todos los pacientes de la
            clínica con ese implante y cómo contactarlos.
          </p>
        </EncabezadoEditorial>

        <BuscadorCompacto
          valor={texto}
          onChange={setTexto}
          etiqueta="Buscar por lote"
          placeholder="Lote del fabricante (mínimo 2 caracteres)"
          className="sm:w-96"
        />

        {lote.length < 2 ? (
          <p className="text-base text-muted-foreground">
            Escribe al menos 2 caracteres del lote. La búsqueda no distingue mayúsculas.
          </p>
        ) : consulta.isPending ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Buscando…
          </p>
        ) : consulta.isError ? (
          <ErrorDeCarga
            onReintentar={() => consulta.refetch()}
            reintentando={consulta.isFetching}
            mensaje={mensajeDeError(consulta.error)}
          />
        ) : resultados.length === 0 ? (
          <p className="rounded-panel border border-border bg-card p-6 text-base text-muted-foreground">
            Ningún implante de la clínica tiene un lote que contenga «{lote}».
          </p>
        ) : (
          <section aria-label="Implantes encontrados" className="space-y-3">
            <p className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
              <span>
                <span className="cifra font-semibold">{resultados.length}</span>{" "}
                {resultados.length === 1 ? "implante" : "implantes"} en{" "}
                <span className="cifra font-semibold">{pacientes}</span>{" "}
                {pacientes === 1 ? "paciente" : "pacientes"}
                {" · "}
                <span className="cifra">{enBoca}</span> todavía en boca
              </span>
            </p>
            <ul className="divide-y divide-hairline rounded-panel border border-border bg-card">
              {resultados.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="cifra grid size-10 shrink-0 place-items-center rounded-full border border-foreground text-sm font-semibold">
                      {r.tooth}
                    </span>
                    <div className="min-w-0">
                      <Link
                        to="/pacientes/$pacienteId"
                        params={{ pacienteId: r.patientId }}
                        className="text-base font-semibold underline-offset-2 hover:underline"
                      >
                        {r.patientName}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {r.brand}
                        {r.model ? ` ${r.model}` : ""} · Lote{" "}
                        <span className="cifra text-foreground">{r.lot}</span> ·{" "}
                        {fecha(r.placedOn, zona)}
                        {r.professionalName ? ` · ${r.professionalName}` : ""}
                      </p>
                      {(r.patientPhone || r.patientEmail) && (
                        <p className="text-sm text-muted-foreground">
                          {[r.patientPhone, r.patientEmail].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                  <ChipEstadoImplante estado={r.status} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}
