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
        Puedes traer tus pacientes y tus citas futuras con dos archivos CSV. No tienes que dejar tu
        sistema actual el primer día: la forma más tranquila es usar los dos en paralelo la primera
        semana y apagar el viejo cuando confíes.
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
        nombre, rut, dni, celular, correo) y, si alguno no lo reconoce, te deja elegir a mano qué
        columna corresponde a cada campo antes de importar.
      </LegalP>
      <LegalUl>
        <LegalLi>Fechas de nacimiento como AAAA-MM-DD (por ejemplo 1985-03-27).</LegalLi>
        <LegalLi>
          Fecha y hora de las citas como AAAA-MM-DD HH:mm (por ejemplo 2026-11-10 10:30).
        </LegalLi>
        <LegalLi>Hasta 2.000 filas por carga. Si tienes más, súbelas en varios archivos.</LegalLi>
        <LegalLi>
          Guarda como CSV UTF-8 para que las tildes y las eñes lleguen bien. En Excel: Guardar como
          → CSV UTF-8.
        </LegalLi>
      </LegalUl>

      <LegalH2>3. Importa primero los pacientes y después las citas</LegalH2>
      <LegalP>
        En Pacientes usa "Importar CSV". Verás una vista previa con las filas que se crearán, las
        que ya existen (se detectan por documento) y las que se saltan, con el motivo de cada una.
        Luego, en la Agenda, usa "Importar citas": las citas se asocian al paciente por su
        documento, así que el paciente tiene que existir antes. Si tu clínica tiene más de un
        profesional o más de una sucursal, la cita tiene que indicar cuál; si hay uno solo, se
        asigna sola.
      </LegalP>

      <LegalH2>4. Qué no se importa</LegalH2>
      <LegalP>Para que no haya sorpresas, esto queda fuera de la importación por CSV:</LegalP>
      <LegalUl>
        <LegalLi>
          Historial clínico y odontogramas: se siguen llenando en Esmalia a medida que atiendes.
        </LegalLi>
        <LegalLi>
          Alergias, antecedentes, dirección, previsión o seguro y notas del paciente: no tienen
          columna en el importador. Si son críticos para ti, pásalos a mano a la ficha de los
          pacientes que ya estés atendiendo.
        </LegalLi>
        <LegalLi>Citas pasadas, pagos y presupuestos antiguos.</LegalLi>
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
