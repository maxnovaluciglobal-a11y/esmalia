import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalH2, LegalP, LegalUl, LegalLi, LegalNotice } from "@/components/legal-page";
import { canonicalHead } from "@/lib/seo";

export const Route = createFileRoute("/terminos")({
  head: () => {
    const canonical = canonicalHead("/terminos");
    return {
      meta: [
        { title: "Términos de servicio · Esmalia" },
        {
          name: "description",
          content:
            "Términos de servicio de Esmalia, software de gestión para clínicas dentales: planes, cobro, cancelación, datos y responsabilidades.",
        },
        { name: "robots", content: "index,follow" },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: Terminos,
});

const enlace = "text-brand-700 underline underline-offset-2";

function Terminos() {
  return (
    <LegalPage
      label="Legal"
      title="Términos de servicio"
      updated="Versión 4 · 20 de octubre de 2026 · MAXNOVA & LUCI Global LLC"
    >
      <LegalNotice>
        Esmalia está en etapa de piloto: plan Solo a US$29/mes (1 profesional), plan Clínica a
        US$69/mes (hasta 3 profesionales) y plan Red a medida. Prueba gratis de 14 días sin tarjeta.
        Los detalles de cobro están en la sección 6 y los precios vigentes en{" "}
        <a href="/precios" className={enlace}>
          Precios
        </a>
        . Estos términos van a evolucionar cuando el producto salga de piloto — te vamos a avisar
        antes de cualquier cambio importante.
        <br />
        <br />
        <strong>Qué cambió en la versión 4 (20 de octubre de 2026).</strong> El precio fundador es
        un descuento del 50 % durante 12 meses y después rige el precio de lista, con aviso de 30
        días (sección 6). Antes se describía como un precio que se conservaba mientras la
        suscripción siguiera activa.
      </LegalNotice>

      <LegalH2>1. Qué es Esmalia</LegalH2>
      <LegalP>
        Esmalia es un software como servicio (SaaS) para la gestión de clínicas dentales: agenda,
        fichas clínicas, odontograma, presupuestos, cobranza y mensajería por WhatsApp. Lo opera
        MAXNOVA &amp; LUCI Global LLC, una LLC constituida en Florida, Estados Unidos ("Esmalia",
        "nosotros"). Al crear una cuenta o usar la aplicación, la clínica acepta estos términos, la{" "}
        <a href="/privacidad" className={enlace}>
          Política de privacidad
        </a>{" "}
        y el{" "}
        <a href="/dpa" className={enlace}>
          Acuerdo de tratamiento de datos
        </a>
        , que forma parte de estos términos. Quien crea la cuenta declara que tiene facultades para
        aceptarlos en nombre de la clínica.
      </LegalP>

      <LegalH2>2. Tu cuenta</LegalH2>
      <LegalP>
        Eres responsable de mantener la confidencialidad de tus credenciales y de la actividad que
        ocurre bajo tu cuenta. Cada clínica administra sus propios usuarios y roles (dueño,
        administrador, dentista, asistente, recepción); es responsabilidad de la clínica asignar el
        rol correcto a cada persona, especialmente para el acceso a fichas clínicas, y quitar el
        acceso a quien deja de trabajar en ella.
      </LegalP>

      <LegalH2>3. Datos de tus pacientes</LegalH2>
      <LegalP>
        Los datos que cargas sobre tus pacientes (identidad, contacto, historia clínica,
        odontograma, presupuestos, pagos) son tuyos. Tu clínica es la responsable de esos datos
        frente a tus pacientes; Esmalia actúa como encargado del tratamiento, es decir, procesamos
        esos datos para que la aplicación funcione, pero no los usamos para otro fin ni se los
        vendemos a terceros. El detalle está en la{" "}
        <a href="/privacidad" className={enlace}>
          Política de privacidad
        </a>{" "}
        y en el{" "}
        <a href="/dpa" className={enlace}>
          Acuerdo de tratamiento de datos
        </a>
        .
      </LegalP>
      <LegalP>
        Eres responsable de contar con la base legal correspondiente (consentimiento del paciente, u
        otra que aplique en tu jurisdicción) para cargar y procesar los datos de tus pacientes en
        Esmalia, y de cumplir los plazos de conservación de la historia clínica que fije la ley de
        tu país.
      </LegalP>

      <LegalH2>4. Uso aceptable</LegalH2>
      <LegalP>No puedes usar Esmalia para:</LegalP>
      <LegalUl>
        <LegalLi>Cargar datos de personas que no son pacientes reales de tu clínica.</LegalLi>
        <LegalLi>
          Enviar mensajes por WhatsApp a quien no dio su número a tu clínica o no aceptó recibir
          comunicaciones (opt-in).
        </LegalLi>
        <LegalLi>Intentar acceder a datos de otra clínica distinta de la tuya.</LegalLi>
        <LegalLi>
          Intentar vulnerar la seguridad de Esmalia, sobrecargarla a propósito o copiar el software.
        </LegalLi>
        <LegalLi>Usar la aplicación para actividades ilegales en tu jurisdicción.</LegalLi>
      </LegalUl>

      <LegalH2>5. WhatsApp y mensajería</LegalH2>
      <LegalP>
        Si conectas el número de WhatsApp de tu clínica, los mensajes salientes (recordatorios,
        avisos de lista de espera, seguimiento de presupuestos, etc.) se despachan siempre desde tu
        clínica, con revisión del personal antes de cada envío. La única excepción es una respuesta
        automática: cuando alguien que no es paciente le escribe a tu número por primera vez,
        Esmalia le contesta una sola vez, a nombre de tu clínica, para avisarle que su mensaje llegó
        y que alguien del equipo le va a responder. Fuera de eso, Esmalia no manda mensajes sin que
        alguien de tu equipo lo dispare. El cumplimiento de las políticas de Meta/WhatsApp Business
        sobre plantillas y ventanas de mensajería es responsabilidad compartida entre tu clínica y
        Esmalia como proveedor técnico.
      </LegalP>

      <LegalH2>6. Planes, prueba gratis y cobro</LegalH2>
      <LegalUl>
        <LegalLi>
          <strong>Prueba gratis.</strong> Cada clínica nueva tiene 14 días gratis, sin dejar
          tarjeta. Si al terminar no te suscribes, agenda, pacientes, ficha clínica y la exportación
          de datos siguen abiertos; finanzas, comisiones, inventario y los demás informes se activan
          al suscribirte. Si te suscribes durante la prueba, el primer cobro ocurre al terminar la
          prueba, y si cancelas antes no te cobramos.
        </LegalLi>
        <LegalLi>
          <strong>Cobro mensual por adelantado y renovación automática.</strong> La suscripción es
          mensual, se cobra al inicio de cada período en dólares estadounidenses (USD) con la
          tarjeta que registraste en Stripe, y se renueva sola cada mes hasta que la canceles. El
          monto en tu moneda lo define el tipo de cambio de tu banco o tarjeta, que también puede
          cobrarte comisiones propias.
        </LegalLi>
        <LegalLi>
          <strong>Cancelación.</strong> Puedes cancelar cuando quieras desde la aplicación, en
          Suscripción, que te lleva al portal de pagos de Stripe. La cancelación corre al final del
          período que ya pagaste: hasta esa fecha sigues con acceso completo y después no se te
          vuelve a cobrar.
        </LegalLi>
        <LegalLi>
          <strong>Reembolsos.</strong> No devolvemos períodos parciales ni días sin usar, salvo que
          la ley aplicable lo exija. Si te cobramos por un error nuestro, te devolvemos ese monto.
          Si se devuelve el total de un cobro, la suscripción asociada se cancela.
        </LegalLi>
        <LegalLi>
          <strong>Cambios de precio.</strong> Si cambiamos el precio de un plan, te avisamos por
          email con al menos 30 días de anticipación, y el nuevo precio rige desde el primer cobro
          posterior a ese plazo. Si no estás de acuerdo, puedes cancelar antes de que rija. El
          precio fundador es un descuento del 50 % sobre el precio del plan durante 12 meses;
          después rige el precio de lista vigente, y te avisamos con 30 días de anticipación antes
          del primer cobro a ese precio.
        </LegalLi>
        <LegalLi>
          <strong>Si un pago falla.</strong> Stripe reintenta el cobro de forma automática durante
          los días siguientes y te mandamos un email avisando que no pudimos cobrar. Mientras el
          pago esté pendiente, quien es dueño de la cuenta ve la pantalla de Suscripción al entrar,
          para actualizar el medio de pago; el resto del equipo puede seguir usando la aplicación.
          Si después de los reintentos el pago no se concreta, la suscripción se cancela y el acceso
          a las funciones pagadas puede quedar suspendido hasta que se regularice. Tus datos no se
          borran por un pago fallido.
        </LegalLi>
        <LegalLi>
          <strong>Plan Red.</strong> Las condiciones del plan Red (varias sedes) se acuerdan por
          escrito con cada clínica; en lo que ese acuerdo no diga, rigen estos términos.
        </LegalLi>
        <LegalLi>
          <strong>Facturas.</strong> Puedes descargar tus comprobantes de pago desde el portal de
          Stripe.
        </LegalLi>
      </LegalUl>

      <LegalH2>7. Contenido clínico y uso de IA</LegalH2>
      <LegalP>
        Esmalia es una herramienta de gestión: no hace diagnósticos, no indica tratamientos y no
        reemplaza el criterio del profesional. Lo que se registra en la ficha clínica, el
        odontograma, los presupuestos y los planes de tratamiento es responsabilidad del profesional
        y de la clínica que lo registra. Lo mismo vale para los borradores y resúmenes que genera
        Patty, el asistente de IA: son una ayuda para redactar, pueden contener errores, y el
        profesional debe revisarlos antes de firmarlos o usarlos. Hoy Patty está pausada: no genera
        borradores ni resúmenes y no se envían datos a ningún proveedor de IA.
      </LegalP>

      <LegalH2>8. Propiedad intelectual</LegalH2>
      <LegalP>
        El software de Esmalia, su diseño y su marca son propiedad de MAXNOVA &amp; LUCI Global LLC.
        Te damos una licencia para usarlo mientras tengas una cuenta activa; no se te transfiere
        ninguna propiedad sobre el software. Los datos que cargas siguen siendo tuyos como se
        describe en la sección 3. Si nos mandas sugerencias, podemos usarlas para mejorar Esmalia
        sin obligación de pago.
      </LegalP>

      <LegalH2>9. Disponibilidad del servicio</LegalH2>
      <LegalP>
        Durante la etapa de piloto no ofrecemos un nivel de servicio (SLA) formal. Hacemos el mejor
        esfuerzo para mantener Esmalia disponible y avisamos con anticipación cuando sabemos que va
        a haber una interrupción planificada. Podemos modificar o agregar funcionalidades sin previo
        aviso mientras el producto está en desarrollo activo; si quitamos una función importante que
        pagas, te avisamos antes. Para soporte, escribe a{" "}
        <a href="mailto:soporte@esmalia.com" className={enlace}>
          soporte@esmalia.com
        </a>
        .
      </LegalP>

      <LegalH2>10. Terminación y tus datos</LegalH2>
      <LegalP>
        Puedes dejar de usar Esmalia y pedir el cierre de tu cuenta cuando quieras. Puedes exportar
        todos los datos de tu clínica desde Ajustes en cualquier momento, también antes de cerrar la
        cuenta (lo hace el dueño o un administrador). Si lo prefieres, escríbenos a{" "}
        <a href="mailto:soporte@esmalia.com" className={enlace}>
          soporte@esmalia.com
        </a>{" "}
        y te los enviamos. Dentro de la aplicación las historias clínicas no se borran: un paciente
        se archiva y su historia se conserva, para que puedas cumplir los plazos de conservación de
        tu país (sección 3). Después de que termina el servicio, si nos lo pides por escrito a{" "}
        <a href="mailto:privacidad@esmalia.com" className={enlace}>
          privacidad@esmalia.com
        </a>
        , eliminamos tus datos o te los devolvemos dentro de los 30 días siguientes al pedido. Las
        copias de respaldo cifradas se eliminan solas al rotar, como explica la Política de
        privacidad.
      </LegalP>
      <LegalP>
        Podemos suspender o cerrar una cuenta que incumpla la sección 4 (uso aceptable) o que no
        pague (sección 6), avisando el motivo salvo que la ley nos impida hacerlo. Si cerramos
        Esmalia como servicio, avisamos con al menos 30 días de anticipación para que puedas
        exportar tus datos.
      </LegalP>

      <LegalH2>11. Límite de responsabilidad</LegalH2>
      <LegalP>
        Esmalia se ofrece "tal cual", especialmente durante la etapa de piloto. En la medida que lo
        permita la ley aplicable:
      </LegalP>
      <LegalUl>
        <LegalLi>
          No somos responsables por daños indirectos, lucro cesante, pérdida de pacientes o de
          ingresos derivados del uso de la aplicación o de no poder usarla.
        </LegalLi>
        <LegalLi>
          Nuestra responsabilidad total frente a una clínica, por cualquier causa, tiene como tope
          lo que esa clínica nos pagó por Esmalia en los 12 meses anteriores al hecho que origina el
          reclamo.
        </LegalLi>
        <LegalLi>
          No respondemos por decisiones clínicas, por el contenido que carga la clínica ni por
          fallas de servicios de terceros que no controlamos (por ejemplo, la conexión a internet de
          la clínica o una caída de WhatsApp).
        </LegalLi>
      </LegalUl>
      <LegalP>
        Nada en estos términos limita la responsabilidad por dolo o negligencia grave, ni los
        derechos que la ley de tu país te da y que no se pueden renunciar por contrato.
      </LegalP>

      <LegalH2>12. Ley aplicable</LegalH2>
      <LegalP>
        Estos términos se rigen por las leyes del estado de Florida, Estados Unidos. Esto es sin
        perjuicio de las normas de tu país que no se pueden dejar de lado por contrato, en
        particular las de protección del consumidor y las de protección de datos personales y de
        salud, que siguen aplicando. Tampoco reemplaza las obligaciones locales que tu clínica tenga
        respecto a los datos de salud de sus pacientes — te recomendamos consultarlo con tu asesor
        legal local. Antes de cualquier reclamo formal, te pedimos escribirnos para intentar
        resolverlo de buena fe.
      </LegalP>

      <LegalH2>13. Cambios a estos términos</LegalH2>
      <LegalP>
        Si hacemos un cambio importante en estos términos te vamos a avisar por email o dentro de la
        aplicación antes de que entre en vigencia. Si sigues usando Esmalia después de esa fecha, se
        entiende que aceptas la nueva versión; si no estás de acuerdo, puedes cancelar.
      </LegalP>
      <LegalUl>
        <LegalLi>
          <strong>Versión 4 — 20 de octubre de 2026.</strong> Se redefine el precio fundador: pasa
          de "se conserva mientras la suscripción siga activa" a un 50 % de descuento durante 12
          meses y después el precio de lista, con aviso de 30 días (sección 6).
        </LegalLi>
        <LegalLi>
          <strong>Versión 3 — 19 de octubre de 2026.</strong> La exportación de datos vuelve a estar
          en la aplicación, también al terminar la prueba gratis, y sigue disponible el pedido a
          soporte (secciones 6 y 10); se indica que Patty está pausada (sección 7); y se aclara que
          las historias clínicas se archivan y no se borran (sección 10).
        </LegalLi>
        <LegalLi>
          <strong>Versión 2 — 10 de octubre de 2026.</strong> Se agregan las condiciones de planes,
          prueba gratis, cobro, renovación, cancelación, reembolsos, cambios de precio y pagos
          fallidos (sección 6); la responsabilidad del profesional sobre el contenido clínico y la
          IA (sección 7); la devolución y supresión de datos al terminar (sección 10); el tope de
          responsabilidad (sección 11); la ley de Florida como ley aplicable (sección 12); la
          respuesta automática de WhatsApp; y el Acuerdo de tratamiento de datos.
        </LegalLi>
        <LegalLi>
          <strong>Versión 1 — agosto de 2026.</strong> Primera versión.
        </LegalLi>
      </LegalUl>

      <LegalH2>14. Contacto</LegalH2>
      <LegalP>
        Para consultas sobre estos términos:{" "}
        <a href="mailto:hola@esmalia.com" className={enlace}>
          hola@esmalia.com
        </a>
        . Soporte:{" "}
        <a href="mailto:soporte@esmalia.com" className={enlace}>
          soporte@esmalia.com
        </a>
        . Privacidad:{" "}
        <a href="mailto:privacidad@esmalia.com" className={enlace}>
          privacidad@esmalia.com
        </a>
        .
      </LegalP>
    </LegalPage>
  );
}
