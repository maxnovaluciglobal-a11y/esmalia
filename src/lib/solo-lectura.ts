/**
 * Modo solo lectura por suscripción (auditoría 360, BIL-01, siguiente paso
 * del PR #69). Lógica pura, compartida por el servidor (el chequeo real, en
 * `solo-lectura.middleware.ts`) y la interfaz (banner y botones).
 *
 * Cuándo: el nivel `restringido` de `accesoPorSuscripcion` por pago — gracia
 * de cobro fallido agotada, suscripción cancelada, impaga o pausada, período
 * vencido sin renovar. La prueba gratis vencida sin pago queda fuera (solo se
 * pausan los informes) salvo que se active `SOLO_LECTURA_EN_PRUEBA_VENCIDA`.
 * Durante la gracia todo sigue abierto.
 *
 * Qué se puede: VER todo, exportar (botón de #67), ver y descargar fichas y
 * documentos, ir a Suscripción y pagar. Qué no: crear ni editar nada (citas,
 * pacientes, notas, pagos, presupuestos, etc.).
 *
 * Excepción clínica: una nota clínica de una cita en curso (ver
 * `esCitaEnCurso`). Una urgencia no espera a que se regularice el pago, y
 * dejar al profesional sin registro de lo que hizo es peor para el paciente
 * y para la clínica (la historia clínica es obligatoria).
 */
import { accesoPorSuscripcion, type Subscription } from "@/lib/billing";

/**
 * Lo que devuelve el servidor cuando rechaza una escritura. Es el texto que
 * ven los toasts y la cola offline (`marcarFallido`), así que tiene que
 * explicar qué pasa y qué hacer. No delata nada que el equipo no sepa: el
 * banner ya lo dice.
 */
export const MENSAJE_SOLO_LECTURA =
  "Tu clínica está en modo solo lectura porque la suscripción no está al día. Puedes ver y exportar todo; para volver a crear y editar, regulariza el pago en Suscripción.";

/** Explicación corta para botones deshabilitados (tooltip / texto de ayuda). */
export const EXPLICACION_BOTON_SOLO_LECTURA =
  "No disponible en modo solo lectura: regulariza el pago en Suscripción para volver a crear y editar.";

/**
 * Interruptor: ¿la prueba gratis vencida sin pago también entra en solo
 * lectura? Hoy NO (decisión comercial pendiente de Walter): solo se le pausan
 * los informes, como antes. Para activarlo, cambiar a `true` (una línea; el
 * banner, los botones y el servidor lo siguen solos).
 */
export const SOLO_LECTURA_EN_PRUEBA_VENCIDA = false;

export function soloLectura(sub: Subscription | null | undefined, ahora: Date = new Date()) {
  if (sub === undefined) return false;
  const acceso = accesoPorSuscripcion(sub, ahora);
  if (acceso.nivel !== "restringido") return false;
  if (acceso.motivo === "trial_vencido") return SOLO_LECTURA_EN_PRUEBA_VENCIDA;
  return true;
}

export function esErrorSoloLectura(error: unknown): boolean {
  return error instanceof Error && error.message === MENSAJE_SOLO_LECTURA;
}

/**
 * Criterio mínimo de "cita en curso" para la excepción de urgencia clínica.
 *
 * Una cita del paciente en esa clínica, que no esté cancelada ni marcada
 * ausente, cuya ventana `[inicio − 30 min, fin + 2 h]` contiene el momento
 * actual. Los 30 minutos previos cubren al paciente que llega antes; las
 * 2 horas posteriores, al profesional que escribe la nota al terminar.
 *
 * Por hora y no por estado (`en-sala`): en solo lectura no se puede cambiar
 * el estado de una cita, así que exigirlo dejaría la excepción sin uso.
 * Tampoco abre la puerta a escribir notas de cualquier paciente: hace falta
 * una cita real, creada antes de entrar en solo lectura (crear citas está
 * bloqueado), y la ventana es de horas.
 */
export const URGENCIA_MARGEN_ANTES_MS = 30 * 60 * 1000;
export const URGENCIA_MARGEN_DESPUES_MS = 2 * 60 * 60 * 1000;
const ESTADOS_SIN_ATENCION = new Set(["cancelada", "ausente"]);

export function esCitaEnCurso(
  cita: { starts_at: string; ends_at: string; status: string },
  ahora: Date = new Date(),
): boolean {
  if (ESTADOS_SIN_ATENCION.has(cita.status)) return false;
  const t = ahora.getTime();
  const desde = new Date(cita.starts_at).getTime() - URGENCIA_MARGEN_ANTES_MS;
  const hasta = new Date(cita.ends_at).getTime() + URGENCIA_MARGEN_DESPUES_MS;
  return desde <= t && t <= hasta;
}

/**
 * Server functions POST que NO pasan por el chequeo de escritura, cada una
 * con su motivo. `tests/solo-lectura-cobertura.test.ts` recorre todas las
 * server functions y falla si una POST no usa uno de los middlewares de
 * escritura y tampoco está acá. Agregar algo a esta lista es una decisión:
 * el motivo tiene que explicar por qué no es "crear o editar datos de la
 * clínica".
 */
export const ESCRITURA_EXENTA: Record<string, string> = {
  // Pagar: el owner siempre tiene que poder salir del modo solo lectura.
  createCheckoutSession: "Pagar la suscripción es la salida del modo solo lectura.",
  createBillingPortalSession: "Actualizar el medio de pago es la salida del modo solo lectura.",

  // Ver y exportar.
  iniciarExportacionClinica: "Exportar los datos de la clínica (#67) siempre está permitido.",
  firmarArchivosExportacion: "Descarga de la exportación.",
  leerTablaExportacion: "Lectura de la exportación.",
  iniciarExportacionPaciente: "Exportar la ficha de un paciente siempre está permitido.",
  firmarArchivosExportacionPaciente: "Descarga de la exportación de la ficha de un paciente.",
  leerTablaExportacionPaciente: "Lectura de la exportación de la ficha de un paciente.",
  registrarExportacionDeLista:
    "Exportar una lista en CSV (EXP-04) siempre está permitido; solo anota la exportación.",
  setActiveClinic: "Cambia la clínica que se está viendo; no toca datos.",
  previsualizarCampana:
    "Vista previa de una campaña (CRM-04): solo calcula a quién le llegaría; no escribe nada. Es POST porque lleva el texto del mensaje.",

  // Estado personal del usuario, no datos de la clínica.
  markNotificationsRead: "Marca avisos como leídos: estado personal del usuario.",
  markNotificationUnread: "Vuelve un aviso a no leído (NAV-11): estado personal del usuario.",
  updateMyNotificationPreferences: "Preferencias personales de avisos.",
  enviarCodigoPorCorreo:
    "Seguridad de la cuenta (SEG-01): el código del segundo paso; sin él no se entra ni a ver.",
  verificarCodigoPorCorreo:
    "Seguridad de la cuenta (SEG-01): verificar el segundo paso; sin él no se entra ni a ver.",
  configurarSegundoPaso: "Seguridad de la cuenta (SEG-01): método del segundo paso, personal.",
  autorizarInscripcionApp:
    "Seguridad de la cuenta (SEG-01): permite sumar la app autenticadora, personal.",
  registrarEventoDeCuenta: "Telemetría de producto, no datos de la clínica.",
  saveMySignatureData:
    "Nombre y registro del propio profesional: hacen falta para firmar la nota de una urgencia.",

  // Fuera de una clínica existente.
  completeClinicSetup: "Alta de una clínica nueva (todavía no tiene suscripción).",
  marcarLlamadaHecha: "Herramienta del staff de Esmalia (/admin), no del equipo de la clínica.",
  extenderPrueba: "Herramienta del staff de Esmalia (/admin), no del equipo de la clínica.",

  // Sin sesión del equipo: los usa alguien de afuera de la clínica.
  openPortalSession: "Portal del paciente (sin login): abrir la sesión.",
  getExpiredPortalContact: "Portal del paciente (sin login): contacto de un link vencido.",
  requestPortalAppointment:
    "Portal del paciente (sin login): el paciente pide hora; la clínica la ve y decide al regularizar.",
  openLabPortalSession: "Portal del laboratorio (sin login): abrir la sesión.",
  updateLabOrderStatusFromPortal:
    "Portal del laboratorio (sin login): el laboratorio informa el estado de su trabajo.",
  confirmarBajaDeCorreos: "Baja de correos: obligatoria por ley, nunca se bloquea.",
  descargarMisDatosPortal:
    "Portal del paciente (sin login): derecho de acceso y portabilidad a sus datos (Ley 21.719).",
  solicitarDerechoPortal:
    "Portal del paciente (sin login): el paciente ejerce un derecho sobre sus datos (Ley 21.719).",
  cambiarComunicacionPortal:
    "Portal del paciente (sin login): oposición a recibir mensajes; obligatoria por ley, nunca se bloquea.",

  // Obligaciones legales de la clínica con sus pacientes y con la autoridad
  // (Ley 21.719): no dependen de que la suscripción esté al día.
  registrarSolicitudTitular:
    "Registrar una solicitud de derechos que llegó por otro canal: el plazo legal corre igual.",
  actualizarSolicitudTitular:
    "Responder una solicitud de derechos del paciente dentro del plazo legal.",
  prorrogarSolicitudTitular: "Prorrogar el plazo legal de una solicitud de derechos del paciente.",
  enviarRespuestaTitularPorCorreo:
    "Enviar al paciente la respuesta a su solicitud de derechos (obligación legal).",
  registrarBrecha: "Registrar un incidente de seguridad o brecha de datos (obligación legal).",
  agregarSeguimientoBrecha:
    "Seguimiento de un incidente de seguridad o brecha de datos (obligación legal).",

  abrirFirmaADistancia: "Firma a distancia (sin login): el paciente abre el link de la clínica.",
  verificarRutParaFirmar:
    "Firma a distancia (sin login): el paciente confirma su identidad con el RUT.",
  enviarCodigoParaFirmar:
    "Firma a distancia (sin login): el paciente pide su código de verificación.",
  firmarDocumentoADistancia:
    "Firma a distancia (sin login): el paciente firma un documento que la clínica ya le mandó.",
  abrirFormularioPrevio:
    "Formulario antes de la cita (sin login): el paciente abre el link que le mandó la clínica.",
  enviarFormularioPrevio:
    "Formulario antes de la cita (sin login): el paciente envía sus datos; no toca la ficha hasta que el equipo lo acepta.",
  abrirEncuesta: "Encuesta de satisfacción (sin login): el paciente abre el link de la clínica.",
  responderEncuesta: "Encuesta de satisfacción (sin login): el paciente responde la encuesta.",
  abrirReserva: "Reserva en línea (sin login): el paciente abre el link público de la clínica.",
  horasDeReserva: "Reserva en línea (sin login): el paciente mira las horas libres.",
  pedirCodigoDeReserva:
    "Reserva en línea (sin login): el paciente pide su código; la clínica en solo lectura no recibe reservas (se revisa adentro).",
  confirmarReserva:
    "Reserva en línea (sin login): crea una cita tentativa; la clínica en solo lectura no recibe reservas (se revisa adentro).",
  verMiCita: "Gestión de la cita (sin login): el paciente abre su link firmado.",
  confirmarMiCita:
    "Gestión de la cita (sin login): el paciente avisa que va (eje aparte de confirmada).",
  cancelarMiCita:
    "Gestión de la cita (sin login): el paciente cancela su propia cita; nunca se bloquea.",
  horasParaReagendar:
    "Gestión de la cita (sin login): el paciente mira horas para cambiar la suya.",
  reagendarMiCita:
    "Gestión de la cita (sin login): el paciente cambia su hora; con la clínica en solo lectura se niega adentro.",
  submitMarketingLead: "Formulario público de la web.",
  ensureDemoClinicFresh: "Clínica demo pública (ya es de solo lectura por trigger).",

  // Siembra idempotente de una lista estándar, no datos que escriba el equipo.
  asegurarEspecialidades:
    "Siembra las especialidades estándar del arancel si faltan; no edita datos de la clínica.",
};
