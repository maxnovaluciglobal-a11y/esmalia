import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CLINIC_ROLES } from "../src/lib/access/access";
import {
  avisoDeTelefono,
  cambiosDeDatosBasicos,
  datosBasicosDe,
  EDITAR_PACIENTE_SCHEMA,
  errorDeFechaDeNacimiento,
  puedeEditarPaciente,
  validarDatosBasicos,
} from "../src/lib/patients/editar-paciente";

/**
 * "Editar datos" de la ficha (auditoría 20-oct-2026): no había forma de
 * corregir un teléfono mal cargado. Pruebas puras (sin base) del validador,
 * del diff que manda el diálogo, del aviso del teléfono y de quién puede
 * editar. El permiso y la RLS contra una base real están en
 * editar-paciente-db.test.ts.
 */

const raiz = path.resolve(__dirname, "..");
const leer = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

const CLINICA = "11111111-1111-4111-8111-111111111111";
const PACIENTE = "22222222-2222-4222-8222-222222222222";

describe("EDITAR_PACIENTE_SCHEMA (validador de updatePatient)", () => {
  const base = { clinicId: CLINICA, patientId: PACIENTE };

  it("acepta una edición solo del teléfono", () => {
    expect(EDITAR_PACIENTE_SCHEMA.parse({ ...base, telefono: " 9 1234 5678 " })).toEqual({
      ...base,
      telefono: "9 1234 5678",
    });
  });

  it("exige ids con formato uuid", () => {
    expect(() => EDITAR_PACIENTE_SCHEMA.parse({ clinicId: "x", patientId: PACIENTE })).toThrow();
    expect(() => EDITAR_PACIENTE_SCHEMA.parse({ clinicId: CLINICA, patientId: "1" })).toThrow();
  });

  it("no deja el nombre vacío ni demasiado largo", () => {
    expect(() => EDITAR_PACIENTE_SCHEMA.parse({ ...base, nombre: "   " })).toThrow(
      /El nombre es obligatorio/,
    );
    expect(() => EDITAR_PACIENTE_SCHEMA.parse({ ...base, nombre: "a".repeat(201) })).toThrow();
  });

  it("rechaza un email mal escrito, pero acepta vacío para borrarlo", () => {
    expect(() => EDITAR_PACIENTE_SCHEMA.parse({ ...base, email: "sin-arroba" })).toThrow(
      /Email inválido/,
    );
    expect(EDITAR_PACIENTE_SCHEMA.parse({ ...base, email: "" }).email).toBe("");
  });

  it("valida la fecha de nacimiento con las reglas del alta y deja borrarla con null", () => {
    expect(() => EDITAR_PACIENTE_SCHEMA.parse({ ...base, fechaNacimiento: "2999-01-01" })).toThrow(
      /no puede ser futura/,
    );
    expect(() => EDITAR_PACIENTE_SCHEMA.parse({ ...base, fechaNacimiento: "1850-01-01" })).toThrow(
      /fuera de rango/,
    );
    expect(() => EDITAR_PACIENTE_SCHEMA.parse({ ...base, fechaNacimiento: "01/02/1990" })).toThrow(
      /Formato de fecha inválido/,
    );
    expect(
      EDITAR_PACIENTE_SCHEMA.parse({ ...base, fechaNacimiento: "1990-02-01" }).fechaNacimiento,
    ).toBe("1990-02-01");
    expect(
      EDITAR_PACIENTE_SCHEMA.parse({ ...base, fechaNacimiento: null }).fechaNacimiento,
    ).toBeNull();
  });

  it("errorDeFechaDeNacimiento usa el día de hoy que se le pasa", () => {
    expect(errorDeFechaDeNacimiento("2026-10-21", new Date("2026-10-20T12:00:00Z"))).toMatch(
      /futura/,
    );
    expect(errorDeFechaDeNacimiento("2026-10-19", new Date("2026-10-20T12:00:00Z"))).toBeNull();
  });
});

describe("diálogo Editar datos", () => {
  const paciente = {
    nombre: "Ana Pérez",
    documento: "12.345.678-5",
    fechaNacimiento: "1990-02-01",
    telefono: "+56912345678",
    email: "",
  };

  it("arranca con los datos actuales de la ficha (null → vacío)", () => {
    expect(datosBasicosDe({ ...paciente, fechaNacimiento: null })).toEqual({
      ...paciente,
      fechaNacimiento: "",
    });
  });

  it("solo manda lo que cambió, recortado", () => {
    const antes = datosBasicosDe(paciente);
    expect(cambiosDeDatosBasicos(antes, { ...antes })).toEqual({});
    expect(cambiosDeDatosBasicos(antes, { ...antes, nombre: " Ana Pérez " })).toEqual({});
    expect(cambiosDeDatosBasicos(antes, { ...antes, telefono: " 9 8765 4321 " })).toEqual({
      telefono: "9 8765 4321",
    });
  });

  it("borrar la fecha de nacimiento manda null; borrar el documento manda vacío", () => {
    const antes = datosBasicosDe(paciente);
    expect(cambiosDeDatosBasicos(antes, { ...antes, fechaNacimiento: "", documento: "" })).toEqual({
      fechaNacimiento: null,
      documento: "",
    });
  });

  it("valida en el cliente con los mismos textos que el servidor", () => {
    const antes = datosBasicosDe(paciente);
    expect(validarDatosBasicos(antes)).toEqual({});
    expect(
      validarDatosBasicos({ ...antes, nombre: " ", email: "x@", fechaNacimiento: "2999-01-01" }),
    ).toEqual({
      nombre: "El nombre es obligatorio.",
      email: "Email inválido.",
      fechaNacimiento: "La fecha de nacimiento no puede ser futura.",
    });
  });

  it("muestra cómo queda guardado el teléfono con el país de la clínica", () => {
    expect(avisoDeTelefono("", "CL")).toBeNull();
    expect(avisoDeTelefono("9 1234 5678", "CL")).toEqual({
      tipo: "ok",
      texto: "Se guarda como +56912345678.",
    });
    const dudoso = avisoDeTelefono("123", "MX");
    expect(dudoso?.tipo).toBe("dudoso");
    expect(dudoso?.texto).toContain("+52");
  });
});

describe("quién edita los datos de un paciente", () => {
  it("owner, admin, dentist y reception; no assistant ni accounting", () => {
    const pueden = CLINIC_ROLES.filter((r) => puedeEditarPaciente(r));
    expect(pueden).toEqual(["owner", "admin", "dentist", "reception"]);
    expect(puedeEditarPaciente(null)).toBe(false);
  });

  it("coincide con los roles de la policy patients_update_front_desk", () => {
    const sql = leer("supabase/migrations/20260811120000_9c2e4b7a-0a1d-4f6e-9b5c-7a8d3e1f4c60.sql");
    const policy = sql.match(/CREATE POLICY "patients_update_front_desk"[\s\S]*?;/)?.[0] ?? "";
    const roles = [...policy.matchAll(/ARRAY\[([^\]]+)\]/g)].map((m) =>
      m[1]
        .replace(/'/g, "")
        .split(",")
        .map((r) => r.trim())
        .sort(),
    );
    expect(roles).toHaveLength(2); // USING y WITH CHECK
    for (const r of roles) {
      expect(r).toEqual(CLINIC_ROLES.filter((x) => puedeEditarPaciente(x)).sort());
    }
    // Ninguna migración posterior la redefine (si alguien la cambia, este
    // test tiene que revisarse junto con la matriz de access.ts).
    const otras = leer("supabase/migrations/20261008010000_rls_auth_uid_initplan.sql");
    expect(otras).not.toMatch(/patients_update_front_desk/);
  });
});

describe("cableado de la ficha y del servidor", () => {
  const ruta = leer("src/routes/_authenticated/_clinic/pacientes.$pacienteId.tsx");
  const dialogo = leer("src/components/editar-paciente-dialog.tsx");
  const servidor = leer("src/lib/patients/editar-paciente.server.ts");
  const funciones = leer("src/lib/patients/patients.functions.ts");

  it("la ficha muestra Editar datos solo a quien puede editar", () => {
    expect(ruta).toMatch(/puedeEditarPaciente\(access\.role\) && \(\s*<EditarPacienteDialog/);
  });

  it("el diálogo usa updatePatient, refresca la ficha y el listado y avisa en tuteo", () => {
    expect(dialogo).toContain("useServerFn(updatePatient)");
    expect(dialogo).toContain('queryKey: ["patients", clinicId]');
    expect(dialogo).toContain("router.invalidate()");
    expect(dialogo).toContain('toast.success("Datos del paciente actualizados")');
    expect(dialogo).toContain("Corrige los datos");
    // Respeta el modo solo lectura como el resto de los botones de la ficha.
    expect(dialogo).toContain("<BloqueoEscritura>");
  });

  it("los campos tienen label y los errores quedan asociados para lectores de pantalla", () => {
    for (const c of ["nombre", "documento", "fechaNacimiento", "telefono", "email"]) {
      expect(dialogo).toContain(`htmlFor={\`\${fid}-${c}\`}`);
    }
    expect(dialogo).toContain('"aria-invalid"');
    expect(dialogo).toContain('"aria-describedby"');
    // A 390 px los campos van de a uno.
    expect(dialogo).toContain("grid-cols-1 gap-3 sm:grid-cols-2");
  });

  it("updatePatient valida con el esquema compartido, exige escritura y delega", () => {
    expect(funciones).toMatch(
      /export const updatePatient = createServerFn\(\{ method: "POST" \}\)\s*\.middleware\(\[requireEscritura\]\)/,
    );
    expect(funciones).toContain(".merge(CAMPOS_EDITABLES_DEL_PACIENTE)");
    expect(funciones).toContain("actualizarPaciente(context.supabase, context.userId, data)");
  });

  it("el servidor verifica permiso, clínica y que el UPDATE haya escrito", () => {
    expect(servidor).toMatch(/requireClinicPermission\([\s\S]*"patients:manage"/);
    expect(servidor.match(/\.eq\("clinic_id", clinicId\)/g)).toHaveLength(2);
    expect(servidor).toMatch(/\.update\(patch\)[\s\S]*\.select\("id"\)[\s\S]*if \(!fila\)/);
  });
});
