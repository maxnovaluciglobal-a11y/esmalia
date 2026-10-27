import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { VincularDispositivo } from "@/components/dispositivos/vincular-dispositivo";
import {
  verDispositivo,
  type IdentidadDispositivo,
} from "@/lib/dispositivos/dispositivo-publico.functions";
import { RUTA_TIPO, type TipoDispositivo } from "@/lib/dispositivos/dispositivos";
import {
  borrarTokenDispositivo,
  guardarTokenDispositivo,
  leerTokenDispositivo,
} from "@/lib/dispositivos/token-local";
import { hora } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

/**
 * Marco de las pantallas de dispositivo (`/totem`, `/sala`, `/box`): sin
 * login, a pantalla completa. Lee el token guardado (lo único que guarda el
 * navegador); sin token, o si la clínica lo revocó, muestra la vinculación.
 * Si el token es de otro tipo de dispositivo, lleva a su pantalla.
 */

type Estado =
  | { fase: "cargando" }
  | { fase: "vincular"; aviso: string | null }
  | { fase: "listo"; token: string; dispositivo: IdentidadDispositivo };

export interface ContextoDispositivo {
  token: string;
  dispositivo: IdentidadDispositivo;
  /** El servidor dijo que el token ya no sirve (revocado o desvinculado). */
  alInvalidar: () => void;
}

export function PantallaDeDispositivo({
  tipo,
  oscuro = false,
  children,
}: {
  tipo: TipoDispositivo;
  /** TV y box: tinta, para leer de lejos y no encandilar en la sala. */
  oscuro?: boolean;
  children: (ctx: ContextoDispositivo) => ReactNode;
}) {
  const navigate = useNavigate();
  const verFn = useServerFn(verDispositivo);
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

  const abrir = useCallback(
    async (token: string) => {
      try {
        const r = await verFn({ data: { token } });
        if (r.invalido) {
          borrarTokenDispositivo();
          setEstado({
            fase: "vincular",
            aviso: "Este dispositivo ya no está vinculado. Pide un código nuevo.",
          });
          return;
        }
        if (r.dispositivo.tipo !== tipo) {
          void navigate({ to: RUTA_TIPO[r.dispositivo.tipo], replace: true });
          return;
        }
        setEstado({ fase: "listo", token, dispositivo: r.dispositivo });
      } catch {
        // Sin red: reintenta en unos segundos sin perder el token.
        setTimeout(() => void abrir(token), 5000);
      }
    },
    [navigate, tipo, verFn],
  );

  useEffect(() => {
    const token = leerTokenDispositivo();
    if (token) void abrir(token);
    else setEstado({ fase: "vincular", aviso: null });
  }, [abrir]);

  const alVincular = (token: string, tipoVinculado: TipoDispositivo) => {
    guardarTokenDispositivo(token);
    if (tipoVinculado !== tipo) {
      void navigate({ to: RUTA_TIPO[tipoVinculado], replace: true });
      return;
    }
    setEstado({ fase: "cargando" });
    void abrir(token);
  };

  const alInvalidar = useCallback(() => {
    borrarTokenDispositivo();
    setEstado({
      fase: "vincular",
      aviso: "Este dispositivo ya no está vinculado. Pide un código nuevo.",
    });
  }, []);

  return (
    <div
      className={cn("min-h-dvh overflow-x-hidden bg-background text-foreground", oscuro && "dark")}
    >
      {estado.fase === "cargando" ? (
        <div className="flex min-h-dvh items-center justify-center" role="status">
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">Cargando…</span>
        </div>
      ) : estado.fase === "vincular" ? (
        <VincularDispositivo aviso={estado.aviso} onVinculado={alVincular} />
      ) : (
        children({ token: estado.token, dispositivo: estado.dispositivo, alInvalidar })
      )}
    </div>
  );
}

/** Hora de la sucursal, grande y en cifras (encabezado de la TV y del box). */
export function RelojDeSucursal({ zona, className }: { zona: string; className?: string }) {
  const [ahora, setAhora] = useState<Date | null>(null);
  useEffect(() => {
    setAhora(new Date());
    const id = setInterval(() => setAhora(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  if (!ahora) return null;
  const texto = hora(ahora, zona);
  return <span className={cn("cifra tabular-nums", className)}>{texto}</span>;
}
