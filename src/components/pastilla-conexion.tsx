import { CloudUpload, Wifi, WifiOff } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useColaOffline } from "@/hooks/use-offline-mutation";
import { textoConexion } from "@/lib/shell-v2";
import { cn } from "@/lib/utils";

const hora = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });

/**
 * Vista pura de la pastilla (sin hooks), para poder probarla con
 * `renderToStaticMarkup`. El detalle vive en `PastillaConexion`.
 */
export function PastillaConexionVista({
  online,
  pendientes,
  className,
}: {
  online: boolean;
  pendientes: number;
  className?: string;
}) {
  const Icono = !online ? WifiOff : pendientes > 0 ? CloudUpload : Wifi;
  return (
    <span
      data-estado={online ? "en-linea" : "sin-conexion"}
      className={cn(
        "inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium",
        online ? "border-border text-muted-foreground" : "border-warning-border text-warning",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", online ? "bg-success" : "bg-warning")}
      />
      <Icono className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{textoConexion({ online, pendientes })}</span>
    </span>
  );
}

/**
 * Pastilla de conexión del shell A+ (flag `shell-v2`). Reemplaza a dos
 * franjas (`OfflineBanner` y la parte informativa de `PendingSyncBanner`):
 * dice si hay red y cuántas operaciones de la cola de este usuario esperan
 * subir. Los fallidos y los conflictos NO van acá: piden una decisión y
 * siguen en la franja de estado, con sus botones.
 *
 * Al tocarla se abre el mismo detalle exacto que daba el banner (qué se
 * puede hacer sin conexión y qué no): prometer de más sería peor que no
 * avisar.
 */
export function PastillaConexion({
  userId,
  className,
  soloSiHayAlgo = false,
}: {
  userId: string | undefined;
  className?: string;
  /** En el celular no hay sidebar ni lugar en la barra superior: la
   *  pastilla aparece solo si no hay red o si hay algo esperando subir. */
  soloSiHayAlgo?: boolean;
}) {
  const { online, lastOnlineAt } = useConnectivity();
  const { pendientes } = useColaOffline(userId);
  const n = pendientes.length;
  const texto = textoConexion({ online, pendientes: n });
  if (soloSiHayAlgo && online && n === 0) return null;

  return (
    <Popover>
      {/* Región viva aparte: el contenido de un botón es su nombre, no un aviso. */}
      <span role="status" className="sr-only">
        {texto}
      </span>
      <PopoverTrigger
        aria-label={`Estado de la conexión: ${texto}`}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <PastillaConexionVista online={online} pendientes={n} className={className} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        {online ? (
          <p>
            {n > 0
              ? `${n === 1 ? "1 operación guardada" : `${n} operaciones guardadas`} en este equipo. Se están sincronizando solas: no tienes que hacer nada.`
              : "Todo lo que guardas llega al servidor al instante."}
          </p>
        ) : (
          <p>
            Puedes seguir cobrando, agendando, guardando notas clínicas, marcando el odontograma y
            editando la anamnesis (alergias, medicación, antecedentes): se guarda en este equipo y
            se sincroniza solo cuando vuelva internet. Ves la información
            {lastOnlineAt ? ` de las ${hora.format(lastOnlineAt)}` : " guardada"}. Enviar mensajes o
            crear presupuestos sí necesita conexión.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
