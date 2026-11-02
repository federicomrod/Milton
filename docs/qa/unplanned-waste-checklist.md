# QA · Merma no planeada (#408)

Solo con datos de demostración en staging. Antes: pegar `077_kitchen_waste_lines.sql` (la tabla `kitchen_waste_lines`) en Staging. Sin la migración la línea de Rentabilidad dice ⚑ Falta y nada se rompe.

1. **Borrador de Milton.** Desde el bot o la app de cocina manda como cocinero demo: «tiramos 3 kg de tomate demo y 2 l de leche demo». En Cocina (como gerente) aparece «Merma por confirmar» con dos líneas marcadas «Borrador de Milton». No se ve ningún precio.
2. **No cuenta todavía.** En Rentabilidad, «Merma no planeada» sigue en ⚑ Falta: un borrador no cuenta.
3. **Confirmar en línea.** En Cocina cambia la cantidad de una línea si hace falta y pulsa «Confirmar». La línea desaparece de la lista en un solo clic.
4. **Se valora al costo de ese día.** En Rentabilidad la línea «Merma no planeada» ya muestra un monto en «Hasta ayer» y la proyección (promedio diario × días del mes), con «x,x % de tus ventas».
5. **Sin precio o sin cantidad.** Reporta un producto demo sin precio, o sin cantidad, y confírmalo. Se cuenta, pero la fila muestra ⚑ Falta y nunca $0.
6. **Planeado vs reportado.** Debajo de la tabla: «Hasta ayer, de lo que compraste: planeaste X % de merma, reportaste Y %: $Z de diferencia».
7. **Roles.** Con un usuario de cocina (o analista/lector) no se ve «Merma por confirmar» ni valores; solo propietario, administrador y gerente confirman.
8. **Móvil (390 px).** Cocina y Rentabilidad se leen sin scroll horizontal ni pestañas. La merma no aparece en el costo de ningún plato.
