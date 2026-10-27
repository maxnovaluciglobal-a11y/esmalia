// Ola 10 · frente C · EQU-01/02/03: matriz con ajustes por persona, roles
// nuevos y profesión. Lógica pura: no toca Postgres (el espejo SQL se prueba
// en permisos-por-persona-db.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AJUSTES_POR_PERMISO,
  CLINIC_ROLES,
  PERMISOS_CLINICOS,
  PERMISOS_DE_PAGOS,
  PERMISSIONS,
  PROFESIONES,
  PROFESION_LABELS,
  PROFESION_SUGERIDA,
  ROLES_CON_HISTORIA_CLINICA,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ajusteAdmitido,
  ajustesDesdeFilas,
  ajustesVigentes,
  etiquetaProfesion,
  hasPermission,
  motivoSinAjuste,
  permisosEfectivos,
  permissionsForRole,
  type AjustePermiso,
  type ClinicRole,
} from "@/lib/access/access";

const SIN_HISTORIA: ClinicRole[] = CLINIC_ROLES.filter(
  (r) => !ROLES_CON_HISTORIA_CLINICA.includes(r),
);

/** Todos los "dar" posibles: el peor caso para la regla 2. */
const TODO_DADO: AjustePermiso[] = PERMISSIONS.map((p) => ({ permission: p, effect: "grant" }));

describe("EQU-02 · roles nuevos", () => {
  it("coordinación y técnico/a dental están en la matriz con nombre y descripción", () => {
    for (const r of ["coordinator", "lab_technician"] as const) {
      expect(CLINIC_ROLES).toContain(r);
      expect(ROLE_LABELS[r]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[r]).toBeTruthy();
      expect(ROLE_LABELS[r]).not.toMatch(/_/);
    }
  });

  it("coordinación = recepción ∪ contabilidad (lo que le abre has_clinic_role)", () => {
    const union = new Set([
      ...permissionsForRole("reception"),
      ...permissionsForRole("accounting"),
    ]);
    expect(new Set(permissionsForRole("coordinator"))).toEqual(union);
  });

  it("ningún rol nuevo trae historia clínica ni gestión del equipo", () => {
    for (const r of ["coordinator", "lab_technician"] as const) {
      for (const p of [...PERMISOS_CLINICOS, "team:manage", "settings:manage"] as const) {
        expect(hasPermission(r, p), `${r} ${p}`).toBe(false);
      }
    }
  });

  it("técnico/a dental no maneja pagos", () => {
    for (const p of PERMISOS_DE_PAGOS) expect(hasPermission("lab_technician", p)).toBe(false);
  });

  it("los seis roles de siempre no cambian", () => {
    expect(permissionsForRole("owner")).toEqual([...PERMISSIONS]);
    expect(permissionsForRole("admin")).toEqual([...PERMISSIONS]);
    expect(permissionsForRole("assistant")).toEqual([
      "dashboard:view",
      "agenda:view",
      "patients:view",
      "treatments:view",
      "inventory:view",
    ]);
    expect(permissionsForRole("reception")).not.toContain("clinical:view");
    expect(permissionsForRole("accounting")).not.toContain("clinical:view");
  });
});

describe("EQU-01 · regla 2 con ajustes por persona", () => {
  it("ningún ajuste abre historia clínica a quien la regla 2 no la permite", () => {
    for (const r of SIN_HISTORIA) {
      for (const p of PERMISOS_CLINICOS) {
        expect(ajusteAdmitido(r, p, "grant"), `${r} ${p}`).toBe(false);
      }
      const efectivos = permisosEfectivos(r, TODO_DADO);
      for (const p of PERMISOS_CLINICOS) expect(efectivos, r).not.toContain(p);
    }
  });

  it("ningún ajuste le da pagos a asistente dental", () => {
    for (const p of PERMISOS_DE_PAGOS) expect(ajusteAdmitido("assistant", p, "grant")).toBe(false);
    const efectivos = permisosEfectivos("assistant", TODO_DADO);
    for (const p of PERMISOS_DE_PAGOS) expect(efectivos).not.toContain(p);
  });

  it("al propietario no se le ajusta nada", () => {
    for (const p of PERMISSIONS) {
      expect(ajusteAdmitido("owner", p, "grant")).toBe(false);
      expect(ajusteAdmitido("owner", p, "revoke")).toBe(false);
      expect(motivoSinAjuste("owner", p)).toBeTruthy();
    }
    expect(permisosEfectivos("owner", [{ permission: "clinical:view", effect: "revoke" }])).toEqual(
      [...PERMISSIONS],
    );
  });

  it("el catálogo es coherente: se da lo que el rol no trae y se quita lo que trae", () => {
    for (const p of PERMISSIONS) {
      const regla = AJUSTES_POR_PERMISO[p];
      if ("motivo" in regla) continue;
      for (const r of regla.otorgable) expect(hasPermission(r, p), `dar ${p} a ${r}`).toBe(false);
      for (const r of regla.revocable) expect(hasPermission(r, p), `quitar ${p} a ${r}`).toBe(true);
    }
  });

  it("cada combinación tiene un motivo exactamente cuando no se admite", () => {
    for (const r of CLINIC_ROLES) {
      for (const p of PERMISSIONS) {
        const efecto = hasPermission(r, p) ? "revoke" : "grant";
        const admitido = ajusteAdmitido(r, p, efecto);
        const motivo = motivoSinAjuste(r, p);
        expect(admitido ? motivo : !!motivo, `${r} ${p}`).toBe(admitido ? null : true);
        // El motivo nunca muestra la clave técnica (UX-06).
        if (motivo) expect(motivo).not.toMatch(/[a-z]+:[a-z]/);
      }
    }
  });

  it("dar historia clínica a asistente la abre; escribir exige ver", () => {
    expect(
      permisosEfectivos("assistant", [{ permission: "clinical:write", effect: "grant" }]),
    ).not.toContain("clinical:write");
    const ambos = permisosEfectivos("assistant", [
      { permission: "clinical:view", effect: "grant" },
      { permission: "clinical:write", effect: "grant" },
    ]);
    expect(ambos).toContain("clinical:view");
    expect(ambos).toContain("clinical:write");
  });

  it("quitar ver historia a un profesional también le quita escribir", () => {
    const e = permisosEfectivos("dentist", [{ permission: "clinical:view", effect: "revoke" }]);
    expect(e).not.toContain("clinical:view");
    expect(e).not.toContain("clinical:write");
    expect(e).toContain("agenda:manage");
  });

  it("quitar agendar o editar pacientes a recepción", () => {
    const e = permisosEfectivos("reception", [
      { permission: "agenda:manage", effect: "revoke" },
      { permission: "patients:manage", effect: "revoke" },
    ]);
    expect(e).not.toContain("agenda:manage");
    expect(e).not.toContain("patients:manage");
    expect(e).toContain("cash:manage");
  });

  it("los ajustes que no corresponden al rol (p. ej. tras un cambio de rol) se ignoran", () => {
    const deAsistente: AjustePermiso[] = [{ permission: "clinical:view", effect: "grant" }];
    expect(ajustesVigentes("reception", deAsistente)).toEqual([]);
    expect(new Set(permisosEfectivos("reception", deAsistente))).toEqual(
      new Set(permissionsForRole("reception")),
    );
  });

  it("finanzas, caja y comisiones no se ajustan por persona (se integran con los frentes A y B)", () => {
    for (const p of [
      "finance:view",
      "cash:manage",
      "payments:reverse",
      "commission:view-own",
    ] as const) {
      for (const r of CLINIC_ROLES) {
        expect(ajusteAdmitido(r, p, "grant")).toBe(false);
        expect(ajusteAdmitido(r, p, "revoke")).toBe(false);
      }
    }
  });

  it("ajustesDesdeFilas descarta permisos y efectos desconocidos", () => {
    expect(
      ajustesDesdeFilas([
        { permission: "clinical:view", effect: "grant" },
        { permission: "inventado:ver", effect: "grant" },
        { permission: "agenda:manage", effect: "quizas" },
      ]),
    ).toEqual([{ permission: "clinical:view", effect: "grant" }]);
  });
});

describe("hasPermission con el acceso del usuario", () => {
  it("usa los permisos efectivos cuando vienen", () => {
    const acceso = {
      role: "dentist" as const,
      permissions: permisosEfectivos("dentist", [
        { permission: "clinical:view", effect: "revoke" },
      ]),
    };
    expect(hasPermission(acceso, "clinical:view")).toBe(false);
    expect(hasPermission("dentist", "clinical:view")).toBe(true);
  });

  it("sin permisos efectivos, cae al rol", () => {
    expect(hasPermission({ role: "reception" }, "agenda:manage")).toBe(true);
    expect(hasPermission({ role: null }, "agenda:manage")).toBe(false);
    expect(hasPermission(null, "agenda:manage")).toBe(false);
  });
});

describe("EQU-03 · profesión", () => {
  it("cada profesión tiene etiqueta legible y la sugerida por rol existe", () => {
    for (const p of PROFESIONES) {
      expect(PROFESION_LABELS[p]).toBeTruthy();
      expect(etiquetaProfesion(p)).toBe(PROFESION_LABELS[p]);
    }
    for (const r of CLINIC_ROLES) {
      const s = PROFESION_SUGERIDA[r];
      if (s) expect(PROFESIONES).toContain(s);
    }
    expect(etiquetaProfesion(null)).toBeNull();
    expect(etiquetaProfesion("inventada")).toBeNull();
  });

  it("la lista coincide con el check de la base", () => {
    const sql = readFileSync(
      "supabase/migrations/20261106300200_permisos_por_persona_y_profesion.sql",
      "utf8",
    );
    const bloque = sql.slice(
      sql.indexOf("add constraint clinic_members_profession_check"),
      sql.indexOf("comment on column public.clinic_members.profession"),
    );
    const enSql = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(enSql.sort()).toEqual([...PROFESIONES].sort());
  });
});

describe("pantallas", () => {
  it("Equipo y la matriz muestran etiquetas, no claves técnicas", () => {
    const dialogo = readFileSync("src/components/equipo/ajustes-de-permisos.tsx", "utf8");
    expect(dialogo).toContain("PERMISSION_LABELS[p]");
    expect(dialogo).not.toMatch(/>\s*\{p\}\s*</);
  });
});
