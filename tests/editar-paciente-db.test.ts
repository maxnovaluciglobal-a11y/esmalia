import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import type { Database } from "@/integrations/supabase/types";
import {
  actualizarPaciente,
  MENSAJE_PACIENTE_AJENO,
  MENSAJE_SIN_PERMISO_EDITAR,
} from "@/lib/patients/editar-paciente.server";

/**
 * "Editar datos" de la ficha contra el Supabase efímero (scripts/test-db),
 * con usuarios reales logueados con la anon key: el mismo camino que la app,
 * con la RLS del usuario, no una conexión con permisos elevados.
 *
 * Se llama a `actualizarPaciente` (el cuerpo de `updatePatient`) porque una
 * `createServerFn` no se puede invocar fuera de un request HTTP (ver
 * finance-reports-permission.test.ts).
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Correr con la base de tests: ` +
        "bash scripts/test-db/start.sh; set -a; source .env.test; set +a",
    );
  }
  return value;
}

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const ANON_KEY = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

type Cliente = SupabaseClient<Database>;
type Rol = "owner" | "reception" | "dentist" | "assistant" | "accounting";

describe("updatePatient / actualizarPaciente con la RLS real", () => {
  let admin: Cliente;
  const usuarios: string[] = [];
  const clinicas: string[] = [];
  const clientes = {} as Record<Rol | "ajeno", { client: Cliente; userId: string }>;
  let clinicA: string;
  let clinicB: string;
  let pacienteA: string;
  let pacienteB: string;

  async function crearUsuario(etiqueta: string) {
    const email = `editar-${etiqueta}-${randomUUID()}@esmalia-test.invalid`;
    const password = `Ep0-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`No se pudo crear ${etiqueta}: ${error?.message}`);
    usuarios.push(data.user.id);
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: loginError } = await client.auth.signInWithPassword({ email, password });
    if (loginError) throw new Error(`Login ${etiqueta} falló: ${loginError.message}`);
    return { client, userId: data.user.id };
  }

  async function crearClinica(ownerId: string, nombre: string) {
    const { data, error } = await admin
      .from("clinics")
      .insert({ name: nombre, created_by: ownerId, country: "CL" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la clínica: ${error?.message}`);
    clinicas.push(data.id);
    return data.id;
  }

  async function crearPaciente(clinicId: string, ownerId: string) {
    const { data, error } = await admin
      .from("patients")
      .insert({
        clinic_id: clinicId,
        full_name: "Paciente Editable",
        phone: "+56911111111",
        phone_valid: true,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el paciente: ${error?.message}`);
    return data.id;
  }

  async function fila(id: string) {
    const { data } = await admin
      .from("patients")
      .select("full_name, phone, phone_valid, email, birth_date, document_id")
      .eq("id", id)
      .single();
    return data!;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    clientes.owner = await crearUsuario("owner");
    clinicA = await crearClinica(clientes.owner.userId, "Clínica Editar A");
    for (const rol of ["reception", "dentist", "assistant", "accounting"] as const) {
      clientes[rol] = await crearUsuario(rol);
      const { error } = await admin
        .from("clinic_members")
        .insert({ clinic_id: clinicA, user_id: clientes[rol].userId, role: rol });
      if (error) throw new Error(`No se pudo sumar ${rol}: ${error.message}`);
    }
    // Owner de OTRA clínica: autenticado, pero ajeno a la A.
    clientes.ajeno = await crearUsuario("ajeno");
    clinicB = await crearClinica(clientes.ajeno.userId, "Clínica Editar B");

    pacienteA = await crearPaciente(clinicA, clientes.owner.userId);
    pacienteB = await crearPaciente(clinicB, clientes.ajeno.userId);
  }, 90_000);

  afterAll(async () => {
    // Los pacientes no se borran por API (no hay policy de DELETE y las FKs
    // clínicas son RESTRICT): la base de tests es efímera. Solo se quitan
    // los usuarios para no acumular cuentas si se corre contra una base viva.
    for (const id of usuarios) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("recepción corrige el teléfono: queda en E.164 y se valida una sola vez", async () => {
    const validarTelefono = vi.fn(async () => true);
    const { client, userId } = clientes.reception;

    await expect(
      actualizarPaciente(
        client,
        userId,
        { clinicId: clinicA, patientId: pacienteA, telefono: "9 8765 4321" },
        { validarTelefono },
      ),
    ).resolves.toEqual({ ok: true });
    expect(await fila(pacienteA)).toMatchObject({ phone: "+56987654321", phone_valid: true });
    expect(validarTelefono).toHaveBeenCalledWith("+56987654321");

    // El mismo número escrito de otra forma no vuelve a gastar Numverify.
    validarTelefono.mockClear();
    await actualizarPaciente(
      client,
      userId,
      { clinicId: clinicA, patientId: pacienteA, telefono: "+56 9 8765 4321" },
      { validarTelefono },
    );
    expect(validarTelefono).not.toHaveBeenCalled();
  });

  it("el dentista edita nombre, email, fecha y documento (y se vigila el cifrado)", async () => {
    const vigilarCifrado = vi.fn(async () => []);
    const { client, userId } = clientes.dentist;
    await actualizarPaciente(
      client,
      userId,
      {
        clinicId: clinicA,
        patientId: pacienteA,
        nombre: "Paciente Corregido",
        email: "corregido@esmalia-test.invalid",
        fechaNacimiento: "1990-02-01",
        documento: "12.345.678-5",
      },
      { vigilarCifrado },
    );
    expect(await fila(pacienteA)).toMatchObject({
      full_name: "Paciente Corregido",
      email: "corregido@esmalia-test.invalid",
      birth_date: "1990-02-01",
      document_id: "12.345.678-5",
    });
    expect(vigilarCifrado).toHaveBeenCalledWith(client, [pacienteA], "edicion");
  });

  it("vacío y null borran email, documento y fecha", async () => {
    const { client, userId } = clientes.owner;
    await actualizarPaciente(
      client,
      userId,
      { clinicId: clinicA, patientId: pacienteA, email: "", documento: "", fechaNacimiento: null },
      { vigilarCifrado: async () => [] },
    );
    expect(await fila(pacienteA)).toMatchObject({
      email: null,
      document_id: null,
      birth_date: null,
    });
  });

  it.each(["assistant", "accounting"] as const)("%s no puede editar", async (rol) => {
    const antes = await fila(pacienteA);
    const { client, userId } = clientes[rol];
    await expect(
      actualizarPaciente(client, userId, {
        clinicId: clinicA,
        patientId: pacienteA,
        telefono: "9 2222 2222",
      }),
    ).rejects.toThrow(MENSAJE_SIN_PERMISO_EDITAR);
    expect(await fila(pacienteA)).toEqual(antes);
  });

  it("la RLS también frena a assistant si llama directo a la API (par de la UI)", async () => {
    const { data } = await clientes.assistant.client
      .from("patients")
      .update({ phone: "+56933333333" })
      .eq("id", pacienteA)
      .eq("clinic_id", clinicA)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    expect((await fila(pacienteA)).phone).not.toBe("+56933333333");
  });

  it("un usuario de otra clínica no puede editar pacientes de la A", async () => {
    const antes = await fila(pacienteA);
    const { client, userId } = clientes.ajeno;
    await expect(
      actualizarPaciente(client, userId, {
        clinicId: clinicA,
        patientId: pacienteA,
        nombre: "Hackeado",
      }),
    ).rejects.toThrow(MENSAJE_SIN_PERMISO_EDITAR);
    // Ni pasando su propia clínica con el id de un paciente ajeno.
    await expect(
      actualizarPaciente(client, userId, {
        clinicId: clinicB,
        patientId: pacienteA,
        nombre: "Hackeado",
      }),
    ).rejects.toThrow(MENSAJE_PACIENTE_AJENO);
    expect(await fila(pacienteA)).toEqual(antes);
  });

  it("recepción de la A no edita un paciente de la B pasando su propia clínica", async () => {
    const antes = await fila(pacienteB);
    const { client, userId } = clientes.reception;
    await expect(
      actualizarPaciente(client, userId, {
        clinicId: clinicA,
        patientId: pacienteB,
        telefono: "9 4444 4444",
      }),
    ).rejects.toThrow(MENSAJE_PACIENTE_AJENO);
    expect(await fila(pacienteB)).toEqual(antes);
  });

  it("sin cambios no escribe nada", async () => {
    const { client, userId } = clientes.reception;
    await expect(
      actualizarPaciente(client, userId, { clinicId: clinicA, patientId: pacienteA }),
    ).resolves.toEqual({ ok: true });
  });
});
