# Motor de plantillas y documentos

**Versión:** 1 · 22-oct-2026 · Ola 4 (DOC-01, DOC-02, DOC-06, DOC-08, DOC-09, FIN-16, MKT-04).

Un solo motor para todo documento que Esmalia arma con datos de la ficha: certificados, informes, el detalle para el reembolso del seguro, el PDF del presupuesto y la receta. El código vive en `src/lib/documentos/`.

## Flujo

```
plantilla (texto con {{variables}})            document_template_versions.body
  → analizarPlantilla(cuerpo)                  variables desconocidas o mal escritas
  → renderPlantilla(cuerpo, contexto, {firma}) bloques (estructura neutra)
  → bloquesAHtml(bloques)                      HTML canónico, todo escapado
  → INSERT issued_documents                    la base pone correlativo, snapshots y huella
  → HojaDocumento (React) / construirDocumentoPdf (jsPDF) / window.print()
```

- **Bloques** (`tipos.ts`): título, párrafo (con negrita y saltos), lista, tabla y firma. Son lo único que se dibuja: la pantalla los pinta con React (sin `innerHTML`), el PDF los recorre con jsPDF y el HTML canónico sale de ellos. Ni una plantilla ni un dato de la ficha pueden inyectar markup.
- **Formato de plantilla:** `# Título`, `## Subtítulo`, `**negrita**`, `- ítem`, línea en blanco entre párrafos. Una variable de bloque (`{{reembolso.prestaciones}}`) va sola en su línea y se imprime como tabla.
- **Variables** (`variables.ts`): `paciente.*`, `clinica.*`, `profesional.*`, `fecha`, `fecha_corta`, `reembolso.*` y `campo.*` (lo que se completa al emitir; los conocidos tienen etiqueta y tipo, y una plantilla puede pedir campos propios). Sin dato, se imprime una línea para completar a mano y la vista previa lo avisa.
- **Versiones:** editar una plantilla inserta una versión nueva (la numera la base) y la deja vigente; una versión no se edita. El documento emitido guarda `template_version_id`.
- **Huella:** `sha256(content_html || U+001F || coalesce(signature_sha256, ''))`, la calcula el trigger `issued_documents_emitir`; `huella.ts` es el par en TypeScript y la página del documento la verifica en el navegador.
- **Firma (DOC-06):** imagen en el bucket privado `professional-signatures/<clinic>/<professional>/<uuid>`, registrada por el propio profesional con `registrar_mi_firma` (también guarda su número de la Superintendencia de Salud, `professionals.sis_registry_number`). Al emitir, la base copia la ruta y el sha256 de la firma vigente. Una firma nueva es un archivo nuevo: la anterior queda para los documentos que la usaron. Firma simple (Ley 19.799), no avanzada.
- **Anulación (DOC-08):** un documento no se edita ni se borra (sin DELETE). Se anula una vez, con motivo; quién y cuándo los pone la base. Solo quien lo emitió o un administrador.

## PDF: por qué jsPDF en el navegador

jsPDF ya es dependencia (notas, recetas, ficha completa), corre sin binarios (nada de Chromium ni wkhtmltopdf en Vercel), se carga recién al hacer clic y también corre en Node (los tests arman el PDF sin navegador). Para "Imprimir o guardar como PDF" con el diálogo del navegador está la página `/documentos/:id`, con CSS de impresión (`documento-impresion.css`, el mismo criterio que `/recorrido` y los resultados del piloto).

## API para los frentes siguientes (presupuesto, receta)

```ts
// Puro (navegador y servidor)
analizarPlantilla(cuerpo: string): AnalisisPlantilla
renderPlantilla(cuerpo: string, contexto: ContextoDocumento, opciones?: { firma?: Bloque | null }): DocumentoRenderizado
bloquesAHtml(bloques: readonly Bloque[]): string
bloqueDeFirma(p: { nombre: string; registroSis: string | null; especialidad: string | null }): Bloque
construirContexto(datos: DatosParaDocumento): { valores; tablas }
huellaDocumento(contenidoHtml: string, firmaSha256: string | null): Promise<string>
folioDocumento(year: number, number: number): string

// Navegador
construirDocumentoPdf(d: DocumentoParaPdf): Promise<jsPDF>
descargarDocumentoPdf(d: DocumentoParaPdf): Promise<void>
<HojaDocumento bloques={...} encabezado={...} pie={...} firmaUrl={...} />

// Servidor
emitirDocumento(supabase, { clinicId, patientId, userId, templateId?, templateVersionId?, campos }): Promise<{ id, year, number, contentSha256 }>
cargarDatosParaDocumento(supabase, { clinicId, patientId, userId, periodo? }): Promise<{ datos, profesional }>
```

Para sumar un documento nuevo (por ejemplo el presupuesto): agregar su grupo de variables al catálogo (`presupuesto.*`, con sus tablas como variables de bloque), extender `DatosParaDocumento` y `construirContexto`, y sembrar su plantilla con un `kind` nuevo (CHECK de `document_templates.kind`). El motor no cambia.

## Presupuesto en PDF y envíos por correo (Ola 4 · PLA-08, PLA-09, PLA-11, DOC-07)

- **PDF del presupuesto con el mismo motor.** Grupo `presupuesto.*` en `variables.ts` (número, fecha, validez, profesional, `presupuesto.prestaciones` y `presupuesto.totales` como tablas, subtotal, descuento, total, convenio, cobertura, copago, notas); la lógica pura vive en `presupuesto.ts` y lee los montos **guardados** (cantidad × unitario − descuento propio por línea; subtotal − descuento comercial = total; total − convenio = lo que paga el paciente; los mismos de `calculo-presupuesto.ts`, lo vigila `tests/presupuesto-documento.test.ts`). Las secciones son filas destacadas de la tabla (`destacadas` en el bloque tabla).
- **Plantilla `presupuesto`** (kind nuevo, `seed_key` `presupuesto`), sembrada por clínica por `seed_clinic_quote_template` (migración `20261025200100`) y editable en `/plantillas-de-documentos`, donde muestra solo las variables que tienen dato. No se emite desde la ficha (`TIPOS_SIN_EMISION_DESDE_LA_FICHA`): no es un documento emitido, no lleva folio ni huella. Sin plantilla activa, el PDF usa `PLANTILLA_PRESUPUESTO`.
- **Firma (PLA-11):** la del profesional a cargo del presupuesto (no la de quien descarga), con nombre, especialidad, registro SIS e imagen si la registró. La URL de la imagen la firma el rol de servicio (10 min, esa ruta): recepción también descarga y envía presupuestos y el bucket solo lo leen roles clínicos.
- **Diagramación común:** `construirHojaPdf(HojaParaPdf)` en `pdf.ts` (encabezado con datos tributarios FIN-16, bloques, firma, pie). La usan el documento emitido y el presupuesto, en el navegador (descarga) y en el servidor (adjunto del correo).
- **Correo al paciente** (`correo.ts` puro, `correo.server.ts`, `envios.functions.ts`): PDF adjunto, texto editable, cuerpo sin datos clínicos. Frenos en el servidor: nunca la demo; baja del paciente (`patients.email_opt_out_at`, enlace del pie con el token de `/correos/baja`, grupo `correos_paciente`); menor con tutor → al tutor; `email_sandbox_config` (en sandbox se bloquea o se desvía a la casilla de pruebas; el diálogo lo avisa antes de enviar). Todo intento queda en `messages`. El presupuesto, además, deja el evento `envio` en `quote_events` (quién, cuándo, a qué correo) y marca `sent_at` (un borrador pasa a enviado) con `registrar_envio_de_presupuesto(message_id)`. La copia de un documento emitido (DOC-07) queda en `messages.issued_document_id` y se lista en `/documentos/:id`.
- **Demo:** `/api/demo-reset` deja un certificado de atención emitido en la ficha de Valentina, firmado por la profesional de la demo con el registro ficticio `EJEMPLO-000000`. `issued_documents_emitir` acepta el rol de servicio solo en la clínica demo y a nombre del usuario de la ficha del profesional (migración `20261025200200`).

## Límites conocidos

- La copia al paciente es por descarga, impresión o correo (PDF adjunto). El portal de pacientes todavía no sirve documentos, así que no hay link firmado para mandar por WhatsApp.
- La baja de correos del paciente la deshace la clínica a pedido del paciente (botón en el diálogo de envío); no hay pantalla propia de preferencias del paciente.
- El formulario de reembolso lista las prestaciones marcadas como realizadas en el período y lo pagado imputado a cada una; un pago "al plan" (sin prestación) suma al total del período pero no se reparte entre prestaciones.
- No hay integración con el SII: los datos tributarios (FIN-16) solo se imprimen.
