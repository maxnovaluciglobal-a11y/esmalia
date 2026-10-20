// FAQ corta de la landing A+: cinco preguntas que admiten límites. Se usa
// para el HTML y para el JSON-LD FAQPage de la ruta (mismo texto).
export const FAQ_CORTA = [
  {
    q: "¿Los recordatorios se envían solos?",
    a: "No. Esmalia arma la lista 48 y 3 horas antes de cada cita y alguien de la clínica los envía desde su WhatsApp con un toque. Conectar el número de la clínica a WhatsApp oficial está en habilitación con Meta.",
  },
  {
    q: "¿Qué pasa si se corta internet?",
    a: "La agenda y los pacientes siguen disponibles en el equipo hasta 7 días. Los cambios quedan en cola y se sincronizan en orden cuando vuelve la conexión. Para usarla sin conexión hay que haber entrado antes con tu usuario en ese equipo.",
  },
  {
    q: "¿Emite factura o boleta electrónica?",
    a: "No. Registra cobros, saldos y caja, pero la factura electrónica la sigues haciendo en tu sistema tributario.",
  },
  {
    q: "¿Puedo llevarme mis datos?",
    a: "Sí, cuando quieras y sin pedírselo a nadie: desde Ajustes descargas un ZIP con planillas CSV y los archivos de cada paciente.",
  },
  {
    q: "¿Patty ya funciona?",
    a: "Todavía no. Está en habilitación mientras se pasa a un proveedor de IA con contrato para datos de salud. Cuando vuelva, propondrá; el profesional revisa y firma.",
  },
] as const;
