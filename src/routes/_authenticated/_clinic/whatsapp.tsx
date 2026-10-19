import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  MessageCircle,
  UserPlus,
  Unplug,
  X,
} from "lucide-react";
import { toast } from "sonner";

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
import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { LlamadaDesbloqueo } from "@/components/llamada-desbloqueo";
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { requiereLlamadaOSuscripcion } from "@/lib/billing";
import { normalizeToWaMe } from "@/lib/messaging/messaging";
import {
  completeWhatsAppEmbeddedSignup,
  disconnectWhatsAppAccount,
  resincronizarPlantillasWhatsApp,
  getWhatsAppAccountStatus,
  listWhatsAppLeads,
  updateWhatsAppLeadStatus,
  type WhatsAppLead,
} from "@/lib/messaging/whatsapp.functions";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/_clinic/whatsapp")({
  beforeLoad: requirePermission("team:manage"),
  head: () => ({
    meta: [
      { title: "WhatsApp | Esmalia" },
      {
        name: "description",
        content:
          "Conecta el WhatsApp de tu clínica para mandar recordatorios y avisos automáticos.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WhatsAppPage,
});

// Config de plataforma expuesta al navegador — no son secretos (el App
// Secret y el System User token nunca salen del server). Sin esto seteado,
// la página muestra el estado "todavía no habilitado" en vez de un botón roto.
const WHATSAPP_APP_ID = import.meta.env.VITE_WHATSAPP_APP_ID as string | undefined;
const WHATSAPP_CONFIG_ID = import.meta.env.VITE_WHATSAPP_CONFIG_ID as string | undefined;
// Meta da ~2 años de vida a cada versión del Graph API. v25.0 es la vigente
// en oct-2026; revisar este default (o VITE_WHATSAPP_API_VERSION) a fines de 2027.
const WHATSAPP_API_VERSION =
  (import.meta.env.VITE_WHATSAPP_API_VERSION as string | undefined) || "v25.0";

declare global {
  interface Window {
    FB?: {
      init: (opts: {
        appId: string;
        autoLogAppEvents: boolean;
        xfbml: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        opts: {
          config_id: string;
          response_type: string;
          override_default_response_type: boolean;
          extras: { setup: Record<string, never> };
        },
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

/** Carga el SDK de Facebook una sola vez y llama FB.init. */
function useFacebookSdk(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!WHATSAPP_APP_ID) return;
    if (window.FB) {
      setReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: WHATSAPP_APP_ID,
        autoLogAppEvents: true,
        xfbml: true,
        version: WHATSAPP_API_VERSION,
      });
      setReady(true);
    };
    if (document.getElementById("facebook-jssdk")) return;
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/es_LA/sdk.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, []);

  return ready;
}

interface EmbeddedSignupPayload {
  wabaId: string;
  phoneNumberId: string;
  displayPhone?: string;
}

/**
 * Escucha el postMessage que manda Meta con el waba_id/phone_number_id
 * conectado. Embedded Signup v4: "FINISH" es el flujo de Cloud API y
 * "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" cuando la clínica conecta el
 * número que ya usa en la app WhatsApp Business.
 */
function useEmbeddedSignupResult(onResult: (payload: EmbeddedSignupPayload) => void) {
  useEffect(() => {
    function handler(event: MessageEvent) {
      let origen: URL;
      try {
        origen = new URL(event.origin);
      } catch {
        return;
      }
      if (origen.protocol !== "https:" || !/(^|\.)facebook\.com$/.test(origen.hostname)) return;
      try {
        const parsed = JSON.parse(event.data);
        if (
          parsed.type === "WA_EMBEDDED_SIGNUP" &&
          (parsed.event === "FINISH" || parsed.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
        ) {
          const d = parsed.data ?? {};
          if (d.waba_id && d.phone_number_id) {
            onResult({
              wabaId: d.waba_id,
              phoneNumberId: d.phone_number_id,
              displayPhone: d.display_phone_number,
            });
          }
        }
      } catch {
        // No es el mensaje que esperamos (Meta manda otros postMessage también) — ignorar.
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onResult]);
}

function WhatsAppPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const queryClient = useQueryClient();

  const fetchStatus = useServerFn(getWhatsAppAccountStatus);
  const {
    data: account,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["whatsapp-account", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchStatus({ data: { clinicId: clinicId! } }),
  });

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  // Gatea solo la CONEXIÓN real (Embedded Signup) — la bandeja de leads y el
  // fallback wa.me siguen visibles/funcionando siempre. Ver
  // `requiereLlamadaOSuscripcion` en billing.ts.
  const requiereLlamada = requiereLlamadaOSuscripcion(
    sub ?? null,
    access.clinic?.onboardingCallAt ?? null,
  );

  const complete = useServerFn(completeWhatsAppEmbeddedSignup);
  const disconnect = useServerFn(disconnectWhatsAppAccount);

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: ["whatsapp-account", clinicId] });

  const completeMutation = useMutation({
    mutationFn: (payload: EmbeddedSignupPayload & { code: string }) =>
      complete({
        data: {
          clinicId: clinicId!,
          code: payload.code,
          wabaId: payload.wabaId,
          phoneNumberId: payload.phoneNumberId,
          displayPhone: payload.displayPhone,
        },
      }),
    onSuccess: () => {
      toast.success("WhatsApp conectado. Ya puedes mandar mensajes automáticos.");
      invalidar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const resincronizar = useServerFn(resincronizarPlantillasWhatsApp);
  const plantillasMutation = useMutation({
    mutationFn: () => resincronizar({ data: { clinicId: clinicId! } }),
    onSuccess: (r) => {
      if (r.fallidas.length === 0) {
        toast.success(
          `Plantillas enviadas a Meta (${r.registradas}). Se usan apenas Meta las aprueba.`,
        );
      } else {
        toast.error(
          `Meta no aceptó ${r.fallidas.length} plantilla(s). Revisa tu cuenta en WhatsApp Manager.`,
        );
      }
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnect({ data: { clinicId: clinicId! } }),
    onSuccess: () => {
      toast.success("WhatsApp desconectado. Los envíos vuelven a wa.me manual.");
      invalidar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const sdkReady = useFacebookSdk();
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<EmbeddedSignupPayload | null>(null);
  const [isOpeningPopup, setIsOpeningPopup] = useState(false);

  // Meta manda dos cosas por canales distintos y en cualquier orden: los IDs
  // de la cuenta (postMessage) y el código de autorización (callback de
  // FB.login). Se guardan las dos y se completa cuando están ambas; antes,
  // si los IDs llegaban primero, se descartaban y la conexión quedaba a medias.
  useEmbeddedSignupResult(setPendingPayload);

  useEffect(() => {
    if (!pendingCode || !pendingPayload) return;
    setIsOpeningPopup(false);
    completeMutation.mutate({ ...pendingPayload, code: pendingCode });
    setPendingCode(null);
    setPendingPayload(null);
    // completeMutation cambia de identidad en cada render; el disparo depende solo de los datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCode, pendingPayload]);

  // Si el usuario cierra la ventana de Meta sin terminar, o el postMessage
  // nunca llega, el botón quedaba colgado sin ningún aviso — 2 minutos es
  // más que suficiente para completar el flujo real (5-15 min según el
  // texto de la página se refiere al enrolamiento, no a este popup puntual).
  useEffect(() => {
    if (!isOpeningPopup) return;
    const timeout = window.setTimeout(() => {
      setIsOpeningPopup(false);
      setPendingCode(null);
      setPendingPayload(null);
      toast.error(
        "No llegó respuesta de Meta. Si cerraste la ventana o no la viste, revisa que el navegador no bloquee popups e intenta de nuevo.",
      );
    }, 120_000);
    return () => window.clearTimeout(timeout);
  }, [isOpeningPopup]);

  function launchSignup() {
    if (!window.FB || !WHATSAPP_CONFIG_ID) {
      toast.error("No se pudo abrir la ventana de Meta. Recarga la página e intenta de nuevo.");
      return;
    }
    setIsOpeningPopup(true);
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (code) {
          setPendingCode(code);
        } else {
          setIsOpeningPopup(false);
        }
      },
      {
        config_id: WHATSAPP_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }

  const platformConfigured = Boolean(WHATSAPP_APP_ID && WHATSAPP_CONFIG_ID);

  return (
    <AppShell title="WhatsApp" access={access}>
      <div className="max-w-2xl space-y-6">
        <p className="text-sm text-muted-foreground">
          {requiereLlamada && (!platformConfigured || account?.status !== "connected")
            ? "Conecta el WhatsApp de tu clínica para mandar recordatorios, recall y avisos de saldo desde aquí — cada clínica usa su propio número, nunca compartimos uno entre clínicas."
            : "Conecta el WhatsApp de tu clínica para mandar recordatorios, recall y avisos de saldo automáticamente. Cada clínica usa su propio número — nunca compartimos uno entre clínicas."}
        </p>

        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}

        {/* Un error no es "sin número conectado": antes se ofrecía conectar
            un número a una clínica que quizás ya lo tenía. */}
        {isError && platformConfigured && (
          <ErrorDeCarga
            onReintentar={refetch}
            mensaje="No pudimos consultar el estado de tu WhatsApp."
          />
        )}

        {!isLoading && !platformConfigured && (
          <div className="card-clinical p-6">
            <p className="text-sm font-medium">WhatsApp todavía no está habilitado.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Esto lo activa el equipo de Esmalia una vez enrolados como proveedor técnico ante
              Meta. Mientras tanto, los recordatorios y avisos siguen funcionando por wa.me manual
              desde /recordatorios y la ficha del paciente.
            </p>
          </div>
        )}

        {!isLoading && platformConfigured && account?.status === "connected" && (
          <div className="card-clinical space-y-3 p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" />
                <div>
                  <p className="text-sm font-medium">
                    Conectado {account.displayPhone ? `· ${account.displayPhone}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {account.qualityRating
                      ? `Calidad reportada por Meta: ${account.qualityRating}`
                      : "Los recordatorios y avisos se mandan automáticamente."}
                  </p>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    disabled={disconnectMutation.isPending}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50",
                    )}
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Unplug className="size-3.5" />
                    )}
                    Desconectar
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Desconectar WhatsApp?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Los recordatorios, el recall y los avisos de saldo dejan de mandarse
                      automáticamente y vuelven a wa.me manual desde /recordatorios. Vas a poder
                      reconectar cuando quieras.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => disconnectMutation.mutate()}>
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <p className="text-xs text-muted-foreground">
              Al conectar, Esmalia crea en tu cuenta las plantillas de recordatorios y avisos. Meta
              las revisa (suele tardar minutos u horas) y, mientras tanto, los envíos siguen por
              wa.me.{" "}
              <button
                type="button"
                onClick={() => plantillasMutation.mutate()}
                disabled={plantillasMutation.isPending}
                className="text-brand-700 underline underline-offset-2 disabled:opacity-60"
              >
                {plantillasMutation.isPending ? "Enviando…" : "Volver a enviar las plantillas"}
              </button>
            </p>
            {account.qualityRating === "RED" && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  Meta marcó tu número con calidad baja — puede que tus mensajes no lleguen. Revisa
                  tu cuenta de WhatsApp Business para entender por qué.
                </p>
              </div>
            )}
          </div>
        )}

        {!isLoading && account?.status === "connected" && account.displayPhone && (
          <WaMeLinkCard displayPhone={account.displayPhone} />
        )}

        {!isLoading && account?.status === "connected" && clinicId && (
          <LeadsSection clinicId={clinicId} />
        )}

        {!isLoading &&
          !isError &&
          platformConfigured &&
          account?.status !== "connected" &&
          requiereLlamada && (
            <LlamadaDesbloqueo
              feature="WhatsApp automático"
              descripcion="Conecta el WhatsApp real de tu clínica para mandar recordatorios, recall y avisos de saldo automáticamente por la API de Meta — en vez de wa.me manual."
              clinicName={access.clinic?.name}
              clinicEmail={access.email}
            />
          )}

        {!isLoading &&
          !isError &&
          platformConfigured &&
          account?.status !== "connected" &&
          !requiereLlamada && (
            <div className="card-clinical p-6">
              <p className="text-sm font-medium">Sin número conectado</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Vas a elegir o verificar el WhatsApp de tu clínica en una ventana de Meta. Toma
                entre 5 y 15 minutos.
              </p>
              <button
                type="button"
                onClick={launchSignup}
                disabled={!sdkReady || isOpeningPopup || completeMutation.isPending}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-brand bg-transparent px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand/12 disabled:opacity-50"
              >
                {isOpeningPopup || completeMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <MessageCircle className="size-3.5" />
                )}
                {isOpeningPopup ? "Esperando a Meta…" : "Conectar WhatsApp"}
              </button>
            </div>
          )}
      </div>
    </AppShell>
  );
}

/** Link fijo para pegar en un QR o en la bio de Instagram — no genera imagen, cualquier generador de QR gratis sirve con este link. */
function WaMeLinkCard({ displayPhone }: { displayPhone: string }) {
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const { access } = Route.useRouteContext();
  const normalized = normalizeToWaMe(displayPhone, access.clinic?.country);
  const link = normalized ? `https://wa.me/${normalized}` : null;

  if (!link) {
    return (
      <div className="card-clinical p-6">
        <p className="text-sm font-medium">Link para captar pacientes nuevos</p>
        <p className="mt-1 text-xs text-muted-foreground">
          No pudimos generar el link automático para el número {displayPhone}. Escríbenos a soporte
          y lo resolvemos.
        </p>
      </div>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link!);
      setCopiedAt(Date.now());
      setTimeout(() => setCopiedAt(null), 2000);
      toast.success("Link copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar. Copialo manualmente.");
    }
  }

  return (
    <div className="card-clinical p-6">
      <p className="text-sm font-medium">Link para captar pacientes nuevos</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Pegalo en la bio de Instagram, en un QR en la clínica, o en cualquier anuncio — quien lo
        abra te escribe directo a este WhatsApp.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs text-foreground/80">
          {link}
        </code>
        <button
          type="button"
          onClick={copy}
          className={cn(
            "shrink-0 rounded-lg border border-hairline bg-background p-1.5 text-muted-foreground hover:text-foreground",
            copiedAt && "text-brand-700",
          )}
          aria-label="Copiar link"
        >
          {copiedAt ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

// Si pasó esto desde que se creó el lead y `autoRepliedAt` sigue null, algo
// falló mandando la auto-respuesta (ver el catch en api.whatsapp-webhook.ts,
// que ahora reporta a Sentry) — se lo marcamos al staff en vez de dejar que
// se entere solo revisando Sentry.
const AUTO_REPLY_STALE_MS = 5 * 60 * 1000;

function isAutoReplyStale(lead: Pick<WhatsAppLead, "createdAt" | "autoRepliedAt">): boolean {
  if (lead.autoRepliedAt) return false;
  return Date.now() - new Date(lead.createdAt).getTime() > AUTO_REPLY_STALE_MS;
}

/** Desconocidos que escribieron por primera vez (Fase 3) — capturados y auto-respondidos por el webhook, sin plantilla. */
function LeadsSection({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient();
  const fetchLeads = useServerFn(listWhatsAppLeads);
  const updateStatus = useServerFn(updateWhatsAppLeadStatus);

  const {
    data: leads = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["whatsapp-leads", clinicId],
    queryFn: () => fetchLeads({ data: { clinicId } }),
  });

  const mutation = useMutation({
    mutationFn: (vars: { id: string; status: "converted" | "discarded" }) =>
      updateStatus({ data: { clinicId, id: vars.id, status: vars.status } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-leads", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (isError)
    return (
      <ErrorDeCarga
        onReintentar={refetch}
        mensaje="No pudimos cargar los contactos nuevos de WhatsApp."
      />
    );
  if (isLoading || leads.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold">
        Leads nuevos
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-700">
          {leads.length}
        </span>
      </h2>
      <div className="card-clinical divide-y divide-hairline overflow-hidden">
        {leads.map((lead: WhatsAppLead) => (
          <div key={lead.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {lead.name || lead.phone}
                {isAutoReplyStale(lead) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                    <AlertTriangle className="size-3" aria-hidden="true" />
                    Sin auto-respuesta
                  </span>
                )}
              </p>
              {lead.name && <p className="text-xs text-muted-foreground">{lead.phone}</p>}
              {isAutoReplyStale(lead) && (
                <p className="text-xs text-destructive">
                  La auto-respuesta no se pudo mandar — contactalo a mano.
                </p>
              )}
              <p className="mt-1 truncate text-xs text-muted-foreground">{lead.firstMessage}</p>
              {lead.referredByName && (
                <p className="mt-1 text-xs font-medium text-brand-700">
                  Referido por {lead.referredByName}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => mutation.mutate({ id: lead.id, status: "converted" })}
                disabled={mutation.isPending}
                title="Convertir en paciente"
                className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand hover:text-brand-700 disabled:opacity-50"
              >
                <UserPlus className="size-3.5" /> Convertir
              </button>
              <button
                type="button"
                onClick={() => mutation.mutate({ id: lead.id, status: "discarded" })}
                disabled={mutation.isPending}
                title="Descartar"
                aria-label="Descartar"
                className="inline-flex size-7 items-center justify-center rounded-md border border-hairline text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
