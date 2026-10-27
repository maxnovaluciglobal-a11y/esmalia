// Navegación por destinos (rediseño, fase 3; Ola 0). Lógica pura: no toca Postgres.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLINIC_ROLES,
  hasPermission,
  permisosEfectivos,
  permissionsForRole,
  type Permission,
} from "@/lib/access/access";
import {
  AJUSTES,
  AJUSTES_SOLO_DUENO,
  DESTINOS,
  GRUPOS_NAV,
  RUTAS_FUERA_DEL_MENU,
  ajustesVisibles,
  coincideTermino,
  destinoDeRuta,
  destinoDeHub,
  destinosVisibles,
  esRutaDeAjustes,
  esSubpaginaDeAjustes,
  filtrarAjustes,
  gruposVisibles,
  idDeGrupoAjustes,
  migasDeAjustes,
  puedeVer,
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
  it("ningún rol ve más de 9 entradas (8 destinos en 3 grupos + Ajustes)", () => {
    for (const rol of CLINIC_ROLES) {
      expect(destinosVisibles(rol).length + 1).toBeLessThanOrEqual(9);
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
    expect(destinoDeRuta("/presupuestos/paquetes", ds)?.id).toBe("caja");
    expect(destinoDeRuta("/finanzas", ds)?.id).toBe("finanzas");
    expect(destinoDeRuta("/notificaciones", ds)?.id).toBe("hoy");
    expect(destinoDeRuta("/reportes", ds)?.id).toBe("reportes");
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

// ─── Ola 12 · NAV-01: menú final por grupos ─────────────────────────────────
describe("menú final por grupos (Ola 12, NAV-01)", () => {
  const rutasMenu = new Set(todas.map((p) => p.to));
  const pestanasDe = (s: Parameters<typeof destinosVisibles>[0]) =>
    destinosVisibles(s).flatMap((d) => d.pestanas.map((p) => p.to));
  const ajustesDe = (s: Parameters<typeof ajustesVisibles>[0]) =>
    ajustesVisibles(s).flatMap((g) => g.items.map((i) => i.to));
  const visiblesDe = (s: Parameters<typeof destinosVisibles>[0]) => [
    ...pestanasDe(s),
    ...ajustesDe(s),
  ];

  /** `pacientes.$pacienteId.tsx` → `/pacientes/$pacienteId`; `x.index.tsx` → `/x`. */
  function rutasDelArbol(): string[] {
    return readdirSync(DIR)
      .filter((f) => f.endsWith(".tsx") && f !== "route.tsx")
      .map(
        (f) =>
          `/${f
            .replace(/\.tsx$/, "")
            .replace(/\.index$/, "")
            .replace(/\./g, "/")}`,
      );
  }

  it("toda pantalla del árbol está en el menú o justificada fuera", () => {
    for (const ruta of rutasDelArbol()) {
      const justificada = ruta in RUTAS_FUERA_DEL_MENU;
      expect(rutasMenu.has(ruta) || justificada, ruta).toBe(true);
    }
  });

  it("lo justificado fuera existe y no está además en el menú", () => {
    const arbol = new Set(rutasDelArbol());
    for (const ruta of Object.keys(RUTAS_FUERA_DEL_MENU)) {
      expect(arbol.has(ruta), ruta).toBe(true);
      expect(rutasMenu.has(ruta), ruta).toBe(false);
      expect(RUTAS_FUERA_DEL_MENU[ruta].length).toBeGreaterThan(10);
    }
  });

  it("cada pantalla está en un solo lugar del menú", () => {
    const vistas = new Map<string, number>();
    for (const p of [...DESTINOS.flatMap((d) => d.pestanas), ...AJUSTES.flatMap((g) => g.items)]) {
      vistas.set(p.to, (vistas.get(p.to) ?? 0) + 1);
    }
    for (const [ruta, veces] of vistas) expect(veces, ruta).toBe(1);
  });

  it("tres grupos en orden, cada destino en uno y sin grupos vacíos para el dueño", () => {
    expect(GRUPOS_NAV.map((g) => g.titulo)).toEqual(["Día a día", "Clínica", "Gestión"]);
    const owner = gruposVisibles(destinosVisibles("owner"));
    expect(owner.map((g) => g.destinos.map((d) => d.id))).toEqual([
      ["hoy", "agenda", "mensajes", "caja"],
      ["pacientes", "operacion"],
      ["finanzas", "reportes"],
    ]);
  });

  it("ubica las pantallas nuevas de las olas 7-11 donde corresponde", () => {
    const destinoDe = (to: string) => DESTINOS.find((d) => d.pestanas.some((p) => p.to === to))?.id;
    const grupoAjustes = (to: string) =>
      AJUSTES.find((g) => g.items.some((i) => i.to === to))?.titulo;
    expect(destinoDe("/notificaciones")).toBe("hoy");
    expect(destinoDe("/seguimiento")).toBe("mensajes");
    expect(destinoDe("/campanas")).toBe("mensajes");
    expect(destinoDe("/membresias")).toBe("caja");
    expect(destinoDe("/implantes")).toBe("pacientes");
    expect(destinoDe("/ortodoncia")).toBe("pacientes");
    expect(destinoDe("/laboratorios")).toBe("operacion");
    expect(destinoDe("/finanzas")).toBe("finanzas");
    expect(destinoDe("/gastos-fijos")).toBe("finanzas");
    expect(destinoDe("/comisiones")).toBe("finanzas");
    expect(destinoDe("/informes")).toBe("reportes");
    expect(destinoDe("/mi-desempeno")).toBe("reportes");
    expect(grupoAjustes("/reserva-en-linea")).toBe("Agenda y reservas");
    expect(grupoAjustes("/notificaciones-a-pacientes")).toBe("Mensajes a pacientes");
    expect(grupoAjustes("/plantillas-de-mensajes")).toBe("Mensajes a pacientes");
    expect(grupoAjustes("/protocolos-clinicos")).toBe("Atención clínica");
    expect(grupoAjustes("/empresas-con-convenio")).toBe("Precios y cobro");
    expect(grupoAjustes("/permisos")).toBe("Equipo y seguridad");
  });

  it("qué ve cada rol (sin pestañas que rebotan)", () => {
    // Recepción: mostrador, sin finanzas ni configuración.
    expect(pestanasDe("reception")).toEqual(
      expect.arrayContaining([
        "/dashboard",
        "/agenda",
        "/conversaciones",
        "/cajas",
        "/membresias",
        "/pacientes",
      ]),
    );
    for (const ruta of ["/finanzas", "/presupuestos", "/campanas", "/implantes"]) {
      expect(pestanasDe("reception"), ruta).not.toContain(ruta);
    }
    // Doctor/a: su comisión y su desempeño, nunca la vista de finanzas.
    expect(pestanasDe("dentist")).toEqual(
      expect.arrayContaining(["/comisiones", "/mi-desempeno", "/implantes", "/ortodoncia"]),
    );
    expect(pestanasDe("dentist")).not.toContain("/finanzas");
    expect(pestanasDe("dentist")).not.toContain("/cajas");
    // Contabilidad: plata, sin agenda ni historia clínica.
    expect(pestanasDe("accounting")).toEqual(
      expect.arrayContaining(["/finanzas", "/presupuestos", "/gastos", "/cajas"]),
    );
    for (const ruta of ["/agenda", "/implantes", "/ortodoncia", "/conversaciones"]) {
      expect(pestanasDe("accounting"), ruta).not.toContain(ruta);
    }
    // Técnico/a dental: laboratorio e inventario, nada de dinero ni ficha clínica.
    expect(pestanasDe("lab_technician")).toEqual(
      expect.arrayContaining(["/laboratorios", "/inventario", "/agenda"]),
    );
    for (const ruta of ["/cajas", "/finanzas", "/comisiones", "/implantes"]) {
      expect(pestanasDe("lab_technician"), ruta).not.toContain(ruta);
    }
    // Coordinación: operación y finanzas, sin historia clínica ni ajustes de la clínica.
    expect(pestanasDe("coordinator")).toEqual(
      expect.arrayContaining(["/finanzas", "/cajas", "/seguimiento"]),
    );
    expect(pestanasDe("coordinator")).not.toContain("/implantes");
    expect(ajustesDe("coordinator")).not.toContain("/datos-de-la-clinica");
    // Asistente: sin pagos.
    expect(pestanasDe("assistant")).not.toContain("/cajas");
  });

  it("ningún ítem visible (destinos ni Ajustes) termina en /sin-acceso, para ningún rol", () => {
    for (const rol of CLINIC_ROLES) {
      for (const d of destinosVisibles(rol)) {
        for (const p of d.pestanas) expect(puedeVer(rol, p), `${rol} ${p.to}`).toBe(true);
      }
      for (const g of ajustesVisibles(rol)) {
        for (const i of g.items) {
          expect(
            i.permisos.some((perm) => hasPermission(rol, perm)),
            `${rol} ${i.to}`,
          ).toBe(true);
        }
      }
    }
  });

  it("respeta los ajustes por persona (EQU-01): quitar o dar un permiso cambia el menú", () => {
    // Ajustes admitidos de verdad (`permisosEfectivos` descarta los que no).
    // Recepción sin gestionar la agenda: desaparece Mensajes entero
    // (Conversaciones, Recordatorios y Seguimiento piden agenda:manage).
    const recepcionSinAgenda = {
      role: "reception" as const,
      permissions: permisosEfectivos("reception", [
        { permission: "agenda:manage", effect: "revoke" },
      ]),
    };
    expect(pestanasDe(recepcionSinAgenda)).not.toContain("/conversaciones");
    expect(destinosVisibles(recepcionSinAgenda).map((d) => d.id)).not.toContain("mensajes");
    expect(pestanasDe(recepcionSinAgenda)).toContain("/agenda");
    // Doctor/a sin historia clínica: sin Implantes, Ortodoncia ni Protocolos.
    const doctorSinClinica = {
      role: "dentist" as const,
      permissions: permisosEfectivos("dentist", [
        { permission: "clinical:view", effect: "revoke" },
      ]),
    };
    for (const ruta of ["/implantes", "/ortodoncia", "/protocolos-clinicos"]) {
      expect(visiblesDe(doctorSinClinica), ruta).not.toContain(ruta);
    }
    expect(visiblesDe(doctorSinClinica)).toContain("/pacientes");
    // Contabilidad a la que se le dio ver la agenda: aparece Agenda.
    const contabilidadConAgenda = {
      role: "accounting" as const,
      permissions: permisosEfectivos("accounting", [
        { permission: "agenda:view", effect: "grant" },
      ]),
    };
    expect(pestanasDe("accounting")).not.toContain("/agenda");
    expect(pestanasDe(contabilidadConAgenda)).toContain("/agenda");
    // Un ajuste que la base no admite no cambia nada (caja se define por rol).
    const intentoSinCaja = {
      role: "reception" as const,
      permissions: permisosEfectivos("reception", [
        { permission: "cash:manage", effect: "revoke" },
      ]),
    };
    expect(pestanasDe(intentoSinCaja)).toContain("/cajas");
    // Admin sin gestionar el equipo (lista de permisos efectivos a mano):
    // sin Permisos ni WhatsApp, con Equipo.
    const adminSinEquipo = {
      role: "admin" as const,
      permissions: permissionsForRole("admin").filter((p) => p !== "team:manage"),
    };
    expect(visiblesDe(adminSinEquipo)).not.toContain("/permisos");
    expect(visiblesDe(adminSinEquipo)).not.toContain("/whatsapp");
    expect(visiblesDe(adminSinEquipo)).toContain("/equipo");
  });

  it("los hubs viejos redirigen a la primera pestaña que se puede abrir", () => {
    expect(destinoDeHub("owner", "reportes")).toBe("/informes");
    expect(destinoDeHub("owner", "mensajes")).toBe("/conversaciones");
    expect(destinoDeHub("accounting", "reportes")).toBe("/informes");
    expect(destinoDeHub("accounting", "mensajes")).toBe("/sin-acceso");
    expect(destinoDeHub(null, "reportes")).toBe("/sin-acceso");
    for (const hub of ["mensajes", "reportes"]) {
      const src = readFileSync(`${DIR}/${hub}.tsx`, "utf8");
      expect(src, hub).toContain(`destinoDeHub(context.access, "${hub}")`);
    }
    // /caja (sin s) sigue redirigiendo a /cajas.
    expect(readFileSync("src/routes/caja.tsx", "utf8")).toContain('redirect({ to: "/cajas"');
  });

  it("migas de Ajustes: Ajustes › tema › página, con ancla al grupo", () => {
    expect(migasDeAjustes("/sucursales")).toEqual({
      grupo: "Clínica",
      ancla: "ajustes-clinica",
      pagina: "Sucursales",
    });
    expect(migasDeAjustes("/reserva-en-linea")?.ancla).toBe("ajustes-agenda-y-reservas");
    expect(migasDeAjustes("/ajustes")).toBeNull();
    expect(migasDeAjustes("/agenda")).toBeNull();
    for (const g of AJUSTES) expect(idDeGrupoAjustes(g.titulo)).toMatch(/^ajustes-[a-z0-9-]+$/);
  });

  it("el shell, el menú del celular y ⌘K salen de la misma estructura", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(shell).toContain("gruposVisibles(destinos)");
    expect(shell).toContain("gruposVisibles(resto)");
    const buscador = readFileSync("src/components/global-search.tsx", "utf8");
    expect(buscador).toContain("destinosVisibles(access)");
    expect(buscador).toContain("ajustesVisibles(access)");
  });
});
