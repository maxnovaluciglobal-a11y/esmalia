import type { PaginaContenido } from "../tipos";

export const pagina: PaginaContenido = {
  coleccion: "funciones",
  path: "/funciones/presupuestos",
  titulo: "Presupuesto dental y plan de tratamiento | Esmalia",
  descripcion:
    "Presupuestos dentales por pieza y por fases en Esmalia: al aceptarlos se vuelven plan de tratamiento y cada pago descuenta el saldo del paciente.",
  kicker: "Funciones",
  h1: "Presupuestos dentales que se vuelven plan de tratamiento",
  resumen:
    "En Esmalia armas el presupuesto en la ficha del paciente, con prestaciones del arancel, pieza y superficie FDI, fases y descuentos en monto o porcentaje. Al aceptarlo, con firma opcional del paciente, se crea el plan de tratamiento con las mismas líneas. Cada pago descuenta el saldo y cada ítem muestra si está pagado.",
  publicado: "2026-10-11",
  actualizado: "2026-10-11",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Cómo se arma un presupuesto dental en Esmalia?",
      bloques: [
        {
          tipo: "p",
          texto:
            "El presupuesto se crea en la pestaña Finanzas de la ficha, o directo desde el [odontograma](/funciones/odontograma) con el botón Presupuestar esta pieza. Cada línea tiene:",
        },
        {
          tipo: "lista",
          items: [
            "**Prestación.** Del arancel de la clínica, con el precio ya cargado, o escrita a mano. Si falta una, la agregas al catálogo sin salir del presupuesto.",
            "**Pieza y superficie.** Número FDI, de dentición permanente o temporal, y una superficie o la pieza completa.",
            "**Cantidad, precio y descuento.** El descuento va en monto o en porcentaje, según cómo lo negocies.",
            "**Fase.** Un nombre libre, como Fase 1 o Rehabilitación, que agrupa líneas y muestra el subtotal de cada bloque.",
          ],
        },
        {
          tipo: "p",
          texto:
            "Al final puedes aplicar un descuento comercial en porcentaje sobre todo el presupuesto. Ese descuento se reparte entre las líneas, así que llega intacto al plan de tratamiento y al saldo. Cada presupuesto recibe un número correlativo de la clínica, como P-2026-0001, que se reinicia cada año según el huso horario de la clínica. La moneda es la de tu clínica y la fija el servidor, no el navegador.",
        },
      ],
    },
    {
      h2: "¿Qué estados tiene un presupuesto?",
      bloques: [
        {
          tipo: "tabla",
          columnas: ["Estado", "Qué significa", "¿Se puede corregir?"],
          filas: [
            ["Borrador", "Recién creado.", "Sí, y conserva su número."],
            ["Enviado", "Se le presentó al paciente.", "Sí, y conserva su número."],
            ["Aceptado", "El paciente lo aprobó y se creó el plan de tratamiento.", "No."],
            ["Rechazado", "El paciente no lo tomó. Esmalia pide confirmación antes.", "No."],
            ["Vencido", "Pasó su plazo.", "No."],
            ["Convertido en plan", "Sus líneas ya son un plan de tratamiento.", "No."],
          ],
        },
      ],
    },
    {
      h2: "¿Qué pasa cuando el paciente acepta el presupuesto?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Al presionar Aceptar, Esmalia pide el nombre de quien aprueba y, si quieres, la firma del paciente en la pantalla. La firma se guarda en un almacenamiento privado. También quedan registradas la IP y el navegador desde donde se aceptó, como evidencia ante una disputa de cobro. Si la firma no se pudo guardar, la app lo avisa con un mensaje visible en vez de darlo por hecho.",
        },
        {
          tipo: "p",
          texto:
            "En ese momento la base de datos crea el plan de tratamiento con las mismas líneas: prestación, pieza, superficie, fase y precio con el descuento aplicado. Cada línea del plan pasa por Pendiente, En curso, Realizado u Omitido. Las líneas realizadas son la base de las [comisiones de cada profesional](/funciones/comisiones) y, si la clínica usa inventario, al marcarlas se descuentan los insumos de la receta de esa prestación.",
        },
      ],
    },
    {
      h2: "¿Cómo se cobra contra el plan de tratamiento?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Cada pago descuenta el saldo del paciente. La ficha muestra lo facturado, lo pagado y el saldo pendiente, o el monto a favor si el paciente pagó de más. Cada línea del plan tiene su semáforo: sin pagar, parcial o pagado. El saldo también aparece en la cabecera de la ficha y en la pantalla Hoy, para saber quién debe antes de que entre a consulta. Un pago mal cargado se reversa con un motivo, y solo lo pueden hacer los roles con ese permiso.",
        },
        {
          tipo: "p",
          texto:
            "Si el paciente tiene un convenio o seguro con tabla de cobertura, cada línea se divide en lo que cubre el convenio y lo que paga el paciente, en porcentaje o en monto fijo por unidad. El convenio nunca cubre más que la línea. El cálculo se hace en el servidor y el saldo del paciente se arma solo con su parte.",
        },
      ],
    },
    {
      h2: "¿Cómo se hace el seguimiento de un presupuesto?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Desde el presupuesto, el botón Enviar por WhatsApp arma el mensaje con el número y el total. Los presupuestos en estado Enviado que llevan 7 días sin respuesta aparecen en la cola de [recordatorios](/funciones/recordatorios-whatsapp) como seguimiento, y no se vuelven a sugerir antes de 14 días. Igual que todo en Esmalia, el mensaje lo envía una persona.",
        },
      ],
    },
    {
      h2: "¿En qué plan están los presupuestos?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Presupuestos y caja vienen desde el plan Solo (US$19,99 al mes) y están en todos los planes. Crear un presupuesto necesita internet; los cobros sí se pueden registrar sin conexión. Revisa los [precios](/precios) o mira un plan de tratamiento en la [demo](/demo). Si todavía presupuestas en papel, usa nuestra [plantilla de presupuesto dental](/plantillas/presupuesto-dental).",
        },
      ],
    },
    {
      h2: "¿Qué no hace?",
      bloques: [
        {
          tipo: "aviso",
          texto:
            "**Un presupuesto no es un documento tributario.** Esmalia no emite factura electrónica, boleta, DTE ni CFDI en ningún país. El WhatsApp del presupuesto lleva el número y el total, no el detalle línea por línea. Un presupuesto aceptado ya no se edita: lo que cambia después es el plan de tratamiento. Y sin internet no se pueden crear presupuestos.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Puedo presupuestar un tratamiento dental por fases?",
      a: "Sí. Cada línea lleva un nombre de fase y el presupuesto muestra el subtotal por bloque. Al aceptarlo, el plan de tratamiento conserva las mismas fases.",
    },
    {
      q: "¿Puedo corregir un presupuesto que ya envié?",
      a: "Sí, mientras esté en Borrador o Enviado, y conserva su número correlativo. Una vez aceptado, rechazado o vencido ya no se edita.",
    },
    {
      q: "¿El paciente puede firmar el presupuesto?",
      a: "Sí. Al aceptarlo puede firmar en la pantalla con el dedo o el mouse. La firma es opcional; además se guardan el nombre de quien aprobó, la IP y el navegador.",
    },
    {
      q: "¿El descuento del presupuesto se mantiene en el saldo del paciente?",
      a: "Sí. El descuento comercial se reparte entre las líneas, así que el plan de tratamiento y el saldo quedan con el precio ya descontado.",
    },
    {
      q: "¿Esmalia emite boleta o factura del tratamiento?",
      a: "No. Esmalia registra presupuestos, planes y pagos, pero no emite documentos tributarios en ningún país. Está en el roadmap, sin fecha comprometida.",
    },
  ],
  relacionados: [
    "/funciones/odontograma",
    "/funciones/comisiones",
    "/funciones/recordatorios-whatsapp",
    "/funciones/ficha-clinica",
    "/plantillas/presupuesto-dental",
  ],
  enUnaLinea:
    "Presupuestos por pieza y por fases que al aceptarse se vuelven plan de tratamiento, con saldo por línea.",
};
