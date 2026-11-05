# QA · Costos fijos v3 (mocks de Sofia)

Menos de 2 minutos. Staging, cuenta de propietario, administrador o gerente, **después de que Fede limpie** los costos fijos y los borradores de carga del restaurante demo. Usa un archivo de **datos de demostración** (nunca de un cliente real):

| Concepto | Monto |
| --- | --- |
| Nómina demo | 21,400 |
| Renta demo | 6,500 |
| Agua demo | 650 |
| Seguro demo | 3,250 |

más una línea `Gas · Sucursal Inventada · 900`.

Pantalla de laptop (menú de Milton a la izquierda, contenido ~880 px). Repite lo esencial en **360 px**.

## 1. Primera visita (vacío) · 15 s
- [ ] Costos › Costos fijos: arriba `‹ Noviembre 2026 ›`; la tarjeta dice «Costos fijos · noviembre 2026» y «Lo que pagas cada mes aunque no vendas. Sube una factura o escribe el monto.»
- [ ] Zona punteada «Suelta una factura o PDF» con el botón «⇪ Subir factura».
- [ ] Las 5 tarjetas (Planilla, Alquiler, Servicios, Impuestos, Otros) dicen «Sin dato · subir factura o escribir», con «Subir» (texto azul) y «Escribir» (borde). **Sin monto y sin campo.**
- [ ] A la derecha: «Con estos costos, necesitas vender — al día», «Añade costos fijos para ver el punto de equilibrio», «Total costos fijos —», «Confirmados 0 de 5». Ningún $ inventado.
- [ ] No existe ningún texto «Más $X del grupo». No hay «Aprobadas (n)».

## 2. Subir y aprobar · 40 s
- [ ] Arrastra el archivo a la zona (o «Subir factura»). Arriba aparece «Revisa lo que Milton leyó».
- [ ] La línea de Gas dice **«Gas $900 ⚑ Falta · ¿A qué restaurante?»** con «Asignar» (azul) y «Omitir», arriba de todo; el encabezado muestra la etiqueta amarilla «⚑ Falta · Gas».
- [ ] «Aprobar todo (4 · $31,800)»: cuenta solo las 4 aprobables.
- [ ] Toca «Aprobar todo» (sin recargar, sin ventana):
  - [ ] Planilla $21,400 · Alquiler $6,500 · Servicios $3,900, cada una con «{concepto} · desde factura» y «Editar».
  - [ ] Servicios muestra debajo «Agua $650» y «Seguro $3,250» (la tarjeta es su suma). **No** hay campo vacío junto a un monto.
  - [ ] Costos fijos total = $31,800 exacto; el punto de equilibrio pasa de «—» a un número («$X al día», «desde $31,800 costos fijos · N días abiertos») y parpadea en azul.
  - [ ] «4 de 5 confirmados» en el encabezado y «Confirmados 4 de 5» a la derecha.
  - [ ] El botón «Aprobar todo» desaparece (nunca «0 · $0»).
- [ ] «Asignar» en Gas → elige el restaurante → ya se puede aprobar (✓). Aviso «Gas +$900 → {su grupo}» abajo, con «Deshacer».

## 3. Deshacer · 10 s
- [ ] En ~5 s toca «Deshacer»: la tarjeta y el punto de equilibrio vuelven atrás, la línea vuelve a la lista. Si alguien cambió ese valor, no toca nada y lo dice.

## 4. Ya hay datos · 20 s
- [ ] Sube otro archivo con `Nómina demo · 22,100`: «Planilla hoy $21,400 · la factura propone $22,100», botones «Reemplazar» (azul) y «Sumar (→ $43,500)». Impuestos solo ofrece «Reemplazar».
- [ ] «Aprobar todo» no la incluye hasta que elijas.
- [ ] Una línea con error de guardado vuelve a la lista y el error sale **en esa línea**; la tarjeta no queda con monto fantasma.

## 5. Escribir, editar, repetir · 20 s
- [ ] «Escribir» en una tarjeta vacía abre UN campo con «Guardar»; al guardar queda «escrito a mano · Editar».
- [ ] «Editar» abre el campo en la misma fila.
- [ ] Interruptor «Se repite cada mes» por fila: guarda solo esa fila y conserva «desde factura».
- [ ] «Copiar octubre» (arriba a la derecha, solo con datos): avisa cuántos copió o que no había nada que repetir.
- [ ] Impuestos 13 %: «Tus ventas incluyen IVA: Milton resta 13 ÷ 113 de cada venta».

## 6. Selector de mes · 15 s
- [ ] ‹ y › miden 44 px, cambian de gris a tinta al pasar el mouse y se hunden al pulsar (feedback inmediato).
- [ ] Al cambiar de mes: el título cambia al instante y las tarjetas muestran un esqueleto; **nunca** los números del mes anterior bajo el nombre nuevo. Sin recarga completa. Objetivo <500 ms; más de 2 s es un fallo.
- [ ] En el mes actual, › está deshabilitado y dice «Mes futuro» al pasar el mouse.

## 7. Idiomas, colores, permisos
- [ ] es / en / de completos; «plato», nunca «platillo».
- [ ] Solo azul de la app (#1B40C8). Sin rojo, verde ni naranja; amarillo solo en etiquetas pequeñas ⚑; lavanda solo en «Leído por Milton».
- [ ] 360 px sin scroll horizontal; el punto de equilibrio queda fijo abajo.
- [ ] Analista, viewer o cocinero no pueden subir ni aprobar.
