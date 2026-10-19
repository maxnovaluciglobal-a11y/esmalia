import { describe, expect, it } from "vitest";

import { esPalabraDeBaja } from "@/lib/messaging/baja-whatsapp";
import { interpretarMensajeDeAgenda } from "@/lib/messaging/intencion-de-agenda";
import { esConfirmacionDePaciente } from "@/lib/messaging/patient-confirmation";

/**
 * El webhook resuelve un mensaje entrante en un orden fijo, y ese orden es lo
 * que impide que F4 pise a F1 o al opt-out:
 *
 *   1. baja (BAJA/STOP/NO MÁS/UNSUBSCRIBE, mensaje completo; `esPalabraDeBaja`)
 *   2. aviso del paciente ("sí", "ahí voy")  → patient_confirmed_at
 *   3. solicitud de agenda (F4)              → appointment_requests
 *   4. aviso genérico
 *
 * Estos tests fijan que las tres lecturas no se solapen. No tocan Postgres:
 * lo que se verifica es que las funciones puras no reclamen el mismo mensaje.
 */

const esBaja = esPalabraDeBaja;
const HOY = new Date(2026, 8, 7);

describe("las tres lecturas no se pisan", () => {
  it("una baja no se lee como pedido de agenda ni como confirmación", () => {
    for (const t of ["BAJA", "stop", "No más", "UNSUBSCRIBE"]) {
      expect(esBaja(t)).toBe(true);
      expect(interpretarMensajeDeAgenda(t, HOY)).toBeNull();
      expect(esConfirmacionDePaciente(t)).toBe(false);
    }
  });

  it("una confirmación no se lee como pedido de agenda", () => {
    for (const t of ["si", "SI", "ok", "dale", "confirmo"]) {
      expect(interpretarMensajeDeAgenda(t, HOY)).toBeNull();
    }
  });

  it("un pedido de hora no se lee como confirmación ni como baja", () => {
    for (const t of [
      "quiero hora para el jueves",
      "necesito cambiar mi cita",
      "quiero cancelar mi hora del viernes",
      "no voy a poder ir",
    ]) {
      expect(esBaja(t)).toBe(false);
      expect(esConfirmacionDePaciente(t)).toBe(false);
      expect(interpretarMensajeDeAgenda(t, HOY)).not.toBeNull();
    }
  });

  it("'CANCELAR' ya no es una baja: el paciente quiere anular su cita (CON-09)", () => {
    // Antes "CANCELAR" pelado daba de baja de todo al paciente que solo
    // quería anular una hora. Ahora pelado cae al aviso genérico (no es baja,
    // ni confirmación, ni pedido con fecha) y con contexto se lee como
    // cancelación de cita.
    expect(esBaja("CANCELAR")).toBe(false);
    expect(esBaja("cancelar")).toBe(false);
    expect(esConfirmacionDePaciente("CANCELAR")).toBe(false);
    expect(esBaja("quiero cancelar mi hora")).toBe(false);
    expect(interpretarMensajeDeAgenda("quiero cancelar mi hora", HOY)?.intencion).toBe("cancelar");
  });
});

describe("sólo 'agendar con fecha' crea una solicitud", () => {
  // Mover o cancelar tocan una cita concreta que hay que elegir; eso es
  // decisión de la clínica, no del webhook. Y `appointment_requests` exige
  // `preferred_date NOT NULL`, así que sin fecha no hay fila posible.
  const creaFila = (t: string) => {
    const l = interpretarMensajeDeAgenda(t, HOY);
    return l !== null && l.intencion === "agendar" && l.fecha !== null;
  };

  it("crea fila con intención de agendar y fecha", () => {
    expect(creaFila("quiero hora para el jueves")).toBe(true);
    expect(creaFila("¿tienen hora mañana por la tarde?")).toBe(true);
  });

  it("NO crea fila sin fecha, aunque la intención sea clara", () => {
    expect(creaFila("quiero una hora")).toBe(false);
  });

  it("NO crea fila para mover ni cancelar", () => {
    expect(creaFila("necesito cambiar mi hora del jueves")).toBe(false);
    expect(creaFila("quiero cancelar mi hora del jueves")).toBe(false);
  });
});
