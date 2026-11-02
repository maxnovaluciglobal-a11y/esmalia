import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "guias",
  path: "/guias/inasistencias-clinica-dental",
  titulo: "Inasistencias en clínica dental: cómo bajarlas | Esmalia",
  descripcion:
    "Cómo medir la tasa de inasistencia en tu clínica dental, cuánto cuesta una silla vacía y cómo bajarla: confirmación 48 h y 3 h y lista de espera.",
  kicker: "Guía",
  h1: "Cómo medir y bajar las inasistencias en tu clínica dental",
  resumen:
    "La tasa de inasistencia es citas en que el paciente no vino ni avisó, dividido por citas agendadas, por 100. Mídela cada mes. Para bajarla funcionan tres cosas: confirmar 48 h antes, recordar 3 h antes y tener una lista de espera para llenar el hueco. Una política de cancelación clara ayuda a sostenerlo.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  secciones: [
    {
      h2: "¿Cómo se calcula la tasa de inasistencia?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Una inasistencia es una cita en la que el paciente no llegó y no avisó. Una cancelación con aviso no es lo mismo: te deja tiempo para ofrecer la hora a otra persona. Si las mezclas, el número no te dice qué arreglar.",
        },
        {
          tipo: "p",
          texto:
            "**Tasa de inasistencia (%) = citas con inasistencia del mes ÷ citas que debían ocurrir en el mes × 100.** En el denominador van las citas que seguían en pie el día de la atención: las que se cancelaron o se movieron con anticipación no cuentan.",
        },
        {
          tipo: "p",
          texto:
            "Mide aparte la **cancelación tardía**: la que llega con menos de 24 horas (o el margen que defina tu clínica). Para la agenda es casi igual de cara que una inasistencia, porque rara vez alcanzas a llenar ese hueco.",
        },
        {
          tipo: "tabla",
          columnas: ["Indicador", "Cómo se calcula", "Para qué sirve"],
          filas: [
            [
              "Tasa de inasistencia",
              "Inasistencias ÷ citas que debían ocurrir × 100",
              "El número principal. Compáralo mes a mes.",
            ],
            [
              "Cancelación tardía",
              "Cancelaciones con menos de 24 h ÷ citas que debían ocurrir × 100",
              "Muestra si tu política de cancelación se cumple.",
            ],
            [
              "Tasa de confirmación",
              "Pacientes que respondieron que vienen ÷ recordatorios enviados × 100",
              "Si baja, revisa el texto del mensaje o el horario de envío.",
            ],
            [
              "Huecos recuperados",
              "Huecos llenados desde la lista de espera ÷ huecos liberados × 100",
              "Dice cuánto de lo cancelado vuelves a facturar.",
            ],
          ],
          nota: "Con pocas citas en el mes, un porcentaje engaña. Si tienes menos de 20 casos, mira el conteo (por ejemplo, 3 de 15) y no el porcentaje.",
        },
      ],
    },
    {
      h2: "¿Cuánto es normal faltar?",
      bloques: [
        {
          tipo: "p",
          texto:
            "No encontramos un dato público y verificable de inasistencias en odontología para Chile, Perú, México, Colombia o Argentina. La referencia más citada es general de salud: una revisión sistemática de 105 estudios (Dantas y otros, Health Policy, 2018) estimó una tasa promedio del orden del 23 %, con extremos de 13,2 % en Oceanía y 43 % en África. No es una cifra dental ni latinoamericana, así que úsala solo como contexto.",
        },
        {
          tipo: "p",
          texto:
            "La misma revisión encontró que las inasistencias aumentan cuando la cita se agenda con mucha anticipación y cuando el paciente ya faltó antes. Eso te dice dónde mirar primero: pacientes con citas lejanas y pacientes con historial de ausencias.",
        },
        {
          tipo: "aviso",
          texto:
            "La mejor comparación es con tu propia clínica: tu tasa de este mes contra la de los tres meses anteriores. Una cifra de la industria de otro país no te dice si tu agenda mejoró.",
        },
      ],
    },
    {
      h2: "¿Cuánto cuesta una silla vacía?",
      bloques: [
        {
          tipo: "p",
          texto:
            "**Pérdida por inasistencias del mes = citas agendadas × (tasa de inasistencia ÷ 100) × ticket promedio por cita.** Es la misma fórmula que usa la [calculadora de rentabilidad dental](/calculadora-rentabilidad-dental), donde puedes ponerle tus números.",
        },
        {
          tipo: "p",
          texto:
            "Un ejemplo con números inventados para ilustrar: 320 citas al mes, 12 % de inasistencia y un ticket promedio de $40.000 dan 38 citas perdidas y unos $1.536.000 que no entraron. Y el arriendo, los sueldos del equipo de apoyo y el sillón se pagaron igual.",
        },
        {
          tipo: "p",
          texto:
            "Ojo con una trampa: ese monto es ingreso, no ganancia. Lo que de verdad pierdes es el margen de esas horas, porque los costos fijos ya estaban pagados. Aun así, una hora vacía casi nunca se recupera, y por eso conviene atacarla antes que otras fugas. Hay más ideas en el [checklist de fugas de dinero](/recursos/fugas-clinica-dental).",
        },
      ],
    },
    {
      h2: "¿Qué funciona para bajar las inasistencias?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Los recordatorios por mensaje tienen respaldo. Una revisión Cochrane de 2013 (Gurol-Urganci y otros, 8 ensayos, 6.615 participantes) concluyó que los recordatorios por mensaje de texto mejoran la asistencia frente a no recordar y rinden parecido a una llamada, con evidencia de calidad baja a moderada. La revisión no incluye WhatsApp en particular.",
        },
        {
          tipo: "lista",
          ordenada: true,
          items: [
            '**Confirmación 48 h antes.** Pide una respuesta concreta ("Responde SÍ para confirmar"). Dos días te dan margen para ofrecer la hora si el paciente no puede.',
            "**Recordatorio 3 h antes.** Corto, con la hora y la dirección. Sirve para el olvido del mismo día, que la confirmación de 48 h no cubre.",
            "**Llamada a quien no respondió.** Si a las 24 h un paciente no contestó la confirmación, una llamada corta resuelve más que un tercer mensaje.",
            "**Lista de espera activa.** Cuando se libera una hora, avisa a la lista de inmediato. Una cancelación avisada a tiempo se puede volver a vender.",
            "**Citas más cercanas.** Si puedes, evita agendar controles con meses de anticipación sin una confirmación intermedia.",
            "**Seguimiento a quien falta.** Contacta el mismo día al paciente que no vino y ofrécele otra hora. Si falta seguido, pídele confirmación siempre.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Tienes los textos listos para copiar en las [plantillas de WhatsApp para clínica dental](/plantillas/whatsapp-clinica-dental).",
        },
      ],
    },
    {
      h2: "¿Cómo se arma una lista de espera que sí se use?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "Anota en cada entrada el paciente, el tratamiento, el profesional y la franja que le sirve (mañana, tarde, días).",
            "Ordénala por urgencia clínica primero y por antigüedad después.",
            "Cuando se libere una hora, escribe a dos o tres personas a la vez y dale la hora a quien responda primero. Escribir de a una se come el tiempo.",
            "Saca de la lista a quien ya se atendió o rechazó dos ofertas seguidas.",
          ],
        },
      ],
    },
    {
      h2: "¿Qué debería decir tu política de cancelación?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Una política sirve si el paciente la conoce antes de agendar y si la clínica la aplica igual con todos. Ponla en el mensaje de confirmación de la cita y en la recepción. Si piensas cobrar por inasistencias, revisa antes la normativa de protección al consumidor de tu país y deja constancia de que el paciente la aceptó.",
        },
        {
          tipo: "plantilla",
          titulo: "Política de cancelación (base para adaptar)",
          texto:
            "En {clinica} reservamos tu hora solo para ti. Si no puedes venir, avísanos con al menos 24 horas de anticipación por WhatsApp o por teléfono y te ayudamos a reprogramar. Así podemos ofrecer esa hora a otro paciente que la está esperando. Si faltas sin avisar dos veces, te pediremos confirmar cada cita con anticipación antes de reservarla.",
        },
      ],
    },
    {
      h2: "¿Cómo te ayuda Esmalia con esto?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "Arma la lista de recordatorios de 48 h y 3 h antes de cada cita. Alguien de tu clínica los envía con un toque: ningún mensaje a pacientes sale solo. Detalle en [Conectar WhatsApp](/docs/whatsapp).",
            "Cuando se libera una hora, prepara el aviso para la lista de espera.",
            "La cita tiene su estado (por ejemplo, ausente o finalizada), así que la tasa sale de la agenda y no de una planilla aparte.",
            'Con el número de la clínica conectado, un "sí" del paciente queda anotado como aviso de asistencia, separado de la confirmación del profesional.',
            "Una pantalla de efectividad compara inasistencias con y sin recordatorio. Es una comparación observacional, no un experimento: la clínica elige a quién le escribe.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Puedes probarla 14 días sin tarjeta. Mira los planes en [precios](/precios) o entra a la [demo](/demo).",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Una cancelación con aviso cuenta como inasistencia?",
      a: "No. Inasistencia es no venir y no avisar. Las cancelaciones con menos de 24 horas conviene medirlas aparte como cancelación tardía.",
    },
    {
      q: "¿Cuántos recordatorios conviene mandar?",
      a: "Dos: una confirmación 48 horas antes y un recordatorio 3 horas antes. Si el paciente no responde la confirmación, una llamada suele rendir más que un tercer mensaje.",
    },
    {
      q: "¿Existe una tasa de inasistencia de referencia para clínicas dentales en Latinoamérica?",
      a: "No encontramos una publicada y verificable. La revisión más citada (Dantas y otros, 2018) da un promedio general de salud del orden del 23 %, pero no es dental ni latinoamericana.",
    },
  ],
  fuentes: [
    {
      titulo:
        "Dantas, Fleck, Cyrino Oliveira y Hamacher (2018). No-shows in appointment scheduling: a systematic literature review. Health Policy 122(4):412-421",
      url: "https://ideas.repec.org/a/eee/hepoli/v122y2018i4p412-421.html",
    },
    {
      titulo:
        "Gurol-Urganci y otros (2013). Mobile phone messaging reminders for attendance at healthcare appointments. Cochrane, CD007458",
      url: "https://www.cochrane.org/evidence/CD007458_mobile-phone-messaging-reminders-attendance-healthcare-appointments",
    },
  ],
  relacionados: [
    "/plantillas/whatsapp-clinica-dental",
    "/funciones/recordatorios-whatsapp",
    "/calculadora-rentabilidad-dental",
    "/recursos/fugas-clinica-dental",
  ],
  enUnaLinea:
    "Fórmula de la tasa de inasistencia, costo de una silla vacía y qué hacer: confirmación 48 h, recordatorio 3 h, lista de espera y política de cancelación.",
};
