import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalH2, LegalP, LegalUl, LegalLi, LegalNotice } from "@/components/legal-page";
import { canonicalHead } from "@/lib/seo";

export const Route = createFileRoute("/dpa")({
  head: () => {
    const canonical = canonicalHead("/dpa");
    return {
      meta: [
        { title: "Acuerdo de tratamiento de datos · Esmalia" },
        {
          name: "description",
          content:
            "Acuerdo de tratamiento de datos entre Esmalia y cada clínica: roles, instrucciones, seguridad, subencargados, transferencias, incidentes y devolución de los datos de pacientes.",
        },
        { name: "robots", content: "index,follow" },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: Dpa,
});

const enlace = "text-brand-700 underline underline-offset-2";

function Privacidad() {
  return (
    <a href="mailto:privacidad@esmalia.com" className={enlace}>
      privacidad@esmalia.com
    </a>
  );
}

function Dpa() {
  return (
    <LegalPage
      label="Legal"
      title="Acuerdo de tratamiento de datos"
      updated="Versión 2 — 19 de octubre de 2026 · MAXNOVA & LUCI Global LLC"
    >
      <LegalNotice>
        Este acuerdo fija las reglas con las que Esmalia trata los datos de los pacientes de tu
        clínica. Lo aceptas al usar Esmalia, junto con los{" "}
        <a href="/terminos" className={enlace}>
          Términos de servicio
        </a>
        , y no hace falta firmar nada para que valga. Si tu clínica necesita una copia firmada, por
        ejemplo para su propio asesor o para una auditoría, pídela a <Privacidad /> y te la
        mandamos.
        <br />
        <br />
        <strong>Qué cambió en la versión 2 (19 de octubre de 2026).</strong> La función de IA está
        pausada y no se envían datos a ningún proveedor de IA; se suma Numverify como subencargado;
        se agregan la verificación en dos pasos, el registro de lecturas de la ficha y el cifrado
        del número de documento como medidas de seguridad; la clínica exporta sus datos desde la
        aplicación; y las historias clínicas se archivan, no se borran. El detalle está en la
        sección 12.
      </LegalNotice>

      <LegalH2>1. Partes y objeto</LegalH2>
      <LegalP>
        Las partes son la clínica que tiene una cuenta en Esmalia (la "clínica") y MAXNOVA &amp;
        LUCI Global LLC, una LLC constituida en Florida, Estados Unidos, que opera Esmalia
        ("Esmalia"). Este acuerdo regula cómo Esmalia trata, por cuenta de la clínica, los datos
        personales de pacientes y de otras personas que la clínica carga o recibe a través de la
        aplicación: identidad, contacto, historia clínica, odontograma, documentos, citas,
        presupuestos, pagos y mensajes. Muchos de esos datos son datos de salud, que la ley trata
        como datos sensibles.
      </LegalP>
      <LegalP>
        Las palabras se usan con su sentido habitual en la Ley 19.628 de Chile, reformada por la Ley
        21.719, y en las leyes parecidas de los otros países donde trabaja la clínica. Si este
        acuerdo y los Términos de servicio dicen cosas distintas sobre datos personales, manda este
        acuerdo.
      </LegalP>

      <LegalH2>2. Roles</LegalH2>
      <LegalUl>
        <LegalLi>
          <strong>La clínica es la responsable</strong> de los datos de sus pacientes. Decide qué
          datos carga, para qué los usa y por cuánto tiempo los guarda, y es quien debe contar con
          una base legal para tratarlos (por ejemplo, el consentimiento del paciente o la atención
          de salud).
        </LegalLi>
        <LegalLi>
          <strong>Esmalia es el encargado.</strong> Trata esos datos solo para prestar el servicio a
          la clínica y no los usa para fines propios.
        </LegalLi>
        <LegalLi>
          Este acuerdo no cubre los datos de los que Esmalia es responsable por su cuenta: los de
          las personas que usan la cuenta de la clínica, la facturación y los contactos que llegan
          desde el sitio web. Esos se rigen por la{" "}
          <a href="/privacidad" className={enlace}>
            Política de privacidad
          </a>
          .
        </LegalLi>
      </LegalUl>

      <LegalH2>3. Instrucciones de la clínica</LegalH2>
      <LegalP>
        Esmalia trata los datos de pacientes solo siguiendo las instrucciones de la clínica. Las
        instrucciones son: este acuerdo, los Términos de servicio, lo que la clínica configura y
        hace dentro de la aplicación (por ejemplo, cargar un paciente, enviar un mensaje o pedir un
        borrador a la IA) y lo que la clínica nos pida por escrito. Esmalia no usa esos datos para
        publicidad, no los vende, no los usa para entrenar modelos de IA y no los combina con datos
        de otras clínicas. Si una instrucción nos parece contraria a la ley, se lo decimos a la
        clínica antes de cumplirla. Si una ley nos obliga a tratar o entregar datos de otra forma,
        le avisamos a la clínica, salvo que la ley nos lo prohíba.
      </LegalP>

      <LegalH2>4. Confidencialidad</LegalH2>
      <LegalP>
        Solo acceden a los datos de pacientes las personas que operan Esmalia y que lo necesitan
        para prestar el servicio, dar soporte o resolver una falla. Todas ellas están obligadas a
        guardar confidencialidad, también después de dejar de trabajar con Esmalia. Para revisar un
        caso de soporte que exige ver datos de una clínica, lo hacemos a pedido de la clínica o
        cuando es necesario para resolver una falla que la afecta.
      </LegalP>

      <LegalH2>5. Medidas de seguridad</LegalH2>
      <LegalP>Estas son las medidas que están en uso hoy, no promesas a futuro:</LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Aislamiento por clínica en la base de datos</strong> (row-level security): cada
          consulta se filtra por clínica en la propia base, no solo en la pantalla.
        </LegalLi>
        <LegalLi>
          <strong>Permisos por rol</strong>: dueño, administrador, dentista, asistente y recepción
          ven cosas distintas. Las notas clínicas solo las ven los roles clínicos y la
          administración, y la recepción no.
        </LegalLi>
        <LegalLi>
          <strong>Cifrado en tránsito</strong> (HTTPS con TLS) en toda la comunicación, y{" "}
          <strong>cifrado en reposo</strong> de la base de datos y los archivos, provisto por
          Supabase.
        </LegalLi>
        <LegalLi>
          <strong>Copias de respaldo diarias cifradas</strong> antes de salir hacia el proveedor que
          las guarda, con una clave que ese proveedor no tiene.
        </LegalLi>
        <LegalLi>
          <strong>Auditoría de notas clínicas</strong>: la base de datos registra quién crea, edita,
          firma o revisa cada nota, y cuándo se usó IA. Ningún usuario puede escribir ni alterar ese
          registro. La historia clínica y el odontograma se versionan: un cambio agrega una versión
          nueva, no borra la anterior.
        </LegalLi>
        <LegalLi>
          <strong>Verificación de firma</strong> en los mensajes que llegan desde WhatsApp.
        </LegalLi>
        <LegalLi>
          <strong>Informes de error sin datos personales</strong>: antes de enviarlos al servicio de
          monitoreo se quitan cookies, encabezados con credenciales y el contenido de las
          solicitudes.
        </LegalLi>
        <LegalLi>
          <strong>Acceso a producción limitado</strong> a las personas que operan Esmalia.
        </LegalLi>
        <LegalLi>
          <strong>Verificación en dos pasos</strong> (código de una app de autenticación) disponible
          para cada persona de la clínica, y obligatoria para el equipo de Esmalia que entra a la
          administración.
        </LegalLi>
        <LegalLi>
          <strong>Registro de lecturas de la ficha</strong>: la base de datos anota quién abrió la
          ficha clínica de cada paciente y cuándo. Lo ven el dueño y los administradores de la
          clínica, y nadie lo puede modificar ni borrar.
        </LegalLi>
        <LegalLi>
          <strong>Número de documento cifrado</strong> en la base de datos, además del cifrado
          general en reposo.
        </LegalLi>
        <LegalLi>
          <strong>Sin borrado de historias clínicas desde la aplicación</strong>: los pacientes se
          archivan y su historia se conserva.
        </LegalLi>
      </LegalUl>
      <LegalP>
        Esmalia todavía no tiene certificaciones formales como SOC 2 o ISO 27001. Podemos mejorar
        estas medidas con el tiempo, pero no bajar su nivel de protección sin avisar a la clínica.
      </LegalP>

      <LegalH2>6. Subencargados</LegalH2>
      <LegalP>
        La clínica autoriza a Esmalia a usar estos proveedores (subencargados) para prestar el
        servicio:
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Supabase</strong> — base de datos, autenticación y archivos. São Paulo, Brasil.
        </LegalLi>
        <LegalLi>
          <strong>Vercel</strong> — aloja la aplicación. Funciones en São Paulo, Brasil (gru1); red
          de entrega global.
        </LegalLi>
        <LegalLi>
          <strong>Resend</strong> — entrega de correos, incluidos los que la clínica envía a sus
          pacientes. Envío desde São Paulo, Brasil; empresa de Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>Stripe</strong> — cobro de la suscripción de la clínica; no recibe datos de
          pacientes. Estados Unidos y otros países.
        </LegalLi>
        <LegalLi>
          <strong>Google</strong> — inicio de sesión con Google y el modelo de IA Gemini, para
          borradores o resúmenes que pide el profesional y para interpretar mensajes de WhatsApp.{" "}
          <strong>La función de IA está pausada: hoy no se le envían datos.</strong> Estados Unidos
          y otros países.
        </LegalLi>
        <LegalLi>
          <strong>OpenAI</strong> — IA alternativa, para las mismas tareas.{" "}
          <strong>Pausada: hoy no se le envían datos.</strong> Cuando la IA vuelva, informamos qué
          proveedor se usa con el aviso de 30 días de esta sección. Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>Numverify (apilayer)</strong> — comprueba que el teléfono de un paciente tiene
          forma real cuando la clínica lo carga o lo cambia. Recibe solo el número, por HTTPS.
          Empresa de Austria (apilayer Data Products GmbH, Viena), que declara usar proveedores en
          Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>Sentry</strong> — informes de error, sin cookies, encabezados ni contenido de las
          solicitudes. Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>Cloudflare</strong> — DNS del dominio y reenvío de los correos @esmalia.com al
          buzón del equipo, alojado en Google (Gmail). Red global.
        </LegalLi>
        <LegalLi>
          <strong>Backblaze B2</strong> — guarda las copias de respaldo cifradas. Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>GitHub</strong> — código y tareas programadas; el respaldo se cifra en una máquina
          temporal de GitHub antes de subirse. Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>Meta (WhatsApp Cloud API)</strong> — solo si la clínica conecta su número. Estados
          Unidos y otros países.
        </LegalLi>
      </LegalUl>
      <LegalP>
        Esmalia elige proveedores con compromisos de confidencialidad y seguridad adecuados y
        responde frente a la clínica por lo que ellos hagan con los datos. Si vamos a sumar o
        cambiar un subencargado que trate datos de pacientes,{" "}
        <strong>avisamos a la clínica por email con 30 días de anticipación</strong> y actualizamos
        esta lista. Si la clínica tiene un motivo fundado para oponerse, puede escribirnos dentro de
        ese plazo; si no encontramos una solución, puede cancelar sin costo adicional y llevarse sus
        datos.
      </LegalP>

      <LegalH2>7. Transferencias internacionales</LegalH2>
      <LegalP>
        Los datos se alojan en Brasil y algunos subencargados los procesan en Estados Unidos u otros
        países, como indica la sección 6. Esmalia también es una empresa de Estados Unidos y su
        equipo accede desde fuera del país de la clínica. La clínica autoriza estas transferencias
        para prestar el servicio. Esmalia las respalda con las medidas de la sección 5 y con los
        compromisos contractuales de cada proveedor, y no conoce una declaración de nivel adecuado a
        favor de Brasil o de Estados Unidos que las cubra. Si la ley de la clínica exige un
        instrumento adicional (por ejemplo, cláusulas tipo aprobadas por la autoridad), lo firmamos
        cuando exista y la clínica nos lo pida.
      </LegalP>

      <LegalH2>8. Ayuda con los derechos de los pacientes</LegalH2>
      <LegalP>
        Los pacientes ejercen sus derechos (acceso, rectificación, supresión, oposición,
        portabilidad y bloqueo) ante la clínica. Esmalia ayuda a la clínica a responderlos: la
        aplicación permite corregir y exportar los datos, y lo que no se pueda hacer desde la
        aplicación lo hacemos nosotros a pedido de la clínica, sin costo, en un plazo que le permita
        cumplir el suyo. Si un paciente nos escribe directamente, le pasamos el pedido a la clínica
        sin demora y no respondemos por ella salvo que nos lo indique.
      </LegalP>

      <LegalH2>9. Notificación de incidentes</LegalH2>
      <LegalP>
        Si Esmalia confirma un incidente de seguridad que afecte datos de pacientes de la clínica
        (acceso indebido, pérdida, alteración o filtración), se lo avisa a la clínica sin demoras
        indebidas, <strong>con el objetivo de hacerlo dentro de las 72 horas</strong> desde que lo
        confirma. El aviso incluye, en la medida en que se conozca: qué pasó, qué datos y cuántas
        personas están involucradas, qué consecuencias puede tener y qué medidas tomamos o
        proponemos. Si falta información, la mandamos a medida que la tengamos. Esmalia colabora con
        la clínica para que pueda avisar a sus pacientes y a la autoridad cuando corresponda, y no
        avisa a pacientes por su cuenta salvo que la clínica se lo pida o la ley lo exija.
      </LegalP>

      <LegalH2>10. Devolución y supresión al terminar</LegalH2>
      <LegalP>
        Mientras la cuenta esté activa, el dueño o un administrador de la clínica puede exportar
        todos sus datos desde Ajustes, en formato estándar y en cualquier momento. También puede
        pedirnos la copia escribiendo a{" "}
        <a href="mailto:soporte@esmalia.com" className={enlace}>
          soporte@esmalia.com
        </a>
        . Dentro de la aplicación las historias clínicas no se borran: se archivan y se conservan,
        para que la clínica pueda cumplir los plazos legales de conservación que le fija su ley.
        Cuando termina el servicio, la clínica puede pedir por escrito a <Privacidad /> que
        eliminemos sus datos o que se los devolvamos; lo hacemos dentro de los 30 días siguientes al
        pedido y le confirmamos por escrito cuando está hecho. Mientras no recibamos esa
        instrucción, no usamos los datos para nada más que devolvérselos a la clínica. Las copias de
        respaldo cifradas no se editan una por una: los datos borrados desaparecen de ellas cuando
        esas copias rotan (hasta 90 días). Solo conservamos algo más allá de eso si una ley nos
        obliga, y en ese caso lo mantenemos protegido y sin usarlo.
      </LegalP>

      <LegalH2>11. Auditoría</LegalH2>
      <LegalP>
        La clínica puede pedirnos información para verificar que cumplimos este acuerdo. Le
        respondemos por escrito, con la documentación que tengamos sobre las medidas de la sección 5
        y sobre los subencargados. Si eso no alcanza, por ejemplo porque lo pide una autoridad,
        acordamos una revisión razonable: con aviso previo de al menos 30 días, en horario hábil,
        sin acceder a datos de otras clínicas, con un compromiso de confidencialidad y, salvo que se
        detecte un incumplimiento de Esmalia, a costo de quien la pide. Como regla general, no más
        de una revisión por año.
      </LegalP>

      <LegalH2>12. Vigencia</LegalH2>
      <LegalP>
        Este acuerdo rige desde que la clínica empieza a usar Esmalia y mientras Esmalia trate datos
        de pacientes por cuenta de la clínica, incluido el período de devolución y supresión de la
        sección 10. Las obligaciones de confidencialidad siguen después de que termina. Si cambiamos
        este acuerdo, publicamos la nueva versión en esta página y avisamos a las clínicas por email
        antes de que rija. En lo que este acuerdo no diga, aplican los{" "}
        <a href="/terminos" className={enlace}>
          Términos de servicio
        </a>
        , incluida su ley aplicable, sin perjuicio de las normas de protección de datos del país de
        la clínica que no se pueden dejar de lado por contrato.
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Versión 2 — 19 de octubre de 2026.</strong> Se indica que la función de IA está
          pausada y que hoy no se envían datos a Google (Gemini) ni a OpenAI; se agrega Numverify
          como subencargado (sección 6); se suman la verificación en dos pasos, el registro de
          lecturas de la ficha, el cifrado del número de documento y el archivo de pacientes en vez
          del borrado (sección 5); y la clínica exporta sus datos desde la aplicación (secciones 8 y
          10).
        </LegalLi>
        <LegalLi>
          <strong>Versión 1 — 10 de octubre de 2026.</strong> Primera versión.
        </LegalLi>
      </LegalUl>

      <LegalH2>13. Aceptación y copia firmada</LegalH2>
      <LegalP>
        La clínica acepta este acuerdo al crear su cuenta o al usar Esmalia. Si necesita una copia
        firmada por ambas partes, puede pedirla a <Privacidad />.
      </LegalP>
    </LegalPage>
  );
}
