// src/content/ayuda/pantallas.ts
//
// "Cómo se usa esta pantalla" (ONB-02). Una entrada por pantalla principal,
// breve y verdadera según el código del 27-oct-2026 (olas 0-11). Si una
// pantalla cambia, se corrige acá en el mismo PR.
import type { AyudaPantalla, PantallaId } from "@/content/ayuda/tipos";

export const AYUDA_PANTALLAS: readonly AyudaPantalla[] = [
  {
    id: "hoy",
    nombre: "Hoy",
    resumen: "El día de la clínica de un vistazo: lo que requiere acción, la agenda y las cifras.",
    pasos: [
      {
        titulo: "Empieza por lo que requiere acción",
        texto:
          "Arriba aparecen las alertas de tu rol (citas sin confirmar, reservas en línea por aceptar, cajas sin cerrar, stock bajo…). Cada una lleva a donde se resuelve.",
      },
      {
        titulo: "Cierra las citas que ya pasaron",
        texto:
          "Si quedaron citas terminadas sin marcar, Hoy te lo avisa y puedes cerrarlas de una vez.",
      },
      {
        titulo: "Mira el día por profesional",
        texto:
          "La tarjeta oscura resume el día y cada profesional en su carril. «Abrir la agenda» lleva al día de hoy.",
      },
      {
        titulo: "Agenda o crea un paciente",
        texto:
          "«Agendar cita» abre la agenda en hoy. «Nuevo paciente» lleva a la lista de pacientes.",
      },
    ],
    tenEnCuenta: [
      "Cada rol ve sus propios bloques: recepción y profesionales no ven montos.",
      "El checklist «Activa tu clínica» desaparece solo cuando completas los pasos.",
    ],
    palabras: ["inicio", "panel", "resumen", "dashboard", "alertas"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Recorrer Hoy con la demo: alertas arriba y a dónde llevan, cerrar citas pasadas, tarjeta del día por profesional y los botones Agendar cita y Nuevo paciente.",
    },
  },
  {
    id: "agenda",
    nombre: "Agenda",
    resumen: "Agenda las citas, muévelas y sigue su estado durante el día.",
    pasos: [
      {
        titulo: "Elige la vista",
        texto:
          "Día, Semana, Boxes, Mes o Lista. En el celular se abre en Lista. Con «Hoy» y las flechas cambias de período.",
      },
      {
        titulo: "Crea una cita",
        texto:
          "«Nueva cita» (o la tecla N) abre el formulario: paciente, profesional, tipo, duración y box. Ctrl+Enter guarda.",
      },
      {
        titulo: "Sigue a cada paciente",
        texto:
          "Toca una cita para abrir su panel: pasar a sala, marcar finalizada, «No asistió», reagendar o abrir la ficha.",
      },
      {
        titulo: "Mueve citas",
        texto:
          "En la vista Semana se arrastra con el mouse o el dedo, o con Alt + flechas sobre la cita enfocada. Si choca con otra, te lo pregunta.",
      },
      {
        titulo: "Revisa solicitudes y lista de espera",
        texto:
          "«Solicitudes y espera» junta lo que pidieron los pacientes desde su portal y quién espera un hueco.",
      },
    ],
    tenEnCuenta: [
      "Las reservas en línea entran «por confirmar»: las acepta el profesional.",
      "Cancelar una cita la saca de la agenda; al paciente no se le avisa solo.",
      "Los recordatorios por WhatsApp se envían a mano desde la cita o desde Recordatorios.",
      "Sin permiso de agenda, la ves pero no la cambias.",
    ],
    palabras: ["cita", "citas", "turno", "hora", "agendar", "calendario", "reagendar", "box"],
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Crear una cita con la tecla N, cambiar de vista, abrir el panel de una cita y pasarla a sala, arrastrar una cita en Semana y abrir Solicitudes y espera.",
    },
  },
  {
    id: "mi-agenda",
    nombre: "Mi agenda",
    resumen: "Tus citas, solo las tuyas: las que esperan que las aceptes y las de hoy.",
    pasos: [
      {
        titulo: "Acepta lo que llegó",
        texto:
          "«Por aceptar» muestra las citas tentativas (por ejemplo, reservas en línea). «Aceptar» las deja confirmadas.",
      },
      {
        titulo: "Revisa tu día",
        texto: "«Hoy» lista tus citas del día con su estado.",
      },
    ],
    tenEnCuenta: [
      "Necesita que tu usuario esté vinculado a tu ficha de profesional. Si no lo está, usa la agenda general.",
      "Propietario y administración ven las de todo el equipo.",
    ],
    palabras: ["mis citas", "aceptar", "tentativa", "confirmar"],
    video: {
      estado: "pendiente",
      duracion: "1 min",
      guion: "Aceptar una cita tentativa desde Mi agenda y revisar el día propio.",
    },
  },
  {
    id: "pacientes",
    nombre: "Pacientes",
    resumen: "Busca, filtra y ordena la cartera de pacientes de la clínica.",
    pasos: [
      {
        titulo: "Busca",
        texto:
          "Por nombre, RUT (en cualquier formato), correo, teléfono o etiqueta. La tecla F lleva al buscador; ⌘K busca desde cualquier pantalla.",
      },
      {
        titulo: "Filtra con las cifras",
        texto:
          "Cada cifra de la franja oscura filtra la lista: activos, nuevos del mes, sin cita futura, sin visita, fichas incompletas.",
      },
      {
        titulo: "Crea un paciente",
        texto:
          "«Nuevo paciente» (o la tecla N). Al guardar eliges «Guardar y abrir ficha» o «Guardar y agendar cita».",
      },
      {
        titulo: "Actúa sobre varias fichas",
        texto:
          "Marca filas (Espacio) para etiquetar o archivar en lote. El menú ⋮ de cada fila agenda, cobra o abre WhatsApp.",
      },
      {
        titulo: "Guarda tus filtros",
        texto: "Un filtro que usas seguido se guarda como segmento, con su cifra al día.",
      },
    ],
    tenEnCuenta: [
      "Las fichas se archivan, nunca se borran.",
      "«Con saldo» y «Valor histórico» se ven solo con permiso de finanzas.",
      "«Importar» lleva a la migración de datos (propietario y administración).",
    ],
    palabras: ["paciente", "ficha", "cartera", "buscar", "rut", "etiqueta", "segmento", "archivar"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Buscar por RUT, filtrar con la franja de cifras, crear un paciente con Guardar y agendar, etiquetar dos fichas en lote y guardar un segmento.",
    },
  },
  {
    id: "ficha",
    nombre: "Ficha del paciente",
    resumen: "Todo del paciente en un lugar: clínico, presupuestos y pagos, documentos y mensajes.",
    pasos: [
      {
        titulo: "Arriba, lo urgente",
        texto: "Los datos clave, alertas (alergias) y el saldo si tienes permiso de finanzas.",
      },
      {
        titulo: "Recorre las pestañas",
        texto:
          "Odontograma, Periodontograma, Notas, Exámenes, Presupuesto y pagos, Anamnesis y datos, Documentos y Mensajes.",
      },
      {
        titulo: "Cobra y presupuesta",
        texto:
          "«Cobrar» abre Presupuesto y pagos con el pago listo. Ahí también está «Nuevo presupuesto».",
      },
      {
        titulo: "Agenda o escribe",
        texto:
          "«Agendar» crea su próxima cita; «WhatsApp» abre la conversación con el texto listo para enviar a mano.",
      },
      {
        titulo: "Más acciones",
        texto: "Programar un control, editar datos, exportar la ficha o archivarla.",
      },
    ],
    tenEnCuenta: [
      "Notas, odontograma clínico, periodontograma y documentos se ven solo con acceso clínico (propietario, administración, profesional y asistente con permiso).",
      "Una nota firmada no se edita: se corrige con una adenda.",
      "Cada apertura de la ficha queda registrada.",
      "Exámenes (radiografías, fotos, escaneos 3D, CBCT): cada clínica tiene un cupo de almacenamiento, 25 GB en el plan Solo y 75 GB en el plan Clínica. Avisamos al 80 % y, al llegar al 100 %, no se pueden subir más archivos hasta ampliar el cupo. Sube solo la serie que usas, no el estudio completo.",
    ],
    palabras: [
      "ficha",
      "historia clinica",
      "examenes",
      "almacenamiento",
      "cupo",
      "odontograma",
      "notas",
      "anamnesis",
      "adenda",
    ],
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Abrir una ficha de la demo, leer los datos clave, recorrer las pestañas, crear un presupuesto desde el odontograma y registrar un pago con Cobrar.",
    },
  },
  {
    id: "presupuestos",
    nombre: "Presupuestos",
    resumen: "Sigue todos los presupuestos de la clínica: pendientes, por vencer, aceptados.",
    pasos: [
      {
        titulo: "Filtra por estado",
        texto:
          "Pendientes, Por vencer, Aceptados, Rechazados, Vencidos o Todos. Busca por paciente o número.",
      },
      {
        titulo: "Abre uno",
        texto:
          "El detalle tiene Prestaciones, Pagos y abonos, Documentos e Historial. Desde ahí se emite, se acepta (total o parcial), se renueva o se rechaza.",
      },
      {
        titulo: "Envíalo",
        texto: "En Documentos: PDF, correo o WhatsApp.",
      },
    ],
    tenEnCuenta: [
      "Para crear un presupuesto, abre la ficha del paciente (pestaña Presupuesto y pagos).",
      "Un presupuesto rechazado no se vuelve a abrir.",
      "La lista se ve con permiso de finanzas.",
    ],
    palabras: ["presupuesto", "cotizacion", "plan de tratamiento", "aceptar", "vencido"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Filtrar presupuestos por vencer, abrir uno, enviarlo en PDF por correo y aceptarlo en parte.",
    },
  },
  {
    id: "caja",
    nombre: "Caja",
    resumen: "Abre tu caja, mira los movimientos del día y ciérrala con el arqueo.",
    pasos: [
      {
        titulo: "Abre tu caja",
        texto: "«Abrir mi caja» con el monto inicial del cajón. Cada persona tiene su caja.",
      },
      {
        titulo: "Cobra desde la ficha",
        texto:
          "Los pagos se registran en la ficha del paciente («Cobrar» o ⌘K → Registrar pago) y caen en la caja de quien cobra.",
      },
      {
        titulo: "Registra el efectivo que entra o sale",
        texto: "En Movimientos de efectivo: traspasos, retiros y depósitos, con su motivo.",
      },
      {
        titulo: "Cierra con el arqueo",
        texto:
          "Cuenta el cajón por billete y moneda (o anota el total). Si no cuadra, escribe el motivo y cierra.",
      },
    ],
    tenEnCuenta: [
      "Una caja cerrada no se vuelve a abrir: Esmalia te pide confirmar antes.",
      "«Atendidas sin cobro» muestra pacientes que se atendieron hoy y no pagaron.",
      "Esmalia no emite boleta electrónica: los folios de boletas emitidas afuera se anotan en Finanzas.",
    ],
    palabras: [
      "caja",
      "arqueo",
      "efectivo",
      "cobrar",
      "pago",
      "abono",
      "cerrar",
      "cierre",
      "turno",
    ],
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Abrir la caja con monto inicial, registrar un pago desde una ficha, anotar un retiro y cerrar con arqueo por billete, incluyendo el aviso de confirmación.",
    },
  },
  {
    id: "cuentas-por-cobrar",
    nombre: "Cuentas por cobrar",
    resumen: "Lo que los pacientes deben, con su atraso.",
    pasos: [
      {
        titulo: "Mira el total",
        texto: "Por cobrar, vencido y más de 90 días.",
      },
      {
        titulo: "Filtra",
        texto: "Por estado (vencidas, pago parcial, pagadas…) y por antigüedad.",
      },
      {
        titulo: "Cobra en la ficha",
        texto: "Cobrar, repartir en cuotas o anular una cuenta se hace en la ficha del paciente.",
      },
    ],
    tenEnCuenta: [
      "Una cuenta se crea sola al aceptar un presupuesto, por lo que paga el paciente.",
      "Se ve con permiso de finanzas.",
    ],
    palabras: ["deuda", "saldo", "morosidad", "cuotas", "vencido"],
    video: {
      estado: "pendiente",
      duracion: "1 min",
      guion: "Filtrar cuentas vencidas y abrir la ficha para cobrar una cuota.",
    },
  },
  {
    id: "finanzas",
    nombre: "Finanzas",
    resumen: "Cómo le fue a la clínica en el período: ingresos, gastos y producción.",
    pasos: [
      {
        titulo: "Elige el período",
        texto: "Este mes, mes anterior, 90 días o personalizado.",
      },
      {
        titulo: "Lee el resumen",
        texto:
          "Resumen del período, producción por profesional, gastos por categoría y conversión de presupuestos.",
      },
    ],
    tenEnCuenta: [
      "Gastos fijos, membresías y empresas con convenio tienen su propia pestaña.",
      "Se ve con permiso de finanzas.",
    ],
    palabras: ["ingresos", "gastos", "produccion", "utilidad", "folios", "contador"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Cambiar el período de Finanzas, leer producción por profesional y gastos por categoría, y exportar el CSV para el contador.",
    },
  },
  {
    id: "informes",
    nombre: "Informes",
    resumen: "Respuestas a preguntas del negocio: cómo vamos, agenda y boxes, embudo, equipo.",
    pasos: [
      {
        titulo: "Elige la pregunta",
        texto:
          "Cómo vamos, Arma tu informe, Agenda y boxes, Embudo, Pacientes, Equipo y Sucursales (según tu rol).",
      },
      {
        titulo: "Filtra",
        texto: "Por período, sucursal y profesional.",
      },
      {
        titulo: "Toca una cifra",
        texto: "Cualquier cifra abre los registros que la componen. Se exporta a CSV y PDF.",
      },
      {
        titulo: "Guarda tu informe",
        texto: "En «Arma tu informe» puedes guardarlo y compartirlo con el equipo.",
      },
    ],
    tenEnCuenta: [
      "Sin permiso de finanzas no se ven montos.",
      "El detalle muestra hasta 500 registros.",
    ],
    palabras: ["reportes", "estadisticas", "indicadores", "metricas", "embudo", "ocupacion"],
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Abrir Cómo vamos, tocar una cifra para ver el detalle, armar un informe por profesional y guardarlo, y ver el mapa de calor de la agenda.",
    },
  },
  {
    id: "seguimiento",
    nombre: "Seguimiento",
    resumen: "Que ningún paciente se pierda: tareas, controles y tratamientos detenidos.",
    pasos: [
      {
        titulo: "Revisa lo pendiente",
        texto: "Tareas, Controles, Tratamientos detenidos y Riesgo de abandono.",
      },
      {
        titulo: "Crea una tarea",
        texto: "«Nueva tarea» para ti o para alguien del equipo, con fecha.",
      },
      {
        titulo: "Escribe al paciente",
        texto: "Cada mensaje lo revisas y lo mandas tú.",
      },
    ],
    tenEnCuenta: [
      "Nada sale solo.",
      "El riesgo de abandono explica por qué marca a cada paciente; sus pesos son provisorios.",
    ],
    palabras: ["tareas", "controles", "recall", "abandono", "pendientes"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Crear una tarea, revisar controles pendientes y escribir a un paciente con tratamiento detenido.",
    },
  },
  {
    id: "campanas",
    nombre: "Campañas",
    resumen: "Escríbele a un grupo de pacientes por correo o WhatsApp y mide quién volvió.",
    pasos: [
      {
        titulo: "Crea la campaña",
        texto:
          "«Nueva campaña»: elige un segmento guardado o un filtro, el canal y el mensaje (desde una plantilla si quieres).",
      },
      {
        titulo: "Confirma la cifra",
        texto: "Antes de lanzarla ves cuántos pacientes la reciben.",
      },
      {
        titulo: "Envía",
        texto:
          "El correo sale desde el servidor. WhatsApp queda en una cola que se despacha a mano, uno por uno.",
      },
      {
        titulo: "Mide",
        texto: "«Quién volvió» muestra qué pacientes agendaron después.",
      },
    ],
    tenEnCuenta: [
      "Respeta las bajas, el tutor de los menores y el modo de prueba del correo.",
      "WhatsApp nunca sale solo: el envío masivo depende de la conexión con Meta.",
      "Solo propietario y administración.",
    ],
    palabras: ["campana", "marketing", "masivo", "correo", "segmento", "plantillas"],
    video: {
      estado: "pendiente",
      duracion: "3 min",
      guion:
        "Crear una campaña a un segmento, confirmar la cifra, enviar los correos y despachar la cola de WhatsApp a mano.",
    },
  },
  {
    id: "recordatorios",
    nombre: "Recordatorios",
    resumen: "Los avisos del día listos para enviar: citas, presupuestos y controles.",
    pasos: [
      {
        titulo: "Filtra",
        texto: "Todo, Citas, Presupuestos o Controles y seguimiento.",
      },
      {
        titulo: "Envía uno",
        texto: "Cada fila abre WhatsApp con el mensaje listo; tú lo envías.",
      },
      {
        titulo: "Envía todos",
        texto:
          "«Enviar todos» manda los correos de una vez y abre una cola guiada de WhatsApp, un clic por paciente.",
      },
    ],
    tenEnCuenta: [
      "Nada sale solo.",
      "Los correos automáticos al paciente (confirmación, recordatorio, encuesta) se encienden aparte, en Ajustes → Notificaciones a pacientes.",
    ],
    palabras: ["recordatorio", "aviso", "whatsapp", "confirmar", "48 h"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Enviar el recordatorio de 48 h a un paciente por WhatsApp y usar Enviar todos con la cola guiada.",
    },
  },
  {
    id: "mensajes",
    nombre: "Conversaciones",
    resumen: "Los mensajes de WhatsApp con tus pacientes.",
    pasos: [
      {
        titulo: "Filtra",
        texto: "Todas o «Sin responder».",
      },
      {
        titulo: "Responde",
        texto:
          "Si la clínica conectó WhatsApp con Meta y la ventana de 24 h está abierta, el botón dice «Enviar». Si no, «Abrir WhatsApp» con el texto listo.",
      },
    ],
    tenEnCuenta: [
      "Se cargan los 1.000 mensajes más recientes.",
      "La conexión directa con Meta está en habilitación; hoy lo normal es enviar por WhatsApp a mano.",
    ],
    palabras: ["whatsapp", "mensajes", "chat", "conversacion", "responder"],
    video: {
      estado: "pendiente",
      duracion: "1 min",
      guion: "Filtrar sin responder y contestar con Abrir WhatsApp.",
    },
  },
  {
    id: "reserva-en-linea",
    nombre: "Reserva en línea",
    resumen: "Tus pacientes eligen su hora desde un enlace; tú la aceptas.",
    pasos: [
      {
        titulo: "Define las reglas",
        texto:
          "Dirección del enlace, anticipación mínima, hasta cuántos días adelante, qué se puede reservar y el mensaje de bienvenida. «Guardar».",
      },
      {
        titulo: "Enciéndela",
        texto:
          "«Encender la reserva» necesita al menos un tipo de cita o prestación elegido. Se apaga igual de fácil.",
      },
      {
        titulo: "Compártela",
        texto: "Copia el enlace, usa el código para tu web, el QR o el enlace de cada profesional.",
      },
    ],
    tenEnCuenta: [
      "Las horas salen del mismo horario de la agenda (sucursal, bloqueos, citas y boxes).",
      "Cada reserva entra «por confirmar» y el paciente confirma su correo con un código.",
      "Solo propietario y administración.",
    ],
    palabras: ["reserva", "agendamiento", "online", "enlace", "qr", "widget"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Configurar reglas, encender la reserva, copiar el enlace y mostrar cómo llega una reserva por confirmar a la agenda.",
    },
  },
  {
    id: "laboratorios",
    nombre: "Laboratorios",
    resumen: "Las órdenes de trabajo enviadas a laboratorio y su estado.",
    pasos: [
      {
        titulo: "Crea una orden",
        texto:
          "«Nueva orden»: paciente, laboratorio, trabajo, color, material y fecha comprometida.",
      },
      {
        titulo: "Sigue el estado",
        texto: "Enviado, En proceso, Recibido, Reprocesar o Cancelado. Las atrasadas se marcan.",
      },
      {
        titulo: "Dale acceso al laboratorio",
        texto: "Cada laboratorio puede tener su enlace de portal (30 días) para ver sus órdenes.",
      },
    ],
    tenEnCuenta: ["Solo propietario y administración revocan el enlace del portal."],
    palabras: ["laboratorio", "orden", "protesis", "corona", "color vita"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Crear una orden con color VITA, seguir su estado y compartir el portal.",
    },
  },
  {
    id: "inventario",
    nombre: "Inventario",
    resumen: "Insumos y materiales, con lo que está bajo el mínimo o por vencer.",
    pasos: [
      {
        titulo: "Revisa los avisos",
        texto: "«Bajo el stock mínimo» y «Lotes por vencer» (60 días).",
      },
      {
        titulo: "Registra movimientos",
        texto: "En cada ítem: Movimiento, Conteo físico o Historial.",
      },
    ],
    tenEnCuenta: [
      "Crear y editar ítems: propietario y administración.",
      "Registrar movimientos: propietario, administración, profesional y asistente.",
      "Cuando un insumo cruza el mínimo, llega un aviso a la campana.",
    ],
    palabras: ["stock", "insumos", "materiales", "bodega", "vencimiento"],
    video: {
      estado: "pendiente",
      duracion: "1 min",
      guion: "Registrar una salida de insumo y un conteo físico.",
    },
  },
  {
    id: "comisiones",
    nombre: "Comisiones y Mi desempeño",
    resumen: "Cuánto comisiona cada profesional en el período y su liquidación.",
    pasos: [
      {
        titulo: "Elige el período",
        texto: "La tabla muestra producción, comisión y estado por profesional.",
      },
      {
        titulo: "Cierra el período",
        texto:
          "«Cerrar período» congela los montos con su detalle (propietario y administración). Después, «Marcar pagado».",
      },
      {
        titulo: "Mi desempeño",
        texto:
          "Cada profesional ve sus cifras. Es una estimación: lo final es la liquidación cerrada.",
      },
    ],
    tenEnCuenta: [
      "Las reglas tienen «rige desde»: cambiar una regla no toca lo ya liquidado.",
      "Para ver «Mi desempeño», tu usuario tiene que estar vinculado a tu ficha de profesional.",
    ],
    palabras: ["comision", "liquidacion", "porcentaje", "desempeno", "sueldo"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Revisar comisiones del mes, cerrar el período y marcar una liquidación pagada.",
    },
  },
  {
    id: "equipo",
    nombre: "Equipo y permisos",
    resumen: "Quién trabaja en la clínica, con qué rol y qué puede hacer.",
    pasos: [
      {
        titulo: "Invita",
        texto: "«Invitar integrante» con su correo y su rol. Le llega la invitación por correo.",
      },
      {
        titulo: "Ajusta el rol",
        texto: "Cambia el rol o la profesión de cada persona. Esmalia te muestra qué cambia.",
      },
      {
        titulo: "Permisos por persona",
        texto: "«Permisos» da o quita un permiso puntual sin cambiar el rol.",
      },
    ],
    tenEnCuenta: [
      "Ningún ajuste abre la historia clínica a recepción, contabilidad, coordinación o técnico/a, ni los pagos a un asistente.",
      "Solo propietario y administración gestionan el equipo.",
    ],
    palabras: ["usuarios", "roles", "invitar", "permisos", "acceso", "integrante"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion: "Invitar a una recepcionista, cambiarle el rol y quitarle un permiso puntual.",
    },
  },
  {
    id: "notificaciones",
    nombre: "Notificaciones",
    resumen: "La bandeja completa de la campana.",
    pasos: [
      {
        titulo: "Filtra",
        texto:
          "Todas o sin leer, y por tipo (notas clínicas, pacientes, operación). Cada aviso lleva a su lugar.",
      },
      {
        titulo: "Ordena",
        texto: "«Marcar todo como leído» o vuelve uno a «no leído».",
      },
    ],
    tenEnCuenta: [
      "Si apagaste los avisos en Preferencias, no se guardan: ahí mismo se vuelven a encender.",
    ],
    palabras: ["avisos", "campana", "alertas"],
    video: {
      estado: "pendiente",
      duracion: "1 min",
      guion: "Abrir la campana, ir a Notificaciones, filtrar sin leer y marcar todo.",
    },
  },
  {
    id: "ajustes",
    nombre: "Ajustes",
    resumen: "La configuración de la clínica, del equipo, de los cobros y de los mensajes.",
    pasos: [
      {
        titulo: "Busca el ajuste",
        texto:
          "«Buscar en ajustes» o recorre los grupos: Clínica, Equipo y acceso, Precios y cobro, Mensajería y Personal.",
      },
      {
        titulo: "Prueba otro rol",
        texto: "«Ver como otro rol» muestra la app como la vería esa persona (solo la pantalla).",
      },
      {
        titulo: "Tus datos",
        texto: "Propietario y administración descargan todos los datos de la clínica en un ZIP.",
      },
    ],
    tenEnCuenta: ["Muchos ajustes son solo de propietario y administración."],
    palabras: ["configuracion", "preferencias", "datos de la clinica", "exportar", "rol"],
    video: {
      estado: "pendiente",
      duracion: "2 min",
      guion:
        "Buscar un ajuste, usar Ver como otro rol y descargar la exportación completa de la clínica.",
    },
  },
];

const POR_ID = new Map(AYUDA_PANTALLAS.map((p) => [p.id, p]));

export function ayudaDePantalla(id: PantallaId | null): AyudaPantalla | null {
  return id ? (POR_ID.get(id) ?? null) : null;
}
