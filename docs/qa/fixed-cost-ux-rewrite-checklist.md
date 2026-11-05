# QA · Costos fijos: subir, aprobar y ver el punto de equilibrio (rediseño)

Menos de 2 minutos. Staging, con una cuenta de propietario, administrador o gerente.
Usa un archivo de **datos de demostración** (nunca uno de un cliente real) con estas 5 líneas
para un restaurante de prueba, mes actual:

| Concepto | Monto |
| --- | --- |
| Nómina demo | 20,000 |
| Renta demo | 7,000 |
| Luz demo | 1,800 |
| Agua demo | 650 |
| Gastos varios demo | 500 |

Añade una sexta línea: `Gas · Sucursal Inventada · 900`.

Hazlo en un celular de **360 px** de ancho (o la ventana del navegador estrecha) y repite lo
esencial en escritorio.

## 1. Antes de subir (10 s)
- [ ] Costos › Costos fijos, mes sin datos: 5 tarjetas (Planilla, Alquiler, Servicios, Impuestos, Otros).
- [ ] Cada una dice «Sin dato · subir factura o escribir» y tiene **un solo** campo.
- [ ] El punto de equilibrio dice «Añade costos fijos para ver el punto de equilibrio». No hay ningún número inventado.
- [ ] «Total de costos fijos» muestra «—», nunca $0.

## 2. Subir (20 s)
- [ ] «⇪ Subir archivo» está arriba, sin pestañas. Sube el archivo de prueba.
- [ ] Arriba aparece «Revisa lo que Milton leyó». Cada línea: concepto, monto, categoría editable (chip azul) y, si hay dato, «vs mes pasado: +12%» en gris pequeño.
- [ ] La línea de Gas dice **«⚑ Falta · ¿A qué restaurante?»** con un selector, y está **arriba** del todo. No hay ninguna bandera suelta junto a $900.
- [ ] «Aprobar todo (5 · $29,950)» cuenta solo las 5 aprobables (no la de Gas).

## 3. Aprobar todo (15 s, ≤3 toques)
- [ ] Toca «Aprobar todo». Sin recargar la página y sin ventana emergente:
  - [ ] Planilla $20,000 · Alquiler $7,000 · Servicios $2,450 («Luz + Agua») · Otros $500, cada tarjeta con «desde factura · Editar».
  - [ ] Esas tarjetas **ya no tienen** el campo vacío ni «Sin dato».
  - [ ] «Total de costos fijos» = $29,950 exacto.
  - [ ] El punto de equilibrio **cambió** (ahora hay un número) y parpadea un instante en azul (#1B40C8).
  - [ ] No hay «Aprobadas (n)» ni nada que desplegar. El botón «Aprobar todo» desapareció (nunca «0 · $0»).
- [ ] Responde la línea de Gas: elige el restaurante en el selector → ya tiene ✓ Aprobar. Aprueba. Aparece el aviso «Gas +$900 → Otros» y Otros pasa a $1,400.

## 4. Deshacer (10 s)
- [ ] Mientras el aviso sigue (≈5 s) toca «Deshacer»: la tarjeta y el punto de equilibrio vuelven a su valor anterior, y la línea vuelve a la lista.
- [ ] Si otra persona cambió ese valor entre tanto, Deshacer no toca nada y lo dice (todo o nada).

## 5. Ya hay datos (20 s)
- [ ] Sube otro archivo con `Nómina demo · 22,100`. La línea dice «Planilla hoy $20,000 · la factura propone $22,100».
- [ ] Sus botones son **Reemplazar** y **Sumar (→ $42,100)**. «Aprobar todo» no la incluye y avisa «1 líneas esperan tu decisión».
- [ ] Reemplazar → la tarjeta pasa a $22,100. Repite y elige Sumar → suma. Impuestos solo ofrece Reemplazar (una tasa no se suma).

## 6. Escribir a mano (15 s)
- [ ] En una tarjeta vacía escribe un monto y toca «Guardar»: la tarjeta pasa a «escrito a mano · Editar» y el campo desaparece.
- [ ] «Editar» en una tarjeta con monto abre el campo ahí mismo (sin salir de la página); Guardar actualiza total y punto de equilibrio.
- [ ] Un texto que no es número (`12x`) no se puede guardar.

## 7. Errores y permisos (10 s)
- [ ] Si el guardado falla (sin red), la línea vuelve a la lista y el error aparece **en esa línea**; la tarjeta no cambia.
- [ ] Un usuario sin permiso (analista, viewer, cocinero) no puede subir ni aprobar.

## 8. Idiomas y colores
- [ ] es / en / de: todo el flujo traducido; «plato», nunca «platillo».
- [ ] Solo azul de la app; sin rojo, verde ni naranja. El amarillo solo en etiquetas pequeñas ⚑; lavanda solo en «Leído por Milton».
