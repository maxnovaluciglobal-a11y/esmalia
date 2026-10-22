# Motor de plantillas y documentos

**Versión:** 1 · 22-oct-2026 · Ola 4 (DOC-01, DOC-02, DOC-06, DOC-08, DOC-09, FIN-16, MKT-04).

Un solo motor para todo documento que Esmalia arma con datos de la ficha: certificados, informes, el detalle para el reembolso del seguro y, desde la tanda siguiente, el PDF del presupuesto y la receta. El código vive en `src/lib/documentos/`.

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
- **Variables** (`variables.ts`): `paciente.*`, `clinica.*`, `profesional.*`, `fecha`, `fecha_corta`, `reembolso.*`, `receta.*` (`receta.ts`) y `campo.*` (lo que se completa al emitir; los conocidos tienen etiqueta y tipo, y una plantilla puede pedir campos propios). Sin dato, se imprime una línea para completar a mano y la vista previa lo avisa.
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

## Receta (MKT-05)

La receta es un documento del motor con flujo propio: plantilla `kind = 'receta'` (sembrada por clínica, editable), grupo `receta.*` (tabla de medicamentos, alergias, indicaciones generales) y emisión desde la tarjeta Recetas de la ficha, que además guarda la receta estructurada en `prescriptions` (`emitir_receta`, una transacción). No aparece en "Emitir documento" (`TIPOS_CON_FLUJO_PROPIO`). Una tabla puede traer `peso` por columna para el ancho en el PDF. Detalle, vademécum y mapeo a FHIR: `docs/RECETA_FHIR.md`.

## Límites conocidos

- La copia al paciente es por descarga o impresión. El portal de pacientes todavía no sirve documentos, así que no hay link firmado para mandar por WhatsApp; el envío por correo llega en la tanda siguiente.
- El formulario de reembolso lista las prestaciones marcadas como realizadas en el período y lo pagado imputado a cada una; un pago "al plan" (sin prestación) suma al total del período pero no se reparte entre prestaciones.
- No hay integración con el SII: los datos tributarios (FIN-16) solo se imprimen.
