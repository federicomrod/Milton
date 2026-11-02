# QA · Merma visible en Menú › Ingredientes

Solo con datos de demostración en staging. Es solo visualización: no escribe en recetas.

1. **Costo real.** Abre Menú › Ingredientes y elige «Aceite demo» (precio $10/kg, sin merma propia). Junto a «Precio actual» aparece «Costo real (con merma)» en azul, por ejemplo $10,50, con la nota «Merma de cocina 5 % (general)».
2. **Merma propia.** En el bloque «Merma» (borde azul claro) pulsa «Definir», escribe 20 y guarda. Sin recargar la página, el costo real pasa a $12,50 y la nota dice «Merma propia 20 %».
3. **Impacto en «Se usa en».** Más abajo, en la tabla «Se usa en», la columna «Impacto merma» muestra el costo extra de cada línea (por ejemplo +$5,00 para 2 kg). Cambia la merma otra vez y comprueba que los números cambian al instante.
4. **Preparación medida.** Si el ingrediente está en una preparación con «rinde» confirmado, esa fila muestra «—» (no se suma otra merma). Una preparación con «1 orden» supuesto sí muestra el extra.
5. **Sin precio.** Con «Sin precio» o precio 0 en un ingrediente, el panel dice «Sin precio» y cada fila de la columna dice ⚑ Falta. Nunca $0.
6. **Mismo número que el editor.** Abre un plato que use el ingrediente: el «costo efectivo» de esa línea menos el «costo bruto» es igual al impacto de la tabla.
7. **Móvil (390 px) y cocina.** En un celular el panel y la tabla se leen sin scroll horizontal ni pestañas. Con un usuario de cocina no aparecen ni el costo real ni la columna.
