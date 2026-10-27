import { createFileRoute } from "@tanstack/react-router";
import { LegalH2, LegalLi, LegalNotice, LegalP, LegalUl } from "@/components/legal-page";
import { canonicalHead } from "@/lib/seo";

export const Route = createFileRoute("/docs/migrar-desde-otro-sistema")({
  head: () => {
    const canonical = canonicalHead("/docs/migrar-desde-otro-sistema");
    return {
      meta: [
        { title: "Migrar desde otro sistema o Excel · Documentación · Esmalia" },
        {
          name: "description",
          content:
            "Cómo traer tus pacientes y citas futuras a Esmalia desde una planilla o desde otro sistema, con plantillas CSV, y cómo correr los dos sistemas en paralelo hasta que confíes.",
        },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: MigrarDesdeOtroSistema,
});

function MigrarDesdeOtroSistema() {
  return (
    <article>
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Documentación</p>
      <h1 className="font-display mt-2 text-3xl font-bold tracking-tight">
        Migrar desde otro sistema o desde Excel
      </h1>
      <LegalP>
        Puedes traer tus pacientes y tus citas (pasadas y futuras) con dos archivos CSV o Excel. No
        tienes que dejar tu sistema actual el primer día: la forma más tranquila es usar los dos en
        paralelo la primera semana y apagar el viejo cuando confíes.
      </LegalP>

      <LegalH2>1. Descarga las plantillas</LegalH2>
      <LegalUl>
        <LegalLi>
          <a
            href="/plantillas/plantilla-pacientes.csv"
            download
            className="text-brand-700 underline underline-offset-2"
          >
            Plantilla de pacientes
          </a>
          : nombre, documento, fecha_nacimiento, telefono y email. Solo el nombre es obligatorio.
        </LegalLi>
        <LegalLi>
          <a
            href="/plantillas/plantilla-citas.csv"
            download
            className="text-brand-700 underline underline-offset-2"
          >
            Plantilla de citas
          </a>
          : documento_paciente, fecha_hora, tratamiento, y opcionalmente profesional, sucursal y
          duracion_min.
        </LegalLi>
      </LegalUl>
      <LegalNotice>
        Cada plantilla trae una fila de ejemplo. Bórrala antes de subir el archivo para no crear un
        paciente o una cita de mentira.
      </LegalNotice>

      <LegalH2>2. Prepara tu archivo</LegalH2>
      <LegalP>
        Si ya tienes una planilla o puedes exportar desde tu sistema actual a Excel o CSV, no hace
        falta que cambies los nombres de las columnas: Esmalia reconoce los más comunes (por ejemplo
        nombre, rut, dni, celular, correo) y siempre te deja revisar y cambiar a mano qué columna
        corresponde a cada campo antes de importar. Para Dentalink hay un perfil de columnas propio
        (provisional: revisa el mapeo antes de importar).
      </LegalP>
      <LegalUl>
        <LegalLi>
          Fechas como DD/MM/AAAA o AAAA-MM-DD (por ejemplo 27/03/1985). La hora de las citas puede
          ir en su propia columna o junto a la fecha.
        </LegalLi>
        <LegalLi>Hasta 5.000 filas por archivo. Si tienes más, súbelas en varios archivos.</LegalLi>
        <LegalLi>
          Guarda como CSV UTF-8 para que las tildes y las eñes lleguen bien. En Excel: Guardar como
          → CSV UTF-8.
        </LegalLi>
      </LegalUl>

      <LegalH2>3. Importa primero los pacientes y después las citas</LegalH2>
      <LegalP>
        En Ajustes → Migración de datos (solo propietario o administrador) cada archivo se importa
        como un lote. Antes de escribir nada ves una vista previa con las filas válidas, las que
        tienen errores y las duplicadas (mismo documento, mismo id del sistema anterior o mismo
        nombre y fecha de nacimiento), y confirmas con la cifra exacta. Las citas se asocian al
        paciente por el id del sistema anterior, el documento o el nombre, así que los pacientes
        tienen que existir antes; los profesionales del archivo que no estén en Esmalia los eliges
        en la misma vista previa.
      </LegalP>
      <LegalP>
        Si algo salió mal, puedes deshacer el lote completo mientras nadie haya trabajado sobre lo
        importado. Las fichas importadas muestran el sello "Importado de…" con los datos tal como
        venían; las citas pasadas quedan como historial de solo lectura. A los pacientes importados
        no se les envía nada, y las citas futuras importadas no aparecen en Recordatorios salvo que
        lo elijas.
      </LegalP>

      <LegalH2>4. Qué no se importa</LegalH2>
      <LegalP>Para que no haya sorpresas, esto queda fuera de la importación por CSV:</LegalP>
      <LegalUl>
        <LegalLi>
          Historial clínico y odontogramas: se siguen llenando en Esmalia a medida que atiendes.
        </LegalLi>
        <LegalLi>
          Alergias, antecedentes y notas del paciente: no tienen campo en el importador. Quedan
          visibles en los datos de origen de la ficha, pero si son críticos pásalos a la anamnesis.
        </LegalLi>
        <LegalLi>Pagos y presupuestos antiguos.</LegalLi>
      </LegalUl>

      <LegalH2>5. Corre los dos sistemas en paralelo</LegalH2>
      <LegalP>
        Durante la primera semana, agenda en Esmalia y en tu sistema anterior a la vez. Al terminar
        la semana compara: ¿están todas las citas?, ¿llegaron los datos de contacto? Cuando todo
        coincida, deja de usar el sistema anterior. Tus datos de Esmalia los puedes exportar cuando
        quieras desde Ajustes.
      </LegalP>

      <LegalP>
        ¿Algo no calza o prefieres que te acompañemos con la carga? Escríbenos desde la página de{" "}
        <a href="/nosotros" className="text-brand-700 underline underline-offset-2">
          contacto
        </a>{" "}
        y te ayudamos.
      </LegalP>
    </article>
  );
}
