import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { DemoBanner } from "@/components/demo-banner";
import { OfflineBanner } from "@/components/offline-banner";
import { PendingSyncBanner } from "@/components/pending-sync-banner";
import { RoleSimulationBar } from "@/components/role-simulation-bar";
import { TrialBanner } from "@/components/trial-banner";
import {
  AvisoMfaRecomendado,
  useAvisoMfaPospuesto,
  useEstadoMfa,
} from "@/components/verificacion-dos-pasos";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useColaOffline } from "@/hooks/use-offline-mutation";
import type { ClinicAccess } from "@/lib/access/access";
import { debeMostrarAvisoMfa } from "@/lib/auth/mfa";
import { trialBannerVisible } from "@/lib/billing";
import { getMySubscription } from "@/lib/billing.functions";

/**
 * Una sola franja de estado (rediseño, fase 4). Antes podían apilarse hasta
 * cinco banners; ahora se muestra el más importante, en este orden:
 * demo > sin conexión > sincronización pendiente > simulación de rol >
 * verificación en dos pasos (owner sin factor, se puede posponer) > trial.
 *
 * La simulación va antes que el trial (el handoff decía al revés): casi
 * todas las clínicas están en trial, y con ese orden quien simulaba un rol
 * no veía ningún aviso ni el botón para volver a su rol real.
 *
 * No reescribe ningún banner: decide cuál montar y reutiliza el componente
 * de siempre, así que sus textos cuidados (qué se puede hacer offline, cómo
 * resolver un conflicto) y sus acciones siguen intactos. Mismo queryKey de
 * suscripción que `TrialBanner` y el dashboard: comparten caché.
 */
export function StatusStrip({ access }: { access: ClinicAccess }) {
  const { online } = useConnectivity();
  const { pendientes, fallidos, conflictos } = useColaOffline(access.userId);
  const clinicId = access.clinic?.id;
  const esDemo = Boolean(access.clinic?.isDemo);

  const fetchSub = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSub({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId) && !esDemo,
    staleTime: 60 * 1000,
  });

  // SEG-01: al owner sin verificación en dos pasos se le recomienda
  // activarla. Con el rol REAL: simular "dentista" no debería esconderlo.
  const { data: mfa } = useEstadoMfa();
  const [mfaPospuesto, posponerMfa] = useAvisoMfaPospuesto();
  const avisoMfa =
    mfa !== undefined &&
    !mfaPospuesto &&
    debeMostrarAvisoMfa({
      rolReal: access.realRole ?? access.role,
      tieneFactor: mfa.tieneFactor,
      esDemo: esDemo || mfa.esDemo,
    });

  if (esDemo) return <DemoBanner />;
  if (!online) return <OfflineBanner />;
  if (pendientes.length + fallidos.length + conflictos.length > 0) {
    return <PendingSyncBanner userId={access.userId} />;
  }
  if (access.simulatedRole) return <RoleSimulationBar access={access} soloSiSimula />;
  if (avisoMfa) return <AvisoMfaRecomendado onPosponer={posponerMfa} />;
  if (clinicId && trialBannerVisible(sub)) return <TrialBanner clinicId={clinicId} />;
  return null;
}
