import { describe, expect, it } from "vitest";

import { permisosEfectivos, type ClinicRole } from "@/lib/access/access";
import {
  ALERTAS,
  alertasDelSujeto,
  alertasVisibles,
  bloqueMuestraDinero,
  bloquesDelPanel,
  mapearPanelDeHoy,
  perfilDePanel,
  TIPOS_DE_ALERTA,
} from "@/lib/panel/panel-por-rol";
import {
  destinoDeNotificacion,
  grupoDeNotificacion,
  kindsFueraDe,
} from "@/lib/messaging/notifications";

/**
 * Ola 11 · frente B: qué ve cada rol en Hoy (PAN-03, 04, 06, 07, 08, REC-10)
 * y las reglas puras del centro de notificaciones (NAV-11).
 */

const sujeto = (role: ClinicRole) => ({ role, permissions: permisosEfectivos(role) });

const ALERTAS_DE_DINERO = ["cuotas_vencidas", "saldo_pacientes_hoy"] as const;

describe("perfil y bloques por rol", () => {
  it("cada rol tiene su perfil de panel", () => {
    expect(perfilDePanel("owner")).toBe("direccion");
    expect(perfilDePanel("admin")).toBe("direccion");
    expect(perfilDePanel("dentist")).toBe("profesional");
    expect(perfilDePanel("reception")).toBe("recepcion");
    expect(perfilDePanel("coordinator")).toBe("recepcion");
    expect(perfilDePanel("lab_technician")).toBe("laboratorio");
    expect(perfilDePanel("accounting")).toBe("contabilidad");
    expect(perfilDePanel("assistant")).toBe("asistente");
    expect(perfilDePanel(null)).toBeNull();
  });

  it("dirección: caja, ocupación, presupuestos, laboratorio e insumos (PAN-04)", () => {
    expect(bloquesDelPanel(sujeto("owner"))).toEqual([
      "caja",
      "ocupacion",
      "presupuestos",
      "pendientes-clinicos",
      "laboratorio",
      "insumos",
    ]);
  });

  it("profesional: su día, pendientes clínicos, su desempeño y laboratorio (PAN-06)", () => {
    expect(bloquesDelPanel(sujeto("dentist"))).toEqual([
      "mi-dia",
      "pendientes-clinicos",
      "mi-desempeno",
      "laboratorio",
    ]);
  });

  it("recepción: reservas, llegadas y cobros, sin presupuestos (PAN-07)", () => {
    expect(bloquesDelPanel(sujeto("reception"))).toEqual([
      "reservas-en-linea",
      "llegadas",
      "cobros",
    ]);
  });

  it("coordinación: lo de recepción más presupuestos (ve finanzas)", () => {
    expect(bloquesDelPanel(sujeto("coordinator"))).toEqual([
      "reservas-en-linea",
      "llegadas",
      "cobros",
      "presupuestos",
    ]);
  });

  it("técnico/a dental: laboratorio e insumos (PAN-08)", () => {
    expect(bloquesDelPanel(sujeto("lab_technician"))).toEqual(["laboratorio", "insumos"]);
  });

  it("un ajuste que quita la agenda a recepción saca las reservas", () => {
    const s = {
      role: "reception" as const,
      permissions: permisosEfectivos("reception", [
        { permission: "agenda:manage", effect: "revoke" },
      ]),
    };
    expect(bloquesDelPanel(s)).not.toContain("reservas-en-linea");
    expect(alertasDelSujeto(s)).not.toContain("reservas_por_aceptar");
  });
});

describe("recepción no ve dinero", () => {
  it("ningún bloque muestra montos sin finance:view", () => {
    for (const rol of ["reception", "dentist", "assistant", "lab_technician"] as const) {
      for (const b of bloquesDelPanel(sujeto(rol))) {
        expect(bloqueMuestraDinero(sujeto(rol), b), `${rol}/${b}`).toBe(false);
      }
    }
    expect(bloqueMuestraDinero(sujeto("owner"), "caja")).toBe(true);
    expect(bloqueMuestraDinero(sujeto("coordinator"), "cobros")).toBe(true);
  });

  it("las alertas de dinero solo las ve quien tiene finance:view", () => {
    for (const t of ALERTAS_DE_DINERO) expect(ALERTAS[t].permiso).toBe("finance:view");
    const recepcion = alertasDelSujeto(sujeto("reception"));
    for (const t of ALERTAS_DE_DINERO) expect(recepcion).not.toContain(t);
    expect(alertasDelSujeto(sujeto("owner"))).toEqual(
      expect.arrayContaining([...ALERTAS_DE_DINERO]),
    );
  });
});

describe("alertas por rol (PAN-03)", () => {
  it("cada alerta tiene destino y una acción", () => {
    for (const t of TIPOS_DE_ALERTA) {
      const a = ALERTAS[t];
      expect(a.enlace.startsWith("/") || a.enlace.startsWith("#"), t).toBe(true);
      expect(a.cta.length, t).toBeGreaterThan(0);
      expect(a.titulo(1).startsWith("1 "), t).toBe(true);
    }
  });

  it("el técnico/a ve laboratorio e insumos; no la agenda ni la caja", () => {
    expect(alertasDelSujeto(sujeto("lab_technician"))).toEqual([
      "laboratorio_atrasado",
      "stock_bajo",
    ]);
  });

  it("el profesional ve sus pendientes clínicos y no los de caja", () => {
    const a = alertasDelSujeto(sujeto("dentist"));
    expect(a).toEqual(
      expect.arrayContaining(["notas_sin_firmar", "revisiones_pedidas", "laboratorio_atrasado"]),
    );
    expect(a).not.toContain("cajas_sin_cerrar");
    expect(a).not.toContain("reservas_por_aceptar");
  });

  it("recepción ve confirmaciones, reservas, controles y caja sin cerrar", () => {
    expect(alertasDelSujeto(sujeto("reception"))).toEqual(
      expect.arrayContaining([
        "cajas_sin_cerrar",
        "reservas_por_aceptar",
        "citas_por_confirmar",
        "controles_vencidos",
      ]),
    );
  });

  it("muestra solo lo que tiene algo, lo urgente primero y nunca un conteo inventado", () => {
    const lista = alertasVisibles(sujeto("owner"), {
      citas_por_confirmar: 3,
      stock_bajo: 1,
      cajas_sin_cerrar: 1,
      controles_vencidos: 0,
      reservas_por_aceptar: 2,
      cuotas_vencidas: null,
      saldo_pacientes_hoy: undefined,
    });
    expect(lista.map((a) => a.tipo)).toEqual([
      "reservas_por_aceptar",
      "cajas_sin_cerrar",
      "citas_por_confirmar",
      "stock_bajo",
    ]);
    expect(lista[0].titulo).toBe("2 reservas en línea por aceptar");
  });

  it("un bloque que el rol no tiene en pantalla lleva al respaldo (reservas → agenda)", () => {
    const [dueno] = alertasVisibles(sujeto("owner"), { reservas_por_aceptar: 1 });
    expect(dueno.enlace).toBe("/agenda");
    expect(dueno.busqueda).toMatchObject({ estado: "tentativa" });
    const [recepcion] = alertasVisibles(sujeto("reception"), { reservas_por_aceptar: 1 });
    expect(recepcion.enlace).toBe("#reservas-en-linea");
    // Notas sin firmar sin el bloque y sin respaldo: no se ofrece un enlace roto.
    expect(alertasVisibles(sujeto("dentist"), { notas_sin_firmar: 2 }, [])).toEqual([]);
  });

  it("descarta lo que el rol no puede ver aunque venga en los conteos", () => {
    const lista = alertasVisibles(sujeto("reception"), { cuotas_vencidas: 4, stock_bajo: 2 });
    expect(lista).toEqual([]);
  });
});

describe("respuesta de panel_de_hoy", () => {
  it("las secciones que no vienen quedan en null (regla 11)", () => {
    const p = mapearPanelDeHoy({ hoy: "2026-10-27", alertas: { stock_bajo: 2 } });
    expect(p.alertas).toEqual({ stock_bajo: 2 });
    expect(p.presupuestos).toBeNull();
    expect(p.reservas).toBeNull();
    expect(p.laboratorio).toBeNull();
  });

  it("normaliza laboratorio, presupuestos y stock", () => {
    const p = mapearPanelDeHoy({
      hoy: "2026-10-27",
      alertas: {},
      laboratorio: {
        atrasadas: 1,
        en_curso: 2,
        por_recibir_semana: 1,
        ordenes: [
          {
            id: "o1",
            paciente_id: "p1",
            descripcion: "Corona",
            estado: "enviado",
            vence: "2026-10-20",
            atrasada: true,
          },
        ],
      },
      presupuestos: {
        abiertos: 1,
        abiertos_cents: 1000,
        por_vencer: 0,
        aceptados_mes: 0,
        aceptados_mes_cents: 0,
      },
      stock_bajo: [{ id: "i1", nombre: "Guantes", unidad: "cajas", actual: "2", minimo: 5 }],
    });
    expect(p.laboratorio?.ordenes[0]).toMatchObject({ id: "o1", atrasada: true, paciente: null });
    expect(p.presupuestos?.abiertosCents).toBe(1000);
    expect(p.stockBajo?.[0]).toMatchObject({ actual: 2, minimo: 5 });
  });
});

describe("centro de notificaciones (NAV-11)", () => {
  it("agrupa los tipos y lo desconocido va a Operación", () => {
    expect(grupoDeNotificacion("review_requested")).toBe("clinico");
    expect(grupoDeNotificacion("inbound_message")).toBe("pacientes");
    expect(grupoDeNotificacion("stock_low")).toBe("operacion");
    expect(grupoDeNotificacion("algo_nuevo")).toBe("operacion");
    expect(kindsFueraDe("operacion")).not.toContain("stock_low");
    expect(kindsFueraDe("operacion")).toContain("review_requested");
  });

  it("solo navega a rutas internas", () => {
    expect(destinoDeNotificacion({ patientRef: "p1", link: null })).toEqual({
      tipo: "paciente",
      pacienteId: "p1",
    });
    expect(destinoDeNotificacion({ patientRef: null, link: "/inventario?insumo=1" })).toEqual({
      tipo: "ruta",
      href: "/inventario?insumo=1",
    });
    expect(destinoDeNotificacion({ patientRef: null, link: "https://malo.example" })).toBeNull();
    expect(destinoDeNotificacion({ patientRef: null, link: "//malo.example" })).toBeNull();
    expect(destinoDeNotificacion({ patientRef: null, link: null })).toBeNull();
  });
});
