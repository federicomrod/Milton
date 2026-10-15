# R1-18 — Menú › Resumen as the menu's cockpit

Spec: Sofia's `proposal.md` + mocks 1–3. No migration.

## What moved where
- **Costos** now starts with «Configura tus costos · n de 4» (`components/restaurant/costs/CostsSetupSection.tsx`): the checklist and its next-step button, the card «Último archivo» (the SAME `PriceCatalogPanel`: file, chips listos / por confirmar / preparaciones / con dos costos, «Recetas de tu archivo» with Deshacer lote, «Costos por decidir»), «Leer tu menú web (opcional)» folded, the «⋯» menu (undo a load, Empezar de nuevo). Handlers and endpoints are unchanged (upload → prepare the dishes in chunks, undo batch, reset); the prepare loop moved as is to `lib/restaurant/recipe-costing/prepare-from-upload.ts`. Complete → one line «Costos configurados · archivo de hace N días · Subir nuevo» that expands. It reads the same Resumen workspace payload (through the Menú tab cache, so Menú gets it for free).
- **Resumen** has no setup block any more.

## Resumen (one page, 1280×800)
Range control (7 días / mes de la última venta / 90 días), four KPIs, Top platos por ventas, Mejor / Peor margen, Pendientes (290 px) with ONE «Ir a Costos →».

**Speed**: like Cockpit v2, ONE dataset after the page paints (`GET /api/restaurant/menu-resumen-days`: sales per day, restaurant and product — the Cockpit's own read, the SQL rollup when applied, business day and POS timezone included — plus each menu dish's variants with cost and status). Range, KPIs, Top, rankings and Pendientes are then computed in the browser (`lib/restaurant/menu-resumen.ts`, ~1 ms): no navigation, no spinner. The dish roll-up is the loader's own `rollupLeaves`, and the KPIs count only covered (approved) variants exactly like `totalsOf`, so the numbers equal Platos'.

- **Canal is not offered**: the day × product read has no channel, and the brief says to hide it rather than invent an endpoint.
- Missing price = «Sin precio» / «margen —», never $0 or 0%; an uncosted dish is out of cost KPIs, margin and rankings.
- **Rankings**: top / bottom 3 by margin %, only dishes with an approved cost (`marginRankings`, `MIN_RANKED_DISHES = 3`), always «margen de N de M platos» with a coverage bar; under 3: empty state + a link. `RANKING_INCLUDES_ESTIMATED = false` (one constant). AI-estimated dishes carry an «IA» chip wherever they appear (their per-dish margin in Top platos, and in the rankings if the constant is flipped).
- **Pendientes**: Precios por completar (ingredients, from the loader) → Ingredientes · Falta precio; Platos sin receta → Platos · Sin receta; Costos estimados por IA → Platos · Estimado; «Sube tus costos más recientes» with the file name and age; everything complete → «Menú completo».
