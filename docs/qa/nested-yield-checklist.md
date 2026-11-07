# QA · Regla de rendimiento en preparaciones anidadas (#407)

Solo con datos de demostración en staging. Es costo de lectura: nada se escribe en recetas aprobadas. Regla: una sola merma por línea de ingrediente (merma propia, o ninguna si una preparación superior tiene rendimiento medido, o la merma de cocina).

## a) Plato con una preparación medida
1. En Menú › Preparaciones elige «Salsa demo» y confirma «rinde 6,5 kg».
2. Abre «Salsa demo»: cada ingrediente dice «preparación medida (sin colchón)», sin merma de cocina.
3. Abre un plato demo que use la salsa: las líneas de ingredientes propios del plato dicen «merma de cocina 5 %»; la línea de la salsa no cambia.

## b) Plato › preparación › preparación, solo la de arriba medida
1. «Base demo» (medida) usa «Salsa demo» (sin medir) que usa «Cebolla demo» (sin medir).
2. Abre «Salsa demo» y «Cebolla demo»: sus ingredientes dicen «preparación medida», nunca «merma de cocina».
3. Las dos preparaciones de abajo muestran ⚑ falta rendimiento; la de arriba no.

## c) Preparación con «1 orden» supuesto
1. Abre una preparación importada de Excel que rinde «1 orden».
2. Junto al título se ve la etiqueta amarilla pequeña **⚑ falta rendimiento**, sin abrir pestañas.
3. Sus ingredientes dicen «merma de cocina 5 %»; la preparación misma no lleva merma.
4. En un plato que la use, la línea de la preparación también muestra ⚑ falta rendimiento.
5. Escribe el rendimiento real («rinde 6,5 kg») y confirma: la etiqueta desaparece y los ingredientes pasan a «preparación medida».

## d) Merma propia dentro de una preparación medida
1. En «Salsa demo» (medida) pon a «Tomate demo» una merma propia de 35 %.
2. Solo «Tomate demo» muestra «merma propia 35 %» y su costo efectivo es costo ÷ (1 − 0,35); se aplica una vez, sin merma de cocina encima.
3. Los demás ingredientes siguen sin factor.

## e) Precio faltante
1. Quita el precio a un ingrediente de un plato demo.
2. La línea muestra «Sin precio» / ⚑ Falta, nunca $0; no hay costo efectivo y no cuenta en el total.
3. El plato sigue pendiente hasta registrar el precio.

## f) Vista móvil, 390 px
1. Abre las pantallas de (c) en un celular o con la ventana a 390 px.
2. La etiqueta ⚑ falta rendimiento cabe en la línea (puede bajar de renglón) y no hay scroll horizontal.
3. Un cocinero no ve precios ni costos.
