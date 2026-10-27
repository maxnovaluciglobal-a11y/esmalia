import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, MessageCircle, Plus } from "lucide-react";

import { BOTON_PASTILLA, ChipFiltro, EncabezadoEditorial } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { DetalleDeCampana } from "@/components/seguimiento/detalle-de-campana";
import { EditorDeCampana } from "@/components/seguimiento/editor-de-campana";
import {
  BOTON_FILA,
  Chip,
  PanelLista,
  ResumenEnTinta,
  Vacio,
} from "@/components/seguimiento/piezas";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { requirePermission } from "@/lib/access/route-guards";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  listCampanas,
  listPlantillasDeMensaje,
  medirRetornoDeContactos,
  type Campana,
} from "@/lib/seguimiento/campanas.functions";
import { ETIQUETA_ESTADO_CAMPANA } from "@/lib/seguimiento/campanas";
import {
  formatoTasa,
  VENTANA_DE_RETORNO_POR_DEFECTO,
  VENTANAS_DE_RETORNO,
} from "@/lib/seguimiento/retorno";

/**
 * Campañas (Ola 8 · CRM-04 y CRM-05). Un mensaje a un grupo de pacientes, por
 * correo (sale desde el servidor con modo de prueba, bajas y tutor) o por
 * WhatsApp asistido (una cola que se despacha a mano; nada sale solo, ni por
 * cron). Abajo, quién volvió después de cada campaña y del recall. Solo owner
 * y admin (`settings:manage`), igual que la RLS de las tablas.
 */
export const Route = createFileRoute("/_authenticated/_clinic/campanas")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Campañas | Esmalia" },
      {
        name: "description",
        content:
          "Mensajes a grupos de pacientes por correo o WhatsApp asistido, y cuántos volvieron después.",
      },
    ],
  }),
  component: CampanasPage,
});

function CampanasPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id ?? "";
  const zona = access.clinic?.timezone ?? "America/Santiago";
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ campana: Campana | null } | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [ventana, setVentana] = useState<number>(VENTANA_DE_RETORNO_POR_DEFECTO);

  const fCampanas = useServerFn(listCampanas);
  const campanas = useQuery({
    queryKey: ["campanas", clinicId],
    queryFn: () => fCampanas({ data: { clinicId } }),
    enabled: Boolean(clinicId),
  });
  const fPlantillas = useServerFn(listPlantillasDeMensaje);
  const plantillas = useQuery({
    queryKey: ["plantillas-de-mensaje", clinicId],
    queryFn: () => fPlantillas({ data: { clinicId } }),
    enabled: Boolean(clinicId),
  });
  const fRetorno = useServerFn(medirRetornoDeContactos);
  const retorno = useQuery({
    queryKey: ["retorno-contactos", clinicId, ventana],
    queryFn: () => fRetorno({ data: { clinicId, ventanaDias: ventana } }),
    enabled: Boolean(clinicId),
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ["campanas", clinicId] });
    queryClient.invalidateQueries({ queryKey: ["retorno-contactos", clinicId] });
  };

  const lista = campanas.data ?? [];
  const enCurso = lista.filter((c) => c.status === "confirmada");
  const correosPorEnviar = enCurso
    .filter((c) => c.channel === "correo")
    .reduce((n, c) => n + c.conteo.pendiente, 0);
  const colaWhatsApp = enCurso
    .filter((c) => c.channel === "whatsapp")
    .reduce((n, c) => n + c.conteo.pendiente, 0);
  const borradores = lista.filter((c) => c.status === "borrador").length;
  const recall = retorno.data?.find((r) => r.id === "recall");
  const abierta = detalle ? (lista.find((c) => c.id === detalle) ?? null) : null;

  return (
    <AppShell title="Campañas" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-[18px]">
        <EncabezadoEditorial
          contexto={["Mensajes", access.clinic?.name ?? ""]}
          titulo="Campañas a"
          enfasis="pacientes"
          acciones={
            <>
              <Link to="/plantillas-de-mensajes" className={BOTON_PASTILLA}>
                Plantillas
              </Link>
              <BloqueoEscritura>
                <button
                  type="button"
                  className={BOTON_PASTILLA}
                  onClick={() => setEditor({ campana: null })}
                >
                  <Plus className="size-4" aria-hidden /> Nueva campaña
                </button>
              </BloqueoEscritura>
            </>
          }
        >
          <p className="mt-3 max-w-[68ch] text-[15px] text-muted-foreground">
            Un mensaje para un grupo de pacientes: los que no vienen hace meses, los que tienen un
            presupuesto pendiente o un rango de edad. Antes de confirmar ves a cuántos les llega y
            por qué se omite al resto.{" "}
            <b className="font-semibold text-foreground">WhatsApp nunca sale solo.</b>
          </p>
        </EncabezadoEditorial>

        <ResumenEnTinta
          titulo="Lo que requiere"
          enfasis="acción"
          cifras={[
            {
              id: "correos",
              etiqueta: "Correos por enviar",
              valor: campanas.data ? correosPorEnviar : null,
              urgente: true,
            },
            {
              id: "cola",
              etiqueta: "Mensajes en cola de WhatsApp",
              valor: campanas.data ? colaWhatsApp : null,
              urgente: true,
            },
            {
              id: "curso",
              etiqueta: "Campañas en curso",
              valor: campanas.data ? enCurso.length : null,
            },
            { id: "borradores", etiqueta: "Borradores", valor: campanas.data ? borradores : null },
            {
              id: "recall",
              etiqueta: `Volvieron tras el control periódico (${ventana} días)`,
              valor: recall ? recall.resultado.agendaron : null,
            },
          ]}
        />

        {campanas.isPending ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
          </p>
        ) : campanas.isError ? (
          <ErrorDeCarga
            onReintentar={() => campanas.refetch()}
            mensaje={mensajeDeError(campanas.error)}
          />
        ) : (
          <PanelLista titulo="Campañas" conteo={lista.length}>
            {lista.length === 0 ? (
              <Vacio>
                Todavía no hay campañas. Crea una: por ejemplo, un control anual para quienes no
                vienen hace 12 meses.
              </Vacio>
            ) : (
              <ul className="divide-y divide-hairline">
                {[...lista]
                  .sort((a, b) => peso(a) - peso(b) || b.createdAt.localeCompare(a.createdAt))
                  .map((c) => (
                    <FilaCampana
                      key={c.id}
                      campana={c}
                      zona={zona}
                      onAbrir={() =>
                        c.status === "borrador" ? setEditor({ campana: c }) : setDetalle(c.id)
                      }
                    />
                  ))}
              </ul>
            )}
          </PanelLista>
        )}

        <PanelLista
          titulo="Quién volvió"
          descripcion="Pacientes que agendaron (y los que además vinieron) dentro de la ventana desde que se les escribió. Cuenta solo citas creadas después del contacto."
          acciones={
            <div role="group" aria-label="Ventana" className="flex gap-1.5">
              {VENTANAS_DE_RETORNO.map((v) => (
                <ChipFiltro key={v} activo={ventana === v} onClick={() => setVentana(v)}>
                  {v} días
                </ChipFiltro>
              ))}
            </div>
          }
        >
          {retorno.isPending ? (
            <Vacio>Calculando…</Vacio>
          ) : retorno.isError ? (
            <div className="p-4">
              <ErrorDeCarga
                onReintentar={() => retorno.refetch()}
                mensaje={mensajeDeError(retorno.error)}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-[12.5px] font-semibold text-muted-foreground">
                  <tr className="border-b border-hairline">
                    <th className="px-4 py-2 font-semibold">Contacto</th>
                    <th className="px-3 py-2 text-right font-semibold">Contactados</th>
                    <th className="px-3 py-2 text-right font-semibold">Agendaron</th>
                    <th className="px-3 py-2 text-right font-semibold">Vinieron</th>
                    <th className="px-4 py-2 text-right font-semibold">Ventana abierta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {(retorno.data ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold">{r.nombre}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.canal === "recall"
                            ? "Mensajes de control de los últimos 6 meses"
                            : `${r.canal === "correo" ? "Correo" : "WhatsApp"}${r.desde ? ` · ${fecha(r.desde, zona)}` : ""}`}
                        </span>
                      </td>
                      <td className="cifra px-3 py-2.5 text-right">{r.resultado.contactados}</td>
                      <td className="cifra px-3 py-2.5 text-right">
                        {r.resultado.agendaron}{" "}
                        <span className="text-muted-foreground">
                          ({formatoTasa(r.resultado.tasaAgendaron)})
                        </span>
                      </td>
                      <td className="cifra px-3 py-2.5 text-right">
                        {r.resultado.vinieron}{" "}
                        <span className="text-muted-foreground">
                          ({formatoTasa(r.resultado.tasaVinieron)})
                        </span>
                      </td>
                      <td className="cifra px-4 py-2.5 text-right text-muted-foreground">
                        {r.resultado.conVentanaAbierta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PanelLista>
      </div>

      {editor && clinicId && (
        <EditorDeCampana
          clinicId={clinicId}
          clinica={access.clinic?.name ?? ""}
          plantillas={plantillas.data ?? []}
          inicial={editor.campana}
          onCerrar={() => setEditor(null)}
          onGuardada={(id, confirmada) => {
            refrescar();
            setEditor(null);
            if (confirmada) setDetalle(id);
          }}
        />
      )}
      {abierta && clinicId && (
        <DetalleDeCampana
          clinicId={clinicId}
          zona={zona}
          campana={abierta}
          esPropietario={access.role === "owner"}
          onCerrar={() => setDetalle(null)}
          onCambio={refrescar}
        />
      )}
    </AppShell>
  );
}

/** En curso arriba (requiere acción), después borradores, al final las cerradas. */
function peso(c: Campana): number {
  if (c.status === "confirmada") return 0;
  if (c.status === "borrador") return 1;
  return 2;
}

function FilaCampana({
  campana: c,
  zona,
  onAbrir,
}: {
  campana: Campana;
  zona: string;
  onAbrir: () => void;
}) {
  const esCorreo = c.channel === "correo";
  const hechos = esCorreo ? c.conteo.enviado : c.conteo.abierto;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border border-hairline bg-secondary">
          {esCorreo ? (
            <Mail className="size-4" aria-hidden />
          ) : (
            <MessageCircle className="size-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            {c.name}
            <Chip tono={c.status === "confirmada" ? "tinta" : "tenue"}>
              {ETIQUETA_ESTADO_CAMPANA[c.status]}
            </Chip>
            {c.status === "confirmada" && c.conteo.pendiente > 0 && (
              <Chip tono="aviso">
                {c.conteo.pendiente} {esCorreo ? "por enviar" : "en cola"}
              </Chip>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {esCorreo ? "Correo" : "WhatsApp asistido"} · {c.segmentLabel ?? "Grupo de pacientes"}
            {c.status !== "borrador" && (
              <>
                {" "}
                · <span className="cifra">{hechos}</span>/
                <span className="cifra">{c.recipientsCount}</span>{" "}
                {esCorreo ? "enviados" : "abiertos"}
              </>
            )}
            {" · "}
            {fecha(c.createdAt, zona)}
          </p>
        </div>
      </div>
      <button type="button" className={BOTON_FILA} onClick={onAbrir}>
        {c.status === "borrador" ? "Seguir editando" : c.status === "confirmada" ? "Abrir" : "Ver"}
      </button>
    </li>
  );
}
