import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "para",
  path: "/para/dentista-independiente",
  titulo: "Software para dentista independiente | Esmalia",
  descripcion:
    "Qué necesita un dentista independiente en su software, qué le sobra con un sillón y cómo elegir. Plan Solo de Esmalia: US$29/mes, 14 días gratis.",
  kicker: "Para dentistas independientes",
  h1: "Software dental para el dentista que atiende solo",
  resumen:
    "Si atiendes solo con un sillón, necesitas agenda con recordatorios por WhatsApp, ficha con odontograma, presupuestos y saber quién te debe. Lo demás puede esperar. El plan Solo de Esmalia cubre eso por US$29 al mes, para un profesional, con 14 días gratis y sin tarjeta.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué necesitas de verdad con un solo sillón?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Cuando eres dentista, recepcionista y cobrador a la vez, el software tiene que ahorrarte tiempo entre paciente y paciente, no pedirte más. Cuatro cosas hacen la diferencia:",
        },
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "**Que nadie falte sin aviso.** Esmalia te deja listo el recordatorio por WhatsApp 48 h y 3 h antes de cada cita, y lo envías con un toque. Quien no responde queda en una lista, no en tu memoria. Más en [recordatorios por WhatsApp](/funciones/recordatorios-whatsapp).",
            "**La historia en un lugar.** Ficha clínica con [odontograma FDI](/funciones/odontograma) versionado, notas clínicas y consentimientos.",
            "**Saber quién te debe.** El [presupuesto](/funciones/presupuestos) aceptado se vuelve plan de tratamiento y cada pago descuenta el saldo. En la pantalla Hoy ves qué pacientes del día tienen deuda.",
            "**Que no dependa del internet.** Si se corta la conexión sigues atendiendo; todo se sincroniza cuando vuelve. WhatsApp sí necesita conexión.",
          ],
        },
      ],
    },
    {
      h2: "¿Qué te sobra si atiendes solo?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Muchos sistemas venden módulos pensados para clínicas con equipo. Con un sillón, varios no te cambian nada y sí te suben el precio:",
        },
        {
          tipo: "tabla",
          columnas: ["Función", "¿La necesitas solo?", "Dónde está en Esmalia"],
          filas: [
            ["Agenda y recordatorios por WhatsApp", "Sí", "Plan Solo"],
            ["Ficha clínica y odontograma", "Sí", "Plan Solo"],
            ["Caja y presupuestos", "Sí", "Plan Solo"],
            [
              "Importar pacientes desde una planilla",
              "Sí, si vienes de otro sistema",
              "Todos los planes",
            ],
            [
              "Roles y permisos por persona",
              "No, salvo que tengas asistente con acceso",
              "Plan Clínica",
            ],
            ["Comisiones por profesional", "No: no hay a quién liquidar", "Plan Clínica"],
            ["Portal de pacientes para pedir hora", "Útil, no imprescindible", "Plan Clínica"],
            ["Multisede e inventario", "No", "Plan Red"],
          ],
          nota: "Si más adelante sumas un colega o una asistente con su propio acceso, el plan Clínica cubre hasta 3 profesionales por US$69 al mes.",
        },
      ],
    },
    {
      h2: "¿Cómo elegir software dental si trabajas solo?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Antes de decidir, prueba cualquier sistema con un día real de tu agenda. Esta lista sirve para comparar Esmalia con cualquier otro:",
        },
        {
          tipo: "lista",
          items: [
            "**Precio por profesional, no por módulo.** Pregunta qué queda fuera del precio publicado.",
            "**Prueba sin tarjeta.** Si te piden la tarjeta para mirar, ya estás comprando.",
            "**Recordatorios que controlas.** Que puedas ver qué mensaje sale y a quién, antes de que salga.",
            "**Moneda y hora de tu país.** Que los montos no se redondeen mal y la agenda no se corra una hora.",
            "**Funciona sin internet.** Pregunta qué pasa si se cae la conexión a mitad de una consulta.",
            "**Te llevas tus datos.** Que te entreguen todo en un formato estándar si te vas, rápido y sin trabas.",
            "**Qué no hace.** Por ejemplo, si emite o no boletas y facturas en tu país.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "Esmalia **no emite boletas ni facturas electrónicas** en ningún país. Registra cobros y saldos; el documento tributario lo sigues emitiendo donde lo haces hoy. Detalle por país en [Chile](/software-dental-chile) y [Argentina](/software-dental-argentina).",
        },
      ],
    },
    {
      h2: "¿Qué incluye el plan Solo de Esmalia?",
      bloques: [
        {
          tipo: "p",
          texto:
            "US$29 al mes para un profesional, cobrados en dólares por Stripe. Incluye agenda y ficha clínica, recordatorios por WhatsApp, caja y presupuestos, importación de pacientes por planilla y soporte directo con el equipo que lo construye. Quienes entran en esta etapa conservan el precio mientras sean clientes.",
        },
        {
          tipo: "p",
          texto:
            "Para escribir menos al final del día llegará [Patty](/funciones/patty-ia), la IA de Esmalia, hoy en habilitación: pasará tus apuntes a una nota SOAP y resumirá la nota para la próxima consulta. Propone, no decide: no firma notas, no le escribe a tus pacientes y no mueve tu agenda.",
        },
        {
          tipo: "p",
          texto:
            "Tienes 14 días gratis sin tarjeta. Si no te suscribes, la agenda, los pacientes y la ficha siguen abiertos; finanzas, informes y el resto del análisis se activan al suscribirte. Mira los [precios](/precios) o [entra a la demo](/demo).",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Cuál es el mejor software dental para un dentista independiente?",
      a: "El que cubre agenda con recordatorios, ficha con odontograma, presupuestos y saldos sin cobrarte por módulos de clínica grande. Esmalia lo hace con el plan Solo, a US$29 al mes, con 14 días gratis y sin tarjeta.",
    },
    {
      q: "¿Necesito comisiones o portal de pacientes si atiendo solo?",
      a: "Las comisiones no: no hay a quién liquidar. El portal de pacientes es útil pero no imprescindible. Los dos vienen en el plan Clínica; el plan Solo no los incluye.",
    },
    {
      q: "¿Puedo pasar mis pacientes desde una planilla de Excel?",
      a: "Sí. Esmalia importa pacientes desde un archivo CSV en todos los planes, así no los cargas a mano. Desde Excel puedes guardar la planilla como CSV.",
    },
    {
      q: "¿Qué pasa si después contrato una asistente o sumo un colega?",
      a: "Te cambias al plan Clínica: hasta 3 profesionales por US$69 al mes, con roles para que cada persona vea solo lo suyo, comisiones y portal de pacientes.",
    },
  ],
  relacionados: [
    "/para/clinica-dental",
    "/funciones/recordatorios-whatsapp",
    "/funciones/ficha-clinica",
    "/guias/inasistencias-clinica-dental",
    "/software-dental-chile",
    "/precios",
  ],
  enUnaLinea:
    "Qué necesita y qué le sobra a un dentista que atiende solo, checklist para elegir software y plan Solo de Esmalia a US$29 al mes.",
};
