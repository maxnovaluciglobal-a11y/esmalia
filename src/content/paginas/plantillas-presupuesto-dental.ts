import type { PaginaContenido } from "../tipos";

// Plantilla operativa (no clínico-legal): se publica sin revisor. No afirma
// nada normativo; lo que dice de Esmalia sale de funciones-presupuestos.ts.

const FILAS_EN_BLANCO = (n: number, columnas: number) =>
  Array.from({ length: n }, (_, i) => [String(i + 1), ...Array<string>(columnas - 1).fill("")]);

export const pagina: PaginaContenido = {
  coleccion: "plantillas",
  path: "/plantillas/presupuesto-dental",
  titulo: "Plantilla de presupuesto dental para imprimir | Esmalia",
  descripcion:
    "Plantilla de presupuesto dental gratis para imprimir o copiar: detalle por pieza y fase, totales, convenio, forma de pago, condiciones y firma de aceptación.",
  kicker: "Plantillas",
  h1: "Plantilla de presupuesto dental para imprimir",
  resumen:
    "Un buen presupuesto dental dice qué se va a hacer, en qué pieza, en qué orden y cuánto cuesta cada cosa, cuánto paga el paciente, hasta cuándo vale y cómo se acepta. Esta plantilla trae el detalle por pieza y por fase, los totales, las condiciones y la firma de aceptación. Imprímela o cópiala; no es un documento tributario.",
  publicado: "2026-10-20",
  actualizado: "2026-10-20",
  autor: { nombre: "Walter La Madriz", rol: "Fundador de Esmalia" },
  secciones: [
    {
      h2: "¿Qué debe tener un presupuesto dental?",
      bloques: [
        {
          tipo: "lista",
          ordenada: true,
          items: [
            "**Identificación.** Clínica, profesional tratante y paciente (y apoderado si es menor de edad).",
            "**Número y fecha.** Un correlativo te deja encontrarlo después y saber cuál es la versión vigente.",
            "**Validez.** Hasta qué fecha se respetan los precios.",
            "**Detalle por línea.** Prestación, pieza en notación FDI, superficie, cantidad, precio unitario y descuento.",
            "**Fases.** Qué va primero (lo urgente) y qué puede esperar, con el subtotal de cada bloque.",
            "**Totales.** Total del tratamiento, lo que cubre el convenio o seguro si hay, y lo que paga el paciente.",
            "**Forma de pago.** Abono inicial, cuotas o pago por sesión, y qué medios aceptas.",
            "**Condiciones.** Qué no incluye y qué pasa si el plan cambia durante el tratamiento.",
            "**Aceptación.** Nombre, firma y fecha de quien aprueba.",
          ],
        },
        {
          tipo: "aviso",
          texto:
            "**Un presupuesto no reemplaza otros documentos.** No es boleta ni factura, y tampoco es el consentimiento informado: ese documenta que el paciente entendió los riesgos y las alternativas del procedimiento. Si tienes dudas sobre el valor legal de la aceptación firmada en tu país, consúltalo con un abogado.",
        },
      ],
    },
    {
      h2: "Plantilla de presupuesto para imprimir",
      bloques: [
        {
          tipo: "p",
          texto:
            "Usa el botón **Imprimir o guardar en PDF** de arriba: al imprimir se ocultan el menú, los botones y el resto del sitio. También puedes copiar cada bloque a tu procesador de texto. Las variables entre llaves se reemplazan por tus datos.",
        },
        {
          tipo: "plantilla",
          titulo: "Encabezado",
          texto:
            "PRESUPUESTO DENTAL N° {numero}\n\nClínica: {clinica}. Dirección: {direccion}. Teléfono: {telefono}.\nProfesional tratante: {profesional}. Registro profesional: {registro}.\nPaciente: {nombre}. Documento: {documento}. Teléfono: {telefono_paciente}.\nApoderado (si corresponde): {apoderado}.\nFecha de emisión: {fecha}. Válido hasta: {fecha_validez}.\nMotivo de consulta o diagnóstico resumido: {diagnostico}.",
        },
        {
          tipo: "tabla",
          rellenable: true,
          columnas: [
            "N°",
            "Fase",
            "Pieza (FDI)",
            "Superficie",
            "Prestación",
            "Cant.",
            "Precio unitario",
            "Descuento",
            "Subtotal",
          ],
          filas: FILAS_EN_BLANCO(10, 9),
          nota: "Fase: un nombre corto, como Fase 1 (urgencia), Fase 2 (operatoria) o Rehabilitación. Superficie: O, M, D, V, L/P, o pieza completa.",
        },
        {
          tipo: "tabla",
          rellenable: true,
          columnas: ["Totales", "Monto"],
          filas: [
            ["Suma de las líneas", ""],
            ["Descuento comercial sobre el total (si aplica)", ""],
            ["Total del tratamiento", ""],
            ["Cubre el convenio o seguro", ""],
            ["Paga el paciente", ""],
            ["Abono inicial", ""],
            ["Saldo por pagar", ""],
          ],
          nota: "Indica la moneda en cada monto. Si hay convenio, su cobertura nunca debería superar el valor de la línea.",
        },
        {
          tipo: "plantilla",
          titulo: "Forma de pago",
          texto:
            "Forma de pago acordada: [ ] contado  [ ] abono inicial y saldo por sesión  [ ] cuotas.\nNúmero de cuotas: {cuotas}. Monto de cada cuota: {monto_cuota}. Fechas: {fechas_cuotas}.\nMedios de pago aceptados: {medios_pago}.",
        },
        {
          tipo: "plantilla",
          titulo: "Condiciones",
          texto:
            "1. Este presupuesto es válido hasta el {fecha_validez}. Después de esa fecha, los precios pueden cambiar.\n2. No incluye: {no_incluye}.\n3. Si durante el tratamiento aparece la necesidad de un procedimiento distinto, se le informará al paciente y se le presentará un presupuesto adicional antes de realizarlo.\n4. Las fases pueden reordenarse por criterio clínico, con aviso al paciente.\n5. Este documento no es una boleta ni una factura. Los comprobantes de pago se entregan según la normativa de cada país.",
        },
        {
          tipo: "plantilla",
          titulo: "Aceptación",
          texto:
            "Declaro que el profesional me explicó el tratamiento propuesto, sus fases y su costo, y que acepto este presupuesto.\n\nNombre de quien acepta: ____________________\nDocumento: ____________________\nRelación con el paciente (si no es el paciente): ____________________\n\nFirma: ____________________   Fecha: ____ / ____ / ________\n\nFirma del profesional: ____________________",
        },
      ],
    },
    {
      h2: "¿Cómo presentar el presupuesto para que el paciente decida?",
      bloques: [
        {
          tipo: "lista",
          items: [
            "**Explícalo en el sillón, con el paciente mirando.** El odontograma o la radiografía hacen más claro por qué cada línea está ahí.",
            "**Ordénalo por fases.** Lo urgente primero (dolor, infección) y lo que puede esperar después. Un total grande se entiende mejor dividido en etapas.",
            "**Ofrece alternativas cuando existan.** Por ejemplo, dos opciones de rehabilitación con sus precios, para que el paciente elija con información.",
            "**Entrégalo por escrito.** Impreso o en PDF. El paciente casi siempre lo conversa en su casa antes de decidir.",
            "**Deja agendado el siguiente contacto.** Anota cuándo vas a hacer el seguimiento y quién lo hace.",
          ],
        },
      ],
    },
    {
      h2: "¿Cómo hacer el seguimiento de un presupuesto pendiente?",
      bloques: [
        {
          tipo: "p",
          texto:
            "Un presupuesto sin respuesta no siempre es un no: muchas veces el paciente tiene una duda de pago que no pregunta. En [28 plantillas de WhatsApp para tu clínica dental](/plantillas/whatsapp-clinica-dental) hay tres mensajes para enviarlo, preguntar si lo revisó y dejar la puerta abierta sin insistir de más.",
        },
      ],
    },
    {
      h2: "¿Y si armas el presupuesto en Esmalia?",
      bloques: [
        {
          tipo: "p",
          texto:
            "En Esmalia el presupuesto se arma en la ficha del paciente, o directo desde el [odontograma](/funciones/odontograma), con prestaciones del arancel, pieza y superficie FDI, fases y descuentos. Recibe un número correlativo de la clínica (como P-2026-0001). Al aceptarlo, con firma opcional del paciente en la pantalla, se convierte en plan de tratamiento con las mismas líneas, y cada pago descuenta el saldo. Los presupuestos enviados que llevan 7 días sin respuesta aparecen en la cola de recordatorios para que alguien de tu equipo haga el seguimiento. El detalle está en [presupuestos dentales](/funciones/presupuestos).",
        },
        {
          tipo: "aviso",
          texto:
            "Esmalia tampoco emite boleta ni factura: registra presupuestos, planes y pagos, pero no documentos tributarios en ningún país.",
        },
      ],
    },
  ],
  faq: [
    {
      q: "¿Cuánto tiempo debe ser válido un presupuesto dental?",
      a: "No hay un plazo único. Defínelo tú y escríbelo en el presupuesto. Un plazo corto te protege si cambian los costos de laboratorio o de insumos; uno muy corto presiona al paciente.",
    },
    {
      q: "¿El presupuesto dental es un documento tributario?",
      a: "No. Es una propuesta de tratamiento con su costo. Los comprobantes de pago (boleta, factura u otros) se emiten aparte, según la normativa de cada país.",
    },
    {
      q: "¿El paciente tiene que firmar el presupuesto?",
      a: "Es recomendable: la firma de aceptación deja constancia de lo que acordaron. La plantilla trae un bloque de aceptación con nombre, documento, firma y fecha.",
    },
    {
      q: "¿Presupuesto y consentimiento informado son lo mismo?",
      a: "No. El presupuesto es el acuerdo económico del tratamiento. El consentimiento informado documenta que el paciente entendió el procedimiento, sus riesgos y sus alternativas. Son documentos distintos.",
    },
    {
      q: "¿Puedo presupuestar por fases?",
      a: "Sí, y conviene. Anota la fase en cada línea y muestra el subtotal de cada bloque, con lo urgente primero.",
    },
  ],
  relacionados: [
    "/funciones/presupuestos",
    "/plantillas/whatsapp-clinica-dental",
    "/plantillas/inventario-clinica-dental",
    "/funciones/odontograma",
  ],
  enUnaLinea:
    "Plantilla gratis de presupuesto dental para imprimir: detalle por pieza y fase, totales con convenio, forma de pago, condiciones y firma de aceptación.",
};
