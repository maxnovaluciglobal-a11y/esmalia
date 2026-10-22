import type { PaginaContenido } from "../tipos";

const BAJA = "Si prefieres no recibir estos mensajes, responde BAJA.";

export const pagina: PaginaContenido = {
  coleccion: "plantillas",
  path: "/plantillas/whatsapp-clinica-dental",
  titulo: "Plantillas de WhatsApp para clínica dental | Esmalia",
  descripcion:
    "28 mensajes de WhatsApp para copiar en tu clínica dental: confirmación 48 h, recordatorio 3 h, lista de espera, presupuestos, llamados a control y cobranza.",
  kicker: "Plantillas",
  h1: "28 plantillas de WhatsApp para tu clínica dental",
  resumen:
    "Estos 28 mensajes cubren lo que una recepción escribe todas las semanas: confirmar a 48 h, recordar a 3 h, reprogramar, ofrecer una hora de la lista de espera, seguir un presupuesto, saludar, llamar a control y cobrar con tacto. Cambia las variables entre llaves y pide el consentimiento del paciente antes de escribirle.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Cómo se usan estas plantillas?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Copia el texto, reemplaza lo que va entre llaves y revisa que suene a tu clínica. Son mensajes cortos a propósito: en WhatsApp se lee la primera línea y poco más.",
        },
        {
          tipo: "tabla",
          columnas: ["Variable", "Qué va"],
          filas: [
            ["{nombre}", "Nombre de pila del paciente (o del apoderado, si es menor)"],
            ["{fecha}", 'Día de la cita, escrito como se dice: "jueves 16 de octubre"'],
            ["{hora}", "Hora de la cita en hora local de la sede"],
            ["{clinica}", "Nombre de la clínica"],
            ["{profesional}", "Nombre del profesional que atiende"],
            ["{direccion}", "Dirección de la sede, con referencia si hace falta"],
            ["{tratamiento}", 'Nombre simple del tratamiento ("limpieza", "corona")'],
            ["{monto}", "Monto con su moneda"],
          ],
          nota: "Esmalia usa el mismo formato de variables entre llaves. Si una variable no tiene valor, queda escrita tal cual en el mensaje para que alguien lo note antes de enviar.",
        },
        {
          tipo: "aviso",
          texto:
            "Ningún texto de esta página reemplaza una indicación clínica. Los mensajes después de un tratamiento son genéricos a propósito: lo que el paciente debe o no debe hacer lo indica el profesional que lo atendió.",
        },
      ],
    },
    {
      h2: "¿Qué mensaje mandar para confirmar una cita 48 h antes?",
      bloques: [
        {
          tipo: "plantilla",
          titulo: "1. Confirmación estándar",
          texto:
            "Hola {nombre}, te escribimos de {clinica}. Tienes hora el {fecha} a las {hora} con {profesional}. ¿Nos confirmas que vienes? Responde SÍ para confirmar o escríbenos si necesitas cambiarla.",
        },
        {
          tipo: "plantilla",
          titulo: "2. Confirmación para primera visita",
          texto:
            "Hola {nombre}, te esperamos en {clinica} el {fecha} a las {hora}. Estamos en {direccion}. Te pedimos llegar 10 minutos antes para completar tu ficha. Responde SÍ para confirmar.",
        },
        {
          tipo: "plantilla",
          titulo: "3. Confirmación con preparación previa",
          texto:
            "Hola {nombre}, te recordamos tu hora en {clinica} el {fecha} a las {hora} para {tratamiento}. Si tu profesional te dio indicaciones para antes de la cita, tenlas presentes. ¿Confirmas tu asistencia? Responde SÍ.",
        },
        {
          tipo: "plantilla",
          titulo: "4. Confirmación a un paciente que ya faltó",
          texto:
            "Hola {nombre}, tienes hora en {clinica} el {fecha} a las {hora}. Para mantenerla necesitamos que nos confirmes antes de mañana a las 18:00. Si no te acomoda, avísanos y buscamos otra hora juntos.",
        },
      ],
    },
    {
      h2: "¿Y el recordatorio de 3 h antes?",
      bloques: [
        {
          tipo: "plantilla",
          titulo: "5. Recordatorio del día",
          texto:
            "Hola {nombre}, te esperamos hoy a las {hora} en {clinica}, {direccion}. Si tienes algún imprevisto, avísanos por aquí.",
        },
        {
          tipo: "plantilla",
          titulo: "6. Recordatorio con indicación de llegada",
          texto:
            "{nombre}, tu hora es hoy a las {hora} con {profesional}. Te pedimos llegar 10 minutos antes. Nos vemos en {clinica}.",
        },
        {
          tipo: "plantilla",
          titulo: "7. Recordatorio para el apoderado de un menor",
          texto:
            "Hola {nombre}, te recordamos la hora de tu hijo o hija hoy a las {hora} en {clinica}. Es necesario que venga acompañado por un adulto responsable.",
        },
      ],
    },
    {
      h2: "¿Cómo reprogramar sin perder al paciente?",
      bloques: [
        {
          tipo: "plantilla",
          titulo: "8. El paciente pide cambiar la hora",
          texto:
            "Gracias por avisar, {nombre}. Tenemos disponible {fecha} a las {hora}. ¿Te acomoda? Si no, dinos qué días y horarios te sirven y te ofrecemos otra opción.",
        },
        {
          tipo: "plantilla",
          titulo: "9. La clínica tiene que mover la cita",
          texto:
            "Hola {nombre}, te escribimos de {clinica}. Por un imprevisto, {profesional} no podrá atender el {fecha}. Te pedimos disculpas. ¿Te sirve otro día? Responde con tu disponibilidad y te damos prioridad.",
        },
        {
          tipo: "plantilla",
          titulo: "10. Cancelación recibida",
          texto:
            "Listo {nombre}, cancelamos tu hora del {fecha}. Cuando quieras retomar, escríbenos por aquí y te buscamos un horario.",
        },
        {
          tipo: "plantilla",
          titulo: "11. Después de una inasistencia",
          texto:
            "Hola {nombre}, hoy te esperábamos a las {hora} en {clinica} y no pudimos verte. ¿Está todo bien? Si quieres, te ofrecemos una nueva hora esta semana.",
        },
      ],
    },
    {
      h2: "¿Qué escribir cuando se libera una hora de la lista de espera?",
      bloques: [
        {
          tipo: "plantilla",
          titulo: "12. Alta en la lista de espera",
          texto:
            "{nombre}, te dejamos en nuestra lista de espera para {tratamiento}. Si se libera una hora antes, te escribimos por aquí.",
        },
        {
          tipo: "plantilla",
          titulo: "13. Se liberó una hora",
          texto:
            "Hola {nombre}, se liberó una hora el {fecha} a las {hora} con {profesional} en {clinica}. ¿La quieres? Se la damos a la primera persona que responda.",
        },
        {
          tipo: "plantilla",
          titulo: "14. La hora ya se ocupó",
          texto:
            "Gracias por responder, {nombre}. Esa hora ya se tomó, pero sigues en la lista y te avisamos con la próxima que se libere.",
        },
      ],
    },
    {
      h2: "¿Cómo hacer seguimiento a un presupuesto pendiente?",
      bloques: [
        {
          tipo: "plantilla",
          titulo: "15. Envío del presupuesto",
          texto:
            "Hola {nombre}, te enviamos el presupuesto de {tratamiento} que conversaste con {profesional}: {monto}. Si tienes dudas sobre el tratamiento o las formas de pago, respóndenos por aquí.",
        },
        {
          tipo: "plantilla",
          titulo: "16. Seguimiento a la semana",
          texto:
            "Hola {nombre}, ¿pudiste revisar el presupuesto de {tratamiento}? Si quieres, te ayudamos a agendar la primera sesión o resolvemos tus dudas por aquí.",
        },
        {
          tipo: "plantilla",
          titulo: "17. Último seguimiento",
          texto:
            "{nombre}, no queremos insistir de más. Tu presupuesto de {tratamiento} sigue disponible. Cuando decidas avanzar, escríbenos y lo retomamos. " +
            BAJA,
        },
      ],
    },
    {
      h2: "¿Qué mandar después de un tratamiento?",
      bloques: [
        {
          tipo: "plantilla",
          titulo: "18. Seguimiento a los dos o tres días",
          texto:
            "Hola {nombre}, te escribimos de {clinica} para saber cómo te has sentido después de tu atención con {profesional}. Si tienes alguna molestia o duda, respóndenos por aquí.",
        },
        {
          tipo: "plantilla",
          titulo: "19. Recordatorio de indicaciones",
          texto:
            "{nombre}, te recordamos seguir las indicaciones que te dio {profesional}. Si tienes dolor, sangrado o hinchazón que no ceden, llámanos o escríbenos de inmediato.",
        },
        {
          tipo: "plantilla",
          titulo: "20. Agendar el control",
          texto:
            "Hola {nombre}, tu tratamiento necesita un control. Tenemos hora el {fecha} a las {hora}. ¿Te acomoda? Si no, dinos qué horario te sirve.",
        },
      ],
    },
    {
      h2: "¿Vale la pena saludar en el cumpleaños?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Sí, si el paciente aceptó recibir mensajes de la clínica y el saludo es solo un saludo. No lo uses para vender.",
        },
        {
          tipo: "plantilla",
          titulo: "21. Saludo simple",
          texto:
            "¡Feliz cumpleaños, {nombre}! Todo el equipo de {clinica} te desea un gran día. " +
            BAJA,
        },
        {
          tipo: "plantilla",
          titulo: "22. Saludo de parte del profesional",
          texto:
            "Hola {nombre}, {profesional} y el equipo de {clinica} te saludan en tu cumpleaños. Que tengas un excelente día. " +
            BAJA,
        },
      ],
    },
    {
      h2: "¿Cómo recuperar a un paciente inactivo?",
      bloques: [
        {
          tipo: "plantilla",
          titulo: "23. Control de los seis meses",
          texto:
            "Hola {nombre}, ya pasaron seis meses desde tu última visita a {clinica}. ¿Agendamos tu control? Responde con los días que te sirven. " +
            BAJA,
        },
        {
          tipo: "plantilla",
          titulo: "24. Paciente que no viene hace un año",
          texto:
            "Hola {nombre}, hace un tiempo que no te vemos en {clinica}. Si quieres retomar tu control o tu tratamiento, escríbenos y te buscamos una hora. " +
            BAJA,
        },
        {
          tipo: "plantilla",
          titulo: "25. Tratamiento que quedó a medias",
          texto:
            "Hola {nombre}, tu tratamiento de {tratamiento} quedó pendiente. Retomarlo pronto es lo mejor para tu salud bucal. ¿Te ayudamos a agendar? " +
            BAJA,
        },
      ],
    },
    {
      h2: "¿Cómo cobrar una deuda sin incomodar?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Escribe en privado, sin detalles clínicos y sin tono de amenaza. El objetivo es que el paciente responda, no que se ofenda. No pongas links de pago que no hayas verificado.",
        },
        {
          tipo: "plantilla",
          titulo: "26. Primer aviso",
          texto:
            "Hola {nombre}, te escribimos de {clinica}. En nuestros registros figura un saldo pendiente de {monto}. Si ya lo pagaste, avísanos y lo revisamos. Si no, respóndenos y te contamos cómo pagarlo.",
        },
        {
          tipo: "plantilla",
          titulo: "27. Segundo aviso",
          texto:
            "Hola {nombre}, te recordamos el saldo pendiente de {monto} en {clinica}. Si te acomoda pagarlo en partes, dinos y lo conversamos.",
        },
        {
          tipo: "plantilla",
          titulo: "28. Propuesta de plan de pago",
          texto:
            "{nombre}, para facilitarte el pago de los {monto} pendientes podemos dividirlo en cuotas. Respóndenos con lo que te acomoda y lo dejamos acordado por escrito.",
        },
      ],
    },
    {
      h2: "¿Qué pasa con el consentimiento y con quien responde BAJA?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Pide el consentimiento por escrito** al registrar al paciente: que acepta recibir recordatorios y mensajes de la clínica por WhatsApp.",
            '**Separa lo transaccional de lo demás.** Confirmar o recordar una cita es parte de la atención. Cumpleaños, controles y seguimientos de presupuesto son contacto proactivo: ahí incluye siempre la salida ("responde BAJA").',
            "**Respeta la baja de inmediato** y para siempre, hasta que el paciente diga lo contrario.",
            "**Escribe en horario razonable** y nunca con datos clínicos sensibles en el texto.",
          ],
        },
        {
          tipo: "p",
          texto:
            "En Esmalia, con el número de la clínica conectado a Meta, un paciente que responde solo **BAJA**, **STOP** o **NO MÁS** queda marcado como baja y Esmalia deja de enviarle mensajes por WhatsApp (recordatorios, controles, cumpleaños, seguimientos). Si responde **CANCELAR**, la clínica lo recibe como un mensaje más, porque casi siempre quiere anular su cita. En modo manual (wa.me) la respuesta llega a tu WhatsApp y no a Esmalia, así que alguien de la clínica tiene que respetarla. Cómo funciona cada modo: [Conectar WhatsApp](/docs/whatsapp).",
        },
        {
          tipo: "aviso",
          texto:
            "En ningún modo Esmalia le escribe sola a un paciente: arma el mensaje y alguien de tu clínica lo envía. Para enviar desde tu número conectado, Meta revisa y aprueba cada plantilla antes de que se pueda usar.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Puedo usar estas plantillas en WhatsApp Business normal?",
      a: "Sí. Copia el texto, reemplaza las variables y envíalo. Si usas la API de WhatsApp con un número conectado, cada plantilla tiene que pasar antes por la aprobación de Meta.",
    },
    {
      q: "¿Por qué pedir que respondan SÍ?",
      a: "Una respuesta corta y concreta es fácil de contestar y fácil de leer para la recepción. Si el paciente escribe otra cosa, alguien del equipo lo revisa.",
    },
    {
      q: "¿Puedo incluir un link de pago en el mensaje de deuda?",
      a: "Solo si es un link de tu medio de pago que ya probaste. Si no, pide que respondan y explica cómo pagar en la conversación.",
    },
  ],
  relacionados: [
    "/guias/inasistencias-clinica-dental",
    "/funciones/recordatorios-whatsapp",
    "/docs/whatsapp",
    "/para/clinica-dental",
    "/plantillas/presupuesto-dental",
  ],
  enUnaLinea:
    "28 mensajes de WhatsApp para copiar: confirmación, recordatorio, reprogramación, lista de espera, presupuestos, post-tratamiento, cumpleaños, llamados a control y cobranza.",
};
