# QA · Aprobar costos fijos en línea

Costos › Costos fijos, como dueño, administrador o encargado. Datos de demo. Probar también a 360 px de ancho.

## Causa raíz (lo que fallaba)
1. Sube un archivo con 5 líneas: Nómina (Planilla), Renta (Alquiler), Luz y Agua (Servicios), Gastos varios (Otros). Antes de aprobar, los campos de arriba están vacíos y el **Total de costos fijos** muestra «—» (nunca $0).
2. Pulsa **Aprobar todo (5 · $X)**. **La página no se recarga**, no sale ningún modal. Al instante: Planilla, Alquiler, Servicios (Luz + Agua sumadas) y Otros muestran su total («Suma de las líneas aprobadas»), el **Total de costos fijos** sube y el **punto de equilibrio** cambia de «Falta» a un número. El campo cambiado y el punto de equilibrio se resaltan un momento en azul.
3. Tres clics o menos desde que subes el archivo hasta ver los totales (archivo → Aprobar todo).

## En línea
4. Cada línea muestra concepto, monto, la categoría como etiqueta editable, y en gris pequeño «Mes pasado: $…». Acciones: **✓ Aprobar**, **✎ Editar** (monto), **Omitir**.
5. **✓ Aprobar** en una línea: aparece «Agua +$650 → Servicios» con **Deshacer** unos 5 segundos. La línea pasa a **«Aprobadas (n)»** (cerrado) bajo su categoría, no desaparece.
6. **Deshacer**: la categoría y la línea vuelven a como estaban. Si ese valor se cambió a mano después, no se toca y avisa.
7. Aprobar Luz y luego Agua por separado: Servicios = suma (1,800 + 650 = 2,450).
8. Corta la red (o fuerza un error) y pulsa Aprobar: la línea vuelve a pendiente, el campo no cambia y sale «No se pudo guardar. Deshice el cambio.».
9. Una línea ⚑ Falta (sin categoría o sin monto) queda **arriba**, bajo «Corrige primero», y no cuenta en «Aprobar todo (n · $X)». Al corregirla pasa a su categoría.
10. **Mes pasado**: si una categoría cambia más de 20 % frente al mes pasado sale una etiqueta amarilla pequeña («+34 % vs mes pasado»); con 20 % o menos, nada.

## Reglas que siguen igual
11. Líneas de la misma categoría se suman. Dos tasas de Impuestos se marcan ⚑ Falta y no se suman.
12. Si el valor que ya tenías viene de otro lado (a mano o de un archivo anterior), sale «Esto reemplaza valores que ya tienes» con antes → ahora, en la misma pantalla (sin ventana).
13. Una categoría guardada desde un archivo es un total de solo lectura; **Editar a mano** abre el campo. Una categoría sin líneas conserva su campo manual.
14. es / en / de: todos los textos nuevos. Sin cajas amarillas (solo etiquetas pequeñas).
