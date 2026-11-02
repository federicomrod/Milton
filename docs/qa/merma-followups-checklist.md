# QA · Merma: seguimientos (rendimiento por defecto, filtro, roles, vía preparación)

Solo con datos de demostración en staging. No hace falta migración.

1. **El 1 por defecto no es un rendimiento.** En Menú › Preparaciones abre una preparación importada (o creada) que rinde «1 unidad». Sigue con la etiqueta amarilla **⚑ falta rendimiento** aunque cambies o guardes sus ingredientes. Solo cuando escribes un rinde real («rinde 6,5 kg») la etiqueta desaparece y sus ingredientes pasan a «preparación medida».
2. **Etiqueta y filtro en la lista.** En la lista de Preparaciones, cada preparación sin rinde medido muestra la etiqueta ⚑ falta rendimiento. Justo encima de la lista hay un botón «Falta rendimiento (n)»: un toque deja solo esas preparaciones; otro toque las muestra todas.
3. **Roles.** Entra como analista o lector: ves «Costo real (con merma)» e «Impacto merma» en Menú › Ingredientes, y el costo efectivo en el editor de recetas. Entra como cocinero: no ves ningún precio ni valor de merma (ni en pantalla ni en los datos de la página).
4. **Impacto vía preparación.** Abre un ingrediente que un plato usa a través de una preparación (que a su vez usa otra). En «Se usa en», el plato muestra su parte proporcional: cantidad de preparación usada ÷ lo que rinde la preparación × el impacto de la preparación. Si la preparación está medida y no hay merma propia, sale «—».
5. **Parte que no se puede calcular.** Si la preparación no tiene rinde o la unidad no coincide, la celda muestra «—» y, al pasar el cursor (o tocar), «vía preparación».
6. **Falta conversión.** Una línea cuya unidad no se convierte a la del precio (por ejemplo «unidad» contra un precio por kg) muestra ⚑ Falta conversión, nunca $0, y no entra en «Total de impacto merma» (abajo se lee cuántas quedaron fuera).
7. **Móvil (390 px).** La lista de Preparaciones con el filtro y la tabla «Se usa en» se leen sin scroll horizontal ni pestañas.
