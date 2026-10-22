import { Link, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { ACCESS_QUERY_KEY, type ClinicAccess } from "@/lib/access/access";
import { getMyAccess, setActiveClinic } from "@/lib/access/access.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * Selector de clínica activa (progresivo #7, plan Carlos 05-sep-2026). Solo
 * se renderiza como <select> con 2+ membresías reales — con una sola clínica
 * (el caso de hoy para todos los usuarios reales) queda exactamente como
 * antes: el nombre en texto plano, sin ningún cambio visual.
 *
 * Límite conocido, no resuelto a propósito: si el usuario tiene 2 pestañas
 * abiertas y cambia de clínica en una, la otra sigue "creyendo" que la
 * clínica vieja es la activa hasta que su propio caché expire (5 min, ver
 * ACCESS_QUERY_KEY en _clinic/route.tsx) o navegue — RLS igual permite sus
 * escrituras porque sigue siendo miembro real de ambas clínicas, así que no
 * es un problema de seguridad, pero un alta/pago hecho en esa ventana queda
 * bajo la clínica que la pestaña vieja todavía tenía activa. Sin ningún
 * usuario real en 2+ clínicas hoy, no se justifica todavía sumar sincronía
 * entre pestañas (BroadcastChannel) para un caso sin caso real (revisión de
 * código, 06-sep-2026).
 */
export function ClinicSwitcher({ access }: { access: ClinicAccess }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const switchClinicFn = useServerFn(setActiveClinic);
  const getMyAccessFn = useServerFn(getMyAccess);

  // Defensivo: un ClinicAccess restaurado del caché offline (IndexedDB) de
  // antes de que este campo existiera no lo tiene — degradar a "sin
  // selector" en vez de romper la sección entera (revisión de código,
  // 06-sep-2026).
  const memberships = access.memberships ?? [];

  const mut = useMutation({
    mutationFn: async (clinicId: string) => {
      await switchClinicFn({ data: { clinicId } });
      // ensureQueryData (usado en el beforeLoad de _clinic/route.tsx) devuelve
      // el dato cacheado si existe, SIN mirar si está invalidado (confirmado
      // leyendo queryClient.js). fetchQuery con staleTime: 0 fuerza el fetch
      // real — a diferencia de removeQueries (lo que había acá antes), nunca
      // deja la entrada del caché vacía: si este fetch falla, la clínica
      // anterior sigue disponible para el fallback offline de
      // _clinic/route.tsx en vez de tumbar la sección entera con un error
      // (regresión de resiliencia encontrada en revisión de código, 06-sep-2026).
      await queryClient.fetchQuery({
        queryKey: ACCESS_QUERY_KEY,
        queryFn: () => getMyAccessFn({}),
        staleTime: 0,
      });
      await router.invalidate();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (!access.clinic) return null;

  // UX-03: crear otra clínica vive SOLO acá, con un texto que no se confunda
  // con editar la actual (eso es Ajustes · Datos de la clínica). La demo no
  // lo ofrece: su salida es "Crear mi clínica gratis" de la franja.
  const crearOtra = access.clinic.isDemo ? null : (
    <Link
      to="/onboarding"
      title="Abre el asistente para crear una clínica nueva y vacía. No cambia la clínica actual."
      className="mt-1.5 inline-flex min-h-6 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <Plus className="size-3" aria-hidden />
      Crear otra clínica (nueva, vacía)
    </Link>
  );

  if (memberships.length < 2) {
    return (
      <div className="mt-2">
        <p className="truncate text-xs text-muted-foreground">{access.clinic.name}</p>
        {crearOtra}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <label className="block">
        <span className="sr-only">Clínica activa</span>
        <select
          value={access.clinic.id}
          onChange={(e) => {
            if (e.target.value !== access.clinic?.id) mut.mutate(e.target.value);
          }}
          className="w-full truncate rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
        >
          {memberships.map((m) => (
            <option key={m.clinicId} value={m.clinicId}>
              {m.clinicName}
            </option>
          ))}
        </select>
      </label>
      {crearOtra}
    </div>
  );
}
