import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  comoServicio,
  comoUsuario,
  conectar,
  esperaError,
  evaluarPolitica,
  sembrarEscenario,
  TABLA_NOTAS,
  type EstadoNota,
  type Escenario,
} from "./helpers/db";

/**
 * Valida las reglas de acceso de notas clínicas por rol:
 *  - predicados de RLS multi-tenant (is_clinic_member / can_manage_clinic),
 *  - transiciones de estado impuestas por `enforce_clinical_note_update`,
 *  - reglas de historial de revisión y versiones.
 * Cada prueba corre en una transacción que se revierte al terminar.
 */
describe("RLS y transiciones de notas clínicas", () => {
  let client: Client;
  let esc: Escenario;

  const sembrar = async (estado: EstadoNota = {}) => {
    esc = await sembrarEscenario(client, estado);
    return esc;
  };

  /** Lee la nota espejo (misma estructura y trigger que la tabla real). */
  const leerNota = async () => {
    const filas = await comoUsuario<{
      status: string;
      review_status: string;
      content: string;
      reviewer_id: string | null;
    }>(
      client,
      esc.usuarios.dentist,
      `SELECT status, review_status, content, reviewer_id FROM ${TABLA_NOTAS} WHERE id = $1`,
      [esc.noteId],
    );
    return filas[0];
  };

  const actualizar = (userId: string, set: string, params: unknown[] = []) =>
    comoUsuario(client, userId, `UPDATE ${TABLA_NOTAS} SET ${set} WHERE id = $1`, [
      esc.noteId,
      ...params,
    ]);

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  describe("aislamiento multi-tenant (predicados de RLS)", () => {
    const TABLAS = [
      "clinical_notes",
      "clinical_note_versions",
      "clinical_note_reviews",
      "clinical_note_audit",
      "clinic_members",
      "notifications",
    ];

    it("todas las tablas clínicas tienen RLS activa y políticas", async () => {
      await sembrar();
      const filas = await comoUsuario<{ relname: string; relrowsecurity: boolean; n: string }>(
        client,
        esc.usuarios.owner,
        `SELECT c.relname, c.relrowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS n
         FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname='public' AND c.relname = ANY($1)`,
        [TABLAS],
      );
      expect(filas).toHaveLength(TABLAS.length);
      for (const f of filas) {
        expect(f.relrowsecurity, `${f.relname} sin RLS`).toBe(true);
        expect(Number(f.n), `${f.relname} sin políticas`).toBeGreaterThan(0);
      }
    });

    it("un usuario ajeno no cumple el predicado de membresía", async () => {
      await sembrar();
      await expect(
        evaluarPolitica(client, esc.usuarios.externo, "public.is_clinic_member($1)", [
          esc.clinicId,
        ]),
      ).resolves.toBe(false);
    });

    it("un miembro de la clínica sí cumple el predicado de membresía", async () => {
      await sembrar();
      await expect(
        evaluarPolitica(client, esc.usuarios.assistant, "public.is_clinic_member($1)", [
          esc.clinicId,
        ]),
      ).resolves.toBe(true);
    });

    it("solo owner y admin cumplen el predicado de gestión", async () => {
      await sembrar();
      for (const rol of ["owner", "admin"]) {
        await expect(
          evaluarPolitica(client, esc.usuarios[rol], "public.can_manage_clinic($1)", [
            esc.clinicId,
          ]),
        ).resolves.toBe(true);
      }
      for (const rol of ["dentist", "assistant", "reception", "accounting", "externo"]) {
        await expect(
          evaluarPolitica(client, esc.usuarios[rol], "public.can_manage_clinic($1)", [
            esc.clinicId,
          ]),
        ).resolves.toBe(false);
      }
    });

    it("un usuario ajeno no puede modificar la nota", async () => {
      await sembrar();
      const msg = await esperaError(client, () =>
        actualizar(esc.usuarios.externo, "content = 'hackeada'"),
      );
      expect(msg).toMatch(/no perteneces/i);
    });
  });

  describe("edición de contenido", () => {
    it("el autor puede editar su borrador", async () => {
      await sembrar();
      await actualizar(esc.usuarios.dentist, "content = 'Editado por autor'");
      expect((await leerNota()).content).toBe("Editado por autor");
    });

    it("un administrador puede editar el borrador de otro", async () => {
      await sembrar();
      await actualizar(esc.usuarios.admin, "content = 'Editado por admin'");
      expect((await leerNota()).content).toBe("Editado por admin");
    });

    it("recepción no puede editar notas clínicas", async () => {
      await sembrar();
      const msg = await esperaError(client, () =>
        actualizar(esc.usuarios.reception, "content = 'x'"),
      );
      expect(msg).toMatch(/no puede modificar/i);
    });

    it("no se puede editar una nota firmada", async () => {
      await sembrar({ status: "signed" });
      const msg = await esperaError(client, () =>
        actualizar(esc.usuarios.dentist, "content = 'x'"),
      );
      expect(msg).toMatch(/firmada/i);
    });

    it("no se puede editar una nota en revisión", async () => {
      await sembrar({
        status: "signed",
        reviewStatus: "pending",
        reviewerKey: "dentist2",
        requesterKey: "dentist",
      });
      const msg = await esperaError(client, () => actualizar(esc.usuarios.admin, "content = 'x'"));
      expect(msg).toMatch(/firmada|revisión/i);
    });

    it("no se puede reasignar la nota a otro paciente", async () => {
      await sembrar();
      const msg = await esperaError(client, () =>
        actualizar(esc.usuarios.admin, "patient_ref = 'otro'"),
      );
      expect(msg).toMatch(/reasignar/i);
    });
  });

  describe("firma y reapertura", () => {
    it("un asistente no puede firmar", async () => {
      await sembrar();
      const msg = await esperaError(client, () =>
        actualizar(esc.usuarios.assistant, "status = 'signed'"),
      );
      expect(msg).toMatch(/no puede firmar/i);
    });

    // CLI-07/CLI-08 (migración 20261019220000): una nota firmada no vuelve a
    // borrador. La corrección va en una adenda (otra nota con addendum_of).
    it("un doctor firma su nota y después no la puede reabrir", async () => {
      await sembrar();
      await actualizar(esc.usuarios.dentist, "status = 'signed'");
      expect((await leerNota()).status).toBe("signed");
      const msg = await esperaError(client, () =>
        actualizar(esc.usuarios.dentist, "status = 'draft'"),
      );
      expect(msg).toMatch(/adenda/i);
      expect((await leerNota()).status).toBe("signed");
    });

    it("ni el revisor ni la administración reabren una nota firmada", async () => {
      await sembrar({
        status: "signed",
        reviewStatus: "pending",
        reviewerKey: "dentist2",
        requesterKey: "dentist",
      });
      for (const key of ["dentist2", "admin", "owner"]) {
        const msg = await esperaError(client, () =>
          actualizar(esc.usuarios[key], "status = 'draft'"),
        );
        expect(msg, key).toMatch(/adenda/i);
      }
    });

    it("los datos de la firma no se editan a mano", async () => {
      await sembrar({ status: "signed" });
      const msg = await esperaError(client, () =>
        actualizar(esc.usuarios.admin, "signer_license = 'FALSO'"),
      );
      expect(msg).toMatch(/firma no se editan/i);
    });

    it("una adenda no se reasigna a otra nota", async () => {
      await sembrar();
      const msg = await esperaError(client, () =>
        actualizar(esc.usuarios.admin, "addendum_of = gen_random_uuid()"),
      );
      expect(msg).toMatch(/adenda no se puede reasignar/i);
    });
  });

  describe("solicitud de revisión", () => {
    const enviar = (autorKey: string, revisorKey: string) =>
      actualizar(
        esc.usuarios[autorKey],
        `review_status = 'pending', reviewer_id = $2, review_requested_by = $3, review_requested_at = now()`,
        [esc.usuarios[revisorKey], esc.usuarios[autorKey]],
      );

    it("no se puede enviar a revisión una nota en borrador", async () => {
      await sembrar();
      const msg = await esperaError(client, () => enviar("dentist", "dentist2"));
      expect(msg).toMatch(/firmada/i);
    });

    it("no se puede auto-asignar como revisor", async () => {
      await sembrar({ status: "signed" });
      const msg = await esperaError(client, () => enviar("dentist", "dentist"));
      expect(msg).toMatch(/otro profesional/i);
    });

    it("el revisor debe tener rol clínico habilitado", async () => {
      await sembrar({ status: "signed" });
      const msg = await esperaError(client, () => enviar("dentist", "reception"));
      expect(msg).toMatch(/revisor debe ser/i);
    });

    it("un doctor puede enviar a revisión a otro doctor", async () => {
      await sembrar({ status: "signed" });
      await enviar("dentist", "dentist2");
      const nota = await leerNota();
      expect(nota.review_status).toBe("pending");
      expect(nota.reviewer_id).toBe(esc.usuarios.dentist2);
    });
  });

  describe("resolución de la revisión", () => {
    const pendiente: EstadoNota = {
      status: "signed",
      reviewStatus: "pending",
      reviewerKey: "dentist2",
      requesterKey: "dentist",
    };

    it("el revisor asignado aprueba la nota", async () => {
      await sembrar(pendiente);
      await actualizar(esc.usuarios.dentist2, "review_status = 'approved', reviewed_at = now()");
      expect((await leerNota()).review_status).toBe("approved");
    });

    it("un tercero no puede aprobar", async () => {
      await sembrar(pendiente);
      const msg = await esperaError(client, () =>
        actualizar(esc.usuarios.assistant, "review_status = 'approved'"),
      );
      expect(msg).toMatch(/revisor asignado/i);
    });

    it("el revisor puede solicitar cambios", async () => {
      await sembrar(pendiente);
      await actualizar(
        esc.usuarios.dentist2,
        "review_status = 'changes_requested', reviewed_at = now()",
      );
      expect((await leerNota()).review_status).toBe("changes_requested");
    });

    it("un asistente no puede cancelar, el solicitante sí", async () => {
      await sembrar(pendiente);
      const cancelar = (userId: string) =>
        actualizar(
          userId,
          "review_status = 'none', reviewer_id = NULL, review_requested_by = NULL",
        );
      const msg = await esperaError(client, () => cancelar(esc.usuarios.assistant));
      expect(msg).toMatch(/cancelarla|no puede/i);
      await cancelar(esc.usuarios.dentist);
      expect((await leerNota()).review_status).toBe("none");
    });
  });

  describe("historial de revisión y versiones", () => {
    const insertarRevision = (userId: string, action: string) =>
      comoUsuario(
        client,
        userId,
        `INSERT INTO public.clinical_note_reviews (note_id, clinic_id, patient_ref, action, actor_id, reviewer_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [esc.noteId, esc.clinicId, esc.patientRef, action, userId, esc.usuarios.dentist2],
      );

    const insertarVersion = (userId: string) =>
      comoUsuario(
        client,
        userId,
        `INSERT INTO public.clinical_note_versions (note_id, clinic_id, version, title, content, author_id)
         VALUES ($1, $2, 2, 'v2', 'texto', $3)`,
        [esc.noteId, esc.clinicId, userId],
      );

    it("un tercero no puede registrar una aprobación en el historial", async () => {
      await sembrar({
        status: "signed",
        reviewStatus: "pending",
        reviewerKey: "dentist2",
        requesterKey: "dentist",
      });
      const msg = await esperaError(client, () =>
        insertarRevision(esc.usuarios.assistant, "approved"),
      );
      expect(msg).toMatch(/revisor asignado|rol/i);
    });

    it("recepción no participa en revisiones", async () => {
      await sembrar({ status: "signed" });
      const msg = await esperaError(client, () =>
        insertarRevision(esc.usuarios.reception, "requested"),
      );
      expect(msg).toMatch(/rol/i);
    });

    it("el revisor asignado sí puede registrar la aprobación", async () => {
      await sembrar({
        status: "signed",
        reviewStatus: "pending",
        reviewerKey: "dentist2",
        requesterKey: "dentist",
      });
      await insertarRevision(esc.usuarios.dentist2, "approved");
      const filas = await comoUsuario(
        client,
        esc.usuarios.dentist2,
        `SELECT id FROM public.clinical_note_reviews WHERE note_id = $1`,
        [esc.noteId],
      );
      expect(filas).toHaveLength(1);
    });

    it("no se pueden crear versiones sobre una nota firmada", async () => {
      await sembrar({ status: "signed" });
      const msg = await esperaError(client, () => insertarVersion(esc.usuarios.dentist));
      expect(msg).toMatch(/firmada/i);
    });

    it("no se pueden crear versiones con revisión pendiente", async () => {
      await sembrar({
        status: "signed",
        reviewStatus: "pending",
        reviewerKey: "dentist2",
        requesterKey: "dentist",
      });
      const msg = await esperaError(client, () => insertarVersion(esc.usuarios.dentist));
      expect(msg).toMatch(/firmada|revisión/i);
    });

    it("el autor puede versionar un borrador", async () => {
      await sembrar();
      await insertarVersion(esc.usuarios.dentist);
      const filas = await comoUsuario(
        client,
        esc.usuarios.dentist,
        `SELECT id FROM public.clinical_note_versions WHERE note_id = $1`,
        [esc.noteId],
      );
      expect(filas).toHaveLength(1);
    });
  });

  describe("procesos internos (rol de servicio)", () => {
    it("sin identidad de usuario el trigger no bloquea la actualización", async () => {
      await sembrar({ status: "signed" });
      await comoServicio(client, `UPDATE ${TABLA_NOTAS} SET content = 'migración' WHERE id = $1`, [
        esc.noteId,
      ]);
      expect((await leerNota()).content).toBe("migración");
    });
  });
});
