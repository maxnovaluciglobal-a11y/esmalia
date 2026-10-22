import { type ReactElement, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { SoloLecturaContext, useSoloLectura } from "@/hooks/use-solo-lectura";
import type { ClinicAccess } from "@/lib/access/access";
import { getMySubscription } from "@/lib/billing.functions";
import { EXPLICACION_BOTON_SOLO_LECTURA, soloLectura } from "@/lib/solo-lectura";

/**
 * Modo solo lectura en la interfaz (BIL-01). Es solo la cara visible: quien
 * decide es el servidor (`solo-lectura.middleware.ts`). Lo que no esté
 * deshabilitado acá igual lo rechaza el servidor con un mensaje que explica
 * qué pasa, y ese mensaje es el que muestra el toast.
 */
export function SoloLecturaProvider({
  access,
  children,
}: {
  access: ClinicAccess;
  children: ReactNode;
}) {
  const clinicId = access.clinic?.id;
  const esDemo = Boolean(access.clinic?.isDemo);
  const fetchSub = useServerFn(getMySubscription);
  // Mismo queryKey que el banner y el dashboard: comparten caché.
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSub({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId) && !esDemo,
    staleTime: 60 * 1000,
  });
  return (
    <SoloLecturaContext.Provider value={soloLectura(sub)}>{children}</SoloLecturaContext.Provider>
  );
}

/**
 * Envuelve un botón (o un `DialogTrigger asChild`) que crea o edita: en solo
 * lectura lo deshabilita y explica por qué (UX-05): el motivo sale en un globo
 * al pasar el puntero, enfocar o tocar, y el botón lo anuncia con
 * `aria-describedby`. Antes era un `title`, que no se ve en el celular.
 */
export function BloqueoEscritura({
  children,
  otroMotivo,
  className,
}: {
  children: ReactElement<{ disabled?: boolean; className?: string }>;
  /** Motivo propio de la acción (falta un dato, etc.), visible debajo del botón. */
  otroMotivo?: string | null | false;
  className?: string;
}) {
  const bloqueado = useSoloLectura();
  if (bloqueado) {
    return (
      <AccionDeshabilitada motivo={EXPLICACION_BOTON_SOLO_LECTURA} como="globo">
        {children}
      </AccionDeshabilitada>
    );
  }
  return (
    <AccionDeshabilitada motivo={otroMotivo} className={className}>
      {children}
    </AccionDeshabilitada>
  );
}

/**
 * Muestra `bloqueado` en modo solo lectura y `children` si no. Para lo que no
 * se deshabilita con `disabled` (un `Link`): se reemplaza por un botón
 * bloqueado. Tiene que renderizarse dentro del AppShell (el provider).
 */
export function SegunSoloLectura({
  bloqueado,
  children,
}: {
  bloqueado: ReactNode;
  children: ReactNode;
}) {
  return <>{useSoloLectura() ? bloqueado : children}</>;
}
