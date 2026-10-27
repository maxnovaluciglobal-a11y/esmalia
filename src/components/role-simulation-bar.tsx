import { useRouter } from "@tanstack/react-router";
import { Eye, X } from "lucide-react";

import {
  CLINIC_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type ClinicAccess,
  type ClinicRole,
} from "@/lib/access/access";
import { guardarRolSimulado, puedeSimular } from "@/lib/access/role-simulation";

/**
 * Modo de simulación de rol (solo owner/admin): cambia únicamente lo que muestra
 * la interfaz para verificar qué botones y flujos se habilitan por rol.
 * La autorización real siempre la aplica RLS con el rol verdadero.
 */
export function RoleSimulationBar({
  access,
  soloSiSimula = false,
}: {
  access: ClinicAccess;
  /** En la franja de estado solo aparece mientras se está simulando; el
   *  selector completo vive en /ajustes (rediseño, fase 4). */
  soloSiSimula?: boolean;
}) {
  const router = useRouter();
  const realRole = access.realRole ?? access.role;
  const simulado = access.simulatedRole ?? null;

  if (!puedeSimular(realRole)) return null;
  if (soloSiSimula && !simulado) return null;

  const aplicar = (valor: string) => {
    guardarRolSimulado(valor === "real" ? null : (valor as ClinicRole));
    void router.invalidate();
  };

  return (
    <div
      className={
        simulado
          ? "flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-5 py-2 sm:px-8"
          : "flex flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-2 sm:px-8"
      }
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Eye className="size-3.5" aria-hidden />
        Simulación de rol
      </span>

      <label className="sr-only" htmlFor="sim-role">
        Rol a simular
      </label>
      <select
        id="sim-role"
        value={simulado ?? "real"}
        onChange={(e) => aplicar(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
      >
        <option value="real">Mi rol real {realRole ? `(${ROLE_LABELS[realRole]})` : ""}</option>
        {CLINIC_ROLES.map((r) => (
          <option key={r} value={r}>
            Ver como {ROLE_LABELS[r]}
          </option>
        ))}
      </select>

      {simulado ? (
        <>
          <span className="text-xs text-muted-foreground">
            {ROLE_DESCRIPTIONS[simulado]} Se ve el rol tal cual, sin ajustes por persona. Los
            permisos reales no cambian.
          </span>
          <button
            type="button"
            onClick={() => aplicar("real")}
            className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
          >
            <X className="size-3.5" aria-hidden />
            Salir de la simulación
          </button>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          Previsualiza la interfaz con otro rol sin cambiar tus permisos.
        </span>
      )}
    </div>
  );
}
