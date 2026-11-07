# QA · Merma no planeada (#408)

Solo con datos de demostración en staging. Antes: pegar `077_kitchen_waste_lines.sql` (la tabla `kitchen_waste_lines`) en Staging. Sin la migración la línea de Rentabilidad dice ⚑ Falta y nada se rompe.

1. **Borrador de Milton.** Desde el bot o la app de cocina manda como cocinero demo: «tiramos 3 kg de tomate demo y 2 l de leche demo». En Cocina (como gerente) aparece «Merma por confirmar» con dos líneas marcadas «Borrador de Milton». No se ve ningún precio.
2. **No cuenta todavía.** En Rentabilidad, «Merma no planeada» sigue en ⚑ Falta: un borrador no cuenta.
3. **Confirmar en línea.** En Cocina cada línea trae el ingrediente que Milton adivinó, ya elegido; cámbialo o déjalo en blanco si no es ese. Ajusta la cantidad y pulsa «Confirmar». La línea sale de la lista en un solo clic.
4. **Se valora al precio de compra.** En Rentabilidad la línea «Merma no planeada» muestra un monto (cantidad × precio de compra por unidad comprada, sin merma encima) en «Hasta ayer» y la proyección, con «x,x % de tus ventas». La proyección usa tus días abiertos; si no tienes días abiertos definidos, lo dice («días calendario»).
5. **Sin costo.** Reporta un producto demo sin precio o sin unidad y confírmalo. En el historial de Cocina aparece con su cantidad y la etiqueta «Sin costo»; no entra al total en $ y nunca es $0. Debajo de la tabla de Rentabilidad: «x % valorado» y el enlace «Agregar precios que faltan».
6. **Vencido.** Un borrador de más de 7 días aparece en el historial como «Vencido» y no cuenta; aun así lo puedes confirmar a mano.
7. **Planeado vs reportado.** Debajo de la tabla: «Hasta ayer, de lo que compraste: planeaste X % de merma, reportaste Y %: $Z de diferencia». Con más de un restaurante dice «en todos tus restaurantes» (las compras son de toda la empresa).
8. **Roles.** Con un usuario de cocina (o analista/lector) no se ve «Merma por confirmar» ni valores; solo propietario, administrador y gerente confirman.
9. **Móvil (390 px).** Cocina y Rentabilidad se leen sin scroll horizontal ni pestañas. La merma no aparece en el costo de ningún plato.
