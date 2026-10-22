import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmarBajaDeCorreos, revisarTokenDeBaja } from "@/lib/email/baja.functions";

/**
 * Página pública del enlace "Dejar de recibir este resumen" del correo
 * semanal y, desde la Ola 4, del enlace de baja de los correos que una
 * clínica le manda a un paciente (presupuesto, documentos). No exige
 * sesión: el token firmado identifica a la persona.
 *
 * La baja se aplica al confirmar, no al abrir: algunos filtros de correo
 * abren los enlaces solos para revisarlos. La baja de un clic sin página
 * (header `List-Unsubscribe`) vive en `/api/correos/baja`.
 */
export const Route = createFileRoute("/correos/baja")({
  validateSearch: (search: Record<string, unknown>): { token: string } => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  head: () => ({
    meta: [{ title: "Dejar de recibir correos · Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: BajaDeCorreos,
});

type Estado = "revisando" | "listo-para-confirmar" | "invalido" | "enviando" | "hecho" | "error";

function BajaDeCorreos() {
  const { token } = Route.useSearch();
  const revisar = useServerFn(revisarTokenDeBaja);
  const confirmar = useServerFn(confirmarBajaDeCorreos);
  const [estado, setEstado] = useState<Estado>(token ? "revisando" : "invalido");
  const [esPaciente, setEsPaciente] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    revisar({ data: { token } })
      .then((r) => {
        if (cancelado) return;
        setEsPaciente(r.grupo === "correos_paciente");
        setEstado(r.valido ? "listo-para-confirmar" : "invalido");
      })
      .catch(() => !cancelado && setEstado("error"));
    return () => {
      cancelado = true;
    };
  }, [token, revisar]);

  async function onConfirmar() {
    setEstado("enviando");
    try {
      const r = await confirmar({ data: { token } });
      setEstado(r.ok ? "hecho" : r.motivo === "token" ? "invalido" : "error");
    } catch {
      setEstado("error");
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-sm">
        <img
          src="/brand/esmalia-wordmark.svg"
          alt="Esmalia"
          width={140}
          height={39}
          className="mb-8 h-auto w-[140px]"
        />
        {estado === "revisando" && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Revisando el enlace…
          </p>
        )}

        {(estado === "listo-para-confirmar" || estado === "enviando") && esPaciente && (
          <>
            <h1 className="font-display text-3xl font-semibold leading-tight">
              Dejar de recibir correos de tu clínica
            </h1>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Si confirmas, tu clínica no podrá enviarte más correos desde Esmalia: presupuestos,
              copias de documentos ni recordatorios por correo. Para volver a recibirlos, pídeselo a
              la clínica.
            </p>
            <Button className="mt-6" onClick={onConfirmar} disabled={estado === "enviando"}>
              {estado === "enviando" && <Loader2 className="size-4 animate-spin" />}
              Confirmar la baja
            </Button>
          </>
        )}

        {(estado === "listo-para-confirmar" || estado === "enviando") && !esPaciente && (
          <>
            <h1 className="font-display text-3xl font-semibold leading-tight">
              Dejar de recibir el resumen semanal
            </h1>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Si confirmas, no te enviaremos más el correo &quot;Tu semana en la clínica&quot; ni
              otros correos opcionales de Esmalia. Los avisos sobre tu suscripción (fin de la
              prueba, pagos) siguen llegando porque son parte del servicio.
            </p>
            <Button className="mt-6" onClick={onConfirmar} disabled={estado === "enviando"}>
              {estado === "enviando" && <Loader2 className="size-4 animate-spin" />}
              Confirmar la baja
            </Button>
          </>
        )}

        {estado === "hecho" && esPaciente && (
          <>
            <h1 className="font-display text-3xl font-semibold leading-tight">Listo</h1>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Ya no recibirás correos de tu clínica desde Esmalia. Si cambias de opinión, pídele a
              la clínica que los vuelva a activar.
            </p>
          </>
        )}

        {estado === "hecho" && !esPaciente && (
          <>
            <h1 className="font-display text-3xl font-semibold leading-tight">Listo</h1>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Ya no recibirás el resumen semanal. Si cambias de opinión, puedes volver a activarlo
              desde{" "}
              <Link to="/preferencias" className="text-primary underline underline-offset-2">
                Preferencias
              </Link>
              .
            </p>
          </>
        )}

        {estado === "invalido" && (
          <>
            <h1 className="font-display text-3xl font-semibold leading-tight">
              Este enlace no es válido
            </h1>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Puede que esté incompleto o que haya vencido. Puedes desactivar los correos desde{" "}
              <Link to="/preferencias" className="text-primary underline underline-offset-2">
                Preferencias
              </Link>{" "}
              o escribirnos a soporte@esmalia.com y lo hacemos por ti.
            </p>
          </>
        )}

        {estado === "error" && (
          <>
            <h1 className="font-display text-3xl font-semibold leading-tight">
              No pudimos completar la baja
            </h1>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Intenta de nuevo en unos minutos. Si el problema sigue, escríbenos a
              soporte@esmalia.com y lo hacemos por ti.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
