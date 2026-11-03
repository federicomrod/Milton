# QA · Merma: seguimientos (rendimiento por defecto, filtro, roles, vía preparación)

Solo con datos de demostración en staging. No hace falta migración.

1. **El 1 por defecto no es un rendimiento.** En Menú › Preparaciones abre una preparación importada (o creada) que rinde «1 unidad». Sigue con la etiqueta amarilla **⚑ falta rendimiento** aunque cambies o guardes sus ingredientes. Solo cuando escribes un rinde real («rinde 6,5 kg») la etiqueta desaparece y sus ingredientes pasan a «preparación medida».
2. **Etiqueta y filtro en la lista.** En la lista de Preparaciones, cada preparación sin rinde medido muestra la etiqueta ⚑ falta rendimiento. Justo encima de la lista hay un botón «Falta rendimiento (n)»: un toque deja solo esas preparaciones; otro toque las muestra todas.
3. **Roles.** Entra como analista o lector: ves «Costo real (con merma)» e «Impacto merma» en Menú › Ingredientes, y el costo efectivo en el editor de recetas. Entra como cocinero: no ves ningún precio ni valor de merma (ni en pantalla ni en los datos de la página).
4. **Impacto vía preparación.** Abre un ingrediente que un plato usa a través de una preparación (que a su vez usa otra). En «Se usa en», el plato muestra su parte proporcional: cantidad de preparación usada ÷ lo que rinde la preparación × el impacto de la preparación. Si la preparación está medida y no hay merma propia, sale «—».
5. **Parte que no se puede calcular.** Si la preparación no tiene rinde o la unidad no coincide, la celda muestra «—» y, al pasar el cursor (o tocar), «vía preparación».
6. **Falta conversión.** Una línea cuya unidad no se convierte a la del precio (por ejemplo «unidad» contra un precio por kg) muestra ⚑ Falta conversión, nunca $0, y no entra en «Total de impacto merma» (abajo se lee cuántas quedaron fuera).
7. **Móvil (390 px).** La lista de Preparaciones con el filtro y la tabla «Se usa en» se leen sin scroll horizontal ni pestañas.

## Decisiones de Sofia y correcciones de revisión

8. **Cocina no ve Ingredientes.** Entra con un usuario de cocina: en Menú no aparece la pestaña «Ingredientes». Si pegas la dirección `/dashboard/restaurant/menu/ingredientes`, vuelve a Menú y no se carga ningún dato de ingredientes. Propietario, administrador, gerente, analista y lector siguen viéndola.
9. **Confirmar 1 unidad.** Con propietario, administrador o gerente, abre una preparación con «⚑ Falta rendimiento» cuyo rinde es 1: junto a «Confirmar rendimiento» aparece «Confirmar 1 unidad». Púlsalo: la preparación sale de «Falta rendimiento» (también en el filtro), los ingredientes de esa preparación dejan de llevar el buffer de cocina, y abajo, en «Historial del rendimiento», aparece «<nombre> confirmó 1 unidad · fecha».
10. **Se puede deshacer.** En esa misma preparación pulsa «Deshacer confirmación»: vuelve a «Falta rendimiento», el buffer vuelve y el historial conserva las dos líneas (confirmó, deshizo). Si escribes un rendimiento real, el historial se conserva.
11. **Quién puede.** Analista, lector y cocina no ven el botón y la API responde 403 si se intenta.
12. **Editor para cocina.** Con un usuario de cocina abre un plato o una preparación en Menú: se ven ingrediente, cantidad y unidad, pero no hay columnas de precio ni de aporte, ni totales, ni costo por unidad, y no se puede editar nada (ni agregar, ni cambiar cantidades, ni «Crear versión nueva»). Con analista o lector se ven los costos pero tampoco se edita.
13. **Una sola regla para «medida».** Una preparación aprobada con «rinde 6,5 kg» y un borrador abierto sin rendimiento sale sin ⚑ en la lista, en el editor y en el cálculo de buffer. Un borrador con un rendimiento ilegible usa el de la versión.
14. **Impacto merma por camino.** Si un plato usa la misma base por dos preparaciones, una medida y otra no, solo el camino de la no medida suma «Impacto merma».
