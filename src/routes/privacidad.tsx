import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalH2, LegalP, LegalUl, LegalLi, LegalNotice } from "@/components/legal-page";
import { canonicalHead } from "@/lib/seo";

export const Route = createFileRoute("/privacidad")({
  head: () => {
    const canonical = canonicalHead("/privacidad");
    return {
      meta: [
        { title: "Política de privacidad · Esmalia" },
        {
          name: "description",
          content:
            "Cómo Esmalia trata los datos de tu clínica, de tus pacientes y de quien usa nuestras herramientas gratuitas: qué guardamos, para qué, con qué proveedores, dónde y por cuánto tiempo.",
        },
        { name: "robots", content: "index,follow" },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: Privacidad,
});

const enlace = "text-brand-700 underline underline-offset-2";

function Correo({ a }: { a: string }) {
  return (
    <a href={`mailto:${a}`} className={enlace}>
      {a}
    </a>
  );
}

function Privacidad() {
  return (
    <LegalPage
      label="Legal"
      title="Política de privacidad"
      updated="Versión 3 · 10 de octubre de 2026 · MAXNOVA & LUCI Global LLC"
    >
      <LegalNotice>
        Tu clínica es la responsable de los datos de sus pacientes; Esmalia los procesa como
        encargado del tratamiento, para que la aplicación funcione. Si eres paciente de una clínica
        que usa Esmalia y quieres ejercer un derecho sobre tus datos (acceso, corrección, borrado),
        el camino es contactar directamente a tu clínica — nosotros ejecutamos el pedido técnico que
        tu clínica nos indique.
        <br />
        <br />
        Si llegaste aquí desde la calculadora o desde un material gratuito y todavía no eres
        paciente ni tienes cuenta, lo tuyo es distinto y está separado a propósito en la{" "}
        <strong>sección 3</strong>: ahí no somos encargados de nadie, el responsable de esos datos
        somos nosotros.
        <br />
        <br />
        Las reglas entre Esmalia y cada clínica sobre los datos de pacientes están en el{" "}
        <a href="/dpa" className={enlace}>
          Acuerdo de tratamiento de datos
        </a>
        .
      </LegalNotice>

      <LegalH2>1. Quién es responsable y qué papel cumple cada uno</LegalH2>
      <LegalP>
        Esmalia lo opera MAXNOVA &amp; LUCI Global LLC, una LLC constituida en el estado de Florida,
        Estados Unidos. Para cualquier consulta de privacidad, escríbenos a{" "}
        <Correo a="privacidad@esmalia.com" />. Ese correo lo lee el equipo que opera Esmalia, no un
        buzón automático.
      </LegalP>
      <LegalP>Según de qué datos hablemos, el papel de Esmalia cambia:</LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Datos de pacientes</strong> (ficha, historia clínica, citas, pagos, mensajes): la{" "}
          <strong>clínica es la responsable</strong>. Ella decide qué datos carga, para qué y por
          cuánto tiempo. Esmalia es el <strong>encargado</strong>: los trata solo para prestar el
          servicio y siguiendo las instrucciones de la clínica, nunca para fines propios.
        </LegalLi>
        <LegalLi>
          <strong>Datos de las personas que usan la cuenta de la clínica</strong> (nombre, email,
          rol) <strong>y datos de facturación</strong> de la suscripción: aquí Esmalia es{" "}
          <strong>responsable</strong>, porque los necesitamos para darte acceso y cobrar el
          servicio.
        </LegalLi>
        <LegalLi>
          <strong>Datos que nos dejas en el sitio web</strong> (calculadora, materiales gratuitos):
          Esmalia es <strong>responsable</strong>. Están en la sección 3.
        </LegalLi>
      </LegalUl>
      <LegalP>
        Hoy no tenemos un representante legal designado en Chile. Si la ley chilena nos exige
        designar uno, lo designamos y lo publicamos en esta misma página, con nombre y forma de
        contacto — no en un anexo aparte.
      </LegalP>

      <LegalH2>2. Qué datos recopilamos</LegalH2>
      <LegalP>Según cómo uses Esmalia, procesamos:</LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Datos de tu cuenta de staff</strong>: nombre, email, rol dentro de la clínica. Si
          entras con tu cuenta de Google, recibimos de Google tu nombre y tu email; tu contraseña de
          Google nunca pasa por Esmalia.
        </LegalLi>
        <LegalLi>
          <strong>Datos de facturación de la clínica</strong>: plan, estado de la suscripción y
          fechas de cobro. Los datos de la tarjeta los recibe y guarda Stripe; Esmalia no los ve.
        </LegalLi>
        <LegalLi>
          <strong>Datos de pacientes</strong> que tu clínica carga: identidad, contacto, fecha de
          nacimiento, historia clínica y notas, odontograma, documentos adjuntos, presupuestos, plan
          de tratamiento y pagos.
        </LegalLi>
        <LegalLi>
          <strong>Datos del portal de auto-agendamiento</strong>: cuando un paciente pide una cita
          por el link que le comparte la clínica.
        </LegalLi>
        <LegalLi>
          <strong>Datos del portal de laboratorio</strong>: si la clínica comparte un enlace con su
          laboratorio dental, el laboratorio ve las órdenes de trabajo que la clínica le asigna
          (nombre del paciente, descripción del trabajo, piezas y fechas), y nada más.
        </LegalLi>
        <LegalLi>
          <strong>Mensajes de WhatsApp</strong>: si tu clínica conecta su número, los mensajes
          enviados y recibidos por ese canal (incluyendo los de personas que escriben sin ser
          pacientes todavía, para poder darles seguimiento como contacto nuevo).
        </LegalLi>
      </LegalUl>
      <LegalP>
        <strong>Los datos de salud son datos sensibles.</strong> La historia clínica, el
        odontograma, las notas y los diagnósticos son datos de salud, y la ley los protege más que
        al resto. Por eso tienen las restricciones más fuertes de Esmalia: solo los ven los roles
        clínicos (sección 7), no se guardan en la copia local para consultar sin conexión (sección
        4) y nunca los usamos para nada distinto de que la clínica atienda a sus pacientes. No los
        usamos para entrenar modelos de IA, no los usamos para publicidad y no los vendemos.
      </LegalP>
      <LegalP>
        <strong>Para qué usamos estos datos.</strong> No es un uso genérico de "operar el servicio"
        — son finalidades concretas:
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Darte acceso a tu cuenta de staff</strong> y aplicar los permisos de tu rol dentro
          de la clínica.
        </LegalLi>
        <LegalLi>
          <strong>
            Que tu clínica lleve la ficha, el odontograma, los presupuestos y los pagos
          </strong>{" "}
          de sus pacientes — la razón de ser de la aplicación.
        </LegalLi>
        <LegalLi>
          <strong>Procesar las citas que un paciente pide</strong> por el link del portal de
          auto-agendamiento.
        </LegalLi>
        <LegalLi>
          <strong>Dar seguimiento por WhatsApp o por email</strong> a pacientes y a personas que
          escriben sin ser pacientes todavía, cuando la clínica conecta esos canales y su equipo
          decide enviar el mensaje.
        </LegalLi>
        <LegalLi>
          <strong>Generar resúmenes o borradores con IA</strong> — por ejemplo de notas clínicas —
          solo cuando el profesional lo pide de forma explícita. El borrador lo revisa y lo firma el
          profesional; la IA no firma nada.
        </LegalLi>
        <LegalLi>
          <strong>Entender si un mensaje de WhatsApp pide una hora.</strong> Cuando alguien le
          escribe a la clínica por WhatsApp, Esmalia intenta leer con reglas fijas si pide, mueve o
          cancela una cita. Si las reglas no alcanzan y la IA está activada, se envía a la IA solo
          el texto de ese mensaje (hasta 500 caracteres). El resultado es una sugerencia para el
          equipo: nunca confirma, mueve ni cancela una cita por su cuenta.
        </LegalLi>
        <LegalLi>
          <strong>Cobrar la suscripción</strong> de la clínica y avisarle sobre pagos.
        </LegalLi>
        <LegalLi>
          <strong>Enviarle correos de servicio a la clínica</strong>, solo a quienes administran la
          cuenta (propietarios y administradores) y nunca a pacientes: la bienvenida al crear la
          clínica, el aviso de que termina la prueba gratis, la confirmación de la suscripción, el
          aviso de un pago que no se pudo cobrar y un resumen semanal opcional con los indicadores
          de la clínica. El resumen semanal trae en cada envío un enlace para darte de baja con un
          clic, y también se desactiva desde Preferencias; los avisos sobre la cuenta y los pagos
          son parte del servicio y no se pueden desactivar.
        </LegalLi>
        <LegalLi>
          <strong>Detectar y corregir errores</strong> de la aplicación (sección 6, Sentry).
        </LegalLi>
      </LegalUl>
      <LegalP>
        <strong>Con qué base tratamos todo esto.</strong> Con los datos de pacientes, Esmalia actúa
        como encargado: la base de legitimidad la fija tu clínica, que es la responsable — en
        general, la atención de salud que te está dando y la relación que tienes con ella. Con las
        cuentas de staff y la facturación, la base es el contrato de servicio entre Esmalia y la
        clínica: sin cuenta no hay aplicación que usar. Los datos de quien todavía no es paciente ni
        cliente van por otro camino, con sus propias finalidades y sus propias bases, y por eso
        tienen su sección aparte más abajo.
      </LegalP>

      <LegalH2>3. Si usaste la calculadora o pediste un material nuestro</LegalH2>
      <LegalP>
        Este es el caso distinto a todo lo anterior: alguien que entra al sitio, usa una herramienta
        gratuita o pide un material, y todavía no es paciente de nadie ni tiene cuenta en Esmalia.
        Ahí no hay clínica de por medio — el responsable de esos datos somos nosotros, directamente.
      </LegalP>
      <LegalP>
        <strong>Qué te pedimos.</strong> Un email o un WhatsApp (al menos uno de los dos, porque sin
        eso no hay a dónde mandarte lo que pediste) y el país de tu clínica. Tu nombre y el nombre
        de la clínica son opcionales: si los dejas en blanco, el formulario se envía igual. De la
        conexión guardamos un hash de tu dirección IP — no la IP — y el navegador con el que
        enviaste.
      </LegalP>
      <LegalP>
        <strong>Las cifras que escribes en la calculadora no llegan a nuestro servidor.</strong> El
        cálculo ocurre en tu navegador. Lo único que viaja con el formulario es una clasificación
        por rangos del resultado (por ejemplo <em>margen: bajo</em>, <em>ausencias: alto</em>), y el
        servidor descarta cualquier valor numérico que llegue en ese campo. Cuánto factura tu
        clínica no tiene por qué salir de tu pantalla si todavía no eres cliente.
      </LegalP>
      <LegalP>
        <strong>Eso es elaboración de perfiles, y preferimos decirlo con todas las letras.</strong>{" "}
        Guardar <em>margen: bajo</em> para decidir a quién contactar primero y con qué mensaje es
        elaboración de perfiles en los términos de la Ley 21.719, no un detalle técnico. Lo que no
        hay es una decisión automatizada: nadie queda aprobado, rechazado ni puntuado por un
        algoritmo — una persona lee el rango y decide si te escribe. Puedes oponerte a esa
        clasificación escribiéndonos, y no hace falta que expliques por qué.
      </LegalP>
      <LegalP>
        <strong>Para qué usamos esos datos, y con qué base cada cosa.</strong> Son finalidades
        distintas y no vienen en el mismo paquete:
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Enviarte el material que pediste</strong> — base: tu consentimiento, el de la
          casilla que tuviste que marcar tú (no viene marcada de fábrica).
        </LegalLi>
        <LegalLi>
          <strong>Escribirte por email para contarte qué es Esmalia</strong> — base: ese mismo
          consentimiento, cuyo texto exacto guardamos junto con la fecha en que lo diste.
        </LegalLi>
        <LegalLi>
          <strong>Escribirte por WhatsApp con novedades comerciales</strong> — base: un
          consentimiento aparte, con su propia casilla. Dejar el número para recibir el material no
          alcanza: si no marcaste esa segunda casilla, por WhatsApp no te escribimos.
        </LegalLi>
        <LegalLi>
          <strong>Priorizar a quién contactamos</strong>, con los rangos del párrafo anterior —
          base: nuestro interés legítimo en no mandarle lo mismo a todo el mundo. Es la finalidad a
          la que te puedes oponer sin que se caiga el resto.
        </LegalLi>
        <LegalLi>
          <strong>Frenar bots y envíos repetidos</strong>, con el hash de la IP — base: nuestro
          interés legítimo en que el formulario no se llene de basura. Por eso guardamos el hash y
          no la dirección: para contar envíos alcanza.
        </LegalLi>
        <LegalLi>
          <strong>Poder probar que nos diste el consentimiento</strong>, guardando la fecha y el
          texto literal que aceptaste — base: la propia ley, que pone esa carga de la prueba en
          nosotros y no en ti. Si el texto del formulario cambia después, seguimos sabiendo cuál
          aceptaste tú.
        </LegalLi>
      </LegalUl>
      <LegalP>
        <strong>El trato es explícito.</strong> La calculadora y los materiales son gratis, y lo
        único que pedimos a cambio son tus datos de contacto. Lo decimos así de directo a propósito:
        la ley chilena admite ese intercambio cuando está declarado y a la vista — el consentimiento
        como única contraprestación —, no cuando viene escondido entre la letra chica.
      </LegalP>
      <LegalP>
        <strong>Cuánto tiempo los guardamos.</strong> Nuestro compromiso es no quedarnos con tu
        contacto más de 24 meses desde tu última interacción con nosotros (el último formulario que
        enviaste o el último mensaje que nos escribiste) si no llegaste a ser cliente: pasado ese
        plazo, borramos el contacto completo — email, teléfono, nombre y los rangos.{" "}
        <strong>Hoy ese borrado no es automático</strong> — no hay un proceso que lo ejecute solo
        cuando se cumple el plazo, lo hacemos a mano. Si quieres asegurarte de que se cumplió, o
        pedirlo antes de los 24 meses, escríbenos (ver &quot;Cómo te das de baja&quot; abajo) en vez
        de asumir que ya pasó.
      </LegalP>
      <LegalP>
        <strong>Cómo te das de baja.</strong> Cuando quieras, gratis, sin explicar por qué y sin que
        intentemos convencerte de lo contrario. Hoy el camino es escribirnos a{" "}
        <Correo a="privacidad@esmalia.com" /> diciendo que quieres la baja: dejamos de escribirte
        apenas lo leemos y borramos tu email y tu teléfono dentro de los 30 días.{" "}
        <strong>Todavía no existe un enlace de un clic para darte de baja solo.</strong> Cuando
        exista, va a estar en cada mensaje que te mandemos y lo vas a leer aquí. Preferimos decirlo
        así antes que prometer un botón que no está.
      </LegalP>
      <LegalP>
        <strong>A ti no te escribe ningún sistema automático.</strong> Los únicos correos
        automáticos de Esmalia son los de servicio a clínicas que ya tienen cuenta (sección 2). Si
        dejas tu dirección en la calculadora o al pedir un material, queda guardada para que podamos
        escribirte a mano, no para que un sistema te empiece a mandar cosas por su cuenta. Si eso
        cambia, lo vas a leer aquí antes.
      </LegalP>

      <LegalH2>4. Dónde se almacenan</LegalH2>
      <LegalP>
        La base de datos, los archivos y la autenticación viven en Supabase, en la región sa-east-1
        (São Paulo, Brasil). La aplicación se sirve desde Vercel, con sus funciones de servidor
        también en São Paulo (región gru1). El acceso a los datos de cada clínica está aislado a
        nivel de base de datos (row-level security): el personal de una clínica no puede ver datos
        de otra clínica, ni siquiera con un error de código de por medio.
      </LegalP>
      <LegalP>
        <strong>Copia local para consultar.</strong> Para que la clínica pueda seguir consultando
        información durante un corte de internet, el navegador del equipo guarda una copia de parte
        de los datos. Esa copia se limita a lo necesario para atender: agenda, listado y ficha
        básica de pacientes, y catálogos de la clínica (sucursales, profesionales, procedimientos).{" "}
        <strong>
          Las notas clínicas, el odontograma y el detalle de pagos no se guardan en esta copia
        </strong>{" "}
        — para consultarlos hace falta conexión. Esta copia queda asociada al usuario que inició
        sesión, se borra al cerrar sesión y caduca a los 7 días.
      </LegalP>
      <LegalP>
        <strong>Cola temporal para lo que se registra sin conexión.</strong> Es un espacio aparte
        del anterior: cuando el equipo cobra, agenda, edita una nota clínica o marca el odontograma
        sin internet, esa captura queda guardada en el navegador hasta que pueda subirse — sí,
        incluyendo el contenido clínico en ese caso puntual. No es una copia adicional de toda la
        historia del paciente: solo lo que efectivamente se registró estando offline, y desaparece
        del equipo en cuanto sincroniza. Si el servidor detecta que otra persona cambió lo mismo
        mientras tanto, ninguna de las dos versiones se pierde: ambas quedan visibles para que el
        profesional decida cuál vale.
      </LegalP>

      <LegalH2>5. Transferencias internacionales</LegalH2>
      <LegalP>
        Hay varias, y conviene decirlas sin rodeos. Los datos están alojados en Brasil (São Paulo),
        no en el país de tu clínica. Quien opera Esmalia es una empresa constituida en Estados
        Unidos, así que el equipo que administra la base accede desde fuera de Chile. Y algunos
        proveedores de la sección 6 procesan datos en Estados Unidos u otros países (por ejemplo, la
        IA, el monitoreo de errores y las copias de respaldo). Esto vale tanto para los datos de la
        clínica y sus pacientes como para los de captación de la sección 3.
      </LegalP>
      <LegalP>
        <strong>
          No te vamos a decir que existe una declaración de nivel adecuado a favor de Brasil o de
          Estados Unidos, porque no nos consta.
        </strong>{" "}
        Lo que sí podemos afirmar es lo que hacemos: la comunicación viaja cifrada, el aislamiento
        entre clínicas está en la base de datos y no en la pantalla (sección 7), las copias de
        respaldo salen cifradas, el acceso a producción está limitado a las personas que operan
        Esmalia y cada proveedor está sujeto a sus propios compromisos contractuales de
        confidencialidad y seguridad. Las condiciones de estas transferencias para los datos de
        pacientes están en el{" "}
        <a href="/dpa" className={enlace}>
          Acuerdo de tratamiento de datos
        </a>
        ; si tu clínica necesita una copia firmada, escríbenos y la firmamos.
      </LegalP>

      <LegalH2>6. Con quién compartimos datos (subencargados)</LegalH2>
      <LegalP>
        No vendemos datos a nadie. Usamos estos proveedores para que Esmalia funcione. Cada uno
        recibe solo lo que necesita para su tarea:
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Supabase</strong> — base de datos, autenticación y almacenamiento de archivos.
          Ubicación: São Paulo, Brasil.
        </LegalLi>
        <LegalLi>
          <strong>Vercel</strong> — aloja y sirve la aplicación y el sitio. Funciones de servidor en
          São Paulo, Brasil (región gru1); entrega de páginas por su red global.
        </LegalLi>
        <LegalLi>
          <strong>Resend</strong> — entrega los correos que salen de Esmalia: los de servicio a la
          clínica (sección 2), los que la clínica decide enviar a un paciente por email desde la
          aplicación y el aviso interno cuando alguien deja sus datos en el sitio. Procesa la
          dirección de destino, el asunto y el contenido. Envío desde São Paulo, Brasil; empresa de
          Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>Stripe</strong> — cobra la suscripción de la clínica a Esmalia. Los datos de la
          tarjeta los recibe y guarda Stripe; Esmalia no los ve ni los almacena. No procesa pagos de
          pacientes. Ubicación: Estados Unidos y otros países donde opera.
        </LegalLi>
        <LegalLi>
          <strong>Google</strong> — dos usos distintos. (a) <em>Iniciar sesión con Google</em>, si
          eliges esa opción: Google nos confirma tu nombre y tu email. (b) <em>Gemini</em>, el
          modelo detrás de Patty, el asistente de IA de Esmalia: procesa el texto que se le envía en
          los dos casos de la sección 2 (un borrador o resumen que pide el profesional, o un mensaje
          de WhatsApp que las reglas no supieron leer). Ubicación: Estados Unidos y otros países
          donde opera Google.
        </LegalLi>
        <LegalLi>
          <strong>OpenAI</strong> — proveedor de IA alternativo: solo se usa si Gemini no está
          configurado, para las mismas dos tareas y con el mismo texto. Ubicación: Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>Sentry</strong> — recibe los informes de error de la aplicación, cuando el
          monitoreo está activo. Antes de enviar un informe, Esmalia quita las cookies, los
          encabezados de la solicitud (donde viajan las credenciales de sesión) y el cuerpo de la
          solicitud; del usuario solo queda un identificador interno, sin nombre ni email; y se
          tachan los valores de datos que aparezcan en los mensajes de error de la base. Ubicación:
          Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>Cloudflare</strong> — administra el dominio esmalia.com (DNS) y reenvía los
          correos que llegan a direcciones @esmalia.com hacia el buzón del equipo, alojado en Google
          (Gmail). Por ahí pasan los correos que nos escribes, incluidos los pedidos de privacidad.
          Red global.
        </LegalLi>
        <LegalLi>
          <strong>Backblaze B2</strong> — guarda las copias de respaldo diarias de la base de datos.
          Las copias se cifran antes de salir hacia Backblaze, con una clave que Backblaze no tiene:
          para ellos son archivos ilegibles. Ubicación: Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>GitHub</strong> — guarda el código de Esmalia y ejecuta las tareas programadas (el
          respaldo diario, el resumen diario del equipo y los correos de servicio). El respaldo se
          genera en una máquina temporal de GitHub y se cifra ahí mismo, antes de subirse; la
          máquina se descarta al terminar. Ubicación: Estados Unidos.
        </LegalLi>
        <LegalLi>
          <strong>Meta (WhatsApp Cloud API)</strong> — solo si tu clínica conecta su número de
          WhatsApp; procesa los mensajes que se envían y reciben por ese canal. Ubicación: Estados
          Unidos y otros países donde opera Meta.
        </LegalLi>
        <LegalLi>
          <strong>Calendly</strong> — solo si alguien de la clínica agenda la llamada de
          incorporación: recibe el nombre de la clínica y el email de quien agenda. No recibe datos
          de pacientes. Ubicación: Estados Unidos.
        </LegalLi>
      </LegalUl>
      <LegalP>
        Si sumamos o cambiamos un proveedor que trate datos de pacientes, actualizamos esta lista y
        avisamos a las clínicas con 30 días de anticipación, como dice el{" "}
        <a href="/dpa" className={enlace}>
          Acuerdo de tratamiento de datos
        </a>
        .
      </LegalP>
      <LegalP>
        Los datos de captación de la sección 3 viven en la misma base de Supabase, no pasan por
        ninguna plataforma de marketing ni por ningún CRM de terceros, y no se los damos a nadie
        más. Tampoco los vendemos — eso vale para todo lo de esta página, no solo para los datos
        clínicos. También podemos tener que entregar datos a una autoridad cuando una ley o una
        orden judicial nos obligue; si eso pasa con datos de pacientes, le avisamos a la clínica
        salvo que la ley nos lo prohíba.
      </LegalP>

      <LegalH2>7. Seguridad</LegalH2>
      <LegalP>
        Toda la comunicación viaja cifrada (HTTPS con TLS). La base de datos y los archivos quedan
        cifrados en reposo por el proveedor (Supabase). El acceso a fichas clínicas está restringido
        por rol: recepción, por ejemplo, no puede ver notas clínicas. Los registros clínicos y del
        odontograma quedan versionados — nunca se sobrescriben, así que siempre hay un historial de
        quién cambió qué.
      </LegalP>
      <LegalP>
        Algunas cosas concretas que construimos para que esto no quede solo en un párrafo:
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>
            Los datos de cada clínica están separados a nivel de base de datos, no solo de pantalla.
          </strong>{" "}
          No es que la app "oculte" los pacientes de otra clínica en la interfaz: es la base de
          datos misma la que impide la consulta, así que ni un bug de programación en Esmalia podría
          hacer que el personal de una clínica termine viendo pacientes de otra.
        </LegalLi>
        <LegalLi>
          <strong>
            Las notas clínicas tienen un registro de auditoría que escribe la base de datos
          </strong>
          , no la aplicación: quién creó, editó, firmó o revisó cada nota, y cuándo se usó IA.
          Ningún usuario puede escribir ni inventar entradas en ese registro.
        </LegalLi>
        <LegalLi>
          <strong>
            Los mensajes de WhatsApp que llegan por la API se verifican criptográficamente
          </strong>{" "}
          antes de procesarse: cada mensaje entrante trae una firma que Esmalia valida contra un
          secreto compartido con Meta, así que un mensaje no puede hacerse pasar por tráfico
          legítimo de WhatsApp si no viene realmente de ahí.
        </LegalLi>
        <LegalLi>
          <strong>La historia clínica y el odontograma no se pueden "editar por encima".</strong>{" "}
          Cada cambio queda como una entrada nueva con quién y cuándo, no como una edición que borra
          lo anterior — si alguna vez hace falta reconstruir qué pasó con un paciente, la
          información está.
        </LegalLi>
        <LegalLi>
          <strong>Copias de respaldo diarias y cifradas.</strong> La clave para descifrarlas no está
          en los servidores de Esmalia ni en los de quien guarda las copias.
        </LegalLi>
      </LegalUl>
      <LegalP>
        Esmalia es una empresa chica y todavía no tiene certificaciones formales de seguridad de la
        información (por ejemplo SOC 2 o ISO 27001) — son procesos costosos que están fuera de
        alcance en esta etapa. Lo de arriba son controles que sí están construidos y en uso hoy, no
        una promesa de certificación futura.
      </LegalP>

      <LegalH2>8. Si hay un incidente de seguridad</LegalH2>
      <LegalP>
        Si detectamos un acceso indebido, una pérdida o una filtración que afecte datos de
        pacientes, se lo avisamos a la clínica sin demoras indebidas, con el objetivo de hacerlo
        dentro de las 72 horas desde que lo confirmamos. El aviso dice qué pasó, qué datos están
        involucrados, qué hicimos para contenerlo y qué recomendamos hacer. Como la clínica es la
        responsable, es ella quien decide si avisa a sus pacientes y a la autoridad, y le damos la
        información que necesite para hacerlo. Si el incidente afecta datos de los que Esmalia es
        responsable (cuentas de staff, facturación o captación), avisamos nosotros a las personas
        afectadas y a la autoridad cuando la ley lo exija.
      </LegalP>

      <LegalH2>9. Cuánto tiempo guardamos los datos</LegalH2>
      <LegalP>
        <strong>Datos de la clínica y de sus pacientes.</strong> Mientras la cuenta de la clínica
        esté activa. La clínica puede exportar sus datos desde la aplicación en cualquier momento,
        también antes de cerrar la cuenta. Después de que termina el servicio, si la clínica nos lo
        pide por escrito a <Correo a="privacidad@esmalia.com" />, eliminamos sus datos o se los
        devolvemos dentro de los 30 días siguientes al pedido. Mientras no recibamos esa
        instrucción, no los usamos para nada más que devolvérselos a la clínica. La historia clínica
        además tiene plazos legales de conservación propios en cada país: esos los define la clínica
        como responsable, no nosotros.
      </LegalP>
      <LegalP>
        <strong>Copias de respaldo.</strong> Los datos borrados no desaparecen en el mismo instante
        de las copias de respaldo: siguen en ellas, cifradas, hasta que esas copias rotan. Las
        copias diarias que guardamos en Backblaze se conservan hasta 90 días; las copias automáticas
        del proveedor de base de datos rotan en pocos días. No restauramos datos borrados desde una
        copia salvo para recuperarnos de una falla.
      </LegalP>
      <LegalP>
        <strong>Datos de captación.</strong> Tienen su propio plazo, más corto y con número: 24
        meses desde tu última interacción, en la sección 3.
      </LegalP>
      <LegalP>
        <strong>Eventos de medición.</strong> No llevan datos de contacto (sección 10). El hash de
        IP que acompaña al envío del formulario solo tiene sentido dentro de la hora siguiente, que
        es la ventana del límite de envíos; pasada esa hora no lo volvemos a consultar.
      </LegalP>

      <LegalH2>10. Cookies y almacenamiento en tu navegador</LegalH2>
      <LegalP>
        Esmalia usa únicamente cookies funcionales, necesarias para que la aplicación funcione.{" "}
        <strong>No usamos cookies de analítica ni de publicidad.</strong> Las que existen son:
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Clínica activa</strong>: recuerda con qué clínica estás trabajando, si tu usuario
          pertenece a más de una. Dura hasta un año.
        </LegalLi>
        <LegalLi>
          <strong>Sesión del portal del paciente</strong>: mantiene abierta la sesión de quien entra
          por el link de auto-agendamiento. Dura hasta 7 días.
        </LegalLi>
        <LegalLi>
          <strong>Sesión del portal de laboratorio</strong>: lo mismo, para el laboratorio que entra
          por el link de la clínica. Dura hasta 90 días.
        </LegalLi>
      </LegalUl>
      <LegalP>
        Además, la aplicación guarda en el almacenamiento local del navegador: la sesión de tu
        usuario (para que no tengas que entrar cada vez), tu preferencia de tema claro u oscuro,
        algunos ajustes de pantalla y de prueba de correo, el plan que elegiste en la página de
        precios antes de crear la cuenta (se borra al cerrar la pestaña), y la copia local y la cola
        sin conexión que explicamos en la sección 4. Todo eso se queda en tu equipo y se borra al
        cerrar sesión o al limpiar los datos del navegador.
      </LegalP>
      <LegalP>
        <strong>Cómo medimos sin cookies.</strong> En las páginas públicas contamos qué página se
        vio, de qué sitio llegaste (solo el dominio, por ejemplo google.com, nunca la dirección
        completa), las etiquetas de campaña del enlace si las trae (utm_source, utm_medium y
        utm_campaign) y el país aproximado que informa nuestro proveedor de hosting, sin guardar tu
        dirección IP. También contamos que se vio o usó la calculadora, que se envió el formulario y
        que se hizo clic en un botón. Si creas una cuenta, contamos sin tus datos que la cuenta se
        creó, que la clínica quedó configurada, que se agendó la primera cita y que se inició o
        activó la suscripción. Todo va con un identificador aleatorio que se genera al abrir la
        pestaña, se guarda solo en el almacenamiento de esa pestaña y desaparece cuando la cierras.
        Cada evento lleva solo su nombre, ese identificador y etiquetas cortas, nunca cifras de tu
        clínica, tu email ni datos de contacto. No te seguimos entre visitas y no hay Google
        Analytics ni PostHog: la política de seguridad del sitio los bloquea directamente en el
        navegador.
      </LegalP>

      <LegalH2>11. Tus derechos</LegalH2>
      <LegalP>
        Sobre tus datos puedes pedir <strong>acceso</strong> (saber qué tenemos),{" "}
        <strong>rectificación</strong> (corregir lo que está mal), <strong>supresión</strong> (que
        lo borremos), <strong>oposición</strong> (que dejemos de usarlo para algo),{" "}
        <strong>portabilidad</strong> (llevarte una copia en un formato que sirva) y{" "}
        <strong>bloqueo</strong> (que lo dejemos sin usar mientras se resuelve un reclamo). Son los
        derechos de la Ley 19.628 de Chile, reforzados por la Ley 21.719, que entra en vigencia el 1
        de diciembre de 2026, y de leyes parecidas de otros países donde trabajamos, como México,
        Colombia, Perú y Argentina. A quién se lo pides depende de qué relación tengas con nosotros:
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Si eres paciente de una clínica que usa Esmalia</strong>: pídeselo a tu clínica,
          que es la responsable de tus datos. Nosotros ejecutamos a nivel técnico lo que ella nos
          indique. Si nos escribes a nosotros, le pasamos tu pedido a tu clínica y te avisamos que
          lo hicimos.
        </LegalLi>
        <LegalLi>
          <strong>Si eres parte del staff de una clínica</strong>: tu clínica administra tu cuenta —
          pídele a ella la corrección o la baja. Sobre los datos de tu cuenta que trata Esmalia
          también puedes escribirnos directamente.
        </LegalLi>
        <LegalLi>
          <strong>Si dejaste tus datos en la calculadora o en un material</strong>: escríbenos
          directamente a nosotros, sin intermediarios. Ahí no hay ninguna clínica de por medio: el
          responsable somos nosotros y te respondemos nosotros.
        </LegalLi>
      </LegalUl>
      <LegalP>
        <strong>Cómo ejercerlos.</strong> Escribe a <Correo a="privacidad@esmalia.com" /> diciendo
        qué derecho quieres ejercer y sobre qué datos. Es gratis. Si hace falta, te pedimos algo que
        confirme que eres tú, para no entregarle tus datos a otra persona. Te respondemos dentro de
        los 30 días desde que recibimos el pedido; si por la complejidad necesitamos más tiempo, te
        lo decimos dentro de ese plazo y te explicamos por qué.
      </LegalP>

      <LegalH2>12. Reclamar ante la autoridad</LegalH2>
      <LegalP>
        Si crees que estamos tratando mal tus datos, puedes reclamar ante la Agencia de Protección
        de Datos Personales, el organismo que crea la Ley 21.719 en Chile, o ante la autoridad de
        protección de datos de tu país. Nos gustaría que nos escribas primero para poder arreglarlo,
        pero no estás obligado: el reclamo no depende de que hables con nosotros antes.
      </LegalP>

      <LegalH2>13. Cambios a esta política</LegalH2>
      <LegalP>
        Si hacemos un cambio importante en cómo tratamos los datos, lo vamos a reflejar aquí con la
        versión y la fecha actualizadas y, si corresponde, avisamos por email a las clínicas.
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Versión 3 — 10 de octubre de 2026.</strong> Se publica con el nombre Esmalia y el
          dominio esmalia.com. Se aclaran los papeles de la clínica y de Esmalia (sección 1); se
          agrega que los datos de salud son sensibles; se completa la lista de proveedores con su
          finalidad y ubicación (Vercel, Google, OpenAI, Sentry, Cloudflare, Backblaze, GitHub,
          Calendly) y el aviso de 30 días antes de cambiarlos; se describe el uso de IA para leer
          mensajes de WhatsApp; se agregan las medidas de seguridad, el aviso de incidentes con
          objetivo de 72 horas, los plazos de devolución y supresión al terminar el servicio y de
          las copias de respaldo, la lista real de cookies y almacenamiento local, el derecho de
          bloqueo y el plazo de 30 días para responder; y se publica el Acuerdo de tratamiento de
          datos.
        </LegalLi>
        <LegalLi>
          <strong>Versión 2 — 8 de septiembre de 2026.</strong> Se agregó la sección de captación
          (sección 3) con sus finalidades separadas, la declaración de elaboración de perfiles, el
          plazo de conservación de los leads y cómo pedir la baja; las transferencias fuera de Chile
          (sección 5); la base de legitimidad de cada tratamiento; y el derecho a reclamar ante la
          Agencia.
        </LegalLi>
        <LegalLi>
          <strong>Versión 1 — agosto de 2026.</strong> Primera versión, solo sobre los datos de la
          clínica y de sus pacientes.
        </LegalLi>
      </LegalUl>

      <LegalH2>14. Contacto</LegalH2>
      <LegalP>
        Para consultas sobre privacidad: <Correo a="privacidad@esmalia.com" />. Para preguntas
        generales: <Correo a="hola@esmalia.com" />.
      </LegalP>
    </LegalPage>
  );
}
