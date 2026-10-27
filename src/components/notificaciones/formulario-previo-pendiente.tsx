/**
 * MKT-07 · En la ficha (pestaña Anamnesis): lo que el paciente envió en el
 * formulario antes de la cita, pendiente de revisión. Nada pasa a la ficha
 * hasta que alguien del equipo clínico lo acepta, y elige qué pasa: los
 * datos de contacto, la anamnesis o las dos cosas.
 */
import { useId, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { BloqueoEscritura } from "@/components/solo-lectura";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { fechaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  listFormulariosPrevios,
  revisarFormularioPrevio,
  type FormularioPendiente,
} from "@/lib/notificaciones-pacientes/formulario.functions";

export function FormularioPrevioPendiente({
  clinicId,
  patientId,
  puedeRevisar,
  timezone,
}: {
  clinicId: string;
  patientId: string;
  puedeRevisar: boolean;
  timezone: string;
}) {
  const listar = useServerFn(listFormulariosPrevios);
  const consulta = useQuery({
    queryKey: ["formularios-previos", clinicId, patientId],
    queryFn: () => listar({ data: { clinicId, patientId } }),
  });
  if (!consulta.data?.length) return null;
  return (
    <div className="space-y-[18px]">
      {consulta.data.map((f) => (
        <Tarjeta
          key={f.id}
          clinicId={clinicId}
          patientId={patientId}
          form={f}
          puedeRevisar={puedeRevisar}
          timezone={timezone}
        />
      ))}
    </div>
  );
}

function Tarjeta({
  clinicId,
  patientId,
  form,
  puedeRevisar,
  timezone,
}: {
  clinicId: string;
  patientId: string;
  form: FormularioPendiente;
  puedeRevisar: boolean;
  timezone: string;
}) {
  const fid = useId();
  const hayContacto = form.cambiosDeContacto.length > 0;
  const hayAnamnesis =
    form.cuestionario.length > 0 || form.alergias.length > 0 || form.medicacion.length > 0;
  const [contacto, setContacto] = useState(hayContacto);
  const [anamnesis, setAnamnesis] = useState(hayAnamnesis);

  const queryClient = useQueryClient();
  const router = useRouter();
  const revisar = useServerFn(revisarFormularioPrevio);
  const mutacion = useMutation({
    mutationFn: (resultado: "aceptar" | "descartar") =>
      revisar({
        data: {
          clinicId,
          formId: form.id,
          resultado,
          aplicarContacto: resultado === "aceptar" && contacto,
          aplicarAnamnesis: resultado === "aceptar" && anamnesis,
        },
      }),
    onSuccess: (_r, resultado) => {
      void queryClient.invalidateQueries({
        queryKey: ["formularios-previos", clinicId, patientId],
      });
      void queryClient.invalidateQueries({ queryKey: ["medical-history", clinicId, patientId] });
      // Los datos de contacto de la ficha vienen del loader de la ruta.
      void router.invalidate();
      toast.success(
        resultado === "aceptar"
          ? "Formulario aceptado: la ficha quedó al día."
          : "Formulario descartado.",
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const nadaQueAplicar = !(contacto && hayContacto) && !(anamnesis && hayAnamnesis);

  return (
    <section
      aria-labelledby={`${fid}-titulo`}
      className="space-y-4 rounded-[14px] border border-warning-border bg-warning-soft/40 p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <ClipboardList className="mt-1 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0">
          <h3 id={`${fid}-titulo`} className="font-display text-xl font-semibold leading-tight">
            Formulario antes de la cita, pendiente de revisión
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            El paciente lo envió el {fechaHora(form.respondidoEl, timezone)}. No cambió nada de la
            ficha: elige qué pasar.
          </p>
        </div>
      </div>

      {hayContacto && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={contacto}
              onChange={(e) => setContacto(e.target.checked)}
              disabled={!puedeRevisar}
            />
            Actualizar datos de contacto
          </label>
          <dl className="grid gap-1.5 rounded-lg border border-hairline bg-card p-3 text-sm">
            {form.cambiosDeContacto.map((c) => (
              <div key={c.campo} className="grid gap-0.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <dt className="text-muted-foreground">{c.etiqueta}</dt>
                <dd className="min-w-0 break-words">
                  {c.antes ? (
                    <>
                      <s className="text-muted-foreground">{c.antes}</s> → {c.despues}
                    </>
                  ) : (
                    c.despues
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {hayAnamnesis && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={anamnesis}
              onChange={(e) => setAnamnesis(e.target.checked)}
              disabled={!puedeRevisar}
            />
            Sumar a la anamnesis
          </label>
          <div className="space-y-2 rounded-lg border border-hairline bg-card p-3 text-sm">
            {form.cuestionario.length > 0 && (
              <ul className="grid gap-1">
                {form.cuestionario.map((r) => (
                  <li key={r.pregunta}>
                    <b className="font-medium">{r.pregunta}:</b> {r.respuesta}
                    {r.detalle ? ` (${r.detalle})` : ""}
                  </li>
                ))}
              </ul>
            )}
            {form.alergias.length > 0 && (
              <p>
                <b className="font-medium">Alergias:</b> {form.alergias.join(", ")}
              </p>
            )}
            {form.medicacion.length > 0 && (
              <p>
                <b className="font-medium">Medicamentos:</b> {form.medicacion.join(", ")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Las respuestas reemplazan las de esas preguntas; las alergias y los medicamentos se
              agregan a los que ya están (una alergia nueva entra con severidad sin especificar).
            </p>
          </div>
        </div>
      )}

      {form.comentario && (
        <p className="rounded-lg border border-hairline bg-card p-3 text-sm">
          <b className="font-medium">Comentario del paciente:</b> {form.comentario}
        </p>
      )}

      {puedeRevisar ? (
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialog>
            <BloqueoEscritura>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="rounded-full" disabled={mutacion.isPending}>
                  Descartar
                </Button>
              </AlertDialogTrigger>
            </BloqueoEscritura>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Descartar el formulario?</AlertDialogTitle>
                <AlertDialogDescription>
                  Nada de lo que envió el paciente pasa a la ficha. El formulario queda registrado
                  como descartado.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Volver</AlertDialogCancel>
                <AlertDialogAction onClick={() => mutacion.mutate("descartar")}>
                  Descartar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <BloqueoEscritura otroMotivo={nadaQueAplicar ? "Marca qué pasar a la ficha." : null}>
            <Button
              className="rounded-full"
              onClick={() => mutacion.mutate("aceptar")}
              disabled={mutacion.isPending || nadaQueAplicar}
            >
              {mutacion.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Aceptar y pasar a la ficha
            </Button>
          </BloqueoEscritura>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Lo revisa alguien del equipo clínico con permiso para editar la ficha.
        </p>
      )}
    </section>
  );
}
