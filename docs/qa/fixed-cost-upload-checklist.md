# QA · Subir archivo de costos fijos (#409)

Solo con datos de demostración en staging y un archivo demo (no hace falta ninguna migración: las tablas ya existen desde la 064). Usa un propietario, administrador o gerente. Crea un Excel o CSV demo con las columnas «Concepto», «Monto» y, si quieres, «Mes» y «Restaurante». Por ejemplo: Renta del local 6.500, Planilla 21.400, Luz e internet 3.900, una fila «Cosa rara» con 120 y una fila «Seguro» con el monto vacío.

1. **El botón se ve de entrada.** En Costos › Costos fijos aparece «⇪ Subir archivo» arriba de las categorías, sin abrir pestañas ni menús. Un usuario de cocina, analista o lector no ve Costos fijos.
2. **Sube el archivo demo.** Aparece «Revisa lo que Milton leyó» con una línea por fila del archivo. Las categorías y montos ya vienen leídos.
3. **Nada cambia todavía.** Sin aprobar, las cifras de Costos fijos y de Rentabilidad siguen igual.
4. **Líneas que Milton no entendió.** «Cosa rara» sale con ⚑ Falta y sin categoría; «Seguro» sale con «Sin precio». No están en $0 y no se pueden aprobar hasta corregirlas (elige la categoría o escribe el monto en la misma línea) o descartarlas.
5. **Aprobar.** Pulsa «Aprobar todo» (o «Aprobar» en una línea). Las líneas listas pasan a Costos fijos y desaparecen de la revisión; las que quedan siguen ahí.
6. **Historial.** Abajo, en el historial, las líneas aparecen con el origen «Archivo».
7. **No reemplaza en silencio.** Sube otro archivo con un monto distinto para una categoría y mes que ya tiene valor, y pulsa «Aprobar todo». Aparece «Esto reemplaza valores que ya tienes» con «antes → ahora». Cancela y no cambia nada; confirma con «Reemplazar y aprobar» y se guarda.
8. **PDF o foto.** Sube un PDF o una foto demo de costos: las líneas salen con la etiqueta lavanda «Leído por Milton» y también esperan tu aprobación. Con 390 px de ancho todo se lee sin scroll horizontal.
9. **Varias líneas de una categoría.** En el archivo demo pon «Luz», «Agua» e «Internet» (las tres son Servicios, mismo mes y restaurante). Antes de aprobar, la revisión muestra «Servicios · mes: 3 líneas · total». Al aprobar se guarda UN valor con la suma y la etiqueta «Luz + Agua + Internet»; las tres líneas salen de la revisión y el historial tiene una sola entrada. Si el mes ya tenía otro valor para Servicios, el aviso de reemplazo compara con la suma.
10. **Dos líneas de impuestos.** Pon dos filas de impuestos (por ejemplo «IVA» 10 y «ISR» 6) para el mismo mes y restaurante: las dos salen con ⚑ Falta y un mensaje, y no se pueden aprobar. Una tasa no se suma. Descarta una y la otra se puede aprobar.
11. **Restaurante dudoso.** Con dos restaurantes que comparten el principio del nombre (por ejemplo «Los Ranchos Centro» y «Los Ranchos Escalón»), una fila con «Los Ranchos» sale con ⚑ Falta; «Centro» o el nombre completo sí encuentran el restaurante.
