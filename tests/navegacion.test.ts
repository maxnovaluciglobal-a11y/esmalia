// Navegación por destinos (rediseño, fase 3; Ola 0). Lógica pura: no toca Postgres.
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CLINIC_ROLES, hasPermission, type Permission } from "@/lib/access/access";
import {
  AJUSTES,
  AJUSTES_SOLO_DUENO,
  DESTINOS,
  ajustesVisibles,
  coincideTermino,
  destinoDeRuta,
  destinosVisibles,
  esRutaDeAjustes,
  esSubpaginaDeAjustes,
  filtrarAjustes,
} from "@/lib/access/navegacion";
import { limpiarTerminoDeBusqueda } from "@/lib/patients/buscar-pacientes.functions";

const DIR = "src/routes/_authenticated/_clinic";
const todas = [
  ...DESTINOS.flatMap((d) => d.pestanas),
  ...AJUSTES.flatMap((g) => g.items),
  ...AJUSTES_SOLO_DUENO,
];

function archivoDeRuta(to: string) {
  const base = to.replace(/^\//, "");
  const candidatos = [
    `${DIR}/${base}.tsx`,
    `${DIR}/${base}.index.tsx`,
    `src/routes/_authenticated/${base}.tsx`,
  ];
  return candidatos.find((c) => existsSync(c)) ?? null;
}

/** Permisos que exige el `beforeLoad` de la ruta, o null si no tiene guard. */
function permisosDelGuard(archivo: string): Permission[] | null {
  const src = readFileSync(archivo, "utf8");
  const m = src.match(/beforeLoad:\s*require(?:Any)?Permission\(([^)]*)\)/);
  if (!m) return null;
  return [...m[1].matchAll(/"([a-z:-]+)"/g)].map((x) => x[1] as Permission);
}

describe("navegación por destinos", () => {
  it("ningún rol ve más de 8 entradas (7 destinos + Ajustes)", () => {
    for (const rol of CLINIC_ROLES) {
      expect(destinosVisibles(rol).length + 1).toBeLessThanOrEqual(8);
    }
  });

  it("cada pestaña apunta a una ruta que existe", () => {
    for (const p of todas) expect(archivoDeRuta(p.to), p.to).not.toBeNull();
  });

  it("cada pestaña pide los mismos permisos que el beforeLoad de su ruta", () => {
    for (const p of todas) {
      const guard = permisosDelGuard(archivoDeRuta(p.to)!);
      if (guard === null) continue; // ruta sin guard propio (ej. /suscripcion)
      expect([...p.permisos].sort(), p.to).toEqual([...guard].sort());
    }
  });

  it("nunca ofrece una pestaña que termine en /sin-acceso", () => {
    for (const rol of CLINIC_ROLES) {
      for (const d of destinosVisibles(rol)) {
        for (const p of d.pestanas) {
          expect(
            p.permisos.some((perm) => hasPermission(rol, perm)),
            `${rol} ${p.to}`,
          ).toBe(true);
        }
      }
    }
  });

  it("las herramientas de email son solo del dueño", () => {
    const rutas = (rol: (typeof CLINIC_ROLES)[number]) =>
      ajustesVisibles(rol).flatMap((g) => g.items.map((i) => i.to));
    expect(rutas("owner")).toContain("/dominio-email");
    expect(rutas("admin")).not.toContain("/dominio-email");
  });

  it("ubica cada ruta en su destino, incluidas las de detalle", () => {
    const ds = destinosVisibles("owner");
    expect(destinoDeRuta("/pacientes/abc", ds)?.id).toBe("pacientes");
    expect(destinoDeRuta("/mi-agenda", ds)?.id).toBe("agenda");
    expect(destinoDeRuta("/recordatorios", ds)?.id).toBe("mensajes");
    expect(destinoDeRuta("/equipo", ds)).toBeNull();
    expect(destinoDeRuta("/presupuestos", ds)?.id).toBe("caja");
    expect(destinoDeRuta("/inventario", ds)?.id).toBe("operacion");
    expect(destinoDeRuta("/laboratorios", ds)?.id).toBe("operacion");
  });
});

describe("arquitectura de información (Ola 0, UX-13)", () => {
  const rutasDe = (id: string) => DESTINOS.find((d) => d.id === id)!.pestanas.map((p) => p.to);
  const rutasDeAjustes = (rol: (typeof CLINIC_ROLES)[number]) =>
    ajustesVisibles(rol).flatMap((g) => g.items.map((i) => i.to));

  it("Presupuestos es pestaña de Caja y solo la ve quien tiene finance:view", () => {
    expect(rutasDe("caja")).toContain("/presupuestos");
    const pestana = DESTINOS.flatMap((d) => d.pestanas).find((p) => p.to === "/presupuestos")!;
    expect(pestana.permisos).toEqual(["finance:view"]);
    expect(destinosVisibles("reception").flatMap((d) => d.pestanas.map((p) => p.to))).not.toContain(
      "/presupuestos",
    );
    expect(destinosVisibles("accounting").flatMap((d) => d.pestanas.map((p) => p.to))).toContain(
      "/presupuestos",
    );
  });

  it("Inventario y Laboratorios viven en Operación, no en Reportes ni Pacientes", () => {
    expect(rutasDe("operacion")).toEqual(["/inventario", "/laboratorios"]);
    expect(rutasDe("reportes")).not.toContain("/inventario");
    expect(rutasDe("pacientes")).not.toContain("/laboratorios");
  });

  it("Medios de pago y WhatsApp se configuran solo en Ajustes", () => {
    const enDestinos = DESTINOS.flatMap((d) => d.pestanas.map((p) => p.to));
    expect(enDestinos).not.toContain("/medios-de-pago");
    expect(enDestinos).not.toContain("/whatsapp");
    expect(rutasDeAjustes("owner")).toEqual(
      expect.arrayContaining(["/medios-de-pago", "/whatsapp"]),
    );
    expect(esRutaDeAjustes("/medios-de-pago")).toBe(true);
    expect(esRutaDeAjustes("/whatsapp")).toBe(true);
  });

  it("Ajustes edita la clínica actual y ya no lleva al asistente que crea otra", () => {
    expect(rutasDeAjustes("owner")).toContain("/datos-de-la-clinica");
    expect(rutasDeAjustes("owner")).not.toContain("/onboarding");
    expect(rutasDeAjustes("reception")).not.toContain("/datos-de-la-clinica");
  });

  it("Pruebas y Modo prueba de email: solo el propietario, en la UI y en el servidor", () => {
    for (const rol of CLINIC_ROLES) {
      const visibles = rutasDeAjustes(rol);
      const esperado = rol === "owner";
      expect(visibles.includes("/pruebas-email"), rol).toBe(esperado);
      expect(visibles.includes("/sandbox-email"), rol).toBe(esperado);
    }
    for (const archivo of ["pruebas-email", "sandbox-email"]) {
      const src = readFileSync(`${DIR}/${archivo}.tsx`, "utf8");
      expect(src, archivo).toContain("beforeLoad: requireOwner()");
    }
    const servidor = readFileSync("src/lib/messaging/email-config.functions.ts", "utf8");
    expect(servidor.match(/requireClinicRole\(/g)?.length).toBe(2);
    expect(servidor).toContain('["owner"]');
  });

  it("sin anglicismos en las etiquetas visibles", () => {
    const etiquetas = todas.map((p) => p.label.toLowerCase());
    for (const palabra of ["compliance", "sandbox", "dashboard", "recall"]) {
      expect(
        etiquetas.some((e) => e.includes(palabra)),
        palabra,
      ).toBe(false);
    }
  });

  it("el título de cada página de Ajustes coincide con su nombre en el menú", () => {
    for (const item of AJUSTES.flatMap((g) => g.items)) {
      const archivo = archivoDeRuta(item.to);
      if (!archivo) continue;
      const src = readFileSync(archivo, "utf8");
      const titulo = src.match(/<AppShell[^>]*title="([^"]+)"/)?.[1];
      if (!titulo) continue; // título armado en el render
      expect(titulo, item.to).toBe(item.label);
    }
  });

  it("toda sub-página de Ajustes lleva la vuelta al índice", () => {
    expect(esSubpaginaDeAjustes("/ajustes")).toBe(false);
    expect(esSubpaginaDeAjustes("/equipo")).toBe(true);
    expect(esSubpaginaDeAjustes("/datos-de-la-clinica")).toBe(true);
    expect(esSubpaginaDeAjustes("/agenda")).toBe(false);
  });

  it("el filtro de Ajustes busca por nombre, detalle y sinónimo, sin tildes", () => {
    const grupos = ajustesVisibles("owner");
    const rutas = (t: string) => filtrarAjustes(grupos, t).flatMap((g) => g.items.map((i) => i.to));
    expect(rutas("whats")).toEqual(["/whatsapp"]);
    expect(rutas("compliance")).toEqual(["/compliance"]);
    expect(rutas("auditoria")).toContain("/compliance");
    expect(rutas("sucursal")).toContain("/sucursales");
    expect(rutas("")).toHaveLength(grupos.flatMap((g) => g.items).length);
    expect(rutas("zzz")).toEqual([]);
  });
});

describe("coincideTermino (⌘K y Ajustes)", () => {
  it("solo coincide desde el comienzo de una palabra", () => {
    expect(coincideTermino("isi", "Reportes · Comisiones")).toBe(false);
    expect(coincideTermino("isi", "Isidora Fuentes")).toBe(true);
    expect(coincideTermino("caja", "Abrir caja")).toBe(true);
    expect(coincideTermino("CONFIGURACION", "Configuración")).toBe(true);
    expect(coincideTermino("", "lo que sea")).toBe(true);
  });
});

describe("limpiarTerminoDeBusqueda", () => {
  it("no deja pasar separadores ni comodines del filtro de PostgREST", () => {
    expect(limpiarTerminoDeBusqueda("ana),id.eq.1")).toBe("ana id eq 1");
    expect(limpiarTerminoDeBusqueda("50%_*")).toBe("50");
    expect(limpiarTerminoDeBusqueda("  María   José ")).toBe("María José");
  });
});

describe("trialBannerVisible (franja de estado)", () => {
  it("no muestra nada mientras carga ni con suscripción activa", async () => {
    const { trialBannerVisible } = await import("@/lib/billing");
    expect(trialBannerVisible(undefined)).toBe(false);
    expect(trialBannerVisible(null)).toBe(true);
    const base = {
      clinicId: "c",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      trialEnd: null,
      currentPeriodEnd: new Date(Date.now() + 864e5).toISOString(),
      cancelAtPeriodEnd: false,
    };
    expect(trialBannerVisible({ ...base, status: "active" })).toBe(false);
    expect(trialBannerVisible({ ...base, status: "past_due" })).toBe(true);
  });
});
